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
    const when = updatedAt || new Date().toISOString();
    // Preserve the real save time the app stamped into the envelope so cross-device
    // reconciliation can tell which copy is newer; only fall back to "now" if the
    // payload never carried a schema stamp (legacy or empty state).
    if (stamped._schema && typeof stamped._schema === "object"){
      stamped._schema = { ...stamped._schema, savedAt: stamped._schema.savedAt || when };
    }
    stamped.meta = {
      ...((stamped || {}).meta || {}),
      updatedAt: when,
      syncDocId: SHARED_DOC_ID
    };
    return stamped;
  }

  // The app persists state as an envelope: { _schema: { savedAt }, data: {...} }.
  // The real working state lives under .data, so the sync layer has to unwrap it
  // before merging — otherwise recipes/logs/archive look empty and the whole blob
  // gets clobbered by whichever side is "newer".
  function unwrapEnvelope(payload){
    if (payload && typeof payload === "object" && payload.data && payload._schema){
      return { schema: clone(payload._schema), data: clone(payload.data) || {} };
    }
    return { schema: null, data: clone(payload) || {} };
  }

  function appDataStamp(payload, fallback){
    if (!payload || typeof payload !== "object") return 0;
    const schema = payload._schema && typeof payload._schema === "object" ? payload._schema : null;
    return toTimestamp(
      (schema && (schema.savedAt || schema.exportedAt)) ||
      payload?.meta?.updatedAt ||
      payload?.updatedAt ||
      fallback ||
      0
    );
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

  // fermentationLogs/recipes/archive are unioned by id above so an offline device
  // never silently loses another device's entries — but that union has no idea
  // what a "delete" is. The app records a tombstone for every removal (see
  // recordTombstones in app.js); merge those here and strip the dead ids back out
  // of the union, or every deletion would quietly resurrect on the next sync.
  function tombstoneKey(entry){
    return `${entry?.collection || ""}::${entry?.id || ""}`;
  }

  function mergeTombstones(localTombstones, cloudTombstones){
    const merged = new Map();
    list(localTombstones).concat(list(cloudTombstones)).forEach((entry) => {
      if (!entry || !entry.collection || !entry.id) return;
      const key = tombstoneKey(entry);
      const existing = merged.get(key);
      if (!existing || toTimestamp(entry.deletedAt) > toTimestamp(existing.deletedAt)){
        merged.set(key, clone(entry));
      }
    });
    return Array.from(merged.values());
  }

  function tombstonedIdSet(tombstones, collection){
    const ids = new Set();
    list(tombstones).forEach((entry) => {
      if (entry && entry.collection === collection && entry.id) ids.add(String(entry.id));
    });
    return ids;
  }

  function stripTombstoned(items, tombstoneSet){
    return list(items).filter((item) => !tombstoneSet.has(String(item?.id || "")));
  }

  function buildMergedAppData(localPayload, cloudPayload, cloudUpdatedAt){
    if (!localPayload && !cloudPayload) return stampAppData({}, cloudUpdatedAt);
    if (!localPayload) return stampAppData(cloudPayload, cloudUpdatedAt);
    if (!cloudPayload) return stampAppData(localPayload, new Date().toISOString());

    const localEnv = unwrapEnvelope(localPayload);
    const cloudEnv = unwrapEnvelope(cloudPayload);
    const local = localEnv.data || {};
    const cloud = cloudEnv.data || {};

    // Compare the stamps the app wrote into each envelope so the most recently
    // saved copy wins for single-value working fields (recipe draft, current
    // batch, nutrients, cellar). This is what lets "clear the page for a new
    // brew" actually stick instead of being overwritten by the stale cloud copy.
    const localStamp = appDataStamp(localPayload);
    const cloudStamp = appDataStamp(cloudPayload, cloudUpdatedAt);
    const localLogCount = list(local.fermentationLogs).length;
    const cloudLogCount = list(cloud.fermentationLogs).length;
    const localArchiveCount = list(local.archive).length;
    const cloudArchiveCount = list(cloud.archive).length;
    const preferCloud = cloudStamp > localStamp && cloudLogCount >= localLogCount && cloudArchiveCount >= localArchiveCount;
    const primary = preferCloud ? cloud : local;
    const secondary = preferCloud ? local : cloud;
    const mergedData = { ...clone(secondary), ...clone(primary) };
    mergedData.calcs = {
      ...clone((secondary || {}).calcs || {}),
      ...clone((primary || {}).calcs || {})
    };

    // History collections stay additive across devices so an archived batch or a
    // logged reading is never lost just because one device hasn't seen it yet —
    // but a deliberate deletion (tombstone) always overrides the union.
    const mergedTombstones = mergeTombstones(local.tombstones, cloud.tombstones);
    mergedData.tombstones = mergedTombstones;

    mergedData.fermentationLogs = stripTombstoned(
      mergeFermentationLogs(local, cloud),
      tombstonedIdSet(mergedTombstones, "fermentationLogs")
    );
    mergedData.recipes = stripTombstoned(
      mergeByKey(
        local.recipes,
        cloud.recipes,
        (entry) => entry?.id,
        (entry) => toTimestamp(entry?.updatedAt || entry?.createdAt)
      ),
      tombstonedIdSet(mergedTombstones, "recipes")
    );
    mergedData.archive = stripTombstoned(
      mergeArchive(local, cloud),
      tombstonedIdSet(mergedTombstones, "archive")
    );

    const mergedSchema = {
      ...(primary === local ? localEnv.schema : cloudEnv.schema) || localEnv.schema || cloudEnv.schema || {},
      savedAt: new Date(Math.max(localStamp, cloudStamp, Date.now())).toISOString()
    };
    return stampAppData({ _schema: mergedSchema, data: mergedData });
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
