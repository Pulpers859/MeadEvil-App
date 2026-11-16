(function(){
  "use strict";

  const APP_STORAGE_KEY = "meadevil-app-v2";
  const CLOUD_DOC_VERSION = 1;
  const DEFAULT_SYNC_DEBOUNCE_MS = 1200;
  const CLOUD_COLLECTION = "meadevilApp";
  const SHARED_DOC_ID = "meadevil-shared";
  // The last state this device and the cloud AGREED on. It is the common
  // ancestor for the three-way merge below: without it the merge cannot tell
  // "this device changed the field" from "this device has simply not seen the
  // other device's change yet", and a stale tab overwrites newer cloud data.
  const SYNC_BASE_KEY = "meadevil-sync-base-v1";
  // Unioned by id (with tombstones); never merged as single values.
  const COLLECTION_KEYS = ["fermentationLogs", "recipes", "archive", "tombstones"];
  // Per-device view state. Syncing it would switch tabs under the user.
  const LOCAL_ONLY_KEYS = ["ui"];
  // Everything that describes THE active batch. If two devices hold different
  // batches these move together, or one batch's pH lands on another's record.
  const BATCH_GROUP_KEYS = ["currentBatch", "cellar", "nutrients", "fermentChecklist", "cellarChecklist", "rapt"];
  const REMOTE_APPLY_QUIET_MS = 4000;
  const RESUME_SYNC_THROTTLE_MS = 15000;

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
  let syncInFlight = null;
  let syncQueued = false;
  let lastInputAt = 0;
  let lastSyncAt = 0;
  let remoteRetryTimer = null;
  let unsubscribeSnapshot = null;

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
    if (status.mode === "offline") label = "Offline";

    pill.innerHTML = '<span class="sync-dot"></span><span>' + label + "</span>";
    pill.dataset.mode = status.mode;
    if (!pill.dataset.bound){
      // Tap to sync now. On a phone there is no hover, so the tooltip below is
      // unreachable; the tap at least gives a way to force a reconcile.
      pill.dataset.bound = "1";
      pill.addEventListener("click", () => { if (status.enabled) syncNow("manual"); });
    }
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
      // Synchronous on purpose. The old 50ms grace window swallowed any save the
      // user made right after a cloud apply — no push was ever scheduled for it.
      // Listeners of meadevil-cloud-restore run inside dispatchEvent above, so
      // nothing legitimate needs the suppression to outlive this call.
      suppressPush = false;
    }
  }

  // Key-order-independent serialisation. Firestore does not preserve map key
  // order, so plain JSON.stringify reports "different" for identical data and
  // every boot rewrote the cloud document.
  function stableStringify(value){
    if (value === undefined) return "null";
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    return "{" + Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
  }

  function same(a, b){
    return stableStringify(a) === stableStringify(b);
  }

  function isPlain(value){
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  // Three-way merge of one value. `base` is undefined when there is no common
  // ancestor (first sync after this code shipped, or a brand-new device).
  function threeWay(base, local, cloud, preferCloud){
    if (same(local, cloud)) return clone(local);
    if (base !== undefined){
      if (same(local, base)) return clone(cloud);
      if (same(cloud, base)) return clone(local);
    } else {
      if (local === undefined) return clone(cloud);
      if (cloud === undefined) return clone(local);
    }
    if (isPlain(local) && isPlain(cloud)){
      const ancestor = isPlain(base) ? base : null;
      const out = {};
      const keys = new Set(Object.keys(local).concat(Object.keys(cloud)));
      keys.forEach((key) => {
        const value = threeWay(ancestor ? ancestor[key] : undefined, local[key], cloud[key], preferCloud);
        if (value !== undefined) out[key] = value;
      });
      return out;
    }
    // Genuine conflict on a single value or a list: both sides changed it.
    return clone(preferCloud ? cloud : local);
  }

  function batchIdentity(data){
    const batch = data && data.currentBatch;
    if (!isPlain(batch)) return "";
    return [batch.loadedAt || "", batch.recipeId || ""].join("|");
  }

  function loadBase(){
    try{
      const parsed = JSON.parse(localStorage.getItem(SYNC_BASE_KEY) || "null");
      if (parsed && parsed.docId === SHARED_DOC_ID && isPlain(parsed.sections)) return parsed;
    }catch(error){
      warn("Could not read sync baseline", error);
    }
    return null;
  }

  function saveBase(mergedPayload){
    const data = unwrapEnvelope(mergedPayload).data || {};
    const sections = {};
    Object.keys(data).forEach((key) => {
      if (COLLECTION_KEYS.includes(key) || LOCAL_ONLY_KEYS.includes(key)) return;
      sections[key] = data[key];
    });
    try{
      // Not APP_STORAGE_KEY, so neither setItem patch reacts to it.
      localStorage.setItem(SYNC_BASE_KEY, JSON.stringify({
        docId: SHARED_DOC_ID,
        sections,
        tombstoneKeys: list(data.tombstones).map(tombstoneKey)
      }));
    }catch(error){
      // Without a baseline the next merge falls back to newest-save-wins, which
      // is the old behaviour — degraded, not broken.
      warn("Could not store sync baseline", error);
      try{ localStorage.removeItem(SYNC_BASE_KEY); }catch(_){ /* nothing left to do */ }
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

  // Every device must produce the SAME order from the same records, or each one
  // lists its own items first, sees the cloud copy as "different", and rewrites
  // it — two open devices then overwrite each other endlessly. Newest first
  // matches how the app inserts (unshift); id breaks ties.
  function newestFirst(items, stampFn){
    return items.slice().sort((a, b) => {
      const delta = Number(stampFn(b) || 0) - Number(stampFn(a) || 0);
      if (delta) return delta;
      return String(a?.id || "") < String(b?.id || "") ? -1 : String(a?.id || "") > String(b?.id || "") ? 1 : 0;
    });
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
    logs.sort((a, b) => {
      const delta = toTimestamp(a?.telemetryAt || a?.createdAt || a?.date) - toTimestamp(b?.telemetryAt || b?.createdAt || b?.date);
      if (delta) return delta;
      return logKey(a) < logKey(b) ? -1 : logKey(a) > logKey(b) ? 1 : 0;
    });
    return logs;
  }

  function mergeArchive(localData, cloudData){
    const merged = mergeByKey(
      localData?.archive,
      cloudData?.archive,
      (entry) => entry?.id || entry?.archivedAt,
      (entry) => toTimestamp(entry?.archivedAt || entry?.batch?.loadedAt)
    );

    return newestFirst(merged, (entry) => toTimestamp(entry?.archivedAt || entry?.batch?.loadedAt)).map((entry) => ({
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

  function buildMergedAppData(localPayload, cloudPayload, cloudUpdatedAt, base){
    if (!localPayload && !cloudPayload) return stampAppData({}, cloudUpdatedAt);
    if (!localPayload) return stampAppData(cloudPayload, cloudUpdatedAt);
    if (!cloudPayload) return stampAppData(localPayload, new Date().toISOString());

    const localEnv = unwrapEnvelope(localPayload);
    const cloudEnv = unwrapEnvelope(cloudPayload);
    const local = localEnv.data || {};
    const cloud = cloudEnv.data || {};
    const baseSections = base && isPlain(base.sections) ? base.sections : null;

    // Tiebreak for a true conflict (both devices changed the same value since
    // they last agreed) and for the no-baseline case: the most recently saved
    // copy wins, unless it is missing history the other copy has.
    const localStamp = appDataStamp(localPayload);
    const cloudStamp = appDataStamp(cloudPayload, cloudUpdatedAt);
    const localLogCount = list(local.fermentationLogs).length;
    const cloudLogCount = list(cloud.fermentationLogs).length;
    const localArchiveCount = list(local.archive).length;
    const cloudArchiveCount = list(cloud.archive).length;
    const preferCloud = cloudStamp > localStamp && cloudLogCount >= localLogCount && cloudArchiveCount >= localArchiveCount;

    const mergedData = {};
    const sectionKeys = new Set(Object.keys(local).concat(Object.keys(cloud)));
    COLLECTION_KEYS.forEach((key) => sectionKeys.delete(key));

    // Two devices on two DIFFERENT batches: never field-merge them. Take the
    // whole batch group from whichever side moved off the agreed batch.
    let batchGroupSide = null;
    const localBatchId = batchIdentity(local);
    const cloudBatchId = batchIdentity(cloud);
    if (localBatchId !== cloudBatchId){
      const baseBatchId = baseSections ? batchIdentity(baseSections) : null;
      if (baseBatchId !== null && localBatchId === baseBatchId) batchGroupSide = cloud;
      else if (baseBatchId !== null && cloudBatchId === baseBatchId) batchGroupSide = local;
      else batchGroupSide = preferCloud ? cloud : local;
    }

    sectionKeys.forEach((key) => {
      let value;
      if (LOCAL_ONLY_KEYS.includes(key)){
        value = local[key] !== undefined ? clone(local[key]) : clone(cloud[key]);
      } else if (batchGroupSide && BATCH_GROUP_KEYS.includes(key)){
        value = clone(batchGroupSide[key]);
      } else {
        value = threeWay(baseSections ? baseSections[key] : undefined, local[key], cloud[key], preferCloud);
      }
      if (value !== undefined) mergedData[key] = value;
    });

    // History collections stay additive across devices so an archived batch or a
    // logged reading is never lost just because one device hasn't seen it yet —
    // but a deliberate deletion (tombstone) always overrides the union.
    let mergedTombstones = mergeTombstones(local.tombstones, cloud.tombstones);
    // ...and a deliberate REVIVAL (restoring a backup, resuming an archived
    // batch) overrides the tombstone. A tombstone both sides once agreed on that
    // one side has since dropped was revived there; keep it dropped, or the
    // union re-adds it and strips the restored record again.
    if (base && Array.isArray(base.tombstoneKeys) && base.tombstoneKeys.length){
      const agreed = new Set(base.tombstoneKeys);
      const localKeys = new Set(list(local.tombstones).map(tombstoneKey));
      const cloudKeys = new Set(list(cloud.tombstones).map(tombstoneKey));
      mergedTombstones = mergedTombstones.filter((entry) => {
        const key = tombstoneKey(entry);
        return !(agreed.has(key) && (!localKeys.has(key) || !cloudKeys.has(key)));
      });
    }
    // Oldest first: app.js trims the list with slice(-LIMIT) and relies on the
    // newest deletions being at the end. Key breaks ties so order is identical
    // on every device.
    mergedTombstones.sort((a, b) => {
      const delta = toTimestamp(a.deletedAt) - toTimestamp(b.deletedAt);
      if (delta) return delta;
      return tombstoneKey(a) < tombstoneKey(b) ? -1 : tombstoneKey(a) > tombstoneKey(b) ? 1 : 0;
    });
    mergedData.tombstones = mergedTombstones;

    mergedData.fermentationLogs = stripTombstoned(
      mergeFermentationLogs(local, cloud),
      tombstonedIdSet(mergedTombstones, "fermentationLogs")
    );
    mergedData.recipes = stripTombstoned(
      newestFirst(
        mergeByKey(
          local.recipes,
          cloud.recipes,
          (entry) => entry?.id,
          (entry) => toTimestamp(entry?.updatedAt || entry?.createdAt)
        ),
        (entry) => toTimestamp(entry?.createdAt)
      ),
      tombstonedIdSet(mergedTombstones, "recipes")
    );
    mergedData.archive = stripTombstoned(
      mergeArchive(local, cloud),
      tombstonedIdSet(mergedTombstones, "archive")
    );

    const mergedSchema = {
      ...(preferCloud ? cloudEnv.schema : localEnv.schema) || localEnv.schema || cloudEnv.schema || {},
      savedAt: new Date(Math.max(localStamp, cloudStamp, Date.now())).toISOString()
    };
    return stampAppData({ _schema: mergedSchema, data: mergedData });
  }

  function sameAppData(a, b){
    return same(unwrapEnvelope(a).data, unwrapEnvelope(b).data);
  }

  // What goes to the cloud: everything except per-device view state. If `ui`
  // were uploaded, two open devices would each "correct" the other's active tab
  // and rewrite the document back and forth forever.
  function cloudView(payload){
    const env = unwrapEnvelope(payload);
    const data = env.data || {};
    LOCAL_ONLY_KEYS.forEach((key) => { delete data[key]; });
    return { _schema: env.schema || {}, data };
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

  function getLocalRaw(){
    try{ return localStorage.getItem(APP_STORAGE_KEY); }catch(error){ return null; }
  }

  // One reconcile: read the cloud document, three-way merge it with this
  // device, write the result to BOTH sides. Runs in a transaction so two
  // devices saving at the same moment cannot interleave read and write —
  // Firestore re-runs the function against the newer document instead.
  //
  // There is deliberately no "push what I have" path any more. That is what let
  // a tab left open for days overwrite everything saved elsewhere since.
  async function syncOnce(){
    if (!userRef || !db) return;
    const localRawBefore = getLocalRaw();
    const local = getLocalData();
    const base = loadBase();
    let merged = null;
    let wroteCloud = false;

    await db.runTransaction(async (tx) => {
      // The body can run more than once; reset per attempt.
      merged = null;
      wroteCloud = false;
      const snapshot = await tx.get(userRef);
      const cloud = snapshot.exists ? (snapshot.data() || {}) : {};
      const cloudData = cloud.appData || null;
      if (!local && !cloudData) return;
      merged = buildMergedAppData(local, cloudData, cloud.updatedAt, base);
      const outbound = cloudView(merged);
      if (cloudData && sameAppData(outbound, cloudView(cloudData))) return;
      const updatedAt = new Date().toISOString();
      tx.set(userRef, {
        version: CLOUD_DOC_VERSION,
        appId: "meadevil-app",
        updatedAt,
        appData: stampAppData(outbound, updatedAt)
      });
      wroteCloud = true;
    });

    lastSyncAt = Date.now();
    if (!merged){
      setStatus({ lastPullAt: Date.now(), mode: "cloud", lastError: null });
      return;
    }
    // The user kept working while the transaction was in flight. Do not lay the
    // merge over their newer edits and do not advance the baseline: go again.
    if (getLocalRaw() !== localRawBefore){
      syncQueued = true;
      return;
    }
    if (!local || !sameAppData(merged, local)){
      setLocalData(merged);
      log(local ? "Applied changes from another device" : "Restored cloud data to empty local store");
    }
    saveBase(merged);
    const patch = { lastPullAt: Date.now(), mode: "cloud", lastError: null };
    if (wroteCloud) patch.lastPushAt = Date.now();
    setStatus(patch);
    return wroteCloud;
  }

  // Circuit breaker. If two devices ever disagree about what the merged state
  // "should" be (say, two app versions that normalise a field differently),
  // each remote change provokes a corrective write and they loop. The merge is
  // built not to do that, but a loop here burns Firestore quota and battery
  // silently, so it gets a hard stop rather than trust.
  const REMOTE_WRITE_WINDOW_MS = 60000;
  const REMOTE_WRITE_LIMIT = 8;
  const REMOTE_COOLDOWN_MS = 5 * 60000;
  let remoteWriteTimes = [];
  let remotePausedUntil = 0;

  function noteRemoteWrite(){
    const now = Date.now();
    remoteWriteTimes = remoteWriteTimes.filter((stamp) => now - stamp < REMOTE_WRITE_WINDOW_MS);
    remoteWriteTimes.push(now);
    if (remoteWriteTimes.length >= REMOTE_WRITE_LIMIT){
      remotePausedUntil = now + REMOTE_COOLDOWN_MS;
      remoteWriteTimes = [];
      warn("Devices are repeatedly rewriting each other's data; pausing live sync for 5 minutes.");
      setStatus({ mode: "error", lastError: "Live sync paused for 5 minutes: two devices kept overwriting each other. Your saves still upload. Reload both devices if this repeats." });
    }
  }

  function syncNow(reason){
    if (!userRef || !db) return Promise.resolve();
    // A change arriving from another device re-renders the forms. Hold it until
    // the user pauses typing rather than yanking focus mid-keystroke.
    if (reason === "remote" && Date.now() < remotePausedUntil) return Promise.resolve();
    if (reason === "remote" && Date.now() - lastInputAt < REMOTE_APPLY_QUIET_MS){
      clearTimeout(remoteRetryTimer);
      remoteRetryTimer = setTimeout(() => syncNow("remote"), REMOTE_APPLY_QUIET_MS);
      return Promise.resolve();
    }
    if (syncInFlight){
      syncQueued = true;
      return syncInFlight;
    }
    syncInFlight = (async () => {
      try{
        let rounds = 0;
        do {
          syncQueued = false;
          const wrote = await syncOnce();
          if (wrote && reason === "remote") noteRemoteWrite();
          rounds += 1;
        } while (syncQueued && rounds < 5);
      } catch (error){
        const offline = (typeof navigator !== "undefined" && navigator.onLine === false) || error?.code === "unavailable";
        if (offline){
          // Not a fault: edits stay on this device and reconcile on reconnect.
          setStatus({ lastError: "Offline — changes are saved on this device and will sync when you reconnect.", mode: "offline" });
        } else {
          warn("Sync failed (" + (reason || "unknown") + ")", error);
          setStatus({ lastError: String(error?.message || error), mode: "error" });
        }
      } finally {
        syncInFlight = null;
      }
    })();
    return syncInFlight;
  }

  function schedulePush(){
    if (!booted || !userRef || suppressPush) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncNow("save"); }, DEFAULT_SYNC_DEBOUNCE_MS);
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
        clearTimeout(syncTimer);
        syncNow("hidden");
      } else if (Date.now() - lastSyncAt > RESUME_SYNC_THROTTLE_MS){
        // Coming back to a tab that sat in the background: catch up before the
        // user edits anything on top of stale state.
        syncNow("resume");
      }
    });
    window.addEventListener("online", () => { syncNow("online"); });
    document.addEventListener("input", () => { lastInputAt = Date.now(); }, true);
    // The mentor writes brainstorm results straight to storage past the setItem
    // patch, so nothing schedules a push for them. Sweep for unsynced changes.
    let lastSweptRaw = null;
    setInterval(() => {
      if (!booted || syncInFlight || document.visibilityState === "hidden") return;
      const raw = getLocalRaw();
      if (raw === lastSweptRaw) return;
      lastSweptRaw = raw;
      const local = getLocalData();
      const base = loadBase();
      if (!local || !base) return;
      const data = unwrapEnvelope(local).data || {};
      const drifted = Object.keys(base.sections).some((key) => !same(base.sections[key], data[key]));
      if (drifted) schedulePush();
    }, 20000);
  }

  function bindRemoteListener(){
    if (unsubscribeSnapshot){ unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    if (!userRef) return;
    let first = true;
    unsubscribeSnapshot = userRef.onSnapshot((snapshot) => {
      // The first callback is the document we just reconciled at boot; local
      // echoes of our own writes carry hasPendingWrites.
      if (first){ first = false; return; }
      if (snapshot.metadata && snapshot.metadata.hasPendingWrites) return;
      syncNow("remote");
    }, (error) => {
      warn("Live listener failed; falling back to sync on save/resume", error);
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
      booted = true;
      await syncNow("boot");
      bindRemoteListener();

      auth.onAuthStateChanged((nextUser) => {
        if (nextUser){
          userRef = cloudDocRef();
          setStatus({ user: nextUser, authReady: true, mode: "cloud" });
          if (!unsubscribeSnapshot) bindRemoteListener();
        } else {
          userRef = null;
          if (unsubscribeSnapshot){ unsubscribeSnapshot(); unsubscribeSnapshot = null; }
          setStatus({ user: null, authReady: false, mode: "auth" });
        }
      });

      log("Firebase sync ready");
    } catch (error){
      warn("Firebase sync boot failed", error);
      setStatus({ enabled: false, mode: "error", lastError: String(error?.message || error) });
    }
  }

  // Pure merge surface, exposed for the regression suite and for debugging a
  // sync dispute from the console. Nothing in the app calls these.
  window.MeadevilSync = {
    buildMergedAppData,
    threeWay,
    stableStringify,
    syncNow: () => syncNow("manual"),
    status: () => ({ ...status })
  };

  document.addEventListener("DOMContentLoaded", bootFirebaseSync);
})();
