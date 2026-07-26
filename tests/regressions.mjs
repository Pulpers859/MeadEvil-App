/**
 * MeadEvil targeted regression tests
 * Each check pins a specific bug found during the stress-test review:
 *  1. Archive clone must not duplicate recipe ids or leak batch-only fields
 *  2. Recipe card export must print real TOSNA/Go-Ferm numbers and structure additions
 *  3. Est. ABV trend must work when no OG was recorded (highest log fallback)
 *  4. Cancelling "Load to batch" must not clobber the active batch's structure additions
 *  5. A no-op archive click must not overwrite an older archive entry's structure record
 *  6. CSV export → import must round-trip recipes losslessly
 *  7. Garbage inputs must be rejected with messages, not crashes
 * Suites 10–13 pin the MeadTools-derived enhancements:
 *  10. Yeast strain library autofill + very-high YAN tier
 *  11. Stabilizer (k-meta / sorbate) dosing in the Finish summary
 *  12. Hydrometer CSV import (downsample, dedupe, unit normalization)
 *  13. BeerJSON recipe export
 * Suites 14-18 pin the round-2 findings:
 *  14. The printed recipe card must reflect the SELECTED nutrient protocol
 *  15. Duplicate record ids must not collide on delete
 *  16. A batch started from an unsaved draft stays identity-linked to that draft
 *  17. RAPT import must not pull the previous batch's telemetry
 *  18. Exports must download with filesystem-safe filenames
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";

const BASE = "http://127.0.0.1:8910";
const STORAGE_KEY = "meadevil-app-v2";
const ENH_KEY = "meadevil-app-v2-meadevil-mentor";

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { console.log(`  ✅ ${name}`); }
  else { console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); failures.push(`${name}${detail ? `: ${detail}` : ""}`); }
}

async function freshPage(context) {
  const page = await context.newPage();
  page.on("pageerror", err => failures.push(`JS ERROR: ${err.message}`));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // Let the boot-time RAPT import (which persists state on failure) settle
  // BEFORE clearing storage, or it re-persists the previous test's state.
  await delay(900);
  await page.evaluate(([k, e]) => { localStorage.removeItem(k); localStorage.removeItem(e); }, [STORAGE_KEY, ENH_KEY]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await delay(700);
  return page;
}

async function setVal(page, sel, value) {
  await page.$eval(sel, (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, String(value));
}

async function clickTab(page, tab) {
  await page.$eval(`button.tab-btn[data-tab="${tab}"]`, btn => btn.click());
  await delay(250);
}

// Destructive prompts render through the app's own modal (app.js confirmDialog),
// NOT window.confirm — so Playwright's page.on("dialog") never fires for them.
// Drive that modal directly. Tolerant by design: several call sites only prompt
// when there is existing work to clobber, so "no modal appeared" is a valid path.
async function answerModal(page, action = "confirm", timeout = 1200) {
  const appeared = await page
    .waitForSelector(".modal-backdrop .modal-card", { timeout })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return false;
  // The replace-batch modal has THREE buttons in DOM order:
  //   .btn-ghost (Cancel) · .btn-primary (Archive first) · .btn-danger (Discard)
  // A comma selector resolves by document order, not by the order written, so
  // asking for ".btn-primary, .btn-danger" would click "Archive first" whenever
  // the caller meant "confirm the destructive action". Pick explicitly.
  await page.evaluate((act) => {
    const root = document.querySelector(".modal-backdrop .modal-actions");
    if (!root) return;
    const pick = act === "cancel"
      ? root.querySelector(".btn-ghost")
      : act === "alt"
        ? root.querySelector(".btn-primary")
        : (root.querySelector(".btn-danger") || root.querySelector(".btn-primary"));
    if (pick) pick.click();
  }, action);
  await page.waitForSelector(".modal-backdrop", { state: "detached", timeout: 2500 }).catch(() => {});
  return true;
}

// Click a control that may raise the confirm modal, then answer it.
async function clickAndAnswer(page, selector, action = "confirm", settle = 400) {
  await page.$eval(selector, btn => btn.click());
  await answerModal(page, action);
  await delay(settle);
}

async function buildAndSaveRecipe(page, { name, gallons = "3", abv = "12", honeyLb = "9" }) {
  await clickTab(page, "recipes");
  await setVal(page, "#recipeName", name);
  await setVal(page, "#recipeBatchGallons", gallons);
  await setVal(page, "#recipeTargetAbv", abv);
  await page.evaluate((amount) => {
    const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
    const row = document.querySelector("#recipeSourceList .source-row");
    const desc = row.querySelector('[data-source-field="description"]');
    const amt = row.querySelector('[data-source-field="amount"]');
    desc.value = "Wildflower honey"; fire(desc, "input");
    amt.value = amount; fire(amt, "input");
  }, honeyLb);
  await delay(200);
  await page.$eval("#saveRecipeBtn", btn => btn.click());
  await delay(300);
}

// app.js persists through serializeState, which wraps the ledger in an envelope:
//   { _schema: {...}, data: { recipes, recipeDraft, archive, ... } }
// This helper used to return the envelope, so every `s.recipes` / `s.recipeDraft`
// read below was `undefined` and a whole set of checks passed VACUOUSLY against
// nothing. Unwrap to the data layer, tolerating the pre-envelope legacy shape.
async function state(page) {
  const raw = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), STORAGE_KEY);
  if (raw && raw._schema && raw.data && typeof raw.data === "object") return raw.data;
  return raw || {};
}

async function testArchiveCloneIds(context) {
  console.log("\n[1] Archive clone id hygiene");
  const page = await freshPage(context);
  await buildAndSaveRecipe(page, { name: "Original Traditional" });
  await clickAndAnswer(page, "#loadDraftToBatchBtn");
  await clickAndAnswer(page, "#archiveBatchBtn");
  await clickTab(page, "archive");
  await page.$eval("button[data-archive-clone]", btn => btn.click());
  await delay(400);

  const draft = (await state(page)).recipeDraft || {};
  check("clone draft carries no stale id", !draft.id, `draft.id=${draft.id}`);
  check("clone draft has no batch-only fields", !("stepFeedLog" in draft) && !("pitchDate" in draft) && !("phase" in draft));
  check("clone draft renamed", /clone/i.test(draft.name || ""), `name=${draft.name}`);

  await page.$eval("#saveRecipeBtn", btn => btn.click());
  await delay(300);
  const s = await state(page);
  const ids = (s.recipes || []).map(r => r.id);
  check("two recipes saved", ids.length === 2, `count=${ids.length}`);
  check("recipe ids unique after clone save", new Set(ids).size === ids.length, ids.join(","));
  await page.close();
}

async function testRecipeCardExport(context) {
  console.log("\n[2] Recipe card export integrity");
  const page = await freshPage(context);
  // Seed a structure addition through the enhancement store like the Brainstorm flow does.
  await page.evaluate((enhKey) => {
    const enh = JSON.parse(localStorage.getItem(enhKey) || "{}");
    enh.recipeDraft = enh.recipeDraft || {};
    enh.recipeDraft.structureAdditions = [{ id: "adj-test-1", phase: "secondary", category: "spice", ingredient: "Vanilla bean", amount: "1", unit: "each", purpose: "Aroma", notes: "" }];
    localStorage.setItem(enhKey, JSON.stringify(enh));
  }, ENH_KEY);
  await page.reload({ waitUntil: "domcontentloaded" });
  await delay(600);
  await buildAndSaveRecipe(page, { name: "Card Export Test" });
  await setVal(page, "#recipeDryYeast", "5");
  // Nutrients need OG + gallons for the TOSNA block on the card.
  await clickAndAnswer(page, "#loadDraftToBatchBtn");
  await clickTab(page, "recipes");

  const downloadPromise = page.waitForEvent("download", { timeout: 8000 });
  await page.$eval("#printRecipeCardBtn", btn => btn.click());
  const download = await downloadPromise;
  const path = await download.path();
  const text = await fs.readFile(path, "utf8");

  check("card has no null/undefined artifacts", !/null|undefined/.test(text), (text.match(/.*(null|undefined).*/g) || []).join(" | "));
  // The card now prints the SELECTED protocol's plan (see suite 14) rather than an
  // unconditional TOSNA line, so it names the protocol and doses per product.
  check("card names the active protocol", /Protocol:\s*Fermaid O \(TOSNA 2\.0\)/.test(text),
    (text.match(/Protocol:.*/) || ["(no protocol line)"])[0]);
  check("card prints per-product dose math", /Fermaid O: [\d.]+ g total \([\d.]+ g × 4 doses\)/.test(text),
    (text.match(/Fermaid O:.*/) || ["(no Fermaid O line)"])[0]);
  check("card states target vs delivered YAN", /Target YAN: \d+ ppm\s*\|\s*This plan delivers: \d+ ppm/.test(text),
    (text.match(/Target YAN:.*/) || ["(no YAN line)"])[0]);
  check("card prints Go-Ferm water volume", /Go-Ferm: [\d.]+ g in \d+ mL water/.test(text));
  check("card prints structure additions", /STRUCTURE ADDITIONS/.test(text) && /Vanilla bean/.test(text));
  await page.close();
}

