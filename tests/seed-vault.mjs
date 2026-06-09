/**
 * Seeds the 5 stress-test mead recipes into the app's vault
 * Opens the app in a real browser, injects the archive data, and closes.
 */
import { chromium } from "playwright";
import { writeFileSync } from "fs";

const BASE = "http://127.0.0.1:8910";

const ARCHIVE_ENTRIES = [
  {
    name: "Crimson Velvet Cyser",
    style: "Cyser",
    batchGallons: "3",
    targetAbv: "14",
    sweetness: "Semi-sweet",
    carbonation: "Still",
    yeast: "71B",
    dryYeast: "5",
    tags: "apple, fall, dessert",
    quickNote: "Apple cider base with wildflower honey",
    notes: "Press fresh apple cider day-of. Use wildflower honey. Add cinnamon stick in secondary.",
    tastingNotes: "Bright apple up front, honey warmth, dry finish with gentle tannin.",
    og: "1.120",
    fg: "0.998",
    logs: [
      { gravity: "1.120", temp: "68", pH: "3.8", note: "Pitch day — vigorous start" },
      { gravity: "1.080", temp: "66", pH: "3.6", note: "1/3 sugar break" },
      { gravity: "1.040", temp: "65", pH: "3.5", note: "2/3 break, aroma mellowing" },
      { gravity: "1.010", temp: "64", pH: "3.4", note: "Nearing FG, slowing down" },
      { gravity: "0.998", temp: "64", pH: "3.35", note: "Dry — rack to secondary" }
    ]
  },
  {
    name: "Ghost Pepper Bochet",
    style: "Bochet",
    batchGallons: "1",
    targetAbv: "16",
    sweetness: "Dry",
    carbonation: "Still",
    yeast: "EC-1118",
    dryYeast: "3",
    tags: "spicy, bochet, extreme",
    quickNote: "Caramelized honey with ghost pepper heat",
    notes: "Caramelize honey 90min to deep mahogany. Ghost pepper in secondary — 1 dried pod per gallon, taste daily.",
    tastingNotes: "Dark caramel, toffee, lingering ghost pepper burn on the finish.",
    og: "1.140",
    fg: "1.002",
    logs: [
      { gravity: "1.140", temp: "72", pH: "3.9", note: "Pitch — caramelized must is dark" },
      { gravity: "1.100", temp: "70", pH: "3.7", note: "Strong ferment, sulfur off-gas" },
      { gravity: "1.060", temp: "69", pH: "3.5", note: "Past 1/3 break" },
      { gravity: "1.020", temp: "68", pH: "3.4", note: "Slowing, still bubbling" },
      { gravity: "1.002", temp: "67", pH: "3.3", note: "Bone dry, racked off lees" }
    ]
  },
  {
    name: "Lavender Sunset Metheglin",
    style: "Metheglin",
    batchGallons: "5",
    targetAbv: "12",
    sweetness: "Semi-sweet",
    carbonation: "Carbonated",
    yeast: "D47",
    dryYeast: "7.5",
    tags: "floral, spring, elegant",
    quickNote: "Lavender and chamomile with orange blossom honey",
    notes: "Orange blossom honey base. Lavender buds in secondary (2 tbsp/gal). Chamomile tea steep at kegging.",
    tastingNotes: "Elegant floral nose, honey mid-palate, light effervescence, clean finish.",
    og: "1.100",
    fg: "1.008",
    logs: [
      { gravity: "1.100", temp: "62", pH: "3.7", note: "Pitch day, gentle start" },
      { gravity: "1.070", temp: "63", pH: "3.55", note: "Steady ferment" },
      { gravity: "1.040", temp: "62", pH: "3.45", note: "1/3 break" },
      { gravity: "1.015", temp: "62", pH: "3.4", note: "Approaching target" },
      { gravity: "1.008", temp: "61", pH: "3.35", note: "FG reached — transfer" }
    ]
  },
  {
    name: "Blood Orange Melomel",
    style: "Melomel",
    batchGallons: "3",
    targetAbv: "13",
    sweetness: "Dry",
    carbonation: "Still",
    yeast: "QA23",
    dryYeast: "5",
    tags: "citrus, winter, bold",
    quickNote: "Blood orange zest and juice with wildflower",
    notes: "Wildflower honey. Blood orange juice in primary, zest in secondary. Expect haze — cold crash before bottling.",
    tastingNotes: "Bright citrus, balanced acidity, dry honey backbone, winter sipper.",
    og: "1.110",
    fg: "0.996",
    logs: [
      { gravity: "1.110", temp: "65", pH: "3.5", note: "Pitch — orange must looks amazing" },
      { gravity: "1.075", temp: "64", pH: "3.4", note: "Active, citrus aroma" },
      { gravity: "1.045", temp: "64", pH: "3.35", note: "Past 1/3 break" },
      { gravity: "1.010", temp: "63", pH: "3.3", note: "Slowing" },
      { gravity: "0.996", temp: "63", pH: "3.25", note: "Dry — rack, add zest" }
    ]
  },
  {
    name: "Viking's Braggot",
    style: "Braggot",
    batchGallons: "5",
    targetAbv: "10",
    sweetness: "Dry",
    carbonation: "Carbonated",
    yeast: "EC-1118",
    dryYeast: "8",
    tags: "grain, session, norse",
    quickNote: "Half honey half malt — sessionable braggot",
    notes: "50/50 honey and light DME. Grain-forward, sessionable. Hop with a small dose of Saaz for spice.",
    tastingNotes: "Biscuit malt, honey sweetness, light hop spice, refreshing and drinkable.",
    og: "1.080",
    fg: "1.004",
    logs: [
      { gravity: "1.080", temp: "68", pH: "4.2", note: "Pitch — malt and honey blended" },
      { gravity: "1.055", temp: "67", pH: "4.0", note: "Active" },
      { gravity: "1.030", temp: "66", pH: "3.8", note: "Halfway" },
      { gravity: "1.012", temp: "65", pH: "3.7", note: "Slowing" },
      { gravity: "1.004", temp: "65", pH: "3.6", note: "FG — ready to carb" }
    ]
  }
];

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

