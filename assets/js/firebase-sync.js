(function(){
  "use strict";

  const APP_STORAGE_KEY = "meadevil-app-v2";
  const CLOUD_DOC_VERSION = 1;
  const DEFAULT_SYNC_DEBOUNCE_MS = 1200;
  const CLOUD_COLLECTION = "meadevilApp";
  const SHARED_DOC_ID = "meadevil-shared";

  const status = {
    enabled: false,
    authReady: false,
    dbReady: false,
    user: null,
    lastPushAt: null,
    lastPullAt: null,
    lastError: null,
    mode: "local"
  };

  let db = null;
  let auth = null;
  let userRef = null;
  let syncTimer = null;
  let booted = false;
  let suppressPush = false;

  function log(...args){
    console.log("[Meadevil Firebase Sync]", ...args);
  }

  function warn(...args){
    console.warn("[Meadevil Firebase Sync]", ...args);
  }

  function setStatus(patch){
    Object.assign(status, patch || {});
    updateSyncPill();
  }

  function updateSyncPill(){
    const pill = document.querySelector(".sync-pill");
    if (!pill) return;

    let label = "Ledger mode";
    if (status.mode === "local") label = "Local only";
    if (status.mode === "auth") label = "Signing in";
    if (status.mode === "cloud") label = "Cloud sync";
    if (status.mode === "error") label = "Sync issue";

    pill.innerHTML = '<span class="sync-dot"></span><span>' + label + "</span>";
    pill.title = [
      "Mode: " + status.mode,
      "Cloud doc: " + SHARED_DOC_ID,
      status.user ? "Signed in: " + status.user.uid : "Signed in: none",
      status.lastPullAt ? "Last pull: " + new Date(status.lastPullAt).toLocaleString() : "Last pull: never",
      status.lastPushAt ? "Last push: " + new Date(status.lastPushAt).toLocaleString() : "Last push: never",
      status.lastError ? "Last error: " + status.lastError : "Last error: none"
    ].join("\n");
  }

  function hasFirebaseConfig(){
    return Boolean(
      window.MEADEVIL_FIREBASE &&
      window.MEADEVIL_FIREBASE.apiKey &&
      window.MEADEVIL_FIREBASE.projectId &&
      window.MEADEVIL_FIREBASE.appId
    );
  }

  function getLocalData(){
    try{
      const raw = localStorage.getItem(APP_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(error){
      warn("Could not parse local data", error);
      return null;
    }
  }

  function setLocalData(payload){
    suppressPush = true;
    try{
      localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(payload));
      window.dispatchEvent(new CustomEvent("meadevil-cloud-restore", { detail: { restored: true } }));
    } finally {
      setTimeout(() => { suppressPush = false; }, 50);
    }
  }

  function clone(value){
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function toTimestamp(value){
    const stamp = new Date(value || 0).getTime();
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function list(value){
    return Array.isArray(value) ? value : [];
  }

  function stampAppData(payload, updatedAt){
    const stamped = clone(payload) || {};
    stamped.meta = {
      ...((stamped || {}).meta || {}),
      updatedAt: updatedAt || new Date().toISOString(),
      syncDocId: SHARED_DOC_ID
    };
    return stamped;
  }

  function appDataStamp(payload, fallback){
    return toTimestamp(payload?.meta?.updatedAt || payload?.updatedAt || fallback || 0);
  }

  function mergeByKey(localItems, cloudItems, keyFn, stampFn){
    const merged = new Map();

    function upsert(item){
      if (!item) return;
      const key = String(keyFn(item) || "");
      if (!key) return;
      const incomingStamp = Number(stampFn(item) || 0);
      const existing = merged.get(key);
      if (!existing){
        merged.set(key, clone(item));
        return;
      }
      const existingStamp = Number(stampFn(existing) || 0);
      if (incomingStamp >= existingStamp){
        merged.set(key, clone(item));
      }
    }

    list(localItems).forEach(upsert);
    list(cloudItems).forEach(upsert);
    return Array.from(merged.values());
  }

  function logKey(entry){
    if (!entry) return "";
    return String(
      entry.sourceId ||
      entry.id ||
      [
        entry.telemetryAt || "",
        entry.createdAt || "",
        entry.date || "",
        entry.gravity || "",
        entry.temp || "",
        entry.note || ""
      ].join("|")
    );
  }

  function mergeFermentationLogs(localData, cloudData){
    const logs = mergeByKey(
      localData?.fermentationLogs,
      cloudData?.fermentationLogs,
      logKey,
      (entry) => toTimestamp(entry?.telemetryAt || entry?.createdAt || entry?.date)
    );
    logs.sort((a, b) => toTimestamp(a?.telemetryAt || a?.createdAt || a?.date) - toTimestamp(b?.telemetryAt || b?.createdAt || b?.date));
    return logs;
  }

  function mergeArchive(localData, cloudData){
    const merged = mergeByKey(
      localData?.archive,
      cloudData?.archive,
      (entry) => entry?.id || entry?.archivedAt,
      (entry) => toTimestamp(entry?.archivedAt || entry?.batch?.loadedAt)
    );

    return merged.map((entry) => ({
      ...entry,
      fermentationLogs: mergeFermentationLogs(
        { fermentationLogs: entry?.fermentationLogs || [] },
        { fermentationLogs: [] }
      )
    }));
  }

  function buildMergedAppData(localData, cloudData, cloudUpdatedAt){
    if (!localData && !cloudData) return stampAppData({}, cloudUpdatedAt);
    if (!localData) return stampAppData(cloudData, cloudUpdatedAt);
    if (!cloudData) return stampAppData(localData, new Date().toISOString());

    const local = clone(localData) || {};
    const cloud = clone(cloudData) || {};
    const localStamp = appDataStamp(local);
    const cloudStamp = appDataStamp(cloud, cloudUpdatedAt);
    const localLogCount = list(local.fermentationLogs).length;
    const cloudLogCount = list(cloud.fermentationLogs).length;
    const localArchiveCount = list(local.archive).length;
    const cloudArchiveCount = list(cloud.archive).length;
    const preferCloud = cloudStamp > localStamp && cloudLogCount >= localLogCount && cloudArchiveCount >= localArchiveCount;
    const primary = preferCloud ? cloud : local;
    const secondary = preferCloud ? local : cloud;
    const merged = { ...clone(secondary), ...clone(primary) };
    merged.calcs = {
      ...clone((secondary || {}).calcs || {}),
      ...clone((primary || {}).calcs || {})
    };

    merged.fermentationLogs = mergeFermentationLogs(local, cloud);
    merged.recipes = mergeByKey(
      local.recipes,
      cloud.recipes,
      (entry) => entry?.id,
      (entry) => toTimestamp(entry?.updatedAt || entry?.createdAt)
    );
    merged.archive = mergeArchive(local, cloud);
    merged.meta = {
      ...((secondary || {}).meta || {}),
      ...((primary || {}).meta || {}),
      updatedAt: new Date(Math.max(localStamp, cloudStamp, Date.now())).toISOString(),
      syncDocId: SHARED_DOC_ID
    };
    return merged;
  }

  function cloudDocRef(){
    return db.collection(CLOUD_COLLECTION).doc(SHARED_DOC_ID);
  }

  async function ensureAuth(){
    if (!auth) throw new Error("Firebase auth not ready");
    const existing = auth.currentUser;
    if (existing){
      setStatus({ authReady: true, user: existing, mode: "cloud" });
      return existing;
    }
    setStatus({ mode: "auth" });
    const result = await auth.signInAnonymously();
    const user = result.user || auth.currentUser;
    setStatus({ authReady: true, user, mode: "cloud" });
    return user;
  }

  async function pullFromCloudPreferLocal(){
    if (!userRef) return;
    const snapshot = await userRef.get();
    if (!snapshot.exists){
      log("No cloud doc found yet");
      return;
    }

    const cloud = snapshot.data() || {};
    const cloudData = cloud.appData || null;
    if (!cloudData) return;

    const local = getLocalData();
    if (!local){
      setLocalData(stampAppData(cloudData, cloud?.updatedAt));
      setStatus({ lastPullAt: Date.now() });
      log("Restored cloud data to empty local store");
      return;
    }

    const mergedData = buildMergedAppData(local, cloudData, cloud?.updatedAt);
    const localRaw = JSON.stringify(local);
    const mergedRaw = JSON.stringify(mergedData);
    const cloudRaw = JSON.stringify(stampAppData(cloudData, cloud?.updatedAt));

    if (mergedRaw !== localRaw){
      setLocalData(mergedData);
      setStatus({ lastPullAt: Date.now() });
      log("Reconciled local data with shared cloud data");
    } else {
      setStatus({ lastPullAt: Date.now() });
      log("Shared cloud data already matched local");
    }

    if (mergedRaw !== cloudRaw){
      const updatedAt = new Date().toISOString();
      await userRef.set({
        version: CLOUD_DOC_VERSION,
        appId: "meadevil-app",
        updatedAt,
        appData: stampAppData(mergedData, updatedAt)
      }, { merge: true });
      log("Updated shared cloud doc with reconciled app data");
    }
  }

  async function pushLocalToCloud(){
    if (!userRef || suppressPush) return;
    const local = getLocalData();
    if (!local) return;
    const updatedAt = new Date().toISOString();

    const payload = {
      version: CLOUD_DOC_VERSION,
      appId: "meadevil-app",
      updatedAt,
      appData: stampAppData(local, updatedAt)
    };

    await userRef.set(payload, { merge: true });
    setStatus({ lastPushAt: Date.now(), mode: "cloud" });
  }

  function schedulePush(){
    if (!booted || !userRef || suppressPush) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      pushLocalToCloud().catch((error) => {
        warn("Push failed", error);
        setStatus({ lastError: String(error?.message || error), mode: "error" });
      });
    }, DEFAULT_SYNC_DEBOUNCE_MS);
  }

  function patchLocalStorage(){
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value){
      const result = originalSetItem.apply(this, arguments);
      if (this === localStorage && key === APP_STORAGE_KEY && !suppressPush){
        schedulePush();
      }
      return result;
    };
  }

  function bindVisibilitySync(){
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden"){
        pushLocalToCloud().catch((error) => {
          warn("Background push failed", error);
        });
      }
    });
  }

  async function bootFirebaseSync(){
    updateSyncPill();

    try{
      if (window.MEADEVIL_FIREBASE_READY && typeof window.MEADEVIL_FIREBASE_READY.then === "function"){
        await window.MEADEVIL_FIREBASE_READY;
      }
    } catch (error){
      warn("Firebase config bootstrap failed", error);
    }

    if (!hasFirebaseConfig()){
      const localHtmlMessage = "Missing Firebase config. Copy config/firebase/meadevil-firebase-config.example.js to config/firebase/meadevil-firebase-config.local.js for local HTML use.";
      const genericMessage = "No Firebase config found. Staying local-only.";
      const message = window.location.protocol === "file:" ? localHtmlMessage : genericMessage;
      if (window.location.protocol === "file:") {
        warn(message);
      } else {
        console.info(`[Meadevil Firebase Sync] ${message}`);
      }
      setStatus({ enabled: false, mode: "local", lastError: message });
      return;
    }

    if (!window.firebase){
      warn("Firebase SDK missing. Staying local-only.");
      setStatus({ enabled: false, mode: "local", lastError: "Firebase SDK missing" });
      return;
    }

    try{
      const app = firebase.apps.length
        ? firebase.app()
        : firebase.initializeApp(window.MEADEVIL_FIREBASE);

      auth = firebase.auth(app);
      db = firebase.firestore(app);

      setStatus({ enabled: true, dbReady: true, mode: "auth" });

      const user = await ensureAuth();
      userRef = cloudDocRef();

      patchLocalStorage();
      bindVisibilitySync();
      await pullFromCloudPreferLocal();

      booted = true;
      schedulePush();

      auth.onAuthStateChanged((nextUser) => {
        if (nextUser){
          userRef = cloudDocRef();
          setStatus({ user: nextUser, authReady: true, mode: "cloud" });
        } else {
          userRef = null;
          setStatus({ user: null, authReady: false, mode: "auth" });
        }
      });

      log("Firebase sync ready");
    } catch (error){
      warn("Firebase sync boot failed", error);
      setStatus({ enabled: false, mode: "error", lastError: String(error?.message || error) });
    }
  }

  document.addEventListener("DOMContentLoaded", bootFirebaseSync);
})();