async function testAbvWithoutOg(context) {
  console.log("\n[3] Est. ABV fallback without recorded OG");
  const page = await freshPage(context);
  // Recipe with a name only: no batch targets, so no targetOg lands on the batch.
  await clickTab(page, "recipes");
  await setVal(page, "#recipeName", "No Targets Mead");
  await page.$eval("#saveRecipeBtn", btn => btn.click());
  await delay(200);
  await clickAndAnswer(page, "#loadDraftToBatchBtn");

  await page.$eval("#gravityLogCard", el => { el.open = true; }).catch(() => {});
  for (const [g, d] of [["1.100", "2026-06-01"], ["1.020", "2026-06-08"]]) {
    await setVal(page, "#logDate", d);
    await setVal(page, "#logGravity", g);
    await page.$eval("#addLogBtn", btn => btn.click());
    await delay(200);
  }
  const abvPill = await page.$('[data-trend-series-toggle="abv"]');
  const abvText = abvPill ? await abvPill.evaluate(el => el.textContent) : "";
  // 1.100 -> 1.020 with the Cutaiar/Hall high-gravity formula = 11.58%.
  // This used to pin 10.5%, the beer-calibrated (OG-FG)*131.25 value, which
  // understates mead by 1-4 points across its normal gravity range.
  const abvValue = Number((abvText.match(/(\d+\.\d+)\s*%/) || [])[1]);
  check("ABV series uses highest log as OG",
    Boolean(abvPill) && Math.abs(abvValue - 11.58) < 0.15,
    `pill="${abvText}" parsed=${abvValue}`);
  await page.close();
}

