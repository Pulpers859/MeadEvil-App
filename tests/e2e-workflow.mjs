/**
 * MeadEvil full workflow E2E stress test
 * Brainstorm(skip API) → Build → Ferment → Feed → Finish → Vault
 * Runs N consecutive passes; fixes must produce 5 clean passes.
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8910";
const TOTAL_PASSES = 5;

const MEAD_IDEAS = [
  {
    name: "Crimson Velvet Cyser",
    style: "Cyser",
    gallons: "3",
    abv: "14",
    sweetness: "Semi-sweet",
    carbonation: "Still",
    yeast: "71B",
    dryYeast: "5",
    tags: "apple, fall, dessert",
    quickNote: "Apple cider base with wildflower honey",
    notes: "Press fresh apple cider day-of. Use wildflower honey. Add cinnamon stick in secondary.",
    sources: [
      { type: "Honey", amount: "4.5" },
      { type: "Juice (single strength)", amount: "1.5", desc: "Fresh apple cider" }
    ],
    og: "1.120",
    gravityReadings: [
      { gravity: "1.120", temp: "68", pH: "3.8", note: "Pitch day — vigorous start" },
      { gravity: "1.080", temp: "66", pH: "3.6", note: "1/3 sugar break" },
      { gravity: "1.040", temp: "65", pH: "3.5", note: "2/3 break, aroma mellowing" },
      { gravity: "1.010", temp: "64", pH: "3.4", note: "Nearing FG, slowing down" },
      { gravity: "0.998", temp: "64", pH: "3.35", note: "Dry — rack to secondary" }
    ],
    tastingNotes: "Bright apple up front, honey warmth, dry finish with gentle tannin."
  },
  {
    name: "Ghost Pepper Bochet",
    style: "Bochet",
    gallons: "1",
    abv: "16",
    sweetness: "Dry",
    carbonation: "Still",
    yeast: "EC-1118",
    dryYeast: "3",
    tags: "spicy, bochet, extreme",
    quickNote: "Caramelized honey with ghost pepper heat",
    notes: "Caramelize honey 90min to deep mahogany. Ghost pepper in secondary — 1 dried pod per gallon, taste daily.",
    sources: [
      { type: "Honey", amount: "4" }
    ],
    og: "1.140",
    gravityReadings: [
      { gravity: "1.140", temp: "72", pH: "3.9", note: "Pitch — caramelized must is dark" },
      { gravity: "1.100", temp: "70", pH: "3.7", note: "Strong ferment, sulfur off-gas" },
      { gravity: "1.060", temp: "69", pH: "3.5", note: "Past 1/3 break" },
      { gravity: "1.020", temp: "68", pH: "3.4", note: "Slowing, still bubbling" },
      { gravity: "1.002", temp: "67", pH: "3.3", note: "Bone dry, racked off lees" }
    ],
    tastingNotes: "Dark caramel, toffee, lingering ghost pepper burn on the finish."
  },
  {
    name: "Lavender Sunset Metheglin",
    style: "Metheglin",
    gallons: "5",
    abv: "12",
    sweetness: "Semi-sweet",
    carbonation: "Carbonated",
    yeast: "D47",
    dryYeast: "7.5",
    tags: "floral, spring, elegant",
    quickNote: "Lavender and chamomile with orange blossom honey",
    notes: "Orange blossom honey base. Lavender buds in secondary (2 tbsp/gal). Chamomile tea steep at kegging.",
    sources: [
      { type: "Honey", amount: "7.5" }
    ],
    og: "1.100",
    gravityReadings: [
      { gravity: "1.100", temp: "62", pH: "3.7", note: "Pitch day, gentle start" },
      { gravity: "1.070", temp: "63", pH: "3.55", note: "Steady ferment" },
      { gravity: "1.040", temp: "62", pH: "3.45", note: "1/3 break" },
      { gravity: "1.015", temp: "62", pH: "3.4", note: "Approaching target" },
      { gravity: "1.008", temp: "61", pH: "3.35", note: "FG reached — transfer" }
    ],
    tastingNotes: "Elegant floral nose, honey mid-palate, light effervescence, clean finish."
  },
  {
    name: "Blood Orange Melomel",
    style: "Melomel",
    gallons: "3",
    abv: "13",
    sweetness: "Dry",
    carbonation: "Still",
    yeast: "QA23",
    dryYeast: "5",
    tags: "citrus, winter, bold",
    quickNote: "Blood orange zest and juice with wildflower",
    notes: "Wildflower honey. Blood orange juice in primary, zest in secondary. Expect haze — cold crash before bottling.",
    sources: [
      { type: "Honey", amount: "4" },
      { type: "Fruit / Puree", amount: "2", desc: "Blood orange juice" }
    ],
    og: "1.110",
    gravityReadings: [
      { gravity: "1.110", temp: "65", pH: "3.5", note: "Pitch — orange must looks amazing" },
      { gravity: "1.075", temp: "64", pH: "3.4", note: "Active, citrus aroma" },
      { gravity: "1.045", temp: "64", pH: "3.35", note: "Past 1/3 break" },
      { gravity: "1.010", temp: "63", pH: "3.3", note: "Slowing" },
      { gravity: "0.996", temp: "63", pH: "3.25", note: "Dry — rack, add zest" }
    ],
    tastingNotes: "Bright citrus, balanced acidity, dry honey backbone, winter sipper."
  },
  {
    name: "Viking's Braggot",
    style: "Braggot",
    gallons: "5",
    abv: "10",
    sweetness: "Dry",
    carbonation: "Carbonated",
    yeast: "EC-1118",
    dryYeast: "8",
    tags: "grain, session, norse",
    quickNote: "Half honey half malt — sessionable braggot",
    notes: "50/50 honey and light DME. Grain-forward, sessionable. Hop with a small dose of Saaz for spice.",
    sources: [
      { type: "Honey", amount: "3.5" },
      { type: "Custom", amount: "3.5", desc: "Light DME", ppg: "42" }
    ],
    og: "1.080",
    gravityReadings: [
      { gravity: "1.080", temp: "68", pH: "4.2", note: "Pitch — malt and honey blended" },
      { gravity: "1.055", temp: "67", pH: "4.0", note: "Active" },
      { gravity: "1.030", temp: "66", pH: "3.8", note: "Halfway" },
      { gravity: "1.012", temp: "65", pH: "3.7", note: "Slowing" },
      { gravity: "1.004", temp: "65", pH: "3.6", note: "FG — ready to carb" }
    ],
    tastingNotes: "Biscuit malt, honey sweetness, light hop spice, refreshing and drinkable."
  }
];

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function clearAppState(page, fullReset = false) {
  if (fullReset) {
    await page.evaluate(() => {
      localStorage.removeItem("meadevil-app-v2");
      localStorage.removeItem("meadevil-app-v2-meadevil-mentor");
    });
  } else {
    // Keep archive, clear active batch and recipe draft
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("meadevil-app-v2") || "{}");
      state.currentBatch = { name: "", style: "Traditional", batchGallons: "", targetAbv: "", sweetness: "Dry", carbonation: "Still", yeast: "", yeastOther: "", yeastTolerance: "", temp: "", nitrogenRequirement: "low", dryYeast: "", honeyPPG: "35", additions: [], structureAdditions: [] };
      state.recipeDraft = { name: "", style: "Traditional", batchGallons: "", targetAbv: "", sweetness: "Dry", carbonation: "Still", yeast: "", yeastOther: "", yeastTolerance: "", temp: "", nitrogenRequirement: "low", dryYeast: "", honeyPPG: "35", additions: [], structureAdditions: [] };
      state.fermentationLogs = [];
      state.recipes = [];
      state.ui = { ...(state.ui || {}), selectedRecipeId: null, activeTab: "recipes" };
      localStorage.setItem("meadevil-app-v2", JSON.stringify(state));
      localStorage.removeItem("meadevil-app-v2-meadevil-mentor");
    });
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await delay(800);
  await page.$eval('button.tab-btn[data-tab="recipes"]', btn => btn.click());
  await delay(300);
}

async function setInputValue(page, selector, value) {
  await page.$eval(selector, (el, val) => {
    el.value = val;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, String(value));
}

async function setSelectValue(page, selector, value) {
  await page.$eval(selector, (el, val) => {
    el.value = val;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function clickTab(page, tabName) {
  // Use JS click to avoid pointer-interception by the fixed tab bar
  await page.$eval(`button.tab-btn[data-tab="${tabName}"]`, btn => btn.click());
  await delay(300);
}

async function verifyTabActive(page, tabName) {
  const panel = await page.$(`#tab-${tabName}`);
  if (!panel) throw new Error(`Tab panel #tab-${tabName} not found`);
  const isVisible = await panel.evaluate(el => el.classList.contains("active"));
  if (!isVisible) throw new Error(`Tab panel #tab-${tabName} is not active`);
}

async function runPass(context, passNumber, idea) {
  const errors = [];
  const page = await context.newPage();

  page.on("pageerror", err => errors.push(`JS ERROR: ${err.message}`));
  page.on("console", msg => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Ignore expected 500s from Netlify functions not running locally
      if (text.includes("500") || text.includes("Failed to load resource") || text.includes("net::ERR") || text.includes("firebase")) return;
      errors.push(`CONSOLE ERROR: ${text}`);
    }
  });

  try {
    console.log(`\n=== PASS ${passNumber}: ${idea.name} ===`);

    // 1. Load app and clear state (full reset on first pass only)
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await delay(600);
    await clearAppState(page, passNumber === 1);

    // 2. BUILD TAB — fill recipe
    console.log("  [Build] Filling recipe form...");
    await clickTab(page, "recipes");
    await verifyTabActive(page, "recipes");

    await setInputValue(page, "#recipeName", idea.name);
    await setSelectValue(page, "#recipeStyle", idea.style);
    await setInputValue(page, "#recipeBatchGallons", idea.gallons);
    await setInputValue(page, "#recipeTargetAbv", idea.abv);
    await setSelectValue(page, "#recipeSweetness", idea.sweetness);
    await setSelectValue(page, "#recipeCarbonation", idea.carbonation);
    await setSelectValue(page, "#recipeYeast", idea.yeast);
    await setInputValue(page, "#recipeDryYeast", idea.dryYeast);

    // Open recipe extras fold and fill
    await page.$eval("details.recipe-extras-fold", el => { el.open = true; }).catch(() => {});
    await setInputValue(page, "#recipeTags", idea.tags);
    await setInputValue(page, "#recipeQuickNote", idea.quickNote);
    await setInputValue(page, "#recipeNotes", idea.notes);

    // Fill source bill — add extra rows first, then fill all
    for (let i = 1; i < idea.sources.length; i++) {
      await page.$eval("#addRecipeSourceBtn", btn => btn.click());
      await delay(200);
    }
    await page.evaluate((sources) => {
      const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
      const allRows = document.querySelectorAll("#recipeSourceList .source-row");
      sources.forEach((src, i) => {
        const row = allRows[i];
        if (!row) return;
        const typeEl = row.querySelector('[data-source-field="sourceType"]');
        if (typeEl) { typeEl.value = src.type; fire(typeEl, "change"); }
        if (src.desc) {
          const descEl = row.querySelector('[data-source-field="description"]');
          if (descEl) { descEl.value = src.desc; fire(descEl, "input"); }
        }
        const amtEl = row.querySelector('[data-source-field="amount"]');
        if (amtEl) { amtEl.value = src.amount; fire(amtEl, "input"); }
        if (src.ppg) {
          const ppgEl = row.querySelector('[data-source-field="ppg"]');
          if (ppgEl) { ppgEl.value = src.ppg; fire(ppgEl, "input"); }
        }
      });
    }, idea.sources);
    await delay(300);

    // Verify computed sections rendered
    const targetSummary = await page.$eval("#recipeTargetSummary", el => el.innerHTML);
    if (!targetSummary || targetSummary.includes("No plan")) {
      console.log("  [Build] WARNING: Design target still shows placeholder");
    } else {
      console.log("  [Build] Design target computed OK");
    }
    const mustSummary = await page.$eval("#recipeMustSummary", el => el.innerHTML);
    console.log(`  [Build] Source bill has content: ${mustSummary.length > 20}`);
    const sanity = await page.$eval("#recipeReadiness", el => el.innerHTML);
    console.log(`  [Build] Sanity engine has content: ${sanity.length > 20}`);

    // Save recipe
    console.log("  [Build] Saving recipe...");
    await page.$eval("#saveRecipeBtn", btn => btn.click());
    await delay(300);

    // Verify recipe appears in saved list
    const savedRecipes = await page.$$("#recipeList .recipe-item");
    if (!savedRecipes.length) errors.push("SAVE FAILED: No recipes in saved list after save");
    else console.log(`  [Build] Recipe saved — ${savedRecipes.length} recipe(s) in list`);

    // 3. LOAD TO BATCH → auto-navigates to Ferment
    console.log("  [Build] Loading draft to batch...");
    page.once("dialog", d => d.accept());
    await page.$eval("#loadDraftToBatchBtn", btn => btn.click());
    await delay(500);

    // 4. FERMENT TAB
    await verifyTabActive(page, "ferment");
    console.log("  [Ferment] Tab active OK");

    // Check batch pulse loaded
    const batchPulse = await page.$("#batchPulseAccord");
    const pulseOpen = await batchPulse?.evaluate(el => el.open);
    console.log(`  [Ferment] Batch pulse accordion open: ${pulseOpen}`);

    // Set pitch date
    await setInputValue(page, "#batchPitchDate", "2026-06-01");

    // Add gravity readings
    console.log("  [Ferment] Adding gravity readings...");
    // Open the gravity log accordion
    await page.$eval("#gravityLogCard", el => { el.open = true; }).catch(() => {});

    for (const reading of idea.gravityReadings) {
      await setInputValue(page, "#logGravity", reading.gravity);
      await setInputValue(page, "#logTemp", reading.temp);
      if (reading.pH) await setInputValue(page, "#logPH", reading.pH);
      await setInputValue(page, "#logNote", reading.note);
      await page.$eval("#addLogBtn", btn => btn.click());
      await delay(200);

      // Check for entry error
      const logError = await page.$("#logEntryError");
      if (logError) {
        const hidden = await logError.evaluate(el => el.hidden);
        if (!hidden) {
          const errText = await logError.evaluate(el => el.textContent);
          errors.push(`GRAVITY LOG ERROR: ${errText} (reading: ${reading.gravity})`);
        }
      }
    }

    const logCount = await page.$$eval("#gravityLog .log-row", rows => rows.length);
    console.log(`  [Ferment] Gravity log entries: ${logCount}`);
    if (logCount !== idea.gravityReadings.length) {
      errors.push(`GRAVITY LOG COUNT MISMATCH: expected ${idea.gravityReadings.length}, got ${logCount}`);
    }

    // Verify trend chart rendered
    const trendChart = await page.$eval("#fermentationTrendChart", el => el.innerHTML);
    if (trendChart.length < 50) {
      console.log("  [Ferment] WARNING: Trend chart may not have rendered");
    } else {
      console.log("  [Ferment] Trend chart rendered OK");
    }

    // Change batch phase
    // Phase change may trigger 1-2 alerts (phase transition + structure reminder)
    const phaseDialogHandler = d => d.accept();
    page.on("dialog", phaseDialogHandler);
    await setSelectValue(page, "#batchPhase", "secondary");
    await delay(500);
    page.off("dialog", phaseDialogHandler);
    // May trigger alert about structure additions
    await delay(300);

    // 5. FEED TAB
    console.log("  [Feed] Switching to Feed...");
    await clickTab(page, "nutrients");
    await verifyTabActive(page, "nutrients");

    // Verify nutrient fields auto-populated from recipe
    const nutrientOg = await page.$eval("#nutrientOg", el => el.value);
    const nutrientGal = await page.$eval("#nutrientBatchGallons", el => el.value);
    console.log(`  [Feed] Nutrient OG: ${nutrientOg}, Batch gal: ${nutrientGal}`);

    // Check TOSNA summary rendered
    const nutrientSummary = await page.$("#nutrientSummary");
    if (nutrientSummary) {
      const summaryText = await nutrientSummary.evaluate(el => el.innerHTML);
      console.log(`  [Feed] Nutrient summary has content: ${summaryText.length > 20}`);
    }

    // Try advanced protocol
    await page.$eval('button.protocol-btn[data-protocol="advanced"]', btn => btn.click()).catch(() => {});
    await delay(300);
    console.log("  [Feed] Switched to Advanced protocol");
    // Switch back to TOSNA
    await page.$eval('button.protocol-btn[data-protocol="tosna"]', btn => btn.click()).catch(() => {});
    await delay(300);
    console.log("  [Feed] Switched back to TOSNA");

    // 6. FINISH TAB (Cellar)
    console.log("  [Finish] Switching to Finish...");
    await clickTab(page, "cellar");
    await verifyTabActive(page, "cellar");

    // Fill stability readings
    await setInputValue(page, "#stableSgA", "0.998");
    await setInputValue(page, "#stableDateA", "2026-06-15");
    await setInputValue(page, "#stableSgB", "0.998");
    await setInputValue(page, "#stableDateB", "2026-06-30");
    await delay(200);

    // Fill cellar fields
    await setInputValue(page, "#cellarGallons", idea.gallons);
    await setInputValue(page, "#cellarBottleOz", "12");
    await setInputValue(page, "#tastingNotes", idea.tastingNotes);
    await setInputValue(page, "#cellarRating", "4");
    await delay(200);

    // Check bottle math rendered
    const cellarContent = await page.$("#cellarBottleCount");
    if (cellarContent) {
      const bottleText = await cellarContent.evaluate(el => el.textContent);
      console.log(`  [Finish] Bottle count: ${bottleText}`);
    }

    // Check some cellar checklist items
    const cellarCheckCount = await page.$$eval("#stabilizationChecklist input[type='checkbox']", checks => {
      const count = Math.min(2, checks.length);
      for (let i = 0; i < count; i++) {
        checks[i].checked = true;
        checks[i].dispatchEvent(new Event("change", { bubbles: true }));
      }
      return count;
    });
    console.log(`  [Finish] Checked ${cellarCheckCount} cellar tasks`);

    // 7. ARCHIVE TO VAULT
    console.log("  [Vault] Archiving batch...");
    await clickTab(page, "ferment");
    await delay(300);
    await page.$eval("#archiveBatchBtn", btn => btn.click());
    await delay(500);

    // Should auto-navigate to archive tab
    await verifyTabActive(page, "archive");
    console.log("  [Vault] Archive tab active OK");

    // Verify archive entry exists
    const archiveCards = await page.$$(".archive-card");
    if (!archiveCards.length) {
      errors.push("ARCHIVE FAILED: No archive cards found after archiving");
    } else {
      const archiveName = await archiveCards[0].$eval("strong", el => el.textContent).catch(() => "unknown");
      console.log(`  [Vault] Archived batch: ${archiveName}`);
    }

    // Verify batch was cleared
    await clickTab(page, "ferment");
    await delay(300);
    const batchCleared = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("meadevil-app-v2") || "{}");
      return !state.currentBatch?.name;
    });
    if (!batchCleared) errors.push("BATCH NOT CLEARED: currentBatch still has data after archive");
    else console.log("  [Verify] Batch cleared after archive: OK");

    // 8. ROUND-TRIP: Verify archive entry has correct name, then load it
    console.log("  [Vault] Testing round-trip load from archive...");
    await clickTab(page, "archive");
    await delay(300);

    const archiveCheck = await page.evaluate((expectedName) => {
      const state = JSON.parse(localStorage.getItem("meadevil-app-v2") || "{}");
      const first = (state.archive || [])[0];
      return { name: first?.batch?.name || "", id: first?.id || "" };
    }, idea.name);

    if (archiveCheck.name !== idea.name) {
      errors.push(`ARCHIVE NAME MISMATCH: expected "${idea.name}", got "${archiveCheck.name}"`);
    } else {
      // Load the first entry back
      page.once("dialog", d => d.accept());
      await page.$eval('button[data-archive-load]', btn => btn.click());
      await delay(500);
      await verifyTabActive(page, "ferment");

      const loadedName = await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("meadevil-app-v2") || "{}");
        return state.currentBatch?.name || "";
      });
      if (loadedName !== idea.name) {
        errors.push(`ROUND-TRIP NAME MISMATCH: expected "${idea.name}", got "${loadedName}"`);
      } else {
        console.log(`  [Verify] Round-trip load OK: "${loadedName}"`);
      }

      // Re-archive to keep it in vault for user reference
      await page.$eval("#archiveBatchBtn", btn => btn.click());
      await delay(300);
    }

    // 9. TAB NAVIGATION STRESS — rapidly click all tabs
    console.log("  [Stress] Rapid tab switching...");
    const tabOrder = ["meadmaker", "recipes", "ferment", "nutrients", "cellar", "archive"];
    for (const tab of tabOrder) {
      await clickTab(page, tab);
      await verifyTabActive(page, tab);
    }
    console.log("  [Stress] All tabs navigable OK");

  } catch (e) {
    errors.push(`EXCEPTION: ${e.message}`);
  } finally {
    await page.close();
  }

  if (errors.length) {
    console.log(`\n  ❌ PASS ${passNumber} FAILED — ${errors.length} error(s):`);
    errors.forEach(e => console.log(`    • ${e}`));
  } else {
    console.log(`\n  ✅ PASS ${passNumber} CLEAN`);
  }
  return errors;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let consecutiveClean = 0;
  let totalRuns = 0;

  for (let i = 0; i < MEAD_IDEAS.length && consecutiveClean < TOTAL_PASSES; i++) {
    totalRuns++;
    const errors = await runPass(context, totalRuns, MEAD_IDEAS[i]);
    if (errors.length === 0) {
      consecutiveClean++;
    } else {
      consecutiveClean = 0;
    }
    console.log(`  Consecutive clean passes: ${consecutiveClean}/${TOTAL_PASSES}`);
  }

  console.log(`\n${"=".repeat(50)}`);
  if (consecutiveClean >= TOTAL_PASSES) {
    console.log(`SUCCESS: ${TOTAL_PASSES} consecutive clean passes achieved!`);
  } else {
    console.log(`INCOMPLETE: Only ${consecutiveClean} clean passes (need ${TOTAL_PASSES})`);
  }

  // Final check on vault contents
  if (consecutiveClean >= TOTAL_PASSES) {
    console.log("\nVerifying vault contents...");
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await delay(600);

    const archiveNames = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("meadevil-app-v2") || "{}");
      return (state.archive || []).map(a => a.batch?.name || "unnamed");
    });
    console.log(`Vault contains ${archiveNames.length} entries:`);
    archiveNames.forEach((name, i) => console.log(`  ${i + 1}. ${name}`));
    await page.close();
  }

  await context.close();
  await browser.close();
  process.exit(consecutiveClean >= TOTAL_PASSES ? 0 : 1);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(2);
});
