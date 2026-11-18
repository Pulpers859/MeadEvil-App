/**
 * MeadEvil cloud-sync tests — two real app instances against one fake Firestore.
 *
 * The real Firebase SDK is swapped for an in-memory document held in THIS
 * process, shared by two isolated browser contexts ("laptop" and "phone").
 * Transactions use optimistic versioning like the real thing, so a write based
 * on a stale read is rejected and retried.
 *
 * What this pins:
 *   1. A change on one device reaches the other without a reload
 *   2. Two devices editing DIFFERENT fields of the same record keep both edits
 *   3. A device that missed updates must not overwrite them when it next saves
 *   4. Deletions propagate and stay deleted
 *   5. View state (active tab) stays per-device and causes no write ping-pong
 *   6. Offline edits are kept, reported as offline (not an error), and reconcile
 *   7. Merge rules: different batches never field-merge and the losing batch is
 *      parked in the Vault; rows merge by id; revivals are explicit
 * Scenarios 8-13 came from an independent audit of the first version of this
 * sync, every one of which it failed:
 *   8. A brand-new device (slow sign-in) must not wipe the cloud's active batch
 *   9. A stale device with no baseline must not overwrite a newer batch
 *  10. Unreadable local storage must not delete sections from the cloud
 *  11. Structure additions converge instead of flip-flopping between devices
 *  12. A plain reload writes nothing to the cloud
 *  13. An oversized document fails with a message a person can act on
 *
 * Run with the dev server up:  node tests/sync.mjs
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8910";
const STORAGE_KEY = "meadevil-app-v2";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(name, ok, detail = "") {
  if (ok) console.log(`  ✅ ${name}`);
  else { console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); failures.push(`${name}${detail ? `: ${detail}` : ""}`); }
}

// ---- the fake cloud ---------------------------------------------------------
const cloud = { doc: null, version: 0, writes: 0 };
const pages = [];

function fakeFirebaseInit(options) {
  const authDelayMs = (options && options.authDelayMs) || 0;
  if (options && options.seed && !sessionStorage.getItem("__seeded")) {
    sessionStorage.setItem("__seeded", "1");
    Object.keys(options.seed).forEach((key) => localStorage.setItem(key, options.seed[key]));
  }
  const snap = (state) => ({
    exists: state.exists,
    data: () => (state.exists ? JSON.parse(state.json) : undefined),
    metadata: { hasPendingWrites: false }
  });
  const listeners = [];
  window.__fsNotify = async () => {
    if (window.__fsPaused || window.__fsOffline) return;
    const state = await window.__fsGet();
    listeners.forEach((cb) => cb(snap(state)));
  };
  const ref = {
    async get() { return snap(await window.__fsGet()); },
    onSnapshot(cb) {
      listeners.push(cb);
      window.__fsGet().then((state) => cb(snap(state)));
      return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
    }
  };
  const authState = { currentUser: null };
  window.firebase = {
    apps: [],
    initializeApp() { this.apps.push({}); return {}; },
    app() { return {}; },
    auth() {
      return {
        get currentUser() { return authState.currentUser; },
        async signInAnonymously() {
          if (authDelayMs) await new Promise((r) => setTimeout(r, authDelayMs));
          authState.currentUser = { uid: "test-user" };
          return { user: authState.currentUser };
        },
        onAuthStateChanged() {}
      };
    },
    firestore() {
      return {
        collection() { return { doc() { return ref; } }; },
        async runTransaction(fn) {
          for (let attempt = 0; attempt < 6; attempt += 1) {
            if (window.__fsOffline) { const e = new Error("client is offline"); e.code = "unavailable"; throw e; }
            let version = 0;
            let pending = null;
            await fn({
              async get() { const state = await window.__fsGet(); version = state.version; return snap(state); },
              set(_ref, value) { pending = value; }
            });
            if (!pending) return;
            if (await window.__fsSet(JSON.stringify(pending), version)) return;
          }
          throw new Error("transaction contention");
        }
      };
    }
  };
}

async function device(browser, label, options = {}) {
  const context = await browser.newContext();
  await context.route("https://www.gstatic.com/**", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  await context.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ contentType: "text/css", body: "" }));
  await context.route("**/.netlify/functions/firebase-config", (route) => route.fulfill({
    contentType: "application/javascript",
    body: options.localOnly ? "" : 'window.MEADEVIL_FIREBASE = {"apiKey":"k","projectId":"p","appId":"a"};'
  }));
  const page = await context.newPage();
  page.on("pageerror", (err) => failures.push(`[${label}] JS ERROR: ${err.message}`));
  await page.exposeFunction("__fsGet", async () => ({ exists: cloud.doc != null, json: cloud.doc, version: cloud.version }));
  await page.exposeFunction("__fsSet", async (json, version) => {
    if (version !== cloud.version) return false;
    cloud.doc = json; cloud.version += 1; cloud.writes += 1;
    // Fan out to every device, like a real snapshot listener.
    setTimeout(() => pages.forEach((p) => p.evaluate(() => window.__fsNotify && window.__fsNotify()).catch(() => {})), 10);
    return true;
  });
  await page.addInitScript(fakeFirebaseInit, { authDelayMs: options.authDelayMs || 0, seed: options.seed || null });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await delay(1200 + (options.authDelayMs || 0));
  pages.push(page);
  return page;
}

const appData = (page) => page.evaluate((k) => { const p = JSON.parse(localStorage.getItem(k) || "null"); return p && p.data ? p.data : p; }, STORAGE_KEY);
const cloudData = () => (cloud.doc ? JSON.parse(cloud.doc).appData.data : null);
const syncStatus = (page) => page.evaluate(() => window.MeadevilSync.status());
const forceSync = (page) => page.evaluate(() => window.MeadevilSync.syncNow());