async function testCancelledLoadKeepsStructure(context) {
  console.log("\n[4] Cancelled load preserves batch structure additions");
  const page = await freshPage(context);
  await buildAndSaveRecipe(page, { name: "Active Batch" });
  await clickAndAnswer(page, "#loadDraftToBatchBtn");
  // Hand the active batch a structure addition, then change the draft's.
  await page.evaluate((enhKey) => {
    const enh = JSON.parse(localStorage.getItem(enhKey) || "{}");
    enh.currentBatch = enh.currentBatch || {};
    enh.currentBatch.structureAdditions = [{ id: "adj-keep", phase: "secondary", category: "oak", ingredient: "KEEP-ME oak cubes", amount: "1", unit: "oz", purpose: "Structure", notes: "" }];
    enh.recipeDraft = enh.recipeDraft || {};
    enh.recipeDraft.structureAdditions = [{ id: "adj-new", phase: "secondary", category: "spice", ingredient: "REPLACEMENT spice", amount: "2", unit: "g", purpose: "Aroma", notes: "" }];
    localStorage.setItem(enhKey, JSON.stringify(enh));
  }, ENH_KEY);
  // Click load again but CANCEL the confirm modal.
  await clickAndAnswer(page, "#loadDraftToBatchBtn", "cancel", 500);
  const enh = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), ENH_KEY);
  const batchAdds = ((enh.currentBatch || {}).structureAdditions || []).map(r => r.ingredient).join(",");
  check("batch structure additions untouched after cancelled load", batchAdds.includes("KEEP-ME"), `got: ${batchAdds}`);
  await page.close();
}

async function testNoopArchiveKeepsRecord(context) {
  console.log("\n[5] No-op archive keeps older archive structure record");
  const page = await freshPage(context);
  await buildAndSaveRecipe(page, { name: "First Archived" });
  await clickAndAnswer(page, "#loadDraftToBatchBtn");
  await clickAndAnswer(page, "#archiveBatchBtn", "confirm", 500);
  const s1 = await state(page);
  const archiveId = (s1.archive || [])[0]?.id;
  // Mark the existing archive enhancement record, then click archive again with no batch.
  await page.evaluate(([enhKey, id]) => {
    const enh = JSON.parse(localStorage.getItem(enhKey) || "{}");
    enh.archive = enh.archive || {};
    enh.archive[id] = { structureAdditions: [{ id: "adj-orig", phase: "secondary", category: "oak", ingredient: "ORIGINAL-RECORD", amount: "", unit: "oz", purpose: "", notes: "" }] };
    localStorage.setItem(enhKey, JSON.stringify(enh));
  }, [ENH_KEY, archiveId]);
  await clickAndAnswer(page, "#archiveBatchBtn", "confirm", 500);
  const enh = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), ENH_KEY);
  const record = ((enh.archive || {})[archiveId] || {}).structureAdditions || [];
  check("older archive structure record untouched by no-op archive", record.some(r => r.ingredient === "ORIGINAL-RECORD"), JSON.stringify(record));
  await page.close();
}

