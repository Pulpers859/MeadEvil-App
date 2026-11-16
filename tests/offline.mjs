/**
 * MeadEvil offline test — the app must open, with its data, with no network.
 *
 * Run with the dev server up:  node tests/offline.mjs
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8910";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(name, ok, detail = "") {
  if (ok) console.log(`  ✅ ${name}`);
  else { console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); failures.push(name); }
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: "allow" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  console.log("\n[1] First visit installs the offline shell");
  // The suites normally run with the worker off; ?sw=1 opts in.
  await page.goto(`${BASE}/?sw=1`, { waitUntil: "load" });
  const ready = await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then(() => true),
    new Promise((r) => setTimeout(() => r(false), 8000))
  ]));
  check("service worker is active", ready);
  await delay(800);
  const cached = await page.evaluate(async () => {
    const cache = await caches.open("meadevil-shell-v1");
    return (await cache.keys()).map((req) => new URL(req.url).pathname);
  });
  for (const file of ["/index.html", "/assets/js/app.js", "/assets/css/styles.css", "/assets/js/firebase-sync.js", "/manifest.webmanifest"]) {
    check(`precached ${file}`, cached.includes(file), cached.join(" "));
  }

  await page.$eval('button.tab-btn[data-tab="recipes"]', (b) => b.click());
  for (const [sel, value] of [["#recipeName", "Cellar Dweller"], ["#recipeBatchGallons", "3"], ["#recipeTargetAbv", "12"]]) {
    await page.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, value);
  }
  await page.$eval("#saveRecipeBtn", (b) => b.click());
  await delay(400);

  console.log("\n[2] With no network the app still opens, with its data");
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await delay(1500);
  check("page rendered the app, not a browser error", await page.evaluate(() => Boolean(document.querySelector("#tab-recipes") && document.querySelector(".tab-btn"))));
  check("stylesheet applied", await page.evaluate(() => {
    const sheet = Array.from(document.styleSheets).find((item) => /assets\/css\/styles\.css/.test(item.href || ""));
    return Boolean(sheet && sheet.cssRules.length > 100) && getComputedStyle(document.querySelector(".tab-btn")).borderRadius !== "0px";
  }));
  check("app script booted (tabs respond)", await page.evaluate(() => {
    document.querySelector('button.tab-btn[data-tab="archive"]').click();
    return document.querySelector("#tab-archive").classList.contains("active");
  }));
  check("saved recipe is there", (await page.$eval("#tab-archive", (el) => el.textContent)).includes("Cellar Dweller"));
  check("the draft is still in Build", await page.evaluate(() => document.querySelector("#recipeName").value === "Cellar Dweller"));

  // Work done offline must persist offline.
  await page.$eval('button.tab-btn[data-tab="cellar"]', (b) => b.click());
  await page.$eval("#cellarCurrentPh", (el) => { el.value = "3.5"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await delay(300);
  await page.reload({ waitUntil: "domcontentloaded" });
  await delay(1200);
  check("an edit made offline survives another offline reload", await page.evaluate(() => JSON.parse(localStorage.getItem("meadevil-app-v2")).data.cellar.currentPh === "3.5"));
  check("a deep link with a query string still gets the shell", await page.goto(`${BASE}/?source=homescreen`, { waitUntil: "domcontentloaded" }).then((r) => r && r.status() === 200).catch(() => false));
  check("no uncaught JS errors while offline", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log("\n[3] Live services are never answered from cache");
  const mentor = await page.evaluate(() => fetch("/.netlify/functions/meadevil-mentor", { method: "POST", body: "{}" }).then((r) => r.status).catch(() => "network-error"));
  check("mentor call fails honestly offline", mentor === "network-error", String(mentor));
  const rapt = await page.evaluate(() => fetch("/.netlify/functions/rapt-bridge?x=1").then((r) => r.status).catch(() => "network-error"));
  check("RAPT bridge GET is not served from cache", rapt === "network-error", String(rapt));

  console.log("\n[4] Back online, the deployed files win over the cache");
  await context.setOffline(false);
  const fromNetwork = await page.evaluate(async () => {
    const response = await fetch("assets/js/app.js", { cache: "no-store" });
    return response.ok && (await response.text()).length > 100000;
  });
  check("same-origin files are fetched from the network when it is there", fromNetwork);

  await browser.close();
  console.log("\n" + "=".repeat(50));
  if (failures.length) { console.log(`OFFLINE: ${failures.length} FAILURE(S)`); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
  console.log("ALL OFFLINE CHECKS PASSED");
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
