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