async function testCsvRoundTrip(context) {
  console.log("\n[6] CSV export → import round-trip");
  const page = await freshPage(context);
  await buildAndSaveRecipe(page, { name: "CSV Alpha", gallons: "3", abv: "12", honeyLb: "9" });
  await clickAndAnswer(page, "#clearRecipeBtn", "confirm", 300);
  await buildAndSaveRecipe(page, { name: "CSV Beta, with comma \"and quotes\"", gallons: "5", abv: "14", honeyLb: "16.5" });

  const downloadPromise = page.waitForEvent("download", { timeout: 8000 });
  await page.$eval("#exportRecipeCsvBtn", btn => btn.click());
  const download = await downloadPromise;
  const csvPath = await download.path();

  // Wipe recipes, then re-import.
  await page.evaluate((k) => {
    const s = JSON.parse(localStorage.getItem(k) || "{}");
    s.recipes = [];
    localStorage.setItem(k, JSON.stringify(s));
  }, STORAGE_KEY);
  await page.reload({ waitUntil: "domcontentloaded" });
  await delay(600);
  await page.setInputFiles("#recipeCsvFileInput", csvPath);
  await answerModal(page, "confirm");
  await delay(600);

  const s = await state(page);
  const names = (s.recipes || []).map(r => r.name).sort();
  check("both recipes reimported", names.length === 2, names.join(" | "));
  check("quoted/comma name survives round-trip", names.includes('CSV Beta, with comma "and quotes"'), names.join(" | "));
  const alpha = (s.recipes || []).find(r => r.name === "CSV Alpha");
  const amt = alpha?.additions?.[0]?.amount;
  check("source amounts survive round-trip", amt === "9", `amount=${amt}`);
  await page.close();
}

async function testGarbageInputs(context) {
  console.log("\n[7] Garbage input handling");
  const page = await freshPage(context);
  await buildAndSaveRecipe(page, { name: "Garbage Inputs" });
  await clickAndAnswer(page, "#loadDraftToBatchBtn");
  await page.$eval("#gravityLogCard", el => { el.open = true; }).catch(() => {});

  // Absurd gravity rejected
  await setVal(page, "#logGravity", "10.74");
  await page.$eval("#addLogBtn", btn => btn.click());
  await delay(200);
  let err = await page.$eval("#logEntryError", el => ({ hidden: el.hidden, text: el.textContent }));
  check("absurd gravity rejected with message", !err.hidden && /looks off/i.test(err.text), JSON.stringify(err));

  // Absurd temp rejected
  await setVal(page, "#logGravity", "1.074");
  await setVal(page, "#logTemp", "500");
  await page.$eval("#addLogBtn", btn => btn.click());
  await delay(200);
  err = await page.$eval("#logEntryError", el => ({ hidden: el.hidden, text: el.textContent }));
  check("absurd temp rejected with message", !err.hidden && /Temp/i.test(err.text), JSON.stringify(err));

  const logCount = ((await state(page)).fermentationLogs || []).length;
  check("no garbage logs persisted", logCount === 0, `count=${logCount}`);

  // Zero/negative design values must not crash the sanity engine
  await clickTab(page, "recipes");
  await setVal(page, "#recipeBatchGallons", "0");
  await setVal(page, "#recipeTargetAbv", "-5");
  await delay(200);
  const readiness = await page.$eval("#recipeReadiness", el => el.textContent || "");
  check("sanity engine survives zero/negative inputs", readiness.trim().length > 10);
  await page.close();
}

