(function(){
  "use strict";

  const APP_STORAGE_KEY = "meadevil-app-v2";
  const ENHANCEMENT_KEY = "meadevil-app-v2-meadevil-mentor";
  const CLOUD_DOC_VERSION = 2;
  const DEFAULT_SYNC_DEBOUNCE_MS = 1200;
  const CLOUD_COLLECTION = "meadevilApp";
  const SHARED_DOC_ID = "meadevil-shared";
  // The last state this device and the cloud AGREED on: the common ancestor for
  // the three-way merge. Without it the merge cannot tell "this device changed
  // the field" from "this device has not seen the other device's change yet".
  const SYNC_BASE_KEY = "meadevil-sync-base-v2";
  const OLD_SYNC_BASE_KEY = "meadevil-sync-base-v1";
  // Unioned by id (with tombstones); never merged as single values.
  const COLLECTION_KEYS = ["fermentationLogs", "recipes", "archive", "shelf", "tombstones"];
  // Per-device state that is never uploaded. `ui` would switch tabs under the
  // user; `clock` is a stopwatch; the rapt fields are this device's fetch
  // bookkeeping, rewritten on every page load — uploading them made every reload
  // a cloud write that re-rendered every other open device.
  const LOCAL_ONLY_KEYS = ["ui", "clock"];
  const LOCAL_ONLY_FIELDS = { rapt: ["lastFetchedAt", "lastStatus", "lastError", "lastImportCount"] };
  // Everything that describes THE active batch. These move together: if two
  // devices hold different batches they are never field-merged.
  const BATCH_GROUP_KEYS = ["currentBatch", "cellar", "nutrients", "fermentChecklist", "cellarChecklist", "rapt"];
  const QUIET_AFTER_INPUT_MS = 4000;
  const RESUME_SYNC_THROTTLE_MS = 15000;
  const TOMBSTONE_LIMIT = 5000;
  // Firestore rejects documents over 1 MiB. Stop short and say so plainly
  // instead of failing every write with an opaque invalid-argument.
  const CLOUD_DOC_SOFT_LIMIT_BYTES = 950 * 1024;

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
  let deferredTimer = null;
  let retryTimer = null;
  let retryDelayMs = 0;
  let unsubscribeSnapshot = null;
  let lastWrittenStamp = "";
  let autoPausedUntil = 0;
  let rawAtLastSync = null;
  let lastWriteWasCorrective = false;

  function log(...args){
    console.log("[Meadevil Firebase Sync]", ...args);
  }

  function warn(...args){
    console.warn("[Meadevil Firebase Sync]", ...args);
  }

  function setStatus(patch){
    Object.assign(status, patch || {});
    // A successful save-triggered sync must not hide that live sync is paused.
    if (Date.now() < autoPausedUntil && status.mode === "cloud"){
      status.mode = "error";
      status.lastError = PAUSED_MESSAGE;
    }
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

  // ---- small helpers --------------------------------------------------------

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

  function isPlain(value){
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  // Key-order-independent serialisation. Firestore does not preserve map key
  // order, so plain JSON.stringify reports "different" for identical data.
  function stableStringify(value){
    if (value === undefined) return "null";
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    return "{" + Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
  }

  function same(a, b){
    return stableStringify(a) === stableStringify(b);
  }

  // "", null, undefined, [] and {} carry no information. Used only when there is
  // no common ancestor: an empty value must never beat a real one there.
  function isEmptyish(value){
    if (value === undefined || value === null || value === "") return true;
    if (Array.isArray(value)) return value.length === 0;
    if (isPlain(value)) return Object.keys(value).length === 0;
    return false;
  }

  function hashString(text){
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
    return hash.toString(36);
  }

  // ---- local storage --------------------------------------------------------

  function getLocalRaw(){
    try{ return localStorage.getItem(APP_STORAGE_KEY); }catch(error){ return null; }
  }

  // Only a well-formed envelope counts as "this device's data". Anything else —
  // nothing stored yet, a truncated blob, a stub another script wrote before
  // app.js's first save — is NO data, and must never be merged as if the user
  // had deliberately emptied every section.
  function isEnvelope(payload){
    return isPlain(payload) && isPlain(payload._schema) && isPlain(payload.data);
  }

  function getLocalData(){
    try{
      const raw = getLocalRaw();
      const parsed = raw ? JSON.parse(raw) : null;
      return isEnvelope(parsed) ? parsed : null;
    }catch(error){
      warn("Could not parse local data", error);
      return null;
    }
  }

  // The mentor UI keeps its own copy of structure additions under a second key
  // and app.js re-overlays that copy whenever state is reloaded from storage.
  // If incoming cloud data did not update it too, each device kept showing —
  // and then re-uploading — its own adjunct list forever.
  function mirrorStructureAdditions(payload){
    try{
      const data = unwrapEnvelope(payload).data || {};
      const raw = localStorage.getItem(ENHANCEMENT_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      // No enhancement yet (fresh device): start one. The mentor fills in the
      // rest of its defaults when it loads a partial object.
      const enhancement = isPlain(parsed) ? parsed : {};
      let changed = false;
      const put = (holder, key, incoming) => {
        if (!Array.isArray(incoming)) return;
        const slot = isPlain(holder[key]) ? holder[key] : (holder[key] = {});
        if (!same(slot.structureAdditions, incoming)){
          slot.structureAdditions = clone(incoming);
          changed = true;
        }
      };
      ["recipeDraft", "currentBatch"].forEach((key) => put(enhancement, key, data[key] && data[key].structureAdditions));
      // Saved recipes and Vault entries have per-id copies too; a stale one
      // overrides the synced record when that recipe is next opened.
      if (!isPlain(enhancement.recipes)) enhancement.recipes = {};
      list(data.recipes).forEach((recipe) => { if (recipe && recipe.id) put(enhancement.recipes, recipe.id, recipe.structureAdditions); });
      if (!isPlain(enhancement.archive)) enhancement.archive = {};
      list(data.archive).forEach((entry) => { if (entry && entry.id) put(enhancement.archive, entry.id, entry.batch && entry.batch.structureAdditions); });
      if (changed) localStorage.setItem(ENHANCEMENT_KEY, JSON.stringify(enhancement));
    }catch(error){
      warn("Could not mirror structure additions", error);
    }
  }

  function setLocalData(payload){
    suppressPush = true;
    try{
      mirrorStructureAdditions(payload);
      localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(payload));
      window.dispatchEvent(new CustomEvent("meadevil-cloud-restore", { detail: { restored: true, source: "cloud" } }));
    } finally {
      // Synchronous on purpose: listeners run inside dispatchEvent above, so
      // nothing legitimate needs the suppression to outlive this call, and a
      // lingering window would swallow the user's next real save.
      suppressPush = false;
    }
  }

  // ---- envelope helpers -----------------------------------------------------

  function stampAppData(payload, updatedAt){
    const stamped = clone(payload) || {};
    const when = updatedAt || new Date().toISOString();
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
  function unwrapEnvelope(payload){
    if (payload && typeof payload === "object" && payload.data && payload._schema){
      return { schema: clone(payload._schema), data: clone(payload.data) || {} };
    }
    return { schema: null, data: clone(payload) || {} };
  }

  // The adjunct editor always keeps one empty row on screen, created per device
  // with a random id. It is a UI placeholder, not data: uploading it made every
  // device's first load a cloud write and left stray blank rows in the document.
  function isBlankAdjunctRow(row){
    return isPlain(row) && !["ingredient", "amount", "purpose", "notes"].some((field) => String(row[field] ?? "").trim());
  }

  function stripLocalOnly(data){
    ["recipeDraft", "currentBatch"].forEach((key) => {
      if (isPlain(data[key]) && Array.isArray(data[key].structureAdditions)){
        data[key].structureAdditions = data[key].structureAdditions.filter((row) => !isBlankAdjunctRow(row));
      }
    });
    LOCAL_ONLY_KEYS.forEach((key) => { delete data[key]; });
    Object.keys(LOCAL_ONLY_FIELDS).forEach((section) => {
      if (isPlain(data[section])) LOCAL_ONLY_FIELDS[section].forEach((field) => { delete data[section][field]; });
    });
    return data;
  }

  // What goes to the cloud, and what every comparison is made on: the state
  // minus per-device fields.
  function cloudView(payload){
    const env = unwrapEnvelope(payload);
    return { _schema: env.schema || {}, data: stripLocalOnly(env.data || {}) };
  }

  function sameAppData(a, b){
    return same(cloudView(a).data, cloudView(b).data);
  }

  // ---- baseline -------------------------------------------------------------

  function loadBase(){
    try{
      const parsed = JSON.parse(localStorage.getItem(SYNC_BASE_KEY) || "null");
      if (parsed && parsed.docId === SHARED_DOC_ID && isPlain(parsed.sections)) return parsed;
      // First run after the v1 -> v2 upgrade: the old baseline is still a true
      // common ancestor for every section, so keep it instead of falling back
      // to "no ancestor", which cannot tell a deliberate clear from a stale copy.
      const old = JSON.parse(localStorage.getItem(OLD_SYNC_BASE_KEY) || "null");
      if (old && old.docId === SHARED_DOC_ID && isPlain(old.sections)){
        const sections = {};
        Object.keys(old.sections).forEach((key) => {
          if (!LOCAL_ONLY_KEYS.includes(key) && !COLLECTION_KEYS.includes(key)) sections[key] = old.sections[key];
        });
        // Partial (v1 kept fewer sections): weaker evidence than a v2 baseline.
        return { docId: SHARED_DOC_ID, sections, logIds: [], migrated: true };
      }
    }catch(error){
      warn("Could not read sync baseline", error);
    }
    return null;
  }

  function saveBase(mergedPayload){
    const data = cloudView(mergedPayload).data;
    const sections = {};
    Object.keys(data).forEach((key) => {
      if (!COLLECTION_KEYS.includes(key)) sections[key] = data[key];
    });
    try{
      // Not APP_STORAGE_KEY, so neither setItem patch reacts to it.
      localStorage.setItem(SYNC_BASE_KEY, JSON.stringify({
        docId: SHARED_DOC_ID,
        sections,
        logIds: list(data.fermentationLogs).map((entry) => String(entry?.id || "")).filter(Boolean)
      }));
    }catch(error){
      // No baseline means the next merge defers to the cloud: safe, not lossy
      // for anything already uploaded.
      warn("Could not store sync baseline", error);
      try{ localStorage.removeItem(SYNC_BASE_KEY); }catch(_){ /* nothing left to do */ }
    }
  }

  // ---- value merge ----------------------------------------------------------

  function idOf(item){
    return isPlain(item) && typeof item.id === "string" && item.id ? item.id : "";
  }

  function isIdList(value){
    if (!Array.isArray(value)) return false;
    const seen = new Set();
    return value.every((item) => {
      const id = idOf(item);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  // Rows with ids (checklist tasks, source-bill rows, step-feed entries, finish
  // additions) merge row by row. Treating the whole list as one value meant a
  // honey feed logged on one device erased one logged on another.
  function mergeIdLists(base, local, cloud, wholeLists){
    const baseMap = new Map(base.map((item) => [item.id, item]));
    const localMap = new Map(local.map((item) => [item.id, item]));
    const cloudMap = new Map(cloud.map((item) => [item.id, item]));
    // Both sides threw the old list away and built a new one (each archived the
    // batch, or loaded a different recipe): those are two documents, not rows
    // to union. Unioning doubled checklists and mixed two recipes' honey.
    const realRows = (rows) => rows.filter((row) => !("ingredient" in row && isBlankAdjunctRow(row)));
    if (wholeLists && base.length && realRows(local).length && realRows(cloud).length
      && !local.some((item) => baseMap.has(item.id) || cloudMap.has(item.id))
      && !cloud.some((item) => baseMap.has(item.id))){
      return clone(local);
    }
    const order = local.map((item) => item.id).concat(cloud.map((item) => item.id).filter((id) => !localMap.has(id)));
    const out = [];
    order.forEach((id) => {
      const mine = localMap.get(id);
      const theirs = cloudMap.get(id);
      const was = baseMap.get(id);
      if (mine && theirs){ out.push(threeWay(was, mine, theirs, true)); return; }
      const present = mine || theirs;
      // Missing on one side: a new row if the ancestor never had it; otherwise
      // the other side deleted it — honour that unless this side edited the row.
      if (!was || !same(present, was)) out.push(clone(present));
    });
    return out;
  }

  // Three-way merge of one value. `hasBase` false means there is no common
  // ancestor (new device, first sync after this shipped, baseline lost).
  //
  // With an ancestor: a side that did not change a value yields to the side
  // that did; if both changed it, THIS device wins — it is the one syncing now,
  // so that is last-writer-wins by sync order, with no reliance on wall clocks.
  // Without an ancestor there is no evidence this device changed anything, so
  // the cloud wins every disagreement, except that an empty value never beats
  // a real one.
  function threeWay(base, local, cloud, hasBase, wholeLists){
    if (same(local, cloud)) return clone(local);
    if (local === undefined) return clone(cloud);
    if (cloud === undefined) return clone(local);
    if (hasBase){
      if (same(local, base)) return clone(cloud);
      if (same(cloud, base)) return clone(local);
    }
    if (isPlain(local) && isPlain(cloud)){
      const ancestor = isPlain(base) ? base : null;
      const out = {};
      new Set(Object.keys(local).concat(Object.keys(cloud))).forEach((key) => {
        const value = threeWay(ancestor ? ancestor[key] : undefined, local[key], cloud[key], hasBase, wholeLists);
        if (value !== undefined) out[key] = value;
      });
      return out;
    }
    if (hasBase && isIdList(local) && isIdList(cloud) && isIdList(base)){
      return mergeIdLists(base, local, cloud, wholeLists);
    }
    if (hasBase) return clone(local);
    // (Clocks cannot settle whether that empty value is a deliberate clear:
    // the app re-saves on load, so every device looks "just saved". Keeping the
    // real value can undo a clear; the alternative silently loses data.)
    return clone(isEmptyish(cloud) ? local : cloud);
  }

  // ---- collection merge -----------------------------------------------------

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
  // it. Newest first matches how the app inserts (unshift); id breaks ties.
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

  function logStamp(entry){
    return toTimestamp(entry?.telemetryAt || entry?.createdAt || entry?.date);
  }

  function sortLogs(logs){
    return logs.slice().sort((a, b) => {
      const delta = logStamp(a) - logStamp(b);
      if (delta) return delta;
      return logKey(a) < logKey(b) ? -1 : logKey(a) > logKey(b) ? 1 : 0;
    });
  }

  function mergeFermentationLogs(localLogs, cloudLogs){
    return sortLogs(mergeByKey(localLogs, cloudLogs, logKey, logStamp));
  }

  // Batches set aside (not active, not finished). Whole entries keyed by id; a
  // switch back in removes the entry with a tombstone.
  function shelfStamp(entry){
    return toTimestamp(entry?.shelvedAt || entry?.batch?.loadedAt);
  }

  function mergeShelf(localShelf, cloudShelf){
    // Two devices can each set the same batch aside (same id) after logging
    // different readings: the newer copy's fields win, but readings from both
    // are kept. Whole-entry last-writer-wins dropped the other device's.
    const byId = new Map(list(localShelf).filter((entry) => entry && entry.id).map((entry) => [String(entry.id), entry]));
    const merged = mergeByKey(localShelf, cloudShelf, (entry) => entry?.id, shelfStamp).map((entry) => {
      const mine = byId.get(String(entry.id));
      const theirs = list(cloudShelf).find((item) => item && String(item.id) === String(entry.id));
      if (!mine || !theirs) return entry;
      return { ...entry, fermentationLogs: mergeFermentationLogs(mine.fermentationLogs, theirs.fermentationLogs) };
    });
    return newestFirst(merged, shelfStamp).map((entry) => ({
      ...entry,
      fermentationLogs: sortLogs(list(entry?.fermentationLogs))
    }));
  }

  function archiveStamp(entry){
    return toTimestamp(entry?.archivedAt || entry?.batch?.loadedAt);
  }

  function mergeArchive(localArchive, cloudArchive){
    const merged = mergeByKey(localArchive, cloudArchive, (entry) => entry?.id || entry?.archivedAt, archiveStamp);
    return newestFirst(merged, archiveStamp).map((entry) => ({
      ...entry,
      fermentationLogs: sortLogs(list(entry?.fermentationLogs))
    }));
  }

  // Deletions and revivals. The union above has no idea what a "delete" is, so
  // the app records a tombstone per removal (recordTombstones in app.js). A
  // record can also come BACK (restoring a backup, resuming an archived batch):
  // app.js marks the tombstone with revivedAt rather than removing it, because
  // an absent tombstone is indistinguishable from one a device simply has not
  // seen yet — and that device would re-apply the deletion.
  function tombstoneKey(entry){
    return `${entry?.collection || ""}::${entry?.id || ""}`;
  }

  function tombstoneStamp(entry){
    return Math.max(toTimestamp(entry?.deletedAt), toTimestamp(entry?.revivedAt));
  }

  function tombstoneIsLive(entry){
    return toTimestamp(entry?.deletedAt) > toTimestamp(entry?.revivedAt);
  }

  function mergeTombstones(localTombstones, cloudTombstones){
    const merged = new Map();
    list(localTombstones).concat(list(cloudTombstones)).forEach((entry) => {
      if (!entry || !entry.collection || !entry.id) return;
      const key = tombstoneKey(entry);
      const existing = merged.get(key);
      if (!existing || tombstoneStamp(entry) > tombstoneStamp(existing)){
        merged.set(key, clone(entry));
      }
    });
    // Oldest first: app.js trims with slice(-LIMIT) and relies on the newest
    // being at the end. Key breaks ties so every device agrees on the order.
    const ordered = Array.from(merged.values()).sort((a, b) => {
      const delta = tombstoneStamp(a) - tombstoneStamp(b);
      if (delta) return delta;
      return tombstoneKey(a) < tombstoneKey(b) ? -1 : tombstoneKey(a) > tombstoneKey(b) ? 1 : 0;
    });
    return ordered.length > TOMBSTONE_LIMIT ? ordered.slice(-TOMBSTONE_LIMIT) : ordered;
  }

  function tombstonedIdSet(tombstones, collection){
    const ids = new Set();
    list(tombstones).forEach((entry) => {
      if (entry && entry.collection === collection && entry.id && tombstoneIsLive(entry)) ids.add(String(entry.id));
    });
    return ids;
  }

  function stripTombstoned(items, tombstoneSet){
    return list(items).filter((item) => !tombstoneSet.has(String(item?.id || "")));
  }

  // ---- active-batch handling ------------------------------------------------

  function batchIdentity(data){
    const batch = data && data.currentBatch;
    if (!isPlain(batch)) return "|";
    return [batch.loadedAt || "", batch.recipeId || ""].join("|");
  }

  function batchIsReal(data){
    const batch = data && data.currentBatch;
    return isPlain(batch) && Boolean(batch.loadedAt || String(batch.name || "").trim());
  }

  function batchGroupOf(data){
    const group = {};
    BATCH_GROUP_KEYS.forEach((key) => { if (data[key] !== undefined) group[key] = data[key]; });
    return stripLocalOnly(clone(group));
  }

  // The batch the merge is about to drop still had work on it that the winning
  // side never saw. Park it in the Vault rather than discard it: a duplicate
  // archive entry is an annoyance, a silently lost batch record is not
  // recoverable.
  function rescueEntry(loser, logs){
    const group = batchGroupOf(loser);
    const id = "arch-recovered-" + hashString(stableStringify([group, logs.map(logKey)]));
    const batch = clone(loser.currentBatch) || {};
    const baseName = String(batch.name || "Unnamed batch").replace(/(\s*\(recovered copy\))+$/i, "").trim();
    batch.name = `${baseName} (recovered copy)`;
    return {
      id,
      archivedAt: new Date().toISOString(),
      batch,
      nutrients: clone(loser.nutrients) || {},
      cellar: clone(loser.cellar) || {},
      fermentChecklist: clone(loser.fermentChecklist) || [],
      cellarChecklist: clone(loser.cellarChecklist) || [],
      fermentationLogs: sortLogs(logs),
      summary: "Recovered automatically by sync: another device replaced or archived this batch while this copy still had changes that had not been uploaded."
    };
  }

  // ---- the merge ------------------------------------------------------------

  function draftsDiverged(base, local, cloud){
    if (!isPlain(local) || !isPlain(cloud)) return false;
    // Two different saved recipes, by id. A rename of the same draft is an
    // ordinary field edit and merges field by field.
    const ident = (draft) => isPlain(draft) ? String(draft.draftId || draft.id || "") : "";
    return Boolean(ident(local)) && Boolean(ident(cloud))
      && ident(local) !== ident(cloud) && ident(local) !== ident(base) && ident(cloud) !== ident(base);
  }

  // Is this side's batch already sitting in the Vault (archived by another device)?
  function archiveCovers(archive, side, logs){
    const covers = (whole, part) => !isPlain(part) || (isPlain(whole) && Object.keys(part).every((key) => same(whole[key], part[key])));
    const keys = list(logs).map(logKey);
    return list(archive).some((entry) => {
      const entryLogs = new Set(list(entry.fermentationLogs).map(logKey));
      return covers(entry.batch, side.currentBatch) && covers(entry.cellar, side.cellar) && keys.every((key) => entryLogs.has(key));
    });
  }

  // Same batch (start time + recipe) already in the Vault, with every reading
  // this side holds. Looser than archiveCovers: tolerates fields the other
  // device has since edited or normalised.
  function archivedByIdentity(archive, side, ignoreReadings){
    const id = batchIdentity(side);
    if (!side.currentBatch || !side.currentBatch.loadedAt) return false;
    const keys = list(side.fermentationLogs).map(logKey);
    return list(archive).some((entry) => {
      if (batchIdentity({ currentBatch: entry.batch }) !== id) return false;
      if (ignoreReadings) return true;
      const entryLogs = new Set(list(entry.fermentationLogs).map(logKey));
      return keys.every((key) => entryLogs.has(key));
    });
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
    const hasBase = Boolean(baseSections);

    const mergedData = {};
    const sectionKeys = new Set(Object.keys(local).concat(Object.keys(cloud)));
    COLLECTION_KEYS.forEach((key) => sectionKeys.delete(key));

    // Two devices on two DIFFERENT batches: take the whole batch group from one
    // side. With an ancestor, that is the side that moved off the agreed batch
    // (it started, archived or cleared one on purpose). Without one, a real
    // batch beats an empty slot, and otherwise the cloud wins.
    let winner = null;
    let loser = null;
    const localBatchId = batchIdentity(local);
    const cloudBatchId = batchIdentity(cloud);
    if (localBatchId !== cloudBatchId){
      let localWins;
      if (hasBase){
        const baseBatchId = batchIdentity(baseSections);
        if (localBatchId === baseBatchId) localWins = false;
        else if (cloudBatchId === baseBatchId) localWins = true;
        // Both moved (one set a batch aside or archived it, the other made a
        // different one active): a real batch beats an empty slot.
        else localWins = batchIsReal(local) || !batchIsReal(cloud);
      } else {
        // A stale device with no ancestor must not resurrect a batch the
        // cloud already archived (or cleared on purpose).
        localWins = batchIsReal(local) && !batchIsReal(cloud)
          && !archivedByIdentity(mergeArchive(local.archive, cloud.archive).concat(
            stripTombstoned(mergeShelf(local.shelf, cloud.shelf), tombstonedIdSet(mergeTombstones(local.tombstones, cloud.tombstones), "shelf"))), local, true);
      }
      winner = localWins ? local : cloud;
      loser = localWins ? cloud : local;
    }

    sectionKeys.forEach((key) => {
      let value;
      if (LOCAL_ONLY_KEYS.includes(key)){
        value = local[key] !== undefined ? clone(local[key]) : clone(cloud[key]);
      } else if (winner && BATCH_GROUP_KEYS.includes(key)){
        value = clone(winner[key] !== undefined ? winner[key] : loser[key]);
      } else if (key === "recipeDraft" && hasBase && draftsDiverged(baseSections[key], local[key], cloud[key])){
        // Each device loaded a different recipe: never blend two recipes.
        value = clone(local[key]);
      } else {
        // Both devices left the agreed batch (each archived or reset it) and
        // ended on the same identity: their fresh checklists and rows are two
        // copies of one document, not rows to union.
        const wholeLists = hasBase && BATCH_GROUP_KEYS.includes(key)
          && localBatchId !== batchIdentity(baseSections) && cloudBatchId !== batchIdentity(baseSections);
        value = threeWay(baseSections ? baseSections[key] : undefined, local[key], cloud[key], hasBase, wholeLists);
      }
      if (value !== undefined) mergedData[key] = value;
    });
    // Per-device fields inside synced sections always stay this device's own.
    Object.keys(LOCAL_ONLY_FIELDS).forEach((section) => {
      if (!isPlain(mergedData[section])) return;
      LOCAL_ONLY_FIELDS[section].forEach((field) => {
        const mine = isPlain(local[section]) ? local[section][field] : undefined;
        if (mine !== undefined) mergedData[section][field] = clone(mine);
        else delete mergedData[section][field];
      });
    });

    const mergedTombstones = mergeTombstones(local.tombstones, cloud.tombstones);
    const deadLogs = tombstonedIdSet(mergedTombstones, "fermentationLogs");
    let archive = mergeArchive(local.archive, cloud.archive);
    const allShelf = mergeShelf(local.shelf, cloud.shelf);
    let shelf = stripTombstoned(allShelf, tombstonedIdSet(mergedTombstones, "shelf"));
    const strippedShelf = allShelf.filter((entry) => !shelf.includes(entry));
    // A batch that sits in the Vault OR on the shelf is accounted for.
    const accounted = () => archive.concat(shelf);
    let liveLogs;

    if (winner){
      // The live log belongs to the active batch, so it follows the winner.
      liveLogs = stripTombstoned(sortLogs(list(winner.fermentationLogs)), deadLogs);
      const winnerLogKeys = new Set(list(winner.fermentationLogs).map(logKey));
      const loserLogs = list(loser.fermentationLogs);
      const strayLogs = loserLogs.filter((entry) => !winnerLogKeys.has(logKey(entry)));
      // Did the losing side do anything the winner cannot already account for?
      const archivedLogKeys = new Set();
      archive.forEach((entry) => list(entry.fermentationLogs).forEach((item) => archivedLogKeys.add(logKey(item))));
      const baseLogIds = new Set(base && Array.isArray(base.logIds) ? base.logIds : []);
      const unseenLogs = strayLogs.some((entry) => !archivedLogKeys.has(logKey(entry)) && !(hasBase && baseLogIds.has(String(entry?.id || ""))));
      const groupChanged = !hasBase || !same(batchGroupOf(loser), batchGroupOf(baseSections));
      // ...and is that work not already sitting in the Vault (the other device
      // archived this very batch)? Then there is nothing to recover.
      // Identity alone (same batch, readings all there) is enough only without a
      // baseline, where field-level differences may be mere normalisation. With
      // one, a changed group is real unsynced work and must be parked.
      const alreadyArchived = archiveCovers(accounted(), loser, loserLogs) || ((!hasBase || Boolean(base && base.migrated)) && archivedByIdentity(accounted(), loser));
      // The other device set this very batch aside: fold this device's unsynced
      // work into that shelf entry, so switching it back in brings it along,
      // instead of a second copy of the batch in the Vault.
      const shelved = batchIsReal(loser) && (groupChanged || unseenLogs) && !alreadyArchived
        ? shelf.find((entry) => batchIdentity({ currentBatch: entry.batch }) === batchIdentity(loser))
        : null;
      if (shelved){
        const ancestor = hasBase ? baseSections : {};
        const fold = (key, entryKey) => threeWay(ancestor[key], loser[key], shelved[entryKey], hasBase);
        const updated = {
          ...shelved,
          batch: fold("currentBatch", "batch"),
          cellar: fold("cellar", "cellar"),
          nutrients: fold("nutrients", "nutrients"),
          fermentChecklist: fold("fermentChecklist", "fermentChecklist"),
          cellarChecklist: fold("cellarChecklist", "cellarChecklist"),
          fermentationLogs: sortLogs(mergeFermentationLogs(shelved.fermentationLogs, loserLogs)),
          shelvedAt: new Date(Math.max(Date.now(), shelfStamp(shelved) + 1)).toISOString()
        };
        if (!same(updated, shelved)) shelf = shelf.map((entry) => entry === shelved ? updated : entry);
      } else if (batchIsReal(loser) && (groupChanged || unseenLogs) && !alreadyArchived){
        const rescued = rescueEntry(loser, loserLogs);
        if (!archive.some((entry) => entry.id === rescued.id)) archive = newestFirst(archive.concat([rescued]), archiveStamp);
      }
      // Retire the losing batch's live readings everywhere, or a third device
      // still holding them would union them into the new batch's log.
      const stamp = new Date().toISOString();
      strayLogs.forEach((entry) => {
        const id = String(entry?.id || "");
        if (id && !deadLogs.has(id)) mergedTombstones.push({ collection: "fermentationLogs", id, deletedAt: stamp });
      });
    } else {
      liveLogs = stripTombstoned(mergeFermentationLogs(local.fermentationLogs, cloud.fermentationLogs), deadLogs);
      // No ancestor and the same batch on both sides: the cloud won every
      // disagreement, so anything this device changed that the cloud never saw
      // would vanish without a trace. Park this device's version in the Vault.
      const alreadyParked = archive.some((entry) => String(entry.id || "").startsWith("arch-recovered-")
        && String(entry.batch && entry.batch.loadedAt || "") === String(local.currentBatch && local.currentBatch.loadedAt || "")
        && String(entry.batch && entry.batch.recipeId || "") === String(local.currentBatch && local.currentBatch.recipeId || ""));
      if (!hasBase && batchIsReal(local) && !alreadyParked && !same(batchGroupOf(local), batchGroupOf(mergedData))
        && !archiveCovers(accounted(), local, list(local.fermentationLogs))){
        const rescued = rescueEntry(local, list(local.fermentationLogs));
        if (!archive.some((entry) => entry.id === rescued.id)) archive = newestFirst(archive.concat([rescued]), archiveStamp);
      }
    }

    // The active batch cannot also be on the shelf (two devices each switched
    // the same entry in, or one set it aside while the other kept it active).
    // Before dropping such an entry, bring its readings into the live log and
    // revive them: setting it aside retired them there.
    const activeId = batchIdentity(mergedData);
    if (batchIsReal(mergedData)){
      const duplicates = shelf.filter((entry) => batchIdentity({ currentBatch: entry.batch }) === activeId);
      if (duplicates.length){
        const liveIds = new Set(liveLogs.map((entry) => String(entry?.id || "")));
        const extra = [];
        duplicates.forEach((entry) => list(entry.fermentationLogs).forEach((log) => {
          const id = String(log?.id || "");
          if (id && !liveIds.has(id)){ liveIds.add(id); extra.push(log); }
        }));
        if (extra.length){
          const now = Date.now();
          const ids = new Set(extra.map((log) => String(log.id)));
          const kept = mergedTombstones.filter((entry) => !(entry.collection === "fermentationLogs" && ids.has(String(entry.id))));
          const revivals = extra.map((log) => {
            const prior = mergedTombstones.find((entry) => entry.collection === "fermentationLogs" && String(entry.id) === String(log.id));
            return { collection: "fermentationLogs", id: String(log.id), deletedAt: "", revivedAt: new Date(Math.max(now, (prior ? tombstoneStamp(prior) : 0) + 1)).toISOString() };
          });
          mergedTombstones.length = 0;
          mergeTombstones(kept, revivals).forEach((entry) => mergedTombstones.push(entry));
          liveLogs = sortLogs(liveLogs.concat(extra));
        }
        // ...and its field edits (notes, pH, ticks) made before it was set aside.
        const ancestor = hasBase ? baseSections : {};
        const pairs = [["currentBatch", "batch"], ["cellar", "cellar"], ["nutrients", "nutrients"], ["fermentChecklist", "fermentChecklist"], ["cellarChecklist", "cellarChecklist"]];
        duplicates.forEach((entry) => pairs.forEach(([key, entryKey]) => {
          if (entry[entryKey] === undefined || mergedData[key] === undefined) return;
          mergedData[key] = threeWay(ancestor[key], mergedData[key], entry[entryKey], hasBase);
        }));
        shelf = shelf.filter((entry) => batchIdentity({ currentBatch: entry.batch }) !== activeId);
      }
    }

    // A shelf entry another device already removed (made it active, then
    // archived or set it aside again under a later copy) may still hold a
    // reading this device logged before setting it aside. If that reading is
    // nowhere else, park the entry instead of letting it vanish.
    if (strippedShelf.length){
      const known = new Set(liveLogs.map(logKey));
      archive.forEach((entry) => list(entry.fermentationLogs).forEach((log) => known.add(logKey(log))));
      shelf.forEach((entry) => list(entry.fermentationLogs).forEach((log) => known.add(logKey(log))));
      strippedShelf.forEach((entry) => {
        const unseen = list(entry.fermentationLogs).filter((log) => !known.has(logKey(log)));
        if (!unseen.length) return;
        const rescued = rescueEntry({
          currentBatch: entry.batch, nutrients: entry.nutrients, cellar: entry.cellar,
          fermentChecklist: entry.fermentChecklist, cellarChecklist: entry.cellarChecklist, rapt: entry.rapt
        }, list(entry.fermentationLogs));
        if (!archive.some((item) => item.id === rescued.id)) archive = newestFirst(archive.concat([rescued]), archiveStamp);
        list(entry.fermentationLogs).forEach((log) => known.add(logKey(log)));
      });
    }

    mergedData.tombstones = mergedTombstones;
    mergedData.fermentationLogs = liveLogs;
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
    mergedData.archive = stripTombstoned(archive, tombstonedIdSet(mergedTombstones, "archive"));
    mergedData.shelf = shelf;

    const mergedSchema = {
      ...(localEnv.schema || cloudEnv.schema || {}),
      savedAt: new Date().toISOString()
    };
    return stampAppData({ _schema: mergedSchema, data: mergedData });
  }

  // ---- cloud ----------------------------------------------------------------

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

  function byteLength(text){
    try{ return new Blob([text]).size; }catch(_){ return text.length; }
  }

  function userRecentlyTyped(){
    return Date.now() - lastInputAt < QUIET_AFTER_INPUT_MS;
  }

  // One reconcile: read the cloud document, three-way merge it with this
  // device, write the result to BOTH sides. Runs in a transaction so two
  // devices saving at the same moment cannot interleave read and write.
  //
  // There is deliberately no "push what I have" path. That is what let a tab
  // left open for days overwrite everything saved elsewhere since.
  async function syncOnce(reason){
    if (!userRef || !db) return false;
    const localRawBefore = getLocalRaw();
    const local = getLocalData();
    // A baseline describes this device's data. If that data is gone or
    // unreadable the baseline is describing something else: discard it, or
    // every missing section would read as "deleted here on purpose".
    const base = local ? loadBase() : null;
    let merged = null;
    let wroteCloud = false;
    let writtenStamp = "";
    // A write made while this device had nothing new to say is a "corrective"
    // write: the only kind that can form a loop between devices.
    const localChangedSinceSync = localRawBefore !== rawAtLastSync;

    try{
    await db.runTransaction(async (tx) => {
      // The body can run more than once; reset per attempt.
      merged = null;
      wroteCloud = false;
      const snapshot = await tx.get(userRef);
      const cloud = snapshot.exists ? (snapshot.data() || {}) : {};
      const cloudData = isPlain(cloud.appData) ? cloud.appData : null;
      if (!local && !cloudData) return;
      merged = buildMergedAppData(local, cloudData, cloud.updatedAt, base);
      const outbound = cloudView(merged);
      if (cloudData && sameAppData(outbound, cloudData)) return;
      const updatedAt = new Date().toISOString();
      const payload = {
        version: CLOUD_DOC_VERSION,
        appId: "meadevil-app",
        updatedAt,
        appData: stampAppData(outbound, updatedAt)
      };
      const bytes = byteLength(JSON.stringify(payload));
      if (bytes > CLOUD_DOC_SOFT_LIMIT_BYTES){
        const error = new Error(`Your data is too large to sync (${Math.round(bytes / 1024)} KB of a 1024 KB cloud limit). Everything is still saved on this device. Export a backup, then delete old Vault entries or gravity readings to shrink it.`);
        error.code = "meadevil/too-large";
        throw error;
      }
      tx.set(userRef, payload);
      wroteCloud = true;
      writtenStamp = updatedAt;
    });
    } catch (error){
      // Too big to upload is no reason to stop RECEIVING: bring the other
      // devices' changes onto this one, keep the baseline where it was (the
      // cloud still lacks this device's data) and report the size problem.
      if (error && error.code === "meadevil/too-large" && merged && local
        && getLocalRaw() === localRawBefore && !sameAppData(merged, local)
        && !(userRecentlyTyped() && reason !== "boot" && reason !== "manual")){
        setLocalData(merged);
        rawAtLastSync = getLocalRaw();
      }
      throw error;
    }

    lastSyncAt = Date.now();
    lastWriteWasCorrective = wroteCloud && !localChangedSinceSync && Boolean(local);
    if (wroteCloud) lastWrittenStamp = writtenStamp;
    if (!merged){
      setStatus({ lastPullAt: Date.now(), mode: "cloud", lastError: null });
      return wroteCloud;
    }
    // The user kept working while the transaction was in flight. Do not lay the
    // merge over their newer edits and do not advance the baseline: go again.
    if (getLocalRaw() !== localRawBefore){
      syncQueued = true;
      return wroteCloud;
    }
    const needsApply = !local || !sameAppData(merged, local);
    if (needsApply && local && userRecentlyTyped() && reason !== "boot" && reason !== "manual"){
      // Applying re-renders the forms. The cloud already has the merged result;
      // bring this device up to date once the user pauses, not mid-keystroke.
      clearTimeout(deferredTimer);
      deferredTimer = setTimeout(() => syncNow("deferred"), QUIET_AFTER_INPUT_MS);
      setStatus({ lastPullAt: Date.now(), mode: "cloud", lastError: null });
      return wroteCloud;
    }
    if (needsApply){
      setLocalData(merged);
      log(local ? "Applied changes from another device" : "Restored cloud data to this device");
    }
    saveBase(merged);
    rawAtLastSync = getLocalRaw();
    const patch = { lastPullAt: Date.now(), mode: "cloud", lastError: null };
    if (wroteCloud) patch.lastPushAt = Date.now();
    setStatus(patch);
    return wroteCloud;
  }

  // Circuit breaker. If two devices ever disagree about what the merged state
  // "should" be (two app versions that normalise a field differently, say),
  // each write provokes a corrective write from the other and they loop. The
  // merge is built not to do that, but a loop burns Firestore quota and battery
  // silently, so it gets a hard stop rather than trust. Counts every write that
  // was not started by the user saving something.
  const AUTO_WRITE_WINDOW_MS = 60000;
  const AUTO_WRITE_LIMIT = 8;
  const AUTO_COOLDOWN_MS = 5 * 60000;
  let autoWriteTimes = [];
  var PAUSED_MESSAGE = "Live sync paused for 5 minutes: two devices kept overwriting each other. Your saves still upload. Reload both devices if this repeats.";

  function autoPaused(){
    return Date.now() < autoPausedUntil;
  }

  // Second net: a loop in which each device re-saves what it receives changes
  // local storage before every write, so none of them looks corrective. No
  // person makes this many remote-triggered uploads in a minute.
  const REMOTE_WRITE_LIMIT = 30;
  let remoteWriteTimes = [];

  function noteRemoteWrite(){
    const now = Date.now();
    remoteWriteTimes = remoteWriteTimes.filter((stamp) => now - stamp < AUTO_WRITE_WINDOW_MS);
    remoteWriteTimes.push(now);
    if (remoteWriteTimes.length >= REMOTE_WRITE_LIMIT){
      remoteWriteTimes = [];
      autoWriteTimes = new Array(AUTO_WRITE_LIMIT - 1).fill(now);
      noteAutoWrite();
    }
  }

  function noteAutoWrite(){
    const now = Date.now();
    autoWriteTimes = autoWriteTimes.filter((stamp) => now - stamp < AUTO_WRITE_WINDOW_MS);
    autoWriteTimes.push(now);
    if (autoWriteTimes.length >= AUTO_WRITE_LIMIT){
      autoPausedUntil = now + AUTO_COOLDOWN_MS;
      autoWriteTimes = [];
      warn("Devices are repeatedly rewriting each other's data; pausing live sync for 5 minutes.");
      setStatus({ mode: "error", lastError: PAUSED_MESSAGE });
      // Catch up on whatever arrived during the pause.
      setTimeout(() => { setStatus({ mode: "cloud", lastError: null }); syncNow("resume"); }, AUTO_COOLDOWN_MS + 500);
    }
  }

  function scheduleRetry(){
    clearTimeout(retryTimer);
    retryDelayMs = Math.min(retryDelayMs ? retryDelayMs * 2 : 30000, 5 * 60000);
    retryTimer = setTimeout(() => syncNow("retry"), retryDelayMs);
  }

  function syncNow(reason){
    if (!userRef || !db) return Promise.resolve();
    const automatic = reason === "remote" || reason === "deferred" || reason === "retry";
    if (automatic && Date.now() < autoPausedUntil) return Promise.resolve();
    if (syncInFlight){
      syncQueued = true;
      return syncInFlight;
    }
    syncInFlight = (async () => {
      try{
        let rounds = 0;
        do {
          syncQueued = false;
          const wrote = await syncOnce(reason);
          if (wrote && lastWriteWasCorrective && reason !== "manual" && reason !== "boot") noteAutoWrite();
          // While someone is typing, every upload this device makes rides on a
          // remote-triggered sync (the save debounce never settles): that is
          // two people working, not a loop.
          else if (wrote && reason === "remote" && !userRecentlyTyped()) noteRemoteWrite();
          rounds += 1;
        } while (syncQueued && rounds < 5);
        retryDelayMs = 0;
        clearTimeout(retryTimer);
      } catch (error){
        const offline = (typeof navigator !== "undefined" && navigator.onLine === false) || error?.code === "unavailable";
        if (offline){
          // Not a fault: edits stay on this device and reconcile on reconnect.
          setStatus({ lastError: "Offline — changes are saved on this device and will sync when you reconnect.", mode: "offline" });
          scheduleRetry();
        } else if (error?.code === "meadevil/too-large"){
          warn(error.message);
          setStatus({ lastError: error.message, mode: "error" });
        } else {
          warn("Sync failed (" + (reason || "unknown") + ")", error);
          setStatus({ lastError: String(error?.message || error), mode: "error" });
          scheduleRetry();
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
    // The mentor writes some Build fields straight to storage past the setItem
    // patch, so nothing schedules a sync for them. Sweep for unsynced changes.
    // (The brainstorm THREAD is not part of app state and does not sync at all.)
    let lastSweptRaw = null;
    setInterval(() => {
      if (!booted || syncInFlight || document.visibilityState === "hidden") return;
      const raw = getLocalRaw();
      if (raw === lastSweptRaw) return;
      lastSweptRaw = raw;
      const local = getLocalData();
      const base = loadBase();
      if (!local || !base) return;
      const data = cloudView(local).data;
      const drifted = Object.keys(base.sections).some((key) => !same(base.sections[key], data[key]));
      if (drifted) schedulePush();
    }, 20000);
  }

  function bindRemoteListener(){
    if (unsubscribeSnapshot){ unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    if (!userRef) return;
    unsubscribeSnapshot = userRef.onSnapshot((snapshot) => {
      if (snapshot.metadata && snapshot.metadata.hasPendingWrites) return;
      // The server echo of this device's own write needs no second round trip.
      const data = snapshot.exists ? (snapshot.data() || {}) : {};
      if (data.updatedAt && data.updatedAt === lastWrittenStamp) return;
      syncNow("remote");
    }, (error) => {
      warn("Live listener failed; will retry", error);
      unsubscribeSnapshot = null;
      setTimeout(() => { if (userRef && !unsubscribeSnapshot) bindRemoteListener(); }, 30000);
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

      await ensureAuth();
      userRef = cloudDocRef();

      patchLocalStorage();
      bindVisibilitySync();
      booted = true;
      await syncNow("boot");
      bindRemoteListener();

      auth.onAuthStateChanged((nextUser) => {
        if (nextUser){
          const wasSignedOut = !userRef;
          userRef = cloudDocRef();
          setStatus({ user: nextUser, authReady: true, mode: "cloud" });
          if (!unsubscribeSnapshot) bindRemoteListener();
          if (wasSignedOut) syncNow("resume");
        } else {
          userRef = null;
          if (unsubscribeSnapshot){ unsubscribeSnapshot(); unsubscribeSnapshot = null; }
          setStatus({ user: null, authReady: false, mode: "auth" });
          // Anonymous sessions do not come back by themselves.
          ensureAuth().catch((error) => {
            warn("Re-authentication failed", error);
            setStatus({ mode: "error", lastError: String(error?.message || error) });
          });
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
    cloudView,
    syncNow: () => syncNow("manual"),
    status: () => ({ ...status })
  };

  document.addEventListener("DOMContentLoaded", bootFirebaseSync);
})();
