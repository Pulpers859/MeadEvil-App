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
 *   7. Merge rules: different batches never field-merge; a revived record is not
 *      stripped again by a stale tombstone
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

function fakeFirebaseInit() {
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
        async signInAnonymously() { authState.currentUser = { uid: "test-user" }; return { user: authState.currentUser }; },
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

async function device(browser, label) {
  const context = await browser.newContext();
  await context.route("https://www.gstatic.com/**", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  await context.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ contentType: "text/css", body: "" }));
  await context.route("**/.netlify/functions/firebase-config", (route) => route.fulfill({
    contentType: "application/javascript",
    body: 'window.MEADEVIL_FIREBASE = {"apiKey":"k","projectId":"p","appId":"a"};'
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
  await page.addInitScript(fakeFirebaseInit);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await delay(1200);
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
    // Local still on the old batch but recorded a pH; cloud moved to a new batch.
    const out1 = merge(
      env({ currentBatch: batchA, cellar: { currentPh: "3.1" } }, "2026-03-05T00:00:00Z"),
      env({ currentBatch: batchB, cellar: { currentPh: "" } }, "2026-03-02T00:00:00Z"),
      null,
      { sections: { currentBatch: batchA, cellar: { currentPh: "" } }, tombstoneKeys: [] }
    ).data;
    // A tombstone both sides agreed on; local revived the record (backup restore).
    const tomb = { collection: "recipes", id: "r9", deletedAt: "2026-01-01T00:00:00Z" };
    const out2 = merge(
      env({ recipes: [{ id: "r9", name: "Restored" }], tombstones: [] }, "2026-03-05T00:00:00Z"),
      env({ recipes: [], tombstones: [tomb] }, "2026-03-02T00:00:00Z"),
      null,
      { sections: {}, tombstoneKeys: ["recipes::r9"] }
    ).data;
    // Same, with no baseline: the tombstone must still win (old safe behaviour).
    const out3 = merge(
      env({ recipes: [{ id: "r9", name: "Zombie" }], tombstones: [] }, "2026-03-05T00:00:00Z"),
      env({ recipes: [], tombstones: [tomb] }, "2026-03-02T00:00:00Z"),
      null, null
    ).data;
    // Both sides changed the SAME field: newest save wins, other fields still merge.
    const out4 = merge(
      env({ cellar: { currentPh: "3.2", note: "base" } }, "2026-03-01T00:00:00Z"),
      env({ cellar: { currentPh: "3.6", note: "cloud note" } }, "2026-03-09T00:00:00Z"),
      null,
      { sections: { cellar: { currentPh: "3.0", note: "base" } }, tombstoneKeys: [] }
    ).data;
    return {
      batchName: out1.currentBatch.name, batchPh: out1.cellar.currentPh,
      revived: out2.recipes.length, tombLeft: out2.tombstones.length,
      zombie: out3.recipes.length,
      conflictPh: out4.cellar.currentPh, conflictNote: out4.cellar.note,
      stable: window.MeadevilSync.stableStringify({ b: 1, a: { d: 2, c: 3 } }) === window.MeadevilSync.stableStringify({ a: { c: 3, d: 2 }, b: 1 })
    };
  });
  check("a new batch on the other device is taken whole", rules.batchName === "New batch", rules.batchName);
  check("the old batch's pH does not leak onto the new batch", rules.batchPh === "", JSON.stringify(rules.batchPh));
  check("a locally revived record survives the merge", rules.revived === 1 && rules.tombLeft === 0, `${rules.revived}/${rules.tombLeft}`);
  check("without a baseline a tombstone still wins", rules.zombie === 0);
  check("true conflict: newest save wins that field", rules.conflictPh === "3.6", rules.conflictPh);
  check("true conflict: untouched sibling field still merges", rules.conflictNote === "cloud note", rules.conflictNote);
  check("comparison ignores key order", rules.stable);

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