async function testAdjunctUiPersistence(context) {
  console.log("\n[8] Structure additions survive editing app-owned fields");
  const page = await freshPage(context);
  await clickTab(page, "recipes");
  // Type an ingredient into the structure-additions editor (mentor-owned UI).
  await page.$eval('#recipeAdjunctList [data-adjunct-field="ingredient"]', (el) => {
    el.value = "Cinnamon stick";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await delay(300);
  // Now type into an app.js-owned field, which persists app.js's state.
  await setVal(page, "#recipeName", "Adjunct Survival");
  await setVal(page, "#recipeBatchGallons", "3");
  await delay(300);
  const result = await page.evaluate(([k, e]) => {
    const m = JSON.parse(localStorage.getItem(k) || "{}");
    const enh = JSON.parse(localStorage.getItem(e) || "{}");
    return {
      main: (m.recipeDraft?.structureAdditions || []).map(r => r.ingredient).filter(Boolean),
      enh: (enh.recipeDraft?.structureAdditions || []).map(r => r.ingredient).filter(Boolean)
    };
  }, [STORAGE_KEY, ENH_KEY]);
  check("adjunct stored after typing in adjunct UI", result.enh.includes("Cinnamon stick"), JSON.stringify(result));
  check("adjunct survives app-owned field edits", result.main.includes("Cinnamon stick"), JSON.stringify(result));

  // And it must flow into the batch + execution plan on load.
  await clickAndAnswer(page, "#loadDraftToBatchBtn", "confirm", 600);
  const plan = await page.$eval("#executionPlanBody", el => el.textContent || "").catch(() => "");
  check("adjunct shows in Ferment execution plan", /Cinnamon stick/.test(plan), plan.slice(0, 120));
  await page.close();
}

async function testJsonBackupRoundTrip(context) {
  console.log("\n[9] JSON backup → factory reset → import round-trip");
  const page = await freshPage(context);
  // Build a full state: adjunct + recipe + batch + logs + archive entry.
  await clickTab(page, "recipes");
  await page.$eval('#recipeAdjunctList [data-adjunct-field="ingredient"]', (el) => {
    el.value = "Backup oak spiral";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await delay(250);
  await buildAndSaveRecipe(page, { name: "Backup Round Trip", gallons: "3", abv: "12" });
  await clickAndAnswer(page, "#loadDraftToBatchBtn", "confirm", 500);
  await page.$eval("#gravityLogCard", el => { el.open = true; }).catch(() => {});
  await setVal(page, "#logGravity", "1.090");
  await page.$eval("#addLogBtn", btn => btn.click());
  await delay(250);
  await clickAndAnswer(page, "#archiveBatchBtn", "confirm", 500);

  const downloadPromise = page.waitForEvent("download", { timeout: 8000 });
  await page.$eval("#exportDataBtn", btn => btn.click());
  const download = await downloadPromise;
  const backupPath = await download.path();

  await clickAndAnswer(page, "#resetAppBtn", "confirm", 500);
  const wiped = await state(page);
  check("factory reset wipes archive", (wiped.archive || []).length === 0);

  await page.setInputFiles("#importFileInput", backupPath);
  await answerModal(page, "confirm");
  await delay(800);
  const restored = await state(page);
  const arch = (restored.archive || [])[0];
  check("archive restored from backup", arch?.batch?.name === "Backup Round Trip", arch?.batch?.name);
  check("gravity logs restored in archive", (arch?.fermentationLogs || []).length === 1);
  const enh = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), ENH_KEY);
  const draftAdds = (enh.recipeDraft?.structureAdditions || []).map(r => r.ingredient);
  check("enhancement structure additions restored", draftAdds.includes("Backup oak spiral"), draftAdds.join(","));
  await page.close();
}

async function testYeastLibrary(context) {
  console.log("\n[10] Yeast library picker and YAN sync");
  const page = await freshPage(context);
  await clickTab(page, "recipes");
  const optionCount = await page.$eval("#recipeYeast", sel => sel.querySelectorAll("option").length);
  check("yeast select holds the full strain library", optionCount > 100, `${optionCount} options`);
  await setVal(page, "#recipeYeast", "BA11");
  await delay(300);
  const fill = await page.evaluate(() => ({
    tolerance: document.getElementById("recipeYeastTolerance").value,
    temp: document.getElementById("recipeTemp").value,
    nitrogen: document.getElementById("recipeNitrogenRequirement").value,
    feedDisplay: document.getElementById("nutrientYeastRequirementDisplay").value
  }));
  check("library strain autofills tolerance/temp/nitrogen", fill.tolerance === "16" && fill.temp.includes("77") && fill.nitrogen === "high", JSON.stringify(fill));
  check("Feed tab nitrogen display follows the yeast change", fill.feedDisplay.toLowerCase() === "high", fill.feedDisplay);
  await setVal(page, "#recipeBatchGallons", "3");
  await setVal(page, "#recipeTargetAbv", "12");
  await setVal(page, "#recipeYeast", "Kveik Yeast");
  await delay(300);
  const veryHigh = await page.evaluate(() => ({
    nitrogen: document.getElementById("recipeNitrogenRequirement").value,
    yan: Number(document.getElementById("nutrientTargetYan").value)
  }));
  check("very-high nitrogen tier reaches the YAN math (1.8x)", veryHigh.nitrogen === "very high" && veryHigh.yan > 350, JSON.stringify(veryHigh));
  const legacyOk = await page.evaluate(() => Boolean(window.MeadLogic) && [...document.querySelectorAll("#recipeYeast option")].some(o => o.value === "71B"));
  check("legacy preset strains (71B) still selectable", legacyOk);
  await page.close();
}

async function testStabilizerMath(context) {
  console.log("\n[11] Stabilizer dosing is gated on the stability gate");
  const page = await freshPage(context);
  await buildAndSaveRecipe(page, { name: "Stabilizer Pin" });
  await clickAndAnswer(page, "#loadDraftToBatchBtn");
  await clickTab(page, "cellar");
  await setVal(page, "#backsweetenVolume", "3");
  await setVal(page, "#cellarCurrentPh", "3.4");
  await delay(300);

  // BEFORE the gate: a batch this fresh has no stable readings. Printing a bolded
  // gram dose here sizes sulfite/sorbate against a mid-fermentation ABV — the
  // sorbate model scales inversely with ABV, so an early dose is several times too
  // large. HANDOFF §9/§13: do not stabilize until gravity is stable.
  const beforeGate = await page.$eval("#cellarSmartSummary", el => el.textContent);
  check("no gram dose before the stability gate clears",
    !/\d+(\.\d+)?\s*g\s*k-meta/i.test(beforeGate), beforeGate.slice(0, 200));
  check("explains why the dose is withheld", /locked until the stability gate/i.test(beforeGate), beforeGate.slice(0, 200));

  // Now satisfy the gate: two matching SG readings more than a week apart.
  await setVal(page, "#stableSgA", "0.998");
  await setVal(page, "#stableDateA", "2026-06-01");
  await setVal(page, "#stableSgB", "0.998");
  await setVal(page, "#stableDateB", "2026-06-10");
  await delay(400);
  const summary = await page.$eval("#cellarSmartSummary", el => el.textContent);
  check("stabilizer line renders once the gate is clear", /Stabilizer math/.test(summary) && /32 ppm/.test(summary), summary.slice(0, 220));
  check("k-meta and sorbate grams present", /g.*k-meta/i.test(summary) && /sorbate/i.test(summary));
  // 3 gal at ~12% ABV, pH 3.4 → ~0.6 g k-meta, ~1.5–1.7 g sorbate
  const kmeta = Number((summary.match(/([\d.]+)\s*g\s*k-meta/i) || [])[1]);
  check("k-meta dose in expected range", kmeta > 0.4 && kmeta < 0.9, String(kmeta));
  await page.close();
}

async function testGravityCsvImport(context) {
  console.log("\n[12] Hydrometer CSV import");
  const page = await freshPage(context);
  await clickTab(page, "ferment");
  // Thinning is variable-resolution (commit 3b86e9d): hourly for the first 72h of
  // the batch, then every 6h. This test used to assume a flat 6h bucket and so
  // failed permanently after that change — it expected two readings 2h apart on
  // day 0 to collapse, when keeping them is the whole point of fine early
  // resolution. Exercise BOTH tiers instead.
  const tiltCsv = [
    "Timepoint,SG,Temp,Color,Beer",
    "6/1/2026 8:00,1.102,68.5,PURPLE,Pin",   // anchor, hourly tier
    "6/1/2026 8:30,1.102,68.5,PURPLE,Pin",   // same hour as anchor -> thinned away
    "6/1/2026 10:00,1.101,68.7,PURPLE,Pin",  // different hour, day 0 -> kept
    "6/6/2026 8:00,1.030,67.9,PURPLE,Pin",   // >72h in: 6h tier
    "6/6/2026 10:00,1.029,67.8,PURPLE,Pin"   // same 6h window -> thinned away
  ].join("\n");
  const tiltPath = "/tmp/regression-tilt.csv";
  await fs.writeFile(tiltPath, tiltCsv);
  await page.$eval("#gravityLogCard", el => { el.open = true; });
  await page.setInputFiles("#gravityCsvFileInput", tiltPath);
  await delay(700);
  let logs = (await state(page)).fermentationLogs || [];
  check("Tilt CSV thins hourly early and 6-hourly later", logs.length === 3,
    `${logs.length} logs: ${logs.map(l => `${l.date} ${l.gravity}`).join(" | ")}`);
  await page.setInputFiles("#gravityCsvFileInput", tiltPath);
  await delay(600);
  logs = (await state(page)).fermentationLogs || [];
  check("re-import is a no-op (sourceId dedupe)", logs.length === 3, `${logs.length} logs`);
  const celsiusCsv = [
    "timestamp,gravity,temperature (C)",
    "2026-06-05T08:00:00Z,1048,19.5"
  ].join("\n");
  const cPath = "/tmp/regression-ispindel.csv";
  await fs.writeFile(cPath, celsiusCsv);
  await page.setInputFiles("#gravityCsvFileInput", cPath);
  await delay(500);
  logs = (await state(page)).fermentationLogs || [];
  const row = logs.find(l => l.date === "2026-06-05");
  check("points gravity (1048) normalized to SG", row && row.gravity === "1.048", row && row.gravity);
  check("Celsius temp converted to °F", row && Math.abs(Number(row.temp) - 67.1) < 0.2, row && row.temp);
  await page.close();
}

async function testBeerJsonExport(context) {
  console.log("\n[13] BeerJSON export");
  const page = await freshPage(context);
  await buildAndSaveRecipe(page, { name: "BeerJSON Pin" });
  await setVal(page, "#recipeYeast", "71B");
  await delay(250);
  await page.$eval("#saveRecipeBtn", btn => btn.click());
  await delay(300);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.$eval("#exportBeerJsonBtn", btn => btn.click())
  ]);
  const raw = await fs.readFile(await download.path(), "utf8");
  let doc = null;
  try { doc = JSON.parse(raw); } catch (e) { /* checked below */ }
  check("export parses as JSON", Boolean(doc));
  const recipe = doc?.beerjson?.recipes?.[0];
  check("beerjson v1 envelope with mead recipe", doc?.beerjson?.version === 1 && recipe?.type === "mead", JSON.stringify({ v: doc?.beerjson?.version, t: recipe?.type }));
  const honey = recipe?.ingredients?.fermentable_additions?.find(f => f.type === "honey");
  check("honey fermentable carried with amount", honey && honey.amount?.value === 9, JSON.stringify(honey));
  const culture = recipe?.ingredients?.culture_additions?.[0];
  check("yeast culture carried with tolerance", culture?.name === "71B" && culture?.alcohol_tolerance?.value === 14, JSON.stringify(culture));
  await page.close();
}

