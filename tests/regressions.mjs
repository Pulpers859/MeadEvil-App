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

async function state(page) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), STORAGE_KEY);
}

async function testArchiveCloneIds(context) {
  console.log("\n[1] Archive clone id hygiene");
  const page = await freshPage(context);
  await buildAndSaveRecipe(page, { name: "Original Traditional" });
  page.once("dialog", d => d.accept());
  await page.$eval("#loadDraftToBatchBtn", btn => btn.click());
  await delay(400);
  await page.$eval("#archiveBatchBtn", btn => btn.click());
  await delay(400);
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
  page.once("dialog", d => d.accept());
  await page.$eval("#loadDraftToBatchBtn", btn => btn.click());
  await delay(400);
  await clickTab(page, "recipes");

  const downloadPromise = page.waitForEvent("download", { timeout: 8000 });
  await page.$eval("#printRecipeCardBtn", btn => btn.click());
  const download = await downloadPromise;
  const path = await download.path();
  const text = await fs.readFile(path, "utf8");

  check("card has no null/undefined artifacts", !/null|undefined/.test(text), (text.match(/.*(null|undefined).*/g) || []).join(" | "));
  check("card prints TOSNA dose math", /TOSNA: [\d.]+ g Fermaid O total \([\d.]+ g × 4 doses\)/.test(text));
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
  page.once("dialog", d => d.accept());
  await page.$eval("#loadDraftToBatchBtn", btn => btn.click());
  await delay(400);

  await page.$eval("#gravityLogCard", el => { el.open = true; }).catch(() => {});
  for (const [g, d] of [["1.100", "2026-06-01"], ["1.020", "2026-06-08"]]) {
    await setVal(page, "#logDate", d);
    await setVal(page, "#logGravity", g);
    await page.$eval("#addLogBtn", btn => btn.click());
    await delay(200);
  }
  const abvPill = await page.$('[data-trend-series-toggle="abv"]');
  const abvText = abvPill ? await abvPill.evaluate(el => el.textContent) : "";
  check("ABV series uses highest log as OG", Boolean(abvPill) && /10\.[0-9]/.test(abvText), `pill="${abvText}"`);
  await page.close();
}

async function testCancelledLoadKeepsStructure(context) {
  console.log("\n[4] Cancelled load preserves batch structure additions");
  const page = await freshPage(context);
  let dialogAction = "accept";
  page.on("dialog", d => dialogAction === "dismiss" ? d.dismiss() : d.accept());
  await buildAndSaveRecipe(page, { name: "Active Batch" });
  await page.$eval("#loadDraftToBatchBtn", btn => btn.click());
  await delay(400);
  // Hand the active batch a structure addition, then change the draft's.
  await page.evaluate((enhKey) => {
    const enh = JSON.parse(localStorage.getItem(enhKey) || "{}");
    enh.currentBatch = enh.currentBatch || {};
    enh.currentBatch.structureAdditions = [{ id: "adj-keep", phase: "secondary", category: "oak", ingredient: "KEEP-ME oak cubes", amount: "1", unit: "oz", purpose: "Structure", notes: "" }];
    enh.recipeDraft = enh.recipeDraft || {};
    enh.recipeDraft.structureAdditions = [{ id: "adj-new", phase: "secondary", category: "spice", ingredient: "REPLACEMENT spice", amount: "2", unit: "g", purpose: "Aroma", notes: "" }];
    localStorage.setItem(enhKey, JSON.stringify(enh));
  }, ENH_KEY);
  // Click load again but DISMISS the confirm.
  dialogAction = "dismiss";
  await page.$eval("#loadDraftToBatchBtn", btn => btn.click());
  await delay(500);
  const enh = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), ENH_KEY);
  const batchAdds = ((enh.currentBatch || {}).structureAdditions || []).map(r => r.ingredient).join(",");
  check("batch structure additions untouched after cancelled load", batchAdds.includes("KEEP-ME"), `got: ${batchAdds}`);
  await page.close();
}

async function testNoopArchiveKeepsRecord(context) {
  console.log("\n[5] No-op archive keeps older archive structure record");
  const page = await freshPage(context);
  await buildAndSaveRecipe(page, { name: "First Archived" });
  page.once("dialog", d => d.accept());
  await page.$eval("#loadDraftToBatchBtn", btn => btn.click());
  await delay(400);
  await page.$eval("#archiveBatchBtn", btn => btn.click());
  await delay(500);
  const s1 = await state(page);
  const archiveId = (s1.archive || [])[0]?.id;
  // Mark the existing archive enhancement record, then click archive again with no batch.
  await page.evaluate(([enhKey, id]) => {
    const enh = JSON.parse(localStorage.getItem(enhKey) || "{}");
    enh.archive = enh.archive || {};
    enh.archive[id] = { structureAdditions: [{ id: "adj-orig", phase: "secondary", category: "oak", ingredient: "ORIGINAL-RECORD", amount: "", unit: "oz", purpose: "", notes: "" }] };
    localStorage.setItem(enhKey, JSON.stringify(enh));
  }, [ENH_KEY, archiveId]);
  await page.$eval("#archiveBatchBtn", btn => btn.click());
  await delay(500);
  const enh = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), ENH_KEY);
  const record = ((enh.archive || {})[archiveId] || {}).structureAdditions || [];
  check("older archive structure record untouched by no-op archive", record.some(r => r.ingredient === "ORIGINAL-RECORD"), JSON.stringify(record));
  await page.close();
}

