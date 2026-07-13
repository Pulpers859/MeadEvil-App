import { chromium } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BASE_URL = process.env.MEADEVIL_URL || "http://127.0.0.1:8912";
const STORAGE_KEY = "meadevil-app-v2";
const ENHANCEMENT_KEY = `${STORAGE_KEY}-meadevil-mentor`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wirePageErrors(page, bucket) {
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) bucket.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (error) => bucket.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    bucket.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || ""}`);
  });
}

async function openTab(page, tabId, expectedPanelId) {
  await page.locator(`#${tabId}`).click();
  await page.waitForFunction((panelId) => {
    const active = document.querySelector(".tab-panel.active");
    return active && active.id === panelId;
  }, expectedPanelId);
}

async function runDesktopFlow(downloadDir) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  wirePageErrors(page, errors);
  // Data-replacing actions (import, factory reset) confirm first through the
  // app's own modal (window.MeadEvilUI.confirm), not a native browser dialog.
  // The import flow below clicks that modal's confirm button explicitly. A
  // native-dialog handler is kept only as a safety net for any stray dialog.
  page.on("dialog", (dialog) => dialog.accept());

  const recipeName = `Smoke Recipe ${Date.now()}`;

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await openTab(page, "tab-btn-recipes", "tab-recipes");

  await page.fill("#recipeName", recipeName);
  await page.fill("#recipeBatchGallons", "3");
  await page.fill("#recipeTargetAbv", "12");
  await page.selectOption("#recipeSweetness", "Dry");
  await page.click("#saveRecipeBtn");

  await openTab(page, "tab-btn-archive", "tab-archive");
  await page.waitForFunction((name) => {
    const list = document.getElementById("recipeList");
    return list && list.textContent && list.textContent.includes(name);
  }, recipeName);

  await openTab(page, "tab-btn-nutrients", "tab-nutrients");
  await page.fill("#nutrientFruitOffset", "");
  await page.reload({ waitUntil: "networkidle" });
  await openTab(page, "tab-btn-nutrients", "tab-nutrients");
  await page.waitForFunction(() => document.getElementById("nutrientFruitOffset").value === "");
  await openTab(page, "tab-btn-recipes", "tab-recipes");
  await page.waitForFunction((name) => document.getElementById("recipeName").value === name, recipeName);

  await openTab(page, "tab-btn-archive", "tab-archive");
  const downloadPromise = page.waitForEvent("download");
  await page.click("#exportDataBtn");
  const download = await downloadPromise;
  const exportPath = path.join(downloadDir, `meadevil-export-${Date.now()}.json`);
  await download.saveAs(exportPath);

  const exported = JSON.parse(await fs.readFile(exportPath, "utf8"));
  assert(exported._schema?.app === "MeadEvil", "Export is missing app schema metadata.");
  assert(exported._schema?.version === 1, "Export schema version is not current.");
  assert(exported.data?.recipeDraft?.name === recipeName, "Export did not capture the recipe draft.");
  assert(Array.isArray(exported.data?.recipes) && exported.data.recipes.some((recipe) => recipe.name === recipeName), "Export did not capture saved recipes.");

  await page.evaluate(({ storageKey, enhancementKey }) => {
    localStorage.removeItem(storageKey);
    localStorage.removeItem(enhancementKey);
  }, { storageKey: STORAGE_KEY, enhancementKey: ENHANCEMENT_KEY });
  await page.reload({ waitUntil: "networkidle" });
  await openTab(page, "tab-btn-recipes", "tab-recipes");
  await page.waitForFunction(() => document.getElementById("recipeName").value === "");

  await page.setInputFiles("#importFileInput", exportPath);
  // The import replace-all confirm is now an in-app modal — confirm it so the
  // restore proceeds (a cancelled modal would leave the recipe name blank).
  const importConfirm = page.locator(".modal-backdrop .btn-danger");
  await importConfirm.waitFor({ state: "visible" });
  await importConfirm.click();
  await page.waitForFunction((name) => document.getElementById("recipeName").value === name, recipeName);
  await openTab(page, "tab-btn-archive", "tab-archive");
  await page.waitForFunction((name) => {
    const list = document.getElementById("recipeList");
    return list && list.textContent && list.textContent.includes(name);
  }, recipeName);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, "Desktop viewport overflow detected.");
  assert(errors.length === 0, `Desktop flow produced browser errors:\n${errors.join("\n")}`);

  await context.close();
  await browser.close();
}

async function runMobileFlow() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  wirePageErrors(page, errors);

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  const tabs = [
    ["tab-btn-meadmaker", "tab-meadmaker"],
    ["tab-btn-recipes", "tab-recipes"],
    ["tab-btn-ferment", "tab-ferment"],
    ["tab-btn-nutrients", "tab-nutrients"],
    ["tab-btn-cellar", "tab-cellar"],
    ["tab-btn-archive", "tab-archive"]
  ];

  for (const [tabId, panelId] of tabs) {
    await openTab(page, tabId, panelId);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert(!overflow, `Mobile overflow detected on ${panelId}.`);
  }

  await openTab(page, "tab-btn-recipes", "tab-recipes");
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(100);
  await openTab(page, "tab-btn-ferment", "tab-ferment");
  const tabSwitchScrollY = await page.evaluate(() => window.scrollY);
  assert(tabSwitchScrollY <= 8, `Tab navigation did not reset scroll position (scrollY=${tabSwitchScrollY}).`);

  assert(errors.length === 0, `Mobile flow produced browser errors:\n${errors.join("\n")}`);
  await context.close();
  await browser.close();
}

async function main() {
  const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), "meadevil-smoke-"));
  try {
    await runDesktopFlow(downloadDir);
    await runMobileFlow();
    console.log(JSON.stringify({ ok: true, url: BASE_URL, schemaVersion: 1 }, null, 2));
  } finally {
    await fs.rm(downloadDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