// Round-2 pins.
async function testPrintedCardMatchesProtocol(context) {
  console.log("\n[14] Printed recipe card must match the SELECTED nutrient protocol");
  const page = await freshPage(context);
  await buildAndSaveRecipe(page, { name: "Card Protocol Pin", gallons: "5", abv: "18", honeyLb: "17" });
  await setVal(page, "#recipeDryYeast", "10");
  await clickAndAnswer(page, "#loadDraftToBatchBtn");

  // Switch to the DAP-based protocol.
  await clickTab(page, "nutrients");
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("[data-nutrient-protocol]")]
      .find(b => b.dataset.nutrientProtocol === "k_dap_20_80");
    if (btn) btn.click();
  });
  await delay(500);
  const feed = await page.$eval("#advancedNutrientSummary", el => el.innerText);
  const feedK = Number((feed.match(/FERMAID K\s*\n\s*([\d.]+)\s*g/i) || [])[1]);
  const feedD = Number((feed.match(/\bDAP\s*\n\s*([\d.]+)\s*g/i) || [])[1]);

  await clickTab(page, "recipes");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 8000 }),
    page.$eval("#printRecipeCardBtn", btn => btn.click())
  ]);
  const card = await fs.readFile(await download.path(), "utf8");

  // The card used to print `currentTosnaPlan()` unconditionally, so a DAP-based
  // batch got a printout reading "TOSNA: N g Fermaid O" — wrong product, wrong
  // amount, on the sheet taken to the fermenter.
  check("card names the selected protocol", /Protocol:\s*Fermaid K \/ DAP/i.test(card),
    (card.match(/Protocol:.*/) || ["(no protocol line)"])[0]);
  check("card does not print a TOSNA Fermaid O plan for a DAP protocol",
    !/TOSNA:/i.test(card) && !/Fermaid O:/i.test(card),
    (card.match(/.*(TOSNA|Fermaid O).*/) || [""])[0]);
  const cardK = Number((card.match(/Fermaid K:\s*([\d.]+)\s*g/i) || [])[1]);
  const cardD = Number((card.match(/DAP:\s*([\d.]+)\s*g/i) || [])[1]);
  check("card Fermaid K matches the Feed tab", Number.isFinite(cardK) && Math.abs(cardK - feedK) < 0.15, `card=${cardK} feed=${feedK}`);
  check("card DAP matches the Feed tab", Number.isFinite(cardD) && Math.abs(cardD - feedD) < 0.15, `card=${cardD} feed=${feedD}`);
  await page.close();
}