async function setVal(page, sel, value) {
  await page.$eval(sel, (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, String(value));
}
async function clickTab(page, tab) {
  await page.$eval(`button.tab-btn[data-tab="${tab}"]`, (btn) => btn.click());
  await delay(200);
}
async function saveRecipe(page, name) {
  await clickTab(page, "recipes");
  await page.$eval("#clearRecipeBtn", (b) => b.click()).catch(() => {});
  await delay(150);
  await page.evaluate(() => { const b = document.querySelector(".modal-backdrop .btn-danger, .modal-backdrop .btn-primary"); if (b) b.click(); });
  await delay(150);
  await setVal(page, "#recipeName", name);
  await setVal(page, "#recipeBatchGallons", "3");
  await setVal(page, "#recipeTargetAbv", "12");
  await page.$eval("#saveRecipeBtn", (b) => b.click());
  await delay(300);
}
const recipeNames = (data) => (data?.recipes || []).map((r) => r.name).sort().join(",");
// Wait past the 1.2s save debounce plus the listener fan-out.
const settle = () => delay(2600);
// The remote-apply quiet window after typing is 4s.
const settleAfterTyping = () => delay(6200);

async function main() {
  const browser = await chromium.launch();
  const laptop = await device(browser, "laptop");
  const phone = await device(browser, "phone");

  console.log("\n[1] A change on one device reaches the other without a reload");
  check("both devices report cloud mode", (await syncStatus(laptop)).mode === "cloud" && (await syncStatus(phone)).mode === "cloud",
    `${(await syncStatus(laptop)).mode}/${(await syncStatus(phone)).mode}`);
  await saveRecipe(laptop, "Alpha");
  await settleAfterTyping();
  check("recipe saved on laptop reached the cloud", recipeNames(cloudData()) === "Alpha", recipeNames(cloudData()));
  check("recipe arrived on the phone live", recipeNames(await appData(phone)) === "Alpha", recipeNames(await appData(phone)));
  await clickTab(phone, "archive");
  check("phone UI shows it (not just storage)", (await phone.$eval("#tab-archive", (el) => el.textContent)).includes("Alpha"));

  console.log("\n[2] Different fields of the same record, edited on two devices, both survive");
  await phone.evaluate(() => { window.__fsPaused = true; });
  await clickTab(laptop, "cellar");
  await setVal(laptop, "#cellarCurrentPh", "3.42");
  await settle();
  check("laptop pH reached the cloud", String(cloudData()?.cellar?.currentPh) === "3.42", JSON.stringify(cloudData()?.cellar?.currentPh));
  check("phone has not seen the pH yet (precondition)", !(await appData(phone))?.cellar?.currentPh);
  await clickTab(phone, "cellar");
  await setVal(phone, "#cellarCurrentTemp", "64");
  await settleAfterTyping();
  const cellarCloud = cloudData()?.cellar || {};
  check("cloud keeps the laptop's pH", String(cellarCloud.currentPh) === "3.42", JSON.stringify(cellarCloud.currentPh));
  check("cloud gains the phone's temperature", String(cellarCloud.currentTemp) === "64", JSON.stringify(cellarCloud.currentTemp));
  check("phone picked up the pH it had missed", String((await appData(phone))?.cellar?.currentPh) === "3.42");
  check("phone form shows the merged pH", (await phone.$eval("#cellarCurrentPh", (el) => el.value)) === "3.42");
  await phone.evaluate(() => { window.__fsPaused = false; });
  await settleAfterTyping();
  check("laptop received the phone's temperature", String((await appData(laptop))?.cellar?.currentTemp) === "64");

  console.log("\n[3] A device that missed updates must not overwrite them");
  await phone.evaluate(() => { window.__fsPaused = true; });
  await saveRecipe(laptop, "Gamma");
  await clickTab(laptop, "cellar");
  await setVal(laptop, "#cellarCurrentPh", "3.30");
  await settle();
  check("phone is stale (precondition)", recipeNames(await appData(phone)) === "Alpha");
  await saveRecipe(phone, "Delta");
  await settleAfterTyping();
  check("cloud holds all three recipes", recipeNames(cloudData()) === "Alpha,Delta,Gamma", recipeNames(cloudData()));
  check("stale phone did not roll back the newer pH", String(cloudData()?.cellar?.currentPh) === "3.30", JSON.stringify(cloudData()?.cellar?.currentPh));
  check("phone caught up to all three", recipeNames(await appData(phone)) === "Alpha,Delta,Gamma", recipeNames(await appData(phone)));
  await phone.evaluate(() => { window.__fsPaused = false; });
  await settleAfterTyping();
  check("laptop gained the phone's recipe", recipeNames(await appData(laptop)) === "Alpha,Delta,Gamma", recipeNames(await appData(laptop)));

  console.log("\n[4] Deletions propagate and stay deleted");
  await clickTab(laptop, "archive");
  const alphaId = (await appData(laptop)).recipes.find((r) => r.name === "Alpha").id;
  await laptop.$eval(`button[data-recipe-delete="${alphaId}"]`, (b) => b.click());
  await laptop.waitForSelector(".modal-backdrop .modal-card", { timeout: 1500 }).catch(() => {});
  await laptop.evaluate(() => { const b = document.querySelector(".modal-backdrop .btn-danger"); if (b) b.click(); });
  await settle();
  check("deleted on the phone too", recipeNames(await appData(phone)) === "Delta,Gamma", recipeNames(await appData(phone)));
  await forceSync(phone); await forceSync(laptop); await delay(400);
  check("still deleted after another round trip", recipeNames(cloudData()) === "Delta,Gamma", recipeNames(cloudData()));

  console.log("\n[5] View state stays per-device and causes no write ping-pong");
  await clickTab(laptop, "ferment");
  await clickTab(phone, "nutrients");
  await settle();
  const writesBefore = cloud.writes;
  await delay(3500);
  check("no cloud writes while both devices sit idle on different tabs", cloud.writes === writesBefore, `${cloud.writes - writesBefore} writes`);
  check("laptop kept its own tab", (await appData(laptop)).ui.activeTab === "ferment");
  check("phone kept its own tab", (await appData(phone)).ui.activeTab === "nutrients");
  check("view state is not uploaded", cloudData().ui === undefined);

  console.log("\n[6] Offline edits are kept, reported honestly, and reconcile");
  await phone.evaluate(() => { window.__fsOffline = true; });
  await clickTab(phone, "cellar");
  await setVal(phone, "#cellarCurrentTemp", "58");
  await settle();
  const offlineStatus = await syncStatus(phone);
  check("phone reports offline, not a sync error", offlineStatus.mode === "offline", offlineStatus.mode);
  check("offline edit is still on the phone", String((await appData(phone)).cellar.currentTemp) === "58");
  check("cloud untouched while offline", String(cloudData().cellar.currentTemp) === "64");
  await saveRecipe(laptop, "Epsilon");
  await settle();
  await phone.evaluate(() => { window.__fsOffline = false; window.dispatchEvent(new Event("online")); });
  await settleAfterTyping();
  check("offline edit reached the cloud on reconnect", String(cloudData().cellar.currentTemp) === "58", JSON.stringify(cloudData().cellar.currentTemp));
  check("phone received what it missed while offline", recipeNames(await appData(phone)) === "Delta,Epsilon,Gamma", recipeNames(await appData(phone)));
  check("phone back in cloud mode", (await syncStatus(phone)).mode === "cloud");

  console.log("\n[7] Merge rules");
  const rules = await laptop.evaluate(() => {
    const merge = window.MeadevilSync.buildMergedAppData;
    const env = (data, savedAt) => ({ _schema: { savedAt }, data });
    const batchA = { loadedAt: "2026-01-01T00:00:00Z", recipeId: "r1", name: "Old batch", notes: "" };
    const batchB = { loadedAt: "2026-03-01T00:00:00Z", recipeId: "r2", name: "New batch", notes: "" };
    const g1 = { id: "g1", date: "2026-01-02", gravity: "1.100" };
    const g2 = { id: "g2", date: "2026-01-09", gravity: "1.050" };
    // Local still on the old batch, recorded a pH and a reading; cloud moved on.
    const out1 = merge(
      env({ currentBatch: batchA, cellar: { currentPh: "3.1" }, fermentationLogs: [g1, g2], archive: [] }, "2026-03-05T00:00:00Z"),
      env({ currentBatch: batchB, cellar: { currentPh: "" }, fermentationLogs: [], archive: [] }, "2026-03-02T00:00:00Z"),
      null,
      { sections: { currentBatch: batchA, cellar: { currentPh: "" } }, logIds: ["g1"] }
    ).data;
    // Same, but the other device ARCHIVED that exact batch and this one did nothing.
    const out1b = merge(
      env({ currentBatch: batchA, cellar: { currentPh: "" }, fermentationLogs: [g1], archive: [] }, "2026-03-01T00:00:00Z"),
      env({ currentBatch: { name: "", loadedAt: null, recipeId: "" }, cellar: { currentPh: "" }, fermentationLogs: [],
            archive: [{ id: "arch1", archivedAt: "2026-03-02T00:00:00Z", batch: batchA, cellar: { currentPh: "" }, fermentationLogs: [g1] }],
            tombstones: [{ collection: "fermentationLogs", id: "g1", deletedAt: "2026-03-02T00:00:00Z" }] }, "2026-03-02T00:00:00Z"),
      null,
      { sections: { currentBatch: batchA, cellar: { currentPh: "" } }, logIds: ["g1"] }
    ).data;
    // Explicit revival marker beats an older tombstone, on any device, baseline or not.
    const tomb = { collection: "recipes", id: "r9", deletedAt: "2026-01-01T00:00:00Z" };
    const out2 = merge(
      env({ recipes: [{ id: "r9", name: "Restored" }], tombstones: [{ collection: "recipes", id: "r9", deletedAt: "", revivedAt: "2026-02-01T00:00:00Z" }] }, "2026-03-05T00:00:00Z"),
      env({ recipes: [], tombstones: [tomb] }, "2026-03-02T00:00:00Z"),
      null, null
    ).data;
    // A tombstone merely ABSENT locally (trimmed, or never seen) is not a revival.
    const out3 = merge(
      env({ recipes: [{ id: "r9", name: "Zombie" }], tombstones: [] }, "2026-03-05T00:00:00Z"),
      env({ recipes: [], tombstones: [tomb] }, "2026-03-02T00:00:00Z"),
      null,
      { sections: {}, logIds: [] }
    ).data;
    // Deleted again after a revival: the newer deletion wins.
    const out3b = merge(
      env({ recipes: [{ id: "r9", name: "X" }], tombstones: [{ collection: "recipes", id: "r9", deletedAt: "", revivedAt: "2026-02-01T00:00:00Z" }] }, "2026-03-05T00:00:00Z"),
      env({ recipes: [], tombstones: [{ collection: "recipes", id: "r9", deletedAt: "2026-02-20T00:00:00Z" }] }, "2026-03-02T00:00:00Z"),
      null, null
    ).data;
    // Both sides changed the SAME field: the syncing device wins it; siblings still merge.
    const out4 = merge(
      env({ cellar: { currentPh: "3.2", note: "base" } }, "2026-03-01T00:00:00Z"),
      env({ cellar: { currentPh: "3.6", note: "cloud note" } }, "2030-01-01T00:00:00Z"),
      null,
      { sections: { cellar: { currentPh: "3.0", note: "base" } }, logIds: [] }
    ).data;
    // Rows with ids merge row by row.
    const task = (id, done) => ({ id, text: id, done });
    const out5 = merge(
      env({ fermentChecklist: [task("t0", true), task("t1", false)], currentBatch: { stepFeedLog: [{ id: "feedA", lb: "1" }] } }, "2026-03-01T00:00:00Z"),
      env({ fermentChecklist: [task("t0", false), task("t1", true)], currentBatch: { stepFeedLog: [{ id: "feedB", lb: "2" }] } }, "2026-03-02T00:00:00Z"),
      null,
      { sections: { fermentChecklist: [task("t0", false), task("t1", false)], currentBatch: { stepFeedLog: [] } }, logIds: [] }
    ).data;
    // A row deleted on one side stays deleted unless the other side edited it.
    const out6 = merge(
      env({ cellar: { additions: [{ id: "a1", note: "kept" }] } }, "2026-03-01T00:00:00Z"),
      env({ cellar: { additions: [{ id: "a1", note: "kept" }, { id: "a2", note: "edited on cloud" }, { id: "a3", note: "same" }] } }, "2026-03-02T00:00:00Z"),
      null,
      { sections: { cellar: { additions: [{ id: "a1", note: "kept" }, { id: "a2", note: "orig" }, { id: "a3", note: "same" }] } }, logIds: [] }
    ).data;
    // No baseline: the cloud wins disagreements, but an empty value never beats a real one.
    const out7 = merge(
      env({ recipeDraft: { name: "Local draft", notes: "local notes" }, cellar: { currentPh: "3.9" } }, "2030-01-01T00:00:00Z"),
      env({ recipeDraft: { name: "", notes: "cloud notes" }, cellar: { currentPh: "3.3" } }, "2026-03-02T00:00:00Z"),
      null, null
    ).data;
    // Per-device fields are never uploaded.
    const view = window.MeadevilSync.cloudView(env({ ui: { activeTab: "x" }, clock: { running: true }, rapt: { batchKey: "k", lastFetchedAt: "now", lastStatus: "s" } }, "x")).data;
    return {
      batchName: out1.currentBatch.name, batchPh: out1.cellar.currentPh, liveLogs: out1.fermentationLogs.length,
      rescued: out1.archive.length, rescuedName: out1.archive[0] && out1.archive[0].batch.name, rescuedPh: out1.archive[0] && out1.archive[0].cellar.currentPh,
      rescuedLogs: out1.archive[0] && out1.archive[0].fermentationLogs.length,
      noDupe: out1b.archive.length,
      revived: out2.recipes.length,
      zombie: out3.recipes.length,
      redeleted: out3b.recipes.length,
      conflictPh: out4.cellar.currentPh, conflictNote: out4.cellar.note,
      ticks: out5.fermentChecklist.map((t) => t.done).join(","), feeds: out5.currentBatch.stepFeedLog.map((f) => f.id).sort().join(","),
      rows: out6.cellar.additions.map((r) => r.id).join(","),
      nbName: out7.recipeDraft.name, nbNotes: out7.recipeDraft.notes, nbPh: out7.cellar.currentPh,
      viewKeys: Object.keys(view).join(","), raptKeys: Object.keys(view.rapt).join(","),
      stable: window.MeadevilSync.stableStringify({ b: 1, a: { d: 2, c: 3 } }) === window.MeadevilSync.stableStringify({ a: { c: 3, d: 2 }, b: 1 })
    };
  });
  check("a new batch on the other device is taken whole", rules.batchName === "New batch", rules.batchName);
  check("the old batch's pH does not leak onto the new batch", rules.batchPh === "", JSON.stringify(rules.batchPh));
  check("the old batch's readings do not attach to the new batch", rules.liveLogs === 0, String(rules.liveLogs));
  check("the replaced batch's unsynced work is parked in the Vault", rules.rescued === 1 && /Old batch \(recovered copy\)/.test(rules.rescuedName || ""), `${rules.rescued} ${rules.rescuedName}`);
  check("...with its pH and both readings", rules.rescuedPh === "3.1" && rules.rescuedLogs === 2, `${rules.rescuedPh}/${rules.rescuedLogs}`);
  check("no recovered copy when the other device already archived that batch", rules.noDupe === 1, String(rules.noDupe));
  check("an explicit revival beats an older tombstone", rules.revived === 1, String(rules.revived));
  check("a tombstone merely missing locally is not treated as a revival", rules.zombie === 0);
  check("deleting again after a revival still deletes", rules.redeleted === 0);
  check("true conflict: the syncing device wins, regardless of clocks", rules.conflictPh === "3.2", rules.conflictPh);
  check("true conflict: untouched sibling field still merges", rules.conflictNote === "cloud note", rules.conflictNote);
  check("checklist ticks from both devices survive", rules.ticks === "true,true", rules.ticks);
  check("step feeds logged on both devices survive", rules.feeds === "feedA,feedB", rules.feeds);
  check("a deleted row stays deleted unless the other side edited it", rules.rows === "a1,a2", rules.rows);
  check("no baseline: cloud wins a disagreement", rules.nbNotes === "cloud notes" && rules.nbPh === "3.3", `${rules.nbNotes}/${rules.nbPh}`);
  check("no baseline: an empty cloud value does not erase a real one", rules.nbName === "Local draft", rules.nbName);
  check("ui and clock are never uploaded", rules.viewKeys === "rapt", rules.viewKeys);
  check("rapt fetch bookkeeping is never uploaded", rules.raptKeys === "batchKey", rules.raptKeys);
  check("comparison ignores key order", rules.stable);

  // ---- audit scenarios: seeded cloud, realistic state -----------------------
  // A real default state, from a device with sync off.
  const probe = await device(browser, "probe", { localOnly: true });
  await clickTab(probe, "ferment");
  const defaultEnvelope = JSON.parse(await probe.evaluate((k) => localStorage.getItem(k), STORAGE_KEY));
  await probe.context().close();
  pages.splice(pages.indexOf(probe), 1);
  const logRow = (i, day) => ({ id: `log-${i}`, date: `2026-0${day}-0${(i % 9) + 1}`, gravity: (1.1 - i * 0.005).toFixed(3), temp: "66", note: "", createdAt: `2026-0${day}-0${(i % 9) + 1}T10:00:00.000Z` });
  const stateWith = (fn, savedAt) => { const env = JSON.parse(JSON.stringify(defaultEnvelope)); env._schema.savedAt = savedAt; fn(env.data); return env; };
  const seedCloud = (env) => { cloud.doc = JSON.stringify({ version: 1, appId: "meadevil-app", updatedAt: env._schema.savedAt, appData: env }); cloud.version += 1; cloud.writes = 0; };
  const closeAll = async () => { for (const p of pages.splice(0)) await p.context().close(); };
  await closeAll();

  const bigBatch = stateWith((d) => {
    Object.assign(d.currentBatch, { name: "Big Batch", loadedAt: "2026-05-01T00:00:00.000Z", recipeId: "recipe-big", batchGallons: "5" });
    d.cellar.currentPh = "3.40";
    d.fermentationLogs = [logRow(1, 5), logRow(2, 5)];
    d.recipes = [{ id: "recipe-big", name: "Big Batch", createdAt: "2026-04-30T00:00:00.000Z", updatedAt: "2026-04-30T00:00:00.000Z" }];
  }, "2026-05-10T00:00:00.000Z");

  console.log("\n[8] A brand-new device must not wipe the cloud's active batch");
  for (const authDelayMs of [0, 400, 900]) {
    seedCloud(bigBatch);
    const fresh = await device(browser, `fresh-${authDelayMs}`, { authDelayMs });
    await delay(1800);
    const c = cloudData();
    check(`sign-in ${authDelayMs}ms: cloud batch and pH intact`, c.currentBatch.name === "Big Batch" && c.cellar.currentPh === "3.40", `${c.currentBatch.name}/${c.cellar.currentPh}`);
    check(`sign-in ${authDelayMs}ms: new device adopted the batch, readings and recipe`,
      (await appData(fresh)).currentBatch.name === "Big Batch" && (await appData(fresh)).fermentationLogs.length === 2 && recipeNames(await appData(fresh)) === "Big Batch");
    if (authDelayMs === 900) {
      await clickTab(fresh, "ferment");
      check("new device shows the batch in the UI", (await fresh.$eval("#tab-ferment", (el) => el.textContent)).includes("Big Batch"));
      // A second, already-healthy device must not be dragged anywhere either.
      const healthy = await device(browser, "healthy");
      await delay(1500);
      check("an existing device still has the batch afterwards", (await appData(healthy)).currentBatch.name === "Big Batch");
    }
    await closeAll();
  }

  console.log("\n[9] A stale device with no baseline must not overwrite a newer batch");
  seedCloud(stateWith((d) => {
    Object.assign(d.currentBatch, { name: "NEW batch", loadedAt: "2026-06-01T00:00:00.000Z", recipeId: "recipe-new" });
    d.cellar.currentPh = "3.10";
    d.fermentationLogs = [logRow(20, 6), logRow(21, 6)];
    d.tombstones = Array.from({ length: 10 }, (_, i) => ({ collection: "fermentationLogs", id: `log-${i}`, deletedAt: "2026-06-01T00:00:00.000Z" }));
  }, "2026-06-02T00:00:00.000Z"));
  const staleLocal = stateWith((d) => {
    Object.assign(d.currentBatch, { name: "OLD batch", loadedAt: "2026-04-01T00:00:00.000Z", recipeId: "recipe-old", notes: "phone-only notes" });
    d.cellar.currentPh = "3.90";
    d.fermentationLogs = Array.from({ length: 10 }, (_, i) => logRow(i, 4));
  }, "2026-05-28T00:00:00.000Z");
  const stalePhone = await device(browser, "stale-phone", { authDelayMs: 500, seed: { [STORAGE_KEY]: JSON.stringify(staleLocal) } });
  await delay(1800);
  let c9 = cloudData();
  check("cloud still holds the NEW batch and its pH", c9.currentBatch.name === "NEW batch" && c9.cellar.currentPh === "3.10", `${c9.currentBatch.name}/${c9.cellar.currentPh}`);
  check("the new batch keeps exactly its own two readings", c9.fermentationLogs.length === 2 && c9.fermentationLogs.every((l) => /log-2[01]/.test(l.id)), c9.fermentationLogs.map((l) => l.id).join(","));
  const recovered = (c9.archive || []).find((a) => /OLD batch \(recovered copy\)/.test(a.batch?.name || ""));
  check("the stale device's batch was parked in the Vault, not discarded", Boolean(recovered));
  check("...with its notes, pH and all ten readings", recovered && recovered.batch.notes === "phone-only notes" && recovered.cellar.currentPh === "3.90" && recovered.fermentationLogs.length === 10,
    recovered ? `${recovered.batch.notes}/${recovered.cellar.currentPh}/${recovered.fermentationLogs.length}` : "none");
  check("stale device now shows the NEW batch", (await appData(stalePhone)).currentBatch.name === "NEW batch");
  const writes9 = cloud.writes;
  await stalePhone.reload({ waitUntil: "domcontentloaded" });
  await delay(2500);
  check("reloading does not create a second recovered copy", (cloudData().archive || []).filter((a) => /recovered copy/.test(a.batch?.name || "")).length === 1 && cloud.writes === writes9, `${cloud.writes - writes9} writes`);
  await closeAll();

  console.log("\n[10] Unreadable local storage must not delete sections from the cloud");
  seedCloud(bigBatch);
  const healthyBase = JSON.stringify({ docId: "meadevil-shared", sections: Object.fromEntries(Object.entries(bigBatch.data).filter(([k]) => !["fermentationLogs", "recipes", "archive", "tombstones", "ui", "clock"].includes(k))), logIds: ["log-1", "log-2"] });
  const broken = await device(browser, "broken", { authDelayMs: 300, seed: { [STORAGE_KEY]: JSON.stringify(bigBatch).slice(0, 900), "meadevil-sync-base-v2": healthyBase } });
  await delay(1800);
  const c10 = cloudData();
  check("cloud batch, pH and readings intact", c10.currentBatch?.name === "Big Batch" && c10.cellar?.currentPh === "3.40" && c10.fermentationLogs.length === 2, `${c10.currentBatch?.name}/${c10.cellar?.currentPh}`);
  check("no section was removed from the cloud", ["currentBatch", "cellar", "nutrients", "fermentChecklist", "cellarChecklist", "calcs", "mentor"].every((k) => c10[k] !== undefined), Object.keys(c10).join(","));
  check("the device recovered its data from the cloud", (await appData(broken)).currentBatch?.name === "Big Batch", (await appData(broken)).currentBatch?.name);
  check("the unreadable blob was still preserved for manual recovery", await broken.evaluate(() => Boolean(localStorage.getItem("meadevil-app-v2-corrupt-backup"))));
  await closeAll();

  console.log("\n[11] Structure additions converge between devices");
  cloud.doc = null; cloud.version += 1; cloud.writes = 0;
  const lap = await device(browser, "lap");
  const pho = await device(browser, "pho");
  await clickTab(lap, "recipes");
  await setVal(lap, "#recipeName", "Oaked");
  await lap.$eval('#recipeAdjunctList [data-adjunct-field="ingredient"]', (el) => {
    el.value = "OAK-FROM-LAPTOP";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await delay(400);
  await setVal(lap, "#recipeBatchGallons", "3");
  await settleAfterTyping();
  const adjNames = (d) => (d?.recipeDraft?.structureAdditions || []).map((r) => r.ingredient).filter(Boolean).join(",");
  check("laptop's adjunct reached the cloud", adjNames(cloudData()) === "OAK-FROM-LAPTOP", adjNames(cloudData()));
  check("phone storage has it", adjNames(await appData(pho)) === "OAK-FROM-LAPTOP", adjNames(await appData(pho)));
  await clickTab(pho, "recipes");
  await delay(300);
  check("phone UI shows it", (await pho.$$eval('#recipeAdjunctList [data-adjunct-field="ingredient"]', (els) => els.map((e) => e.value))).includes("OAK-FROM-LAPTOP"));
  const writes11 = cloud.writes;
  for (const [page, tab] of [[pho, "ferment"], [lap, "cellar"], [pho, "recipes"], [lap, "recipes"], [pho, "archive"]]) { await clickTab(page, tab); await settle(); }
  check("switching tabs on both devices never drops it", adjNames(cloudData()) === "OAK-FROM-LAPTOP" && adjNames(await appData(lap)) === "OAK-FROM-LAPTOP" && adjNames(await appData(pho)) === "OAK-FROM-LAPTOP",
    `${adjNames(cloudData())} | ${adjNames(await appData(lap))} | ${adjNames(await appData(pho))}`);
  check("...and causes no cloud writes", cloud.writes === writes11, `${cloud.writes - writes11} writes`);

  console.log("\n[12] A plain reload writes nothing to the cloud");
  const writes12 = cloud.writes;
  await pho.reload({ waitUntil: "domcontentloaded" });
  await delay(3000);
  await lap.reload({ waitUntil: "domcontentloaded" });
  await delay(3000);
  check("two reloads, zero writes", cloud.writes === writes12, `${cloud.writes - writes12} writes`);
  await delay(21000);
  check("still zero after the background sweep has run", cloud.writes === writes12, `${cloud.writes - writes12} writes`);

  console.log("\n[13] An oversized document fails with a message a person can act on");
  await clickTab(lap, "recipes");
  await lap.evaluate((k) => {
    const env = JSON.parse(localStorage.getItem(k));
    env.data.recipeDraft.notes = "x".repeat(1100 * 1024);
    localStorage.setItem(k, JSON.stringify(env));
  }, STORAGE_KEY);
  await settle();
  const big = await syncStatus(lap);
  check("status is an error that names the size limit", big.mode === "error" && /too large to sync/.test(big.lastError || ""), `${big.mode}: ${String(big.lastError).slice(0, 80)}`);
  check("the oversized state was not written", !JSON.stringify(cloudData()).includes("xxxxxxxxxx"));
  check("the data is still on the device", (await appData(lap)).recipeDraft.notes.length > 1000000);
  await clickTab(pho, "recipes");
  await setVal(pho, "#recipeName", "Sent to the oversized device");
  await settleAfterTyping();
  await delay(1500);
  check("an oversized device still receives other devices' changes", (await appData(lap)).recipeDraft.name === "Sent to the oversized device", (await appData(lap)).recipeDraft.name);
  check("...and keeps its own oversized data and the warning", (await appData(lap)).recipeDraft.notes.length > 1000000 && (await syncStatus(lap)).mode === "error");

  console.log("\n[15] Second-audit merge rules");
  const pure = await device(browser, "pure", { localOnly: true });
  const r15 = await pure.evaluate(() => {
    const merge = window.MeadevilSync.buildMergedAppData;
    const env = (data, savedAt) => ({ _schema: { savedAt }, data });
    const task = (id, done) => ({ id, text: id, done });
    const batch = { loadedAt: "2026-01-01T00:00:00Z", recipeId: "r1", name: "Shared batch" };
    // No baseline, same batch, a tick made only on this device.
    const a2 = merge(
      env({ currentBatch: batch, fermentChecklist: [task("t0", true)], archive: [] }, "2026-03-01T00:00:00Z"),
      env({ currentBatch: batch, fermentChecklist: [task("t0", false)], archive: [] }, "2026-03-02T00:00:00Z"),
      null, null).data;
    // ...and nothing parked when the two sides already agree.
    const a2b = merge(
      env({ currentBatch: batch, fermentChecklist: [task("t0", true)], archive: [] }, "2026-03-01T00:00:00Z"),
      env({ currentBatch: batch, fermentChecklist: [task("t0", true)], archive: [] }, "2026-03-02T00:00:00Z"),
      null, null).data;
    // No baseline: a stale device must not refill a field the cloud cleared later.
    const a1c = merge(
      env({ cellar: { note: "old note" }, recipeDraft: { name: "Old draft" } }, "2026-03-01T00:00:00Z"),
      env({ cellar: { note: "" }, recipeDraft: { name: "" } }, "2026-03-05T00:00:00Z"),
      null, null).data;
    // Both devices archived the batch apart: each got fresh default rows.
    const empty = { name: "", loadedAt: null, recipeId: "" };
    const a4 = merge(
      env({ currentBatch: empty, fermentChecklist: [task("L0", false), task("L1", false)], cellar: { additions: [{ id: "La", note: "" }] } }, "2026-03-03T00:00:00Z"),
      env({ currentBatch: empty, fermentChecklist: [task("C0", false), task("C1", false)], cellar: { additions: [{ id: "Ca", note: "" }] } }, "2026-03-02T00:00:00Z"),
      null,
      { sections: { currentBatch: batch, fermentChecklist: [task("B0", true), task("B1", true)], cellar: { additions: [{ id: "Ba", note: "x" }] } }, logIds: [] }).data;
    // Each device loaded a different recipe into the Build draft.
    const a4b = merge(
      env({ recipeDraft: { id: "rc", name: "Cyser", batchGallons: "1", notes: "", additions: [{ id: "c1", name: "Cider" }] } }, "2026-03-03T00:00:00Z"),
      env({ recipeDraft: { id: "rt", name: "Trad", batchGallons: "5", notes: "trad notes", additions: [{ id: "t1", name: "Orange blossom", amount: "15" }] } }, "2026-03-02T00:00:00Z"),
      null,
      { sections: { recipeDraft: { id: "", name: "", batchGallons: "1", notes: "", additions: [{ id: "b1", name: "" }] } }, logIds: [] }).data;
    // Recovered-copy suffix never stacks.
    const a8 = merge(
      env({ currentBatch: { loadedAt: "2026-01-01T00:00:00Z", recipeId: "r1", name: "X (recovered copy)", notes: "mine" }, archive: [] }, "2026-03-01T00:00:00Z"),
      env({ currentBatch: { loadedAt: "2026-02-01T00:00:00Z", recipeId: "r2", name: "Other" }, archive: [] }, "2026-03-02T00:00:00Z"),
      null, null).data;
    const s4 = merge(
      env({ recipeDraft: { structureAdditions: [{ id: "blank-xyz", ingredient: "", amount: "", purpose: "", notes: "" }] } }, "2026-03-03T00:00:00Z"),
      env({ recipeDraft: { structureAdditions: [{ id: "b", ingredient: "vanilla" }] } }, "2026-03-02T00:00:00Z"),
      null, { sections: { recipeDraft: { structureAdditions: [{ id: "a", ingredient: "oak" }] } }, logIds: [] }).data;
    const s5 = merge(
      env({ recipeDraft: { additions: [{ id: "w", name: "wildflower" }] } }, "2026-03-03T00:00:00Z"),
      env({ recipeDraft: { additions: [{ id: "c", name: "cherry" }] } }, "2026-03-02T00:00:00Z"),
      null, { sections: { recipeDraft: { additions: [{ id: "k", name: "clover" }] } }, logIds: [] }).data;
    const s6 = merge(
      env({ recipeDraft: { id: "", name: "Trad v2", batchGallons: "5" } }, "2026-03-03T00:00:00Z"),
      env({ recipeDraft: { id: "", name: "Traditional", batchGallons: "6" } }, "2026-03-02T00:00:00Z"),
      null, { sections: { recipeDraft: { id: "", name: "Trad", batchGallons: "5" } }, logIds: [] }).data;
    const l1 = { id: "l1", date: "2026-01-02", gravity: "1.100" };
    const l2 = { id: "l2", date: "2026-01-09", gravity: "1.050" };
    const s10 = merge(
      env({ currentBatch: batch, fermentationLogs: [l1, l2], archive: [] }, "2026-03-01T00:00:00Z"),
      env({ currentBatch: empty, fermentationLogs: [], archive: [{ id: "arch1", archivedAt: "2026-03-02T00:00:00Z", batch, cellar: {}, fermentationLogs: [l1] }] }, "2026-03-02T00:00:00Z"),
      null, null).data;
    // Baseline can never be stored: each new local edit must not add another copy.
    const cloudSide = env({ currentBatch: batch, cellar: { currentPh: "3.3" }, archive: [] }, "2026-03-02T00:00:00Z");
    const first = merge(env({ currentBatch: batch, cellar: { currentPh: "3.5" }, archive: [] }, "2026-03-01T00:00:00Z"), cloudSide, null, null);
    const second = merge(env({ ...first.data, cellar: { currentPh: "3.7" } }, "2026-03-03T00:00:00Z"), env({ ...first.data }, "2026-03-02T00:00:00Z"), null, null).data;
    const s3 = merge(
      env({ recipeDraft: { id: "", draftId: "d-cherry", name: "Cherry Melomel", additions: [{ id: "x1", name: "Tart cherries" }], structureAdditions: [{ id: "o1", ingredient: "Oak cubes" }] } }, "2026-03-03T00:00:00Z"),
      env({ recipeDraft: { id: "", draftId: "d-trad", name: "Orange Blossom Trad", additions: [{ id: "y1", name: "Orange blossom honey" }], structureAdditions: [{ id: "v1", ingredient: "Vanilla bean" }] } }, "2026-03-02T00:00:00Z"),
      null, { sections: { recipeDraft: { id: "", draftId: "", name: "", additions: [{ id: "b0", name: "" }], structureAdditions: [] } }, logIds: [] }).data;
    return {
      s3: [s3.recipeDraft.name, s3.recipeDraft.additions.map((r) => r.name).join("+"), s3.recipeDraft.structureAdditions.map((r) => r.ingredient).join("+")].join("|"),
      s4: s4.recipeDraft.structureAdditions.map((r) => r.ingredient).filter(Boolean).join(","),
      s5: s5.recipeDraft.additions.map((r) => r.name).join(","),
      s6Name: s6.recipeDraft.name, s6Gal: s6.recipeDraft.batchGallons,
      s10Active: s10.currentBatch.name || "", s10Parked: s10.archive.filter((e) => /recovered/.test(e.batch.name)).length,
      s9: second.archive.filter((e) => /recovered/.test(e.batch.name)).length,
      a2Tick: a2.fermentChecklist[0].done, a2Parked: a2.archive.length, a2ParkedTick: a2.archive[0] && a2.archive[0].fermentChecklist[0].done,
      a2bParked: a2b.archive.length,
      a1cNote: a1c.cellar.note, a1cName: a1c.recipeDraft.name,
      a4Tasks: a4.fermentChecklist.map((t) => t.id).join(","), a4Adds: a4.cellar.additions.map((t) => t.id).join(","),
      a4bName: a4b.recipeDraft.name, a4bGal: a4b.recipeDraft.batchGallons, a4bNotes: a4b.recipeDraft.notes, a4bRows: a4b.recipeDraft.additions.map((r) => r.name).join(","),
      a8Name: a8.archive[0] && a8.archive[0].batch.name
    };
  });
  check("no baseline, same batch: cloud value wins", r15.a2Tick === false);
  check("...but this device's differing version is parked in the Vault", r15.a2Parked === 1 && r15.a2ParkedTick === true, `${r15.a2Parked}/${r15.a2ParkedTick}`);
  check("...and nothing is parked when both sides agree", r15.a2bParked === 0, String(r15.a2bParked));
  check("no baseline: a real local value is kept over an empty cloud one, whatever the clocks say", r15.a1cNote === "old note" && r15.a1cName === "Old draft", `${r15.a1cNote}/${r15.a1cName}`);
  check("a blank placeholder row does not erase the other device's adjunct", r15.s4 === "vanilla", r15.s4);
  check("two devices each replacing a source-bill row keep both rows", r15.s5 === "cherry,wildflower" || r15.s5 === "wildflower,cherry", r15.s5);
  check("two plans sent to Build on two devices are never blended", r15.s3 === "Cherry Melomel|Tart cherries|Oak cubes", r15.s3);
  check("two renames of the same draft merge field by field", r15.s6Name === "Trad v2" && r15.s6Gal === "6", `${r15.s6Name}/${r15.s6Gal}`);
  check("a stale device with extra readings does not revive an archived batch", r15.s10Active === "" && r15.s10Parked === 1, `${r15.s10Active}/${r15.s10Parked}`);
  check("repeat syncs without a baseline park one copy per batch, not one per edit", r15.s9 === 1, String(r15.s9));
  check("both devices rebuilt a checklist: one list, not a doubled one", r15.a4Tasks === "L0,L1" && r15.a4Adds === "La", `${r15.a4Tasks} | ${r15.a4Adds}`);
  check("two different recipes loaded apart are never blended", r15.a4bName === "Cyser" && r15.a4bGal === "1" && r15.a4bNotes === "" && r15.a4bRows === "Cider", JSON.stringify(r15));
  check("recovered-copy suffix does not stack", r15.a8Name === "X (recovered copy)", r15.a8Name);

  // Resuming on a device whose clock runs behind the one that archived.
  const future = new Date(Date.now() + 5 * 60000).toISOString();
  const slowEnv = stateWith((d) => {
    d.archive = [{ id: "arch-slow", archivedAt: future, batch: { ...d.currentBatch, name: "Slow clock", loadedAt: "2026-05-01T00:00:00.000Z" }, nutrients: d.nutrients, cellar: d.cellar, fermentChecklist: d.fermentChecklist, cellarChecklist: d.cellarChecklist, fermentationLogs: [logRow(1, 5), logRow(2, 5)] }];
    d.tombstones = [{ collection: "fermentationLogs", id: "log-1", deletedAt: future }, { collection: "fermentationLogs", id: "log-2", deletedAt: future }];
  }, "2026-05-10T00:00:00.000Z");
  const slow = await device(browser, "slow-clock", { localOnly: true, seed: { [STORAGE_KEY]: JSON.stringify(slowEnv) } });
  await clickTab(slow, "archive");
  const resumeBtn = await slow.$("[data-archive-load]");
  if (resumeBtn) {
    await resumeBtn.click();
    await delay(300);
    const ok = await slow.$('.modal-actions button:has-text("Resume batch")');
    if (ok) await ok.click();
    await delay(500);
  }
  const slowData = await appData(slow);
  const marks = (slowData.tombstones || []).filter((t) => t.collection === "fermentationLogs");
  check("resume found and restored the readings", Boolean(resumeBtn) && slowData.fermentationLogs.length === 2, `${Boolean(resumeBtn)}/${slowData.fermentationLogs.length}`);
  check("revival is stamped after the deletion despite the slow clock", marks.length === 2 && marks.every((t) => Date.parse(t.revivedAt) > Date.parse(future)), JSON.stringify(marks));
  const mergedSlow = await slow.evaluate(({ k, future }) => {
    const local = JSON.parse(localStorage.getItem(k));
    const cloudEnv = JSON.parse(JSON.stringify(local));
    cloudEnv.data.fermentationLogs = [];
    cloudEnv.data.tombstones = [{ collection: "fermentationLogs", id: "log-1", deletedAt: future }, { collection: "fermentationLogs", id: "log-2", deletedAt: future }];
    return window.MeadevilSync.buildMergedAppData(local, cloudEnv, null, null).data.fermentationLogs.length;
  }, { k: STORAGE_KEY, future });
  check("...so a sync does not strip the resumed readings", mergedSlow === 2, String(mergedSlow));
  await closeAll();

  console.log("\n[16] Batches set aside on one device");
  const sh = await device(browser, "shelf-pure", { localOnly: true });
  const r16 = await sh.evaluate(() => {
    const merge = window.MeadevilSync.buildMergedAppData;
    const env = (data, savedAt) => ({ _schema: { savedAt }, data });
    const X = { loadedAt: "2026-04-01T00:00:00Z", recipeId: "rx", name: "Batch X" };
    const Y = { loadedAt: "2026-05-01T00:00:00Z", recipeId: "ry", name: "Batch Y" };
    const lx = { id: "lx", date: "2026-04-02", gravity: "1.100" };
    const shelfX = { id: "shelf-x", shelvedAt: "2026-05-01T00:00:00Z", batch: X, cellar: { currentPh: "" }, fermentationLogs: [lx] };
    const base = { sections: { currentBatch: X, cellar: { currentPh: "" } }, logIds: ["lx"] };
    // Laptop set X aside and started Y; phone still on X and did nothing.
    const laptop = env({ currentBatch: Y, cellar: { currentPh: "" }, fermentationLogs: [], shelf: [shelfX], archive: [],
      tombstones: [{ collection: "fermentationLogs", id: "lx", deletedAt: "2026-05-01T00:00:00Z" }] }, "2026-05-01T00:00:00Z");
    const phone = env({ currentBatch: X, cellar: { currentPh: "" }, fermentationLogs: [lx], shelf: [], archive: [] }, "2026-04-02T00:00:00Z");
    const onPhone = merge(phone, laptop, null, base).data;
    // Phone, still on X, recorded a pH the laptop never saw.
    const busyPhone = env({ currentBatch: X, cellar: { currentPh: "3.4" }, fermentationLogs: [lx], shelf: [], archive: [] }, "2026-04-03T00:00:00Z");
    const onBusyPhone = merge(busyPhone, laptop, null, base).data;
    // Stale phone with no baseline at all.
    const onStalePhone = merge(phone, laptop, null, null).data;
    // Later the phone makes X active again (removing it from the shelf).
    const switched = env({ currentBatch: X, cellar: { currentPh: "" }, fermentationLogs: [lx],
      shelf: [{ id: "shelf-y", shelvedAt: "2026-05-05T00:00:00Z", batch: Y, cellar: { currentPh: "" }, fermentationLogs: [] }], archive: [],
      tombstones: [{ collection: "shelf", id: "shelf-x", deletedAt: "2026-05-05T00:00:00Z" },
                   { collection: "fermentationLogs", id: "lx", deletedAt: "", revivedAt: "2026-05-05T00:00:01Z" }] }, "2026-05-05T00:00:00Z");
    const onLaptop = merge(laptop, switched, null, { sections: { currentBatch: Y, cellar: { currentPh: "" } }, logIds: [] }).data;
    const names = (list) => (list || []).map((e) => e.batch.name).join(",");
    // Both devices made the same shelved batch active (each set Y aside, same id).
    const bothSwitch = merge(switched, env({ ...JSON.parse(JSON.stringify(switched.data)) }, "2026-05-05T00:00:01Z"), null,
      { sections: { currentBatch: Y, cellar: { currentPh: "" } }, logIds: [] }).data;
    // One device made X active while the other still shows X on the shelf.
    const activeAlsoShelved = merge(switched, env({ ...laptop.data, currentBatch: X, fermentationLogs: [lx] }, "2026-05-05T00:00:02Z"), null,
      { sections: { currentBatch: X, cellar: { currentPh: "" } }, logIds: ["lx"] }).data;
    // Laptop set X aside while the phone logged a new reading on X.
    const ly = { id: "ly", date: "2026-04-20", gravity: "1.050" };
    const loggingPhone = env({ currentBatch: X, cellar: { currentPh: "" }, fermentationLogs: [lx, ly], shelf: [], archive: [] }, "2026-04-20T00:00:00Z");
    const folded = merge(loggingPhone, laptop, null, base).data;
    // Laptop made Mel active from the shelf while the phone, offline, archived X.
    const M = { loadedAt: "2026-02-01T00:00:00Z", recipeId: "rm", name: "Mel" };
    const shelfM = { id: "shelf-m", shelvedAt: "2026-04-01T00:00:00Z", batch: M, cellar: {}, fermentationLogs: [] };
    const lapMel = env({ currentBatch: M, cellar: {}, fermentationLogs: [], archive: [],
      shelf: [{ ...shelfX, id: "shelf-x2", shelvedAt: "2026-05-06T00:00:00Z" }],
      tombstones: [{ collection: "shelf", id: "shelf-m", deletedAt: "2026-05-06T00:00:00Z" }] }, "2026-05-06T00:00:00Z");
    const phoneArch = env({ currentBatch: { name: "", loadedAt: null, recipeId: "" }, cellar: {}, fermentationLogs: [], shelf: [shelfM],
      archive: [{ id: "arch-x", archivedAt: "2026-05-06T00:00:00Z", batch: X, cellar: {}, fermentationLogs: [lx] }] }, "2026-05-06T00:00:00Z");
    const melWins = merge(phoneArch, lapMel, null, { sections: { currentBatch: X, cellar: {} }, logIds: ["lx"] }).data;
    // Both devices, offline, logged different readings and set the same batch aside.
    const l8 = { id: "l8", date: "2026-05-02", gravity: "1.080" };
    const l7 = { id: "l7", date: "2026-05-03", gravity: "1.070" };
    const sameId = merge(
      env({ currentBatch: { name: "", loadedAt: null, recipeId: "" }, fermentationLogs: [], archive: [], shelf: [{ ...shelfX, shelvedAt: "2026-05-02T00:00:00Z", fermentationLogs: [lx, l8] }] }, "2026-05-02T00:00:00Z"),
      env({ currentBatch: { name: "", loadedAt: null, recipeId: "" }, fermentationLogs: [], archive: [], shelf: [{ ...shelfX, shelvedAt: "2026-05-03T00:00:00Z", fermentationLogs: [lx, l7] }] }, "2026-05-03T00:00:00Z"),
      null, base).data;
    // This device's shelf copy holds a reading; another device already removed that entry.
    const l6 = { id: "l6", date: "2026-05-04", gravity: "1.060" };
    const stripped = merge(
      env({ currentBatch: Y, fermentationLogs: [], archive: [], shelf: [{ ...shelfX, fermentationLogs: [lx, l6] }] }, "2026-05-04T00:00:00Z"),
      env({ currentBatch: Y, fermentationLogs: [], archive: [], shelf: [], tombstones: [{ collection: "shelf", id: "shelf-x", deletedAt: "2026-05-05T00:00:00Z" }] }, "2026-05-05T00:00:00Z"),
      null, { sections: { currentBatch: Y }, logIds: [] }).data;
    const everywhere = (d) => JSON.stringify(d.fermentationLogs.concat(...d.shelf.map((e) => e.fermentationLogs), ...d.archive.map((e) => e.fermentationLogs)).map((l) => l.id));
    return {
      sameIdLogs: (sameId.shelf[0] || {}).fermentationLogs?.map((l) => l.id).sort().join(","), sameIdCount: sameId.shelf.length,
      strippedHasL6: everywhere(stripped).includes('"l6"'),
      bothShelf: names(bothSwitch.shelf), bothActive: bothSwitch.currentBatch.name,
      dupActive: activeAlsoShelved.currentBatch.name, dupShelf: names(activeAlsoShelved.shelf),
      foldedShelfLogs: (folded.shelf.find((e) => e.batch.name === "Batch X") || {}).fermentationLogs?.map((l) => l.id).join(","), foldedVault: folded.archive.length,
      melActive: melWins.currentBatch.name, melVault: names(melWins.archive),
      phoneActive: onPhone.currentBatch.name, phoneShelf: names(onPhone.shelf), phoneLogs: onPhone.fermentationLogs.length,
      phoneCopies: onPhone.archive.length, shelfLogs: onPhone.shelf[0] && onPhone.shelf[0].fermentationLogs.length,
      busyCopies: names(onBusyPhone.archive), busyShelfPh: (onBusyPhone.shelf.find((e) => e.batch.name === "Batch X") || {}).cellar?.currentPh,
      staleActive: onStalePhone.currentBatch.name, staleCopies: onStalePhone.archive.length,
      laptopActive: onLaptop.currentBatch.name, laptopShelf: names(onLaptop.shelf), laptopLogs: onLaptop.fermentationLogs.map((l) => l.id).join(",")
    };
  });
  check("the other device follows: Y active, X on the shelf", r16.phoneActive === "Batch Y" && r16.phoneShelf === "Batch X", `${r16.phoneActive} | ${r16.phoneShelf}`);
  check("...X's reading stays with X, not the live log", r16.phoneLogs === 0 && r16.shelfLogs === 1, `${r16.phoneLogs}/${r16.shelfLogs}`);
  check("...and no recovered copy, since X is accounted for", r16.phoneCopies === 0, String(r16.phoneCopies));
  check("unsynced work on the set-aside batch goes into its shelf entry, not lost", r16.busyShelfPh === "3.4" && !/recovered/.test(r16.busyCopies), `${r16.busyShelfPh} / ${r16.busyCopies}`);
  check("a stale device with no baseline does not revive a shelved batch", r16.staleActive === "Batch Y" && r16.staleCopies === 0, `${r16.staleActive}/${r16.staleCopies}`);
  check("both devices making the same batch active leave one shelf entry", r16.bothActive === "Batch X" && r16.bothShelf === "Batch Y", `${r16.bothActive} | ${r16.bothShelf}`);
  check("the active batch is never also on the shelf", !r16.dupShelf.split(",").includes(r16.dupActive), `${r16.dupActive} | ${r16.dupShelf}`);
  check("a reading logged on a batch the other device set aside joins its shelf entry", r16.foldedShelfLogs === "lx,ly" && r16.foldedVault === 0, `${r16.foldedShelfLogs} / vault ${r16.foldedVault}`);
  check("making a batch active beats an empty slot from a concurrent archive", r16.melActive === "Mel" && !/recovered/.test(r16.melVault), `${r16.melActive} | ${r16.melVault}`);
  check("two devices setting the same batch aside keep both devices' readings", r16.sameIdCount === 1 && r16.sameIdLogs === "l7,l8,lx", `${r16.sameIdCount} / ${r16.sameIdLogs}`);
  check("a removed shelf entry holding the only copy of a reading is parked, not dropped", r16.strippedHasL6);
  check("switching back on one device: X active, Y shelved, X's reading live", r16.laptopActive === "Batch X" && r16.laptopShelf === "Batch Y" && r16.laptopLogs === "lx", JSON.stringify(r16));
  await closeAll();

  console.log("\n[14] A stale device without a v2 baseline must not resurrect an archived batch");
  await closeAll();
  const oldBatch = { name: "Archived Batch", loadedAt: "2026-05-01T00:00:00.000Z", recipeId: "recipe-big", batchGallons: "5" };
  const archivedLogs = [logRow(1, 5), logRow(2, 5)];
  seedCloud(stateWith((d) => {
    // The laptop archived the batch and set a pH on the (now empty) slot.
    d.archive = [{ id: "arch-1", archivedAt: "2026-05-20T00:00:00.000Z", batch: { ...defaultEnvelope.data.currentBatch, ...oldBatch }, cellar: { ...defaultEnvelope.data.cellar }, fermentationLogs: archivedLogs }];
  }, "2026-05-20T00:00:00.000Z"));
  const staleArchive = stateWith((d) => {
    Object.assign(d.currentBatch, oldBatch);
    d.fermentationLogs = archivedLogs;
  }, "2026-05-10T00:00:00.000Z");
  const oldBase = JSON.stringify({ docId: "meadevil-shared", sections: { currentBatch: staleArchive.data.currentBatch, cellar: staleArchive.data.cellar }, tombstoneKeys: [] });
  for (const [label, seed] of [["no baseline", {}], ["v1 baseline", { "meadevil-sync-base-v1": oldBase }]]) {
    seedCloud(cloud.doc ? JSON.parse(JSON.parse(cloud.doc).appData ? JSON.stringify(JSON.parse(cloud.doc).appData) : "{}") : defaultEnvelope);
    const ph = await device(browser, `stale-archive-${label}`, { authDelayMs: 300, seed: { [STORAGE_KEY]: JSON.stringify(staleArchive), ...seed } });
    await delay(1800);
    const c14 = cloudData();
    check(`${label}: the archived batch is not revived`, !String(c14.currentBatch?.name || "").includes("Archived Batch") && !c14.currentBatch?.loadedAt, `${c14.currentBatch?.name}`);
    check(`${label}: its readings stay out of the live log`, (c14.fermentationLogs || []).length === 0, String((c14.fermentationLogs || []).length));
    check(`${label}: no duplicate vault copy`, (c14.archive || []).length === 1, String((c14.archive || []).length));
    await closeAll();
  }

  await browser.close();
  console.log("\n" + "=".repeat(50));
  if (failures.length) {
    console.log(`SYNC: ${failures.length} FAILURE(S)`);
    failures.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
  console.log("ALL SYNC CHECKS PASSED");
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