async function testCsvRoundTrip(context) {
  console.log("\n[6] CSV export → import round-trip");
  const page = await freshPage(context);
  await buildAndSaveRecipe(page, { name: "CSV Alpha", gallons: "3", abv: "12", honeyLb: "9" });
  await page.$eval("#clearRecipeBtn", btn => { window.confirm = () => true; btn.click(); });
  await delay(300);
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
  page.once("dialog", d => d.accept());
  await page.$eval("#loadDraftToBatchBtn", btn => btn.click());
  await delay(400);
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
  page.once("dialog", d => d.accept());
  await page.$eval("#loadDraftToBatchBtn", btn => btn.click());
  await delay(600);
  const plan = await page.$eval("#executionPlanBody", el => el.textContent || "").catch(() => "");
  check("adjunct shows in Ferment execution plan", /Cinnamon stick/.test(plan), plan.slice(0, 120));
  await page.close();
}

async function testJsonBackupRoundTrip(context) {
  console.log("\n[9] JSON backup → factory reset → import round-trip");
  const page = await freshPage(context);
  page.on("dialog", d => d.accept().catch(() => {}));
  // Build a full state: adjunct + recipe + batch + logs + archive entry.
  await clickTab(page, "recipes");
  await page.$eval('#recipeAdjunctList [data-adjunct-field="ingredient"]', (el) => {
    el.value = "Backup oak spiral";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await delay(250);
  await buildAndSaveRecipe(page, { name: "Backup Round Trip", gallons: "3", abv: "12" });
  await page.$eval("#loadDraftToBatchBtn", btn => btn.click());
  await delay(500);
  await page.$eval("#gravityLogCard", el => { el.open = true; }).catch(() => {});
  await setVal(page, "#logGravity", "1.090");
  await page.$eval("#addLogBtn", btn => btn.click());
  await delay(250);
  await page.$eval("#archiveBatchBtn", btn => btn.click());
  await delay(500);

  const downloadPromise = page.waitForEvent("download", { timeout: 8000 });
  await page.$eval("#exportDataBtn", btn => btn.click());
  const download = await downloadPromise;
  const backupPath = await download.path();

  await page.$eval("#resetAppBtn", btn => btn.click());
  await delay(500);
  const wiped = await state(page);
  check("factory reset wipes archive", (wiped.archive || []).length === 0);

  await page.setInputFiles("#importFileInput", backupPath);
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
  page.on("dialog", d => d.accept().catch(() => {}));
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
  console.log("\n[11] Stabilizer dosing in Finish summary");
  const page = await freshPage(context);
  page.on("dialog", d => d.accept().catch(() => {}));
  await buildAndSaveRecipe(page, { name: "Stabilizer Pin" });
  await page.$eval("#loadDraftToBatchBtn", btn => btn.click());
  await delay(400);
  await clickTab(page, "cellar");
  await setVal(page, "#backsweetenVolume", "3");
  await setVal(page, "#cellarCurrentPh", "3.4");
  await delay(300);
  const summary = await page.$eval("#cellarSmartSummary", el => el.textContent);
  check("stabilizer line renders with pH-driven SO₂ target", /Stabilizer math/.test(summary) && /32 ppm/.test(summary), summary.slice(0, 160));
  check("k-meta and sorbate grams present", /g.*k-meta/i.test(summary) && /sorbate/i.test(summary));
  // The MeadTools model: 3 gal at ~12% ABV, pH 3.4 → ~0.6 g k-meta, ~1.5–1.7 g sorbate
  const kmeta = Number((summary.match(/([\d.]+)\s*g\s*k-meta/i) || [])[1]);
  check("k-meta dose in expected range", kmeta > 0.4 && kmeta < 0.9, String(kmeta));
  await page.close();
}

async function testGravityCsvImport(context) {
  console.log("\n[12] Hydrometer CSV import");
  const page = await freshPage(context);
  page.on("dialog", d => d.accept().catch(() => {}));
  await clickTab(page, "ferment");
  const tiltCsv = [
    "Timepoint,SG,Temp,Color,Beer",
    "6/1/2026 8:00,1.102,68.5,PURPLE,Pin",
    "6/1/2026 10:00,1.101,68.7,PURPLE,Pin",
    "6/2/2026 8:00,1.080,67.9,PURPLE,Pin"
  ].join("\n");
  const tiltPath = "/tmp/regression-tilt.csv";
  await fs.writeFile(tiltPath, tiltCsv);
  await page.$eval("#gravityLogCard", el => { el.open = true; });
  await page.setInputFiles("#gravityCsvFileInput", tiltPath);
  await delay(600);
  let logs = (await state(page)).fermentationLogs || [];
  check("Tilt CSV imports and downsamples same 6h bucket", logs.length === 2, `${logs.length} logs`);
  await page.setInputFiles("#gravityCsvFileInput", tiltPath);
  await delay(500);
  logs = (await state(page)).fermentationLogs || [];
  check("re-import is a no-op (sourceId dedupe)", logs.length === 2, `${logs.length} logs`);
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
  page.on("dialog", d => d.accept().catch(() => {}));
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