async function testDuplicateIdsAreSplit(context) {
  console.log("\n[15] Duplicate record ids must not collide on delete");
  const page = await freshPage(context);
  await page.evaluate((k) => {
    localStorage.setItem(k, JSON.stringify({
      _schema: { app: "MeadEvil", version: 1 },
      data: {
        recipes: [
          { id: "dup-id", name: "Dup One", additions: [] },
          { id: "dup-id", name: "Dup Two", additions: [] }
        ],
        currentBatch: { name: "Linked", recipeId: 'hostile"id' }
      }
    }));
  }, STORAGE_KEY);
  await page.reload({ waitUntil: "domcontentloaded" });
  await delay(900);

  const s = await state(page);
  const ids = (s.recipes || []).map(r => r.id);
  check("duplicate ids are split apart", new Set(ids).size === ids.length, ids.join(","));
  check("first occurrence keeps its stable id", ids[0] === "dup-id", ids.join(","));
  check("unsafe recipeId cross-reference is scrubbed",
    !String((s.currentBatch || {}).recipeId || "").includes('"'), JSON.stringify((s.currentBatch || {}).recipeId));

  // Deleting one must remove exactly one.
  await clickTab(page, "archive");
  const before = ids.length;
  await clickAndAnswer(page, "button[data-recipe-delete]", "confirm", 500);
  const after = ((await state(page)).recipes || []).length;
  check("deleting one recipe removes exactly one", after === before - 1, `${before} -> ${after}`);
  await page.close();
}