async function main() {
  const browser = await chromium.launch({ headless: false, channel: "msedge" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await new Promise(r => setTimeout(r, 1000));

  const result = await page.evaluate((entries) => {
    function makeId(prefix) {
      return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    }

    const state = JSON.parse(localStorage.getItem("meadevil-app-v2") || "{}");
    if (!state.archive) state.archive = [];

    const existingNames = new Set(state.archive.map(a => a.batch?.name));

    entries.forEach(entry => {
      if (existingNames.has(entry.name)) return;

      const batch = {
        recipeId: makeId("rec"),
        name: entry.name,
        style: entry.style,
        batchGallons: entry.batchGallons,
        targetAbv: entry.targetAbv,
        sweetness: entry.sweetness,
        carbonation: entry.carbonation,
        yeast: entry.yeast,
        yeastOther: "",
        yeastTolerance: "",
        temp: "",
        nitrogenRequirement: "low",
        dryYeast: entry.dryYeast,
        honeyPPG: "35",
        quickNote: entry.quickNote,
        notes: entry.notes,
        tags: entry.tags,
        targetOg: entry.og,
        targetFg: entry.fg,
        additions: [],
        structureAdditions: [],
        pitchDate: "2026-06-01",
        phase: "complete",
        loadedAt: new Date().toISOString()
      };

      const logs = entry.logs.map((log, i) => ({
        id: makeId("log"),
        date: new Date(Date.now() - (entry.logs.length - i) * 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        gravity: log.gravity,
        temp: log.temp,
        pH: log.pH,
        note: log.note,
        createdAt: new Date().toISOString()
      }));

      state.archive.unshift({
        id: makeId("arch"),
        archivedAt: new Date().toISOString(),
        batch,
        fermentationLogs: logs,
        fermentChecklist: [],
        nutrients: { protocol: "tosna", batchGallons: entry.batchGallons, og: entry.og },
        cellar: { tastingNotes: entry.tastingNotes, rating: "4", tags: entry.tags, wouldMakeAgain: true },
        cellarChecklist: [],
        summary: entry.tastingNotes
      });
    });

    localStorage.setItem("meadevil-app-v2", JSON.stringify(state));
    return state.archive.map(a => a.batch?.name);
  }, ARCHIVE_ENTRIES);

  console.log("Vault now contains:");
  result.forEach((name, i) => console.log(`  ${i + 1}. ${name}`));

  // Navigate to vault tab so user can see them
  await page.$eval('button.tab-btn[data-tab="archive"]', btn => btn.click());
  await new Promise(r => setTimeout(r, 500));

  console.log("\nDone! Recipes are in the vault. Close the browser when ready.");
  // Keep browser open for user to verify
  await new Promise(r => setTimeout(r, 30000));
  await context.close();
  await browser.close();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
