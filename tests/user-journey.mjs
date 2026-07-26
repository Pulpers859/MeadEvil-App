/**
 * MeadEvil user journey — a demo/trial run driven the way a real meadmaker uses it.
 *
 * This is deliberately NOT a unit test. It plays out the documented loop end to end
 * on the repo's own reference recipe (HANDOFF §13, "Code Blue"), and reports
 * anything that a real user would experience as wrong, confusing, or dangerous:
 *
 *   Build a recipe  ->  start a batch  ->  log fermentation  ->  execute the feed
 *   plan  ->  finish/stabilize  ->  archive to Vault  ->  clone and improve
 *
 * Findings are graded HIGH / MED / LOW by user impact, not by test convention:
 *   HIGH = data loss, or a confidently-presented wrong number a brewer would act on
 *   MED  = broken workflow hop, misleading state, lost user input
 *   LOW  = polish, copy, cosmetics
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8910";
const STORAGE_KEY = "meadevil-app-v2";
const ENH_KEY = "meadevil-app-v2-meadevil-mentor";
const delay = (ms) => new Promise(r => setTimeout(r, ms));

const findings = [];
const note = (sev, area, what, detail = "") =>
  findings.push({ sev, area, what, detail: String(detail).slice(0, 300) });
const ok = (area, what) => console.log(`  ✅ ${area}: ${what}`);
const bad = (sev, area, what, detail = "") => {
  console.log(`  ${sev === "HIGH" ? "🔴" : sev === "MED" ? "🟠" : "🟡"} [${sev}] ${area}: ${what}${detail ? ` — ${detail}` : ""}`);
  note(sev, area, what, detail);
};

async function setVal(page, sel, value) {
  await page.$eval(sel, (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, String(value));
  await delay(60);
}

async function clickTab(page, tab) {
  await page.$eval(`button.tab-btn[data-tab="${tab}"]`, b => b.click());
  await delay(250);
}

async function answerModal(page, action = "confirm", timeout = 1200) {
  const appeared = await page.waitForSelector(".modal-backdrop .modal-card", { timeout })
    .then(() => true).catch(() => false);
  if (!appeared) return false;
  // Three-button modal order is ghost / primary(alt) / danger(confirm); a comma
  // selector resolves by DOM order, so pick the intended button explicitly.
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
  await page.waitForSelector(".modal-backdrop", { state: "detached", timeout: 2000 }).catch(() => {});
  return true;
}

async function click(page, sel, { modal = null, settle = 350 } = {}) {
  await page.$eval(sel, b => b.click());
  if (modal) await answerModal(page, modal);
  await delay(settle);
}

async function readState(page) {
  const raw = await page.evaluate(k => JSON.parse(localStorage.getItem(k) || "{}"), STORAGE_KEY);
  return raw && raw._schema && raw.data ? raw.data : (raw || {});
}

async function setSourceRow(page, index, { type, desc, amount }) {
  await page.evaluate(({ index, type, desc, amount }) => {
    const fire = (el, t) => el.dispatchEvent(new Event(t, { bubbles: true }));
    const rows = document.querySelectorAll("#recipeSourceList .source-row");
    const row = rows[index];
    if (!row) return;
    // Changing sourceType fires renderRecipes(), which REPLACES these nodes.
    // Re-query after it or we write to detached elements.
    if (type) {
      const sel = row.querySelector('[data-source-field="sourceType"]');
      sel.value = type; fire(sel, "change");
    }
    const fresh = document.querySelectorAll("#recipeSourceList .source-row")[index];
    if (!fresh) return;
    const d = fresh.querySelector('[data-source-field="description"]');
    if (d && desc != null) { d.value = desc; fire(d, "input"); }
    const a = fresh.querySelector('[data-source-field="amount"]');
    if (a && amount != null) { a.value = String(amount); fire(a, "input"); }
  }, { index, type, desc, amount });
  await delay(150);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  const page = await context.newPage();
  const jsErrors = [];
  page.on("pageerror", e => jsErrors.push(e.message));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await delay(900);
  await page.evaluate(([k, e]) => { localStorage.removeItem(k); localStorage.removeItem(e); }, [STORAGE_KEY, ENH_KEY]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await delay(900);

  // ── 1. FIRST RUN ──────────────────────────────────────────────────────────
  console.log("\n[1] First run — what does a new user actually see?");
  const firstRun = await page.evaluate(() => {
    const panel = document.querySelector(".tab-panel.active");
    const openAccords = [...document.querySelectorAll("details[open]")].length;
    return {
      activeTab: panel ? panel.id : "(none)",
      visibleText: (panel ? panel.innerText : "").trim().length,
      openAccords,
      h1: document.querySelectorAll("h1").length
    };
  });
  if (firstRun.visibleText < 200) bad("MED", "First run", "landing panel is nearly empty", `${firstRun.visibleText} chars`);
  else ok("First run", `lands on ${firstRun.activeTab} with real content`);
  if (firstRun.h1 === 0) bad("MED", "A11y", "page has no <h1>");
  else ok("A11y", "page exposes an h1");

  // ── 2. BUILD the reference recipe ─────────────────────────────────────────
  console.log("\n[2] Build — Code Blue (HANDOFF §13): 1.5 gal blueberry botanical");
  await clickTab(page, "recipes");
  await setVal(page, "#recipeName", "Code Blue");
  await setVal(page, "#recipeBatchGallons", "1.5");
  await setVal(page, "#recipeTargetAbv", "12");
  await setVal(page, "#recipeSweetness", "Semi-sweet");
  await setSourceRow(page, 0, { type: "Honey", desc: "Clove honey", amount: "2.0" });
  await click(page, "#addRecipeSourceBtn", { settle: 250 });
  await setSourceRow(page, 1, { type: "Honey", desc: "Wildflower honey", amount: "2.5" });
  await click(page, "#addRecipeSourceBtn", { settle: 250 });
  await setSourceRow(page, 2, { type: "Fruit / Puree", desc: "Blueberries", amount: "3.25" });
  await delay(400);

  const build = await page.evaluate(() => ({
    reality: (document.getElementById("recipeMustSummary") || {}).innerText || "",
    readiness: (document.getElementById("recipeReadiness") || {}).innerText || "",
    computed: [
      (document.getElementById("recipeTargetSummary") || {}).innerText || "",
      (document.getElementById("recipeTargetRealityDelta") || {}).innerText || ""
    ].join("\n")
  }));
  const ogMatch = build.reality.match(/1\.\d{3}/);
  if (!ogMatch) bad("MED", "Build", "source bill shows no computed OG", build.reality.slice(0, 160));
  else {
    const billOg = parseFloat(ogMatch[0]);
    // 2.0+2.5 lb honey @35 + 3.25 lb blueberries @5 PPG over 1.5 gal
    const expected = ((4.5 * 35) + (3.25 * 5)) / 1.5 / 1000 + 1;
    if (Math.abs(billOg - expected) > 0.004) {
      bad("HIGH", "Build", "source-bill OG does not match its own inputs",
        `shows ${billOg}, inputs imply ${expected.toFixed(3)}`);
    } else ok("Build", `source bill OG ${billOg} matches the entered bill`);
  }
  if (/NaN|undefined|null/.test(build.reality + build.readiness + build.computed)) {
    bad("HIGH", "Build", "NaN/undefined leaked into the Build panels",
      (build.reality + build.readiness + build.computed).match(/.{0,60}(NaN|undefined|null).{0,40}/)?.[0]);
  } else ok("Build", "no NaN/undefined artifacts in Build panels");

  await click(page, "#saveRecipeBtn", { settle: 400 });
  let s = await readState(page);
  if (!(s.recipes || []).length) bad("HIGH", "Build", "Save recipe did not persist anything");
  else ok("Build", `recipe saved to Vault (${s.recipes.length})`);

  // ── 3. START THE BATCH ────────────────────────────────────────────────────
  console.log("\n[3] Ferment — start the batch and log a real fermentation");
  await click(page, "#loadDraftToBatchBtn", { modal: "confirm", settle: 600 });
  s = await readState(page);
  if (!s.currentBatch || !s.currentBatch.name) bad("HIGH", "Ferment", "starting a batch produced no active batch");
  else ok("Ferment", `active batch is "${s.currentBatch.name}"`);

  await clickTab(page, "ferment");
  await page.$eval("#gravityLogCard", el => { el.open = true; }).catch(() => {});
  const readings = [
    ["2026-06-01", "1.118", "68"],
    ["2026-06-03", "1.092", "70"],
    ["2026-06-08", "1.040", "67"],
    ["2026-06-15", "1.004", "65"],
    ["2026-06-25", "0.998", "64"]
  ];
  for (const [d, g, t] of readings) {
    await setVal(page, "#logDate", d);
    await setVal(page, "#logGravity", g);
    await setVal(page, "#logTemp", t);
    await click(page, "#addLogBtn", { settle: 250 });
  }
  s = await readState(page);
  const logs = s.fermentationLogs || [];
  if (logs.length !== readings.length) {
    bad("HIGH", "Ferment", "manual gravity readings were dropped", `entered ${readings.length}, stored ${logs.length}`);
  } else ok("Ferment", `all ${logs.length} manual readings stored`);

  // A blank date must be refused, not silently stored (it poisons log ordering).
  await setVal(page, "#logDate", "");
  await setVal(page, "#logGravity", "1.001");
  await click(page, "#addLogBtn", { settle: 250 });
  const afterBlank = (await readState(page)).fermentationLogs || [];
  if (afterBlank.length > logs.length) bad("MED", "Ferment", "a reading with no date was accepted", `${afterBlank.length} logs`);
  else ok("Ferment", "blank-date reading rejected with a message");
  await setVal(page, "#logDate", "2026-06-26");
  await setVal(page, "#logGravity", "");

  // ── 4. FEED ───────────────────────────────────────────────────────────────
  console.log("\n[4] Feed — does the plan inherit Build and tell the truth about YAN?");
  await clickTab(page, "nutrients");
  await delay(400);
  const feed = await page.evaluate(() => ({
    inheritedYeast: (document.getElementById("nutrientYeastRequirementDisplay") || {}).value || "",
    targetYanInput: (document.getElementById("nutrientTargetYan") || {}).value || "",
    summary: (document.getElementById("advancedNutrientSummary") || {}).innerText || "",
    schedule: (document.getElementById("nutrientSchedule") || {}).innerText || ""
  }));
  const shownTarget = (feed.summary.match(/Target YAN\s*(\d+)/) || [])[1];
  if (shownTarget && feed.targetYanInput && Math.abs(Number(shownTarget) - Number(feed.targetYanInput)) > 1) {
    bad("MED", "Feed", "Target YAN input and summary disagree on the same screen",
      `input=${feed.targetYanInput} summary=${shownTarget}`);
  } else ok("Feed", "Target YAN is consistent between input and summary");
  if (/delivers/i.test(feed.summary)) ok("Feed", "plan reports the YAN it actually delivers");
  else bad("MED", "Feed", "plan does not say how much YAN it actually delivers", feed.summary.slice(0, 140));
  if (/\b0\.0 g\b.*\b0\.0 g\b/.test(feed.schedule)) {
    bad("HIGH", "Feed", "nutrient schedule is all zeroes while a target is displayed", feed.schedule.slice(0, 140));
  } else ok("Feed", "nutrient schedule carries real doses");

  // ── 5. FINISH ─────────────────────────────────────────────────────────────
  console.log("\n[5] Finish — stabilizer safety gate");
  await clickTab(page, "cellar");
  await delay(300);
  const beforeGate = await page.$eval("#cellarSmartSummary", el => el.innerText);
  if (/\d+(\.\d+)?\s*g\s*k-meta/i.test(beforeGate)) {
    bad("HIGH", "Finish", "exact sulfite dose shown before gravity is proven stable", beforeGate.slice(0, 180));
  } else ok("Finish", "stabilizer dose withheld until the stability gate clears");

  await setVal(page, "#stableSgA", "0.998");
  await setVal(page, "#stableDateA", "2026-06-25");
  await setVal(page, "#stableSgB", "0.998");
  await setVal(page, "#stableDateB", "2026-07-05");
  await setVal(page, "#cellarCurrentPh", "3.4");
  await delay(450);
  const afterGate = await page.$eval("#cellarSmartSummary", el => el.innerText);
  const kmeta = Number((afterGate.match(/([\d.]+)\s*g\s*k-meta/i) || [])[1]);
  if (!kmeta) bad("MED", "Finish", "no stabilizer dose even after the gate cleared", afterGate.slice(0, 180));
  else if (kmeta > 1.0) bad("HIGH", "Finish", "sulfite dose implausibly high for 1.5 gal at pH 3.4", `${kmeta} g`);
  else ok("Finish", `stabilizer dose appears once stable: ${kmeta} g k-meta`);
  if (/32 ppm/.test(afterGate)) ok("Finish", "free SO2 target matches the molecular-SO2 model at pH 3.4");
  else bad("MED", "Finish", "SO2 target does not match the pH model", afterGate.slice(0, 160));

  // ── 6. VAULT + CLONE ──────────────────────────────────────────────────────
  console.log("\n[6] Vault — archive, then clone to improve next time");
  await setVal(page, "#tastingNotes", "Bright, cold, controlled. Juniper reads clean.");
  await clickTab(page, "ferment");
  await click(page, "#archiveBatchBtn", { modal: "confirm", settle: 700 });
  s = await readState(page);
  const arch = (s.archive || [])[0];
  if (!arch) bad("HIGH", "Vault", "archiving produced no Vault entry");
  else {
    ok("Vault", `archived "${arch.batch?.name}"`);
    if ((arch.fermentationLogs || []).length !== readings.length) {
      bad("HIGH", "Vault", "gravity history lost on archive",
        `${(arch.fermentationLogs || []).length} of ${readings.length}`);
    } else ok("Vault", "full gravity history preserved in the archive");
    if (!arch.cellar || !arch.cellar.tastingNotes) bad("MED", "Vault", "tasting notes did not survive archiving");
    else ok("Vault", "tasting notes preserved");
  }

  await clickTab(page, "archive");
  await delay(300);
  const cloneBtn = await page.$("button[data-archive-clone]");
  if (!cloneBtn) bad("HIGH", "Vault", "no way to clone an archived batch back into Build");
  else {
    await click(page, "button[data-archive-clone]", { modal: "confirm", settle: 600 });
    const draft = (await readState(page)).recipeDraft || {};
    if (!draft.name) bad("HIGH", "Vault", "clone produced an empty Build draft");
    else if (draft.id) bad("HIGH", "Vault", "clone kept the original id — saving would overwrite the original", draft.id);
    else ok("Vault", `clone opened in Build as "${draft.name}" with a fresh identity`);
    const srcCount = (draft.additions || []).filter(r => r.description).length;
    if (srcCount < 3) bad("HIGH", "Vault", "clone lost source-bill rows", `${srcCount} of 3`);
    else ok("Vault", "clone carried the full source bill");
  }

  // ── 7. SECOND BATCH — the highest-stakes destructive path ─────────────────
  console.log("\n[7] Starting a second batch — is the first one protected?");
  await clickTab(page, "recipes");
  await setVal(page, "#recipeName", "Second Batch Trial");
  await click(page, "#saveRecipeBtn", { settle: 300 });
  await click(page, "#loadDraftToBatchBtn", { modal: "confirm", settle: 500 });
  await clickTab(page, "ferment");
  await page.$eval("#gravityLogCard", el => { el.open = true; }).catch(() => {});
  await setVal(page, "#logDate", "2026-07-10");
  await setVal(page, "#logGravity", "1.100");
  await click(page, "#addLogBtn", { settle: 300 });

  await clickTab(page, "recipes");
  await setVal(page, "#recipeName", "Third Batch Trial");
  await click(page, "#saveRecipeBtn", { settle: 300 });
  await page.$eval("#loadDraftToBatchBtn", b => b.click());
  const modalText = await page.waitForSelector(".modal-backdrop .modal-card", { timeout: 1500 })
    .then(el => el.innerText()).catch(() => "");
  if (!modalText) {
    bad("HIGH", "Ferment", "replacing an active batch with logged readings asked for no confirmation");
  } else {
    const offersArchive = /archiv/i.test(modalText);
    if (!offersArchive) {
      bad("HIGH", "Ferment", "replace-batch prompt offers no way to keep the current batch", modalText.replace(/\n/g, " ").slice(0, 160));
    } else ok("Ferment", "replace-batch prompt offers to archive the current batch first");
    // Take the safe path and confirm it actually preserves the batch.
    const before = ((await readState(page)).archive || []).length;
    const altBtn = await page.$(".modal-backdrop .modal-actions .btn-primary");
    if (offersArchive && altBtn) {
      await altBtn.click();
      await delay(800);
      const after = ((await readState(page)).archive || []).length;
      if (after !== before + 1) bad("HIGH", "Ferment", "'archive first' did not archive the batch", `${before} -> ${after}`);
      else ok("Ferment", "'archive first' preserved the running batch in the Vault");
    } else {
      await answerModal(page, "cancel");
    }
  }

  // ── 8. HOSTILE / MALFORMED DATA ───────────────────────────────────────────
  console.log("\n[8] Robustness — malformed and hostile stored state");
  await page.evaluate((k) => {
    localStorage.setItem(k, JSON.stringify({
      _schema: { app: "MeadEvil", version: 1 },
      data: {
        // Non-object checklist items used to crash renderAll() and blank the app.
        fermentChecklist: [null, "not an object", { id: 1, text: "ok" }],
        recipes: [{ id: '"><img src=x onerror="window.__pwn=true">', name: "Hostile" }],
        fermentationLogs: [{ id: "ok-1", gravity: "1.050", date: "2026-06-01" }]
      }
    }));
  }, STORAGE_KEY);
  await page.reload({ waitUntil: "domcontentloaded" });
  await delay(1200);
  const hostile = await page.evaluate(() => ({
    pwned: window.__pwn === true,
    injected: document.querySelectorAll('img[src="x"]').length,
    rendered: (document.querySelector(".tab-panel.active")?.innerText || "").trim().length,
    tabs: document.querySelectorAll("button.tab-btn").length
  }));
  if (hostile.pwned || hostile.injected > 0) bad("HIGH", "Security", "stored record id executed script (XSS)", JSON.stringify(hostile));
  else ok("Security", "hostile record id neutralised, no script executed");
  if (hostile.rendered < 100 || hostile.tabs !== 6) bad("HIGH", "Robustness", "malformed checklist blanked the app", JSON.stringify(hostile));
  else ok("Robustness", "malformed checklist items degraded gracefully");

  // Corrupt JSON must tell the user, not silently present an empty ledger.
  await page.evaluate((k) => localStorage.setItem(k, "{not valid json"), STORAGE_KEY);
  await page.reload({ waitUntil: "domcontentloaded" });
  await delay(1200);
  const corrupt = await page.evaluate(() => ({
    warned: !!document.querySelector("#meadevilToastHost .toast"),
    toast: document.querySelector("#meadevilToastHost .toast")?.innerText || "",
    backup: !!localStorage.getItem("meadevil-app-v2-corrupt-backup")
  }));
  if (!corrupt.backup) bad("HIGH", "Robustness", "unreadable state was not backed up before being replaced");
  else ok("Robustness", "unreadable state preserved under a backup key");
  if (!corrupt.warned) bad("MED", "Robustness", "unreadable state produced no user-visible warning");
  else ok("Robustness", `user warned: "${corrupt.toast.slice(0, 70)}"`);

  if (jsErrors.length) bad("HIGH", "Runtime", `${jsErrors.length} uncaught JS error(s)`, jsErrors.slice(0, 3).join(" | "));
  else ok("Runtime", "no uncaught JS errors across the whole journey");

  await browser.close();

  // ── REPORT ────────────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(60)}`);
  const by = sev => findings.filter(f => f.sev === sev);
  console.log(`USER JOURNEY: ${by("HIGH").length} HIGH · ${by("MED").length} MED · ${by("LOW").length} LOW`);
  for (const sev of ["HIGH", "MED", "LOW"]) {
    for (const f of by(sev)) console.log(`  [${sev}] ${f.area}: ${f.what}${f.detail ? ` — ${f.detail}` : ""}`);
  }
  if (!findings.length) console.log("Clean run — no issues surfaced by the journey.");
  process.exit(by("HIGH").length ? 1 : 0);
}

main().catch(err => { console.error("Fatal:", err); process.exit(2); });