async function testDraftBatchIdentityLink(context) {
  console.log("\n[16] A batch started from an unsaved draft stays linked to it");
  const page = await freshPage(context);
  await clickTab(page, "recipes");
  await setVal(page, "#recipeName", "Identity Link Pin");
  await setVal(page, "#recipeBatchGallons", "3");
  await setVal(page, "#recipeTargetAbv", "12");
  await setVal(page, "#recipeDryYeast", "5");
  await clickAndAnswer(page, "#loadDraftToBatchBtn");

  const s = await state(page);
  const draftId = (s.recipeDraft || {}).id;
  const batchRef = (s.currentBatch || {}).recipeId;
  check("draft id is stamped and matches the batch", Boolean(draftId) && draftId === batchRef, `draft=${draftId} batch=${batchRef}`);

  // Feed must follow a Build edit for the batch it belongs to.
  await setVal(page, "#recipeDryYeast", "9");
  await delay(400);
  await clickTab(page, "nutrients");
  const dry = await page.$eval("#nutrientDryYeastDisplay", el => el.value);
  check("Feed follows a Build edit for its own batch", String(dry) === "9", `dry=${dry}`);

  // ...but an unrelated draft must NOT touch the live plan.
  await clickTab(page, "recipes");
  await clickAndAnswer(page, "#clearRecipeBtn", "confirm", 400);
  await setVal(page, "#recipeName", "Unrelated");
  await setVal(page, "#recipeDryYeast", "2");
  await delay(400);
  await clickTab(page, "nutrients");
  const dry2 = await page.$eval("#nutrientDryYeastDisplay", el => el.value);
  check("unrelated draft cannot rewrite the live feed plan", String(dry2) === "9", `dry=${dry2}`);
  await page.close();
}

async function testRaptStaleReadingsRejected(context) {
  console.log("\n[17] RAPT import must not pull the previous batch's readings");
  const page = await freshPage(context);
  // Bridge offers two pre-batch readings and one current one.
  await page.route("**/rapt-bridge**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ readings: [
      { gravity: 1.100, temperature: 68, telemetryAt: "2026-05-01T08:00:00.000Z", readingId: "old-1", deviceId: "d1", deviceName: "Pill" },
      { gravity: 1.060, temperature: 68, telemetryAt: "2026-05-08T08:00:00.000Z", readingId: "old-2", deviceId: "d1", deviceName: "Pill" },
      { gravity: 1.118, temperature: 70, telemetryAt: "2026-07-01T08:00:00.000Z", readingId: "new-1", deviceId: "d1", deviceName: "Pill" }
    ] })
  }));
  await buildAndSaveRecipe(page, { name: "RAPT Floor Pin" });
  await clickAndAnswer(page, "#loadDraftToBatchBtn");

  // Pin telemetrySince between the old and new readings.
  await page.evaluate((k) => {
    const raw = JSON.parse(localStorage.getItem(k) || "{}");
    const d = raw._schema ? raw.data : raw;
    d.rapt.telemetrySince = "2026-06-01T00:00:00.000Z";
    if (raw._schema) raw.data = d;
    localStorage.setItem(k, JSON.stringify(raw._schema ? raw : d));
  }, STORAGE_KEY);
  await page.reload({ waitUntil: "domcontentloaded" });
  await delay(1000);
  await clickTab(page, "ferment");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await delay(1800);

  const logs = ((await state(page)).fermentationLogs || []);
  const stale = logs.filter(l => String(l.telemetryAt || "").startsWith("2026-05"));
  check("pre-batch telemetry is rejected", stale.length === 0, `${stale.length} stale of ${logs.length}`);
  check("current-batch telemetry still imports", logs.some(l => String(l.telemetryAt || "").startsWith("2026-07")), JSON.stringify(logs.map(l => l.telemetryAt)));
  await page.close();
}

async function testExportFilenames(context) {
  console.log("\n[18] Exports download with filesystem-safe names");
  const page = await freshPage(context);
  await buildAndSaveRecipe(page, { name: 'Nasty: v2/final "best" <draft>|x' });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 8000 }),
    page.$eval("#printRecipeCardBtn", btn => btn.click())
  ]);
  const name = download.suggestedFilename();
  check("recipe-card filename has no path/reserved characters", !/[\\/:*?"<>|\r\n\t]/.test(name), name);
  check("recipe-card download produced a file", Boolean(await download.path()), name);
  await page.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });

  await testArchiveCloneIds(context);
  await testRecipeCardExport(context);
  await testAbvWithoutOg(context);
  await testCancelledLoadKeepsStructure(context);
  await testNoopArchiveKeepsRecord(context);
  await testCsvRoundTrip(context);
  await testGarbageInputs(context);
  await testAdjunctUiPersistence(context);
  await testJsonBackupRoundTrip(context);
  await testYeastLibrary(context);
  await testStabilizerMath(context);
  await testGravityCsvImport(context);
  await testBeerJsonExport(context);
  await testPrintedCardMatchesProtocol(context);
  await testDuplicateIdsAreSplit(context);
  await testDraftBatchIdentityLink(context);
  await testRaptStaleReadingsRejected(context);
  await testExportFilenames(context);

  await context.close();
  await browser.close();

  console.log(`\n${"=".repeat(50)}`);
  if (failures.length) {
    console.log(`FAILED: ${failures.length} regression check(s):`);
    failures.forEach(f => console.log(`  • ${f}`));
    process.exit(1);
  }
  console.log("ALL REGRESSION CHECKS PASSED");
}

main().catch(err => { console.error("Fatal:", err); process.exit(2); });
