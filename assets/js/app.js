(function(){
  "use strict";

  const STORAGE_KEY = "meadevil-app-v2";
  const ENHANCEMENT_KEY = STORAGE_KEY + "-meadevil-mentor";
  const MeadLogic = window.MeadLogic || {};
  const {
    round,
    calcABV,
    sgToBrix,
    brixToSg,
    calcOneThirdBreak,
    estimateHoneyForTargetOG,
    estimateOGFromHoney,
    estimateRecipeTargets,
    calculateFermenterVolumeEstimate,
    calculateTosna,
    suggestYanPpm,
    calculateAdvancedNutrients,
    calculateGoFerm,
    calculateBacksweetening,
    calculateBottleCount,
    calculateBlend,
    calculateBenchTrial,
    calculateStepFeed,
    calculateSourceBill,
    calculateStabilizers
  } = MeadLogic;

  const $ = (id) => document.getElementById(id);
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const makeId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  let trendHoverPoints = [];
  const RAPT_AUTO_REFRESH_MS = 20 * 60 * 1000;
  const RAPT_VISIBILITY_REFRESH_STALE_MS = 45 * 60 * 1000;

  const YEAST_PRESETS = {
    "71B": { tolerance: "14", temp: "59–86°F", nitrogenRequirement: "low" },
    "D47": { tolerance: "15", temp: "59–86°F", nitrogenRequirement: "low" },
    "QA23": { tolerance: "16", temp: "57–82°F", nitrogenRequirement: "low" },
    "EC-1118": { tolerance: "18", temp: "50–86°F", nitrogenRequirement: "low" }
  };
  // Fold the full strain library (assets/js/yeast-data.js) into the presets.
  // The four literals above stay as a fallback if that script fails to load.
  if (Array.isArray(window.MeadYeasts)){
    window.MeadYeasts.forEach((strain) => {
      if (!strain || !strain.name) return;
      YEAST_PRESETS[strain.name] = {
        tolerance: String(strain.tolerance),
        temp: `${strain.lowTempF}–${strain.highTempF}°F`,
        nitrogenRequirement: String(strain.nitrogenRequirement || "medium").toLowerCase(),
        brand: strain.brand || ""
      };
    });
  }

  const SOURCE_PRESETS = {
    "Honey": { ppg: "35", unit: "lb", locked: true },
    "Maple Syrup": { ppg: "29.8", unit: "lb", locked: true },
    "Table Sugar": { ppg: "46", unit: "lb", locked: true },
    "Juice (single strength)": { ppg: "5", unit: "lb", locked: true },
    "Juice Concentrate": { ppg: "48", unit: "lb", locked: true },
    "Fruit / Puree": { ppg: "10", unit: "lb", locked: true },
    "Custom": { ppg: "", unit: "lb", locked: false }
  };

  const CSV_SOURCE_SLOTS = 6;
  const CELLAR_ADDITION_UNITS = ["g","mL","oz","lb","tsp","tbsp","each","drops","sticks","pods","whole fruit","sachets"];
  const RECIPE_SOURCE_FIELDS = new Set(["sourceType","description","amount","unit","ppg"]);
  const CELLAR_ADDITION_FIELDS = new Set(["type","purpose","amount","unit","notes"]);
  const MENTOR_DEFAULT_BATCH_GAL = 3;
  const MENTOR_DEFAULT_ABV = 12;
  const RECIPE_STYLE_OPTIONS = ["Traditional","Melomel","Hydromel","Metheglin","Sack Mead","Cyser","Pyment","Bochet","Acerglyn","Braggot","Other"];

  const MENTOR_HONEY_KB = [
    {
      name: "Orange Blossom",
      aliases: ["orange blossom", "citrus blossom"],
      profile: "citrus-floral lift and bright aromatic top notes",
      bestUse: "tropical, tequila-inspired, and bright fruit meads",
      watch: "can read thin if structure is underbuilt"
    },
    {
      name: "Wildflower",
      aliases: ["wildflower"],
      profile: "balanced floral and herbaceous honey backbone",
      bestUse: "flexible base for most mead styles",
      watch: "quality varies by source lot"
    },
    {
      name: "Meadowfoam",
      aliases: ["meadowfoam"],
      profile: "marshmallow, vanilla, and toasted sugar notes",
      bestUse: "dessert and coconut-adjacent concepts",
      watch: "can dominate subtle fruit if overused"
    },
    {
      name: "Avocado",
      aliases: ["avocado honey", "avocado"],
      profile: "dark caramel and toasted wood depth",
      bestUse: "oak, cacao, and darker adjunct builds",
      watch: "needs acid lift to avoid heaviness"
    },
    {
      name: "Buckwheat",
      aliases: ["buckwheat"],
      profile: "earthy molasses-like punch",
      bestUse: "aggressive concepts needing a loud honey voice",
      watch: "too much can become muddy quickly"
    },
    {
      name: "Clover",
      aliases: ["clover"],
      profile: "neutral honey sweetness and clean fermentability",
      bestUse: "base layer when adjuncts do the heavy lifting",
      watch: "can feel generic without clear structure"
    },
    {
      name: "Tupelo",
      aliases: ["tupelo"],
      profile: "clean floral honey with elegant sweetness",
      bestUse: "honey-forward and off-dry still meads",
      watch: "cost can be high and supply can be limited"
    },
    {
      name: "Acacia",
      aliases: ["acacia"],
      profile: "light, delicate, and softly floral",
      bestUse: "session meads and delicate floral profiles",
      watch: "easy to bury under strong adjuncts"
    },
    {
      name: "Sage",
      aliases: ["sage honey", "sage"],
      profile: "clean herbal sweetness with subtle spice",
      bestUse: "botanical and citrus-forward meads",
      watch: "can seem plain if acidity is too low"
    },
    {
      name: "Blackberry Blossom",
      aliases: ["blackberry blossom", "blackberry honey"],
      profile: "jammy berry undertone with floral lift",
      bestUse: "berry melomels and dark-fruit builds",
      watch: "fruit additions can mask it if extraction is heavy"
    },
    {
      name: "Blueberry Blossom",
      aliases: ["blueberry blossom", "blueberry honey"],
      profile: "soft berry floral aroma and gentle sweetness",
      bestUse: "blue fruit and violet/floral concepts",
      watch: "can lose signature in high ABV builds"
    },
    {
      name: "Raspberry Blossom",
      aliases: ["raspberry blossom", "raspberry honey"],
      profile: "bright floral-red fruit tone",
      bestUse: "lively fruit meads and sparkling lanes",
      watch: "needs temperature control to keep aromatics intact"
    },
    {
      name: "Star Thistle",
      aliases: ["star thistle", "thistle honey"],
      profile: "toffee-like sweetness with mild floral notes",
      bestUse: "dessert and medium-bodied traditional meads",
      watch: "can drift heavy without acid structure"
    },
    {
      name: "Basswood (Linden)",
      aliases: ["basswood", "linden"],
      profile: "minty-lime floral edge over clean honey core",
      bestUse: "citrus and herb-accented meads",
      watch: "polarizing profile if overdosed"
    },
    {
      name: "Fireweed",
      aliases: ["fireweed"],
      profile: "light floral, soft fruit, and clean finish",
      bestUse: "bright traditional and light melomel bases",
      watch: "too subtle for heavy oak/spice programs"
    },
    {
      name: "Gallberry",
      aliases: ["gallberry"],
      profile: "rich but clean southern wild profile",
      bestUse: "full-bodied traditional or semi-sweet still meads",
      watch: "requires good oxygen/temperature management for clean ferment"
    },
    {
      name: "Eucalyptus",
      aliases: ["eucalyptus"],
      profile: "resinous herbal top note with deep sweetness",
      bestUse: "bold botanical concepts and dark structure builds",
      watch: "can dominate delicate fruit quickly"
    },
    {
      name: "Heather",
      aliases: ["heather"],
      profile: "aromatic floral-earth complexity",
      bestUse: "high-character sipping meads",
      watch: "intense profile can read medicinal if misbalanced"
    },
    {
      name: "Chestnut",
      aliases: ["chestnut"],
      profile: "tannic, nutty, and savory honey depth",
      bestUse: "structured meads with oak or cacao accents",
      watch: "needs sweetness and acid tuning to avoid bitterness"
    }
  ];

  const MENTOR_YEAST_KB = [
    {
      name: "71B",
      aliases: ["71b", "lalvin 71b"],
      lane: "fruit-softening and round mid palate",
      watch: "can flatten brightness if fermentation runs too warm"
    },
    {
      name: "D47",
      aliases: ["d47", "lalvin d47"],
      lane: "full texture and classic still mead profile",
      watch: "temperature drift can throw fusels"
    },
    {
      name: "QA23",
      aliases: ["qa23", "qa-23", "lalvin qa23"],
      lane: "citrus and tropical aromatic expression",
      watch: "needs solid nutrition and temp control to stay clean"
    },
    {
      name: "EC-1118",
      aliases: ["ec-1118", "ec1118", "champagne yeast"],
      lane: "high alcohol reliability and dry finishes",
      watch: "can strip subtle aromatics if concept needs delicacy"
    }
  ];

  const MENTOR_ADJUNCT_KB = [
    {
      key: "toasted_coconut",
      name: "Toasted Coconut",
      aliases: ["toasted coconut", "coconut", "coconut flakes", "coco"],
      stage: "secondary extraction",
      unit: "oz",
      perGalMin: 0.7,
      perGalMax: 1.3,
      flavor: "toasted nut, cream, and confection depth",
      role: "build the coconut core without sunscreen character",
      caution: "overdosing gets waxy and artificial"
    },
    {
      key: "lime_zest",
      name: "Lime Zest",
      aliases: ["lime zest", "lime peel", "lime"],
      stage: "late secondary",
      unit: "whole-lime-zests",
      perGalMin: 0.4,
      perGalMax: 1.0,
      flavor: "high citrus snap and fresh aromatics",
      role: "cuts sweetness and creates tequila-adjacent brightness",
      caution: "avoid pith pickup and long contact times"
    },
    {
      key: "orange_peel",
      name: "Orange Peel",
      aliases: ["orange peel", "orange zest", "orange"],
      stage: "late secondary",
      unit: "whole-orange-zests",
      perGalMin: 0.25,
      perGalMax: 0.8,
      flavor: "sweet citrus bridge",
      role: "rounds sharp citrus edges",
      caution: "too much drifts into marmalade bitterness"
    },
    {
      key: "vanilla_bean",
      name: "Vanilla Bean",
      aliases: ["vanilla bean", "vanilla"],
      stage: "secondary finishing",
      unit: "beans",
      perGalMin: 0.18,
      perGalMax: 0.35,
      flavor: "soft sweetness illusion and polish",
      role: "connects coconut and honey",
      caution: "can mute freshness when overdone"
    },
    {
      key: "american_oak",
      name: "American Oak (medium toast)",
      aliases: ["oak", "american oak", "oak cubes", "barrel"],
      stage: "secondary structure",
      unit: "oz",
      perGalMin: 0.12,
      perGalMax: 0.3,
      flavor: "vanillin, coconut, and tannin line",
      role: "shape the finish and tighten sweetness",
      caution: "small batches over-oak fast"
    },
    {
      key: "agave_syrup",
      name: "Agave Syrup",
      aliases: ["agave", "agave syrup", "agave nectar", "tequila"],
      stage: "bench-trial backsweetening",
      unit: "oz",
      perGalMin: 0.3,
      perGalMax: 1.1,
      flavor: "agave-like flavor bridge",
      role: "reinforces tequila inspiration without adding spirits",
      caution: "pushes cloying quickly if acid is low"
    },
    {
      key: "sea_salt",
      name: "Sea Salt (micro dose)",
      aliases: ["salt", "sea salt", "saline"],
      stage: "bench-trial only",
      unit: "g",
      perGalMin: 0.05,
      perGalMax: 0.18,
      flavor: "palate width and finish lift",
      role: "adds snap when sweetness feels broad",
      caution: "easy to ruin a batch if not bench-tested"
    }
  ];

  const MENTOR_ARCHETYPE_KB = [
    {
      key: "tequila_coconut",
      aliases: ["tequila", "agave", "margarita", "tiki", "coconut", "lime"],
      lead: "toasted coconut and citrus-agave illusion over visible honey",
      recipeStyle: "Metheglin",
      defaultHoney: "Orange Blossom",
      defaultYeast: "QA23",
      defaultAbv: 12.5,
      defaultSweetness: "Semi-sweet",
      acidPlan: "Bright acid line with a clean, clipped finish. Post-ferment pH usually lands best around 3.45-3.60.",
      tanninPlan: "Light tannin frame only. Enough grip for shape, not enough to read woody.",
      packaging: "Usually strongest as still mead with a light chill."
    },
    {
      key: "fruit_dark",
      aliases: ["cherry", "berry", "plum", "currant", "dark fruit"],
      lead: "ripe fruit core with honey still audible underneath",
      recipeStyle: "Melomel",
      defaultHoney: "Wildflower",
      defaultYeast: "71B",
      defaultAbv: 12,
      defaultSweetness: "Semi-sweet",
      acidPlan: "Use acid to sharpen fruit edges; sweetness alone will read jammy.",
      tanninPlan: "Build tannin in small steps to avoid drying out fruit aromatics.",
      packaging: "Still or petillant depending on fruit intensity."
    },
    {
      key: "dessert_spice",
      aliases: ["dessert", "vanilla", "cinnamon", "spice", "rich", "lush"],
      lead: "dessert texture with disciplined sweetness and spice contour",
      recipeStyle: "Metheglin",
      defaultHoney: "Meadowfoam",
      defaultYeast: "D47",
      defaultAbv: 13,
      defaultSweetness: "Sweet",
      acidPlan: "Do not skip acid support or the finish goes flabby.",
      tanninPlan: "Use light oak or tea tannin to keep sweetness from collapsing.",
      packaging: "Best still and bottle-aged."
    },
    {
      key: "honey_first",
      aliases: ["traditional", "show mead", "honey forward", "honey-first"],
      lead: "clean fermentation with honey as the lead actor",
      recipeStyle: "Traditional",
      defaultHoney: "Orange Blossom",
      defaultYeast: "D47",
      defaultAbv: 12,
      defaultSweetness: "Off-dry",
      acidPlan: "Minimal intervention: just enough acid to keep line and length.",
      tanninPlan: "Micro-dose tannin only if finish feels hollow.",
      packaging: "Still with enough age to settle rough edges."
    }
  ];

  function escapeHTML(value){
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function copyText(text){
    if (!text) return;
    navigator.clipboard.writeText(text).catch(() => {});
  }

  function formatDateTime(value){
    if (!value) return "—";
    const date = new Date(value);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }

  function formatDate(value){
    if (!value) return "—";
    return new Date(value).toLocaleDateString();
  }

  function formatCompactDateTime(value){
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }

  function formatLogTimestamp(log){
    if (!log) return "—";
    if (log.telemetryAt) return formatDateTime(log.telemetryAt);
    if (log.date) return formatDate(log.date);
    return formatDateTime(log.createdAt);
  }

  function renderRows(id, rows){
    const el = $(id);
    if (!el) return;
    el.innerHTML = rows.map(([label, value]) => `
      <div class="info-row">
        <div class="info-row-label">${escapeHTML(label)}</div>
        <div class="info-row-value">${typeof value === "string" ? value : escapeHTML(String(value ?? "—"))}</div>
      </div>
    `).join("");
  }

  function emptyState(title, body, tone = "calm", kicker = "Waiting"){
    const toneClass = tone && tone !== "calm" ? ` ${tone}` : "";
    return `
      <div class="empty-state${toneClass}">
        <div class="empty-state-kicker">${escapeHTML(kicker)}</div>
        <div class="empty-state-title">${escapeHTML(title)}</div>
        <div class="empty-state-body">${escapeHTML(body)}</div>
      </div>
    `;
  }

  function sortLogsDescending(logs){
    return clone(logs || []).sort((a, b) => {
      const aTime = new Date(`${a.date}T00:00:00`).getTime();
      const bTime = new Date(`${b.date}T00:00:00`).getTime();
      if (aTime !== bTime) return bTime - aTime;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  function sortLogsAscending(logs){
    return sortLogsDescending(logs).reverse();
  }

  function logTimelineTime(log){
    if (!log) return null;
    if (log.telemetryAt) {
      const telemetryTime = new Date(log.telemetryAt).getTime();
      if (Number.isFinite(telemetryTime)) return telemetryTime;
    }
    if (log.date) {
      const dateOnlyTime = new Date(`${log.date}T12:00:00`).getTime();
      if (Number.isFinite(dateOnlyTime)) return dateOnlyTime;
    }
    const createdTime = new Date(log.createdAt || "").getTime();
    return Number.isFinite(createdTime) ? createdTime : null;
  }

  function fermentationOg(){
    const preferred = [
      Number(data.currentBatch.targetOg),
      Number(data.nutrients.og)
    ].find((value) => Number.isFinite(value) && value > 0);
    if (preferred) return preferred;

    // No recorded OG: the best stand-in is the highest gravity ever logged,
    // not the most recent one (which trends toward FG as fermentation runs).
    const highestLog = data.fermentationLogs
      .map((entry) => Number(entry.gravity))
      .filter((value) => Number.isFinite(value) && value > 0)
      .reduce((max, value) => Math.max(max, value), 0);
    return highestLog || null;
  }

  function buildFermentationTrendModel(logs){
    const ordered = sortLogsAscending(logs)
      .map((log) => {
        const gravity = Number(log.gravity);
        const temp = Number(log.temp);
        const time = logTimelineTime(log);
        return {
          ...log,
          gravity: Number.isFinite(gravity) ? gravity : null,
          temp: Number.isFinite(temp) ? temp : null,
          time: Number.isFinite(time) ? time : null
        };
      })
      .filter((log) => log.time);

    if (!ordered.length) return null;

    const og = fermentationOg();
    const points = ordered.map((log) => ({
      time: log.time,
      label: formatDate(log.date),
      gravity: log.gravity,
      temp: log.temp,
      abv: og && log.gravity ? calcABV(og, log.gravity) : null
    }));

    const gravityValues = points.map((point) => point.gravity).filter((value) => Number.isFinite(value));
    const tempValues = points.map((point) => point.temp).filter((value) => Number.isFinite(value));
    const abvValues = points.map((point) => point.abv).filter((value) => Number.isFinite(value));

    return {
      points,
      gravityValues,
      tempValues,
      abvValues,
      startLabel: points[0].label,
      endLabel: points[points.length - 1].label
    };
  }

  function seriesPath(points, key, xAt, yAt){
    const plotted = points.filter((point) => Number.isFinite(point[key]));
    if (!plotted.length) return "";
    return plotted.map((point, index) => `${index ? "L" : "M"} ${xAt(point.time).toFixed(1)} ${yAt(point[key]).toFixed(1)}`).join(" ");
  }

  function trendScale(values, options = {}){
    const {
      fallbackMin = 0,
      fallbackMax = 1,
      minPadding = 0.15,
      paddingRatio = 0.08
    } = options;
    const source = values.length ? values : [fallbackMin, fallbackMax];
    const min = Math.min(...source);
    const max = Math.max(...source);
    const padding = min === max
      ? Math.max(Math.abs(min * paddingRatio), minPadding)
      : Math.max((max - min) * paddingRatio, minPadding);
    return {
      min,
      max,
      safeMin: min - padding,
      safeMax: max + padding
    };
  }

  function scaleY(value, scale, top, height){
    return top + ((scale.safeMax - value) / (scale.safeMax - scale.safeMin)) * height;
  }

  function axisTicks(scale, count = 4){
    return Array.from({ length: count }, (_, index) => {
      const ratio = count === 1 ? 0 : (index / (count - 1));
      return scale.safeMin + ((scale.safeMax - scale.safeMin) * (1 - ratio));
    });
  }

  function trendSeriesConfig(){
    return {
      gravity: {
        label: "Gravity",
        swatch: "gravity",
        color: "#ffb34d",
        digits: 3,
        suffix: "",
        visible: data.rapt.showGravityTrend !== false
      },
      temp: {
        label: "Temp",
        swatch: "temp",
        color: "#4fc3f7",
        digits: 1,
        suffix: "°F",
        visible: data.rapt.showTempTrend !== false
      },
      abv: {
        label: "Est. ABV",
        swatch: "abv",
        color: "#ff6d9d",
        digits: 1,
        suffix: "%",
        visible: data.rapt.showAbvTrend !== false
      }
    };
  }

  function renderTrendTooltip(point, left, top){
    const tooltip = $("fermentationTrendTooltip");
    if (!tooltip || !point) return;
    tooltip.innerHTML = [
      `<strong>${escapeHTML(formatCompactDateTime(point.when))}</strong>`,
      Number.isFinite(point.gravity) ? `<div>Gravity <strong>${escapeHTML(String(round(point.gravity, 3)))}</strong></div>` : "",
      Number.isFinite(point.temp) ? `<div>Temp <strong>${escapeHTML(String(round(point.temp, 1)))}°F</strong></div>` : "",
      Number.isFinite(point.abv) ? `<div>Est. ABV <strong>${escapeHTML(String(round(point.abv, 1)))}%</strong></div>` : "",
      point.source === "rapt" ? `<div class="muted">Source: RAPT Pill</div>` : `<div class="muted">Source: manual log</div>`
    ].filter(Boolean).join("");
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.hidden = false;
  }

  function hideTrendTooltip(){
    const tooltip = $("fermentationTrendTooltip");
    if (!tooltip) return;
    tooltip.hidden = true;
  }

  function renderFermentationTrend(logs){
    const summary = $("fermentationTrendSummary");
    const chart = $("fermentationTrendChart");
    if (!summary || !chart) return;

    const model = buildFermentationTrendModel(logs);
    if (!model || model.points.length < 2){
      trendHoverPoints = [];
      summary.innerHTML = "";
      chart.innerHTML = emptyState("Trend graph waiting", "Add at least two readings before the fermentation curve can mean anything.", "focus", "Trend");
      return;
    }

    const series = trendSeriesConfig();
    const width = 760;
    const height = 360;
    const padding = { top: 26, right: 88, bottom: 38, left: 58 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const minTime = Math.min(...model.points.map((point) => point.time));
    const maxTime = Math.max(...model.points.map((point) => point.time));

    const xAt = (value) => {
      if (maxTime === minTime) return padding.left + (innerWidth / 2);
      return padding.left + (((value - minTime) / (maxTime - minTime)) * innerWidth);
    };
    const gravityScale = trendScale(model.gravityValues, { fallbackMin: 0.99, fallbackMax: 1.12, minPadding: 0.002, paddingRatio: 0.14 });
    const tempScale = trendScale(model.tempValues, { fallbackMin: 58, fallbackMax: 72, minPadding: 0.3, paddingRatio: 0.12 });
    const abvScale = trendScale(model.abvValues, { fallbackMin: 0, fallbackMax: 14, minPadding: 0.2, paddingRatio: 0.14 });

    const gridTicks = axisTicks(gravityScale, 5);
    const gridLines = gridTicks.map((tick) => {
      const y = scaleY(tick, gravityScale, padding.top, innerHeight);
      return `<line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}" stroke="rgba(244,230,208,0.08)" stroke-width="1" />`;
    }).join("");

    const verticalLines = model.points.map((point) => {
      const x = xAt(point.time);
      return `<line x1="${x.toFixed(1)}" y1="${padding.top}" x2="${x.toFixed(1)}" y2="${height - padding.bottom}" stroke="rgba(244,230,208,0.04)" stroke-width="1" />`;
    }).join("");

    const gravityPath = seriesPath(model.points, "gravity", xAt, (value) => scaleY(value, gravityScale, padding.top, innerHeight));
    const tempPath = seriesPath(model.points, "temp", xAt, (value) => scaleY(value, tempScale, padding.top, innerHeight));
    const abvPath = seriesPath(model.points, "abv", xAt, (value) => scaleY(value, abvScale, padding.top, innerHeight));

    const markers = model.points.map((point) => {
      const bits = [];
      if (series.gravity.visible && Number.isFinite(point.gravity)) bits.push(`<circle cx="${xAt(point.time).toFixed(1)}" cy="${scaleY(point.gravity, gravityScale, padding.top, innerHeight).toFixed(1)}" r="3.5" fill="#ffb34d" />`);
      if (series.temp.visible && Number.isFinite(point.temp)) bits.push(`<circle cx="${xAt(point.time).toFixed(1)}" cy="${scaleY(point.temp, tempScale, padding.top, innerHeight).toFixed(1)}" r="3.5" fill="#4fc3f7" />`);
      if (series.abv.visible && Number.isFinite(point.abv)) bits.push(`<circle cx="${xAt(point.time).toFixed(1)}" cy="${scaleY(point.abv, abvScale, padding.top, innerHeight).toFixed(1)}" r="3.5" fill="#ff6d9d" />`);
      return bits.join("");
    }).join("");

    const hoverWidth = Math.max(18, innerWidth / Math.max(model.points.length, 8));
    trendHoverPoints = model.points.map((point) => ({
      ...point,
      when: point.time
    }));
    const hitTargets = model.points.map((point, index) => {
      const x = xAt(point.time);
      return `<rect data-trend-point="${index}" x="${(x - hoverWidth / 2).toFixed(1)}" y="${padding.top}" width="${hoverWidth.toFixed(1)}" height="${innerHeight}" fill="transparent" />`;
    }).join("");

    const gravityTicks = axisTicks(gravityScale, 5).map((tick) => {
      const y = scaleY(tick, gravityScale, padding.top, innerHeight);
      return `
        <text x="${padding.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="#ffb34d" font-size="11">${round(tick, 3)}</text>
      `;
    }).join("");
    const tempTicks = axisTicks(tempScale, 5).map((tick) => {
      const y = scaleY(tick, tempScale, padding.top, innerHeight);
      return `
        <text x="${width - padding.right + 8}" y="${(y + 4).toFixed(1)}" fill="#4fc3f7" font-size="11">${round(tick, 1)}°</text>
      `;
    }).join("");
    const abvAxisX = width - padding.right + 42;
    const abvTickLabels = axisTicks(abvScale, 4).map((tick) => {
      const y = scaleY(tick, abvScale, padding.top, innerHeight);
      return `
        <text x="${abvAxisX}" y="${(y + 4).toFixed(1)}" fill="#ff6d9d" font-size="11">${round(tick, 1)}%</text>
      `;
    }).join("");

    const latest = model.points[model.points.length - 1];
    summary.innerHTML = [
      Number.isFinite(latest.gravity) ? `<button class="chart-pill ${series.gravity.visible ? "active" : ""}" data-trend-series-toggle="gravity" type="button" aria-pressed="${series.gravity.visible ? "true" : "false"}"><span class="chart-swatch gravity"></span>Gravity ${escapeHTML(String(round(latest.gravity, 3)))}</button>` : "",
      Number.isFinite(latest.temp) ? `<button class="chart-pill ${series.temp.visible ? "active" : ""}" data-trend-series-toggle="temp" type="button" aria-pressed="${series.temp.visible ? "true" : "false"}"><span class="chart-swatch temp"></span>Temp ${escapeHTML(String(round(latest.temp, 1)))}°F</button>` : "",
      Number.isFinite(latest.abv) ? `<button class="chart-pill ${series.abv.visible ? "active" : ""}" data-trend-series-toggle="abv" type="button" aria-pressed="${series.abv.visible ? "true" : "false"}"><span class="chart-swatch abv"></span>Est. ABV ${escapeHTML(String(round(latest.abv, 1)))}%</button>` : ""
    ].filter(Boolean).join("");

    chart.innerHTML = `
      <svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Fermentation trend chart">
        ${gridLines}
        ${verticalLines}
        <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="rgba(255,179,77,0.45)" stroke-width="1.2" />
        <line x1="${width - padding.right}" y1="${padding.top}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="rgba(79,195,247,0.45)" stroke-width="1.2" />
        <line x1="${(abvAxisX - 8).toFixed(1)}" y1="${padding.top}" x2="${(abvAxisX - 8).toFixed(1)}" y2="${height - padding.bottom}" stroke="rgba(255,109,157,0.32)" stroke-width="1" stroke-dasharray="4 5" />
        <text x="${padding.left - 8}" y="${padding.top - 8}" text-anchor="end" fill="#ffb34d" font-size="11">SG</text>
        <text x="${width - padding.right + 8}" y="${padding.top - 8}" fill="#4fc3f7" font-size="11">Temp</text>
        <text x="${abvAxisX}" y="${padding.top - 8}" fill="#ff6d9d" font-size="11">ABV</text>
        ${gravityTicks}
        ${tempTicks}
        ${abvTickLabels}
        ${series.gravity.visible ? `<path d="${gravityPath}" fill="none" stroke="#ffb34d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />` : ""}
        ${series.temp.visible ? `<path d="${tempPath}" fill="none" stroke="#4fc3f7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />` : ""}
        ${series.abv.visible ? `<path d="${abvPath}" fill="none" stroke="#ff6d9d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="8 7" />` : ""}
        ${markers}
        ${hitTargets}
        <text x="${padding.left}" y="${height - 10}" fill="rgba(244,230,208,0.72)" font-size="11">${escapeHTML(model.startLabel)}</text>
        <text x="${width - padding.right}" y="${height - 10}" text-anchor="end" fill="rgba(244,230,208,0.72)" font-size="11">${escapeHTML(model.endLabel)}</text>
      </svg>
      <div class="chart-tooltip" id="fermentationTrendTooltip" hidden></div>
      <div class="trend-chart-note">
        Click a series pill to hide or show it. Hover the chart to inspect a reading. Gravity uses the left axis, temperature uses the blue right axis, and estimated ABV uses the pink dashed axis.
      </div>
    `;
  }

  /* =========================================================
     App defaults and state templates
     ========================================================= */

  function sourcePreset(type){
    return SOURCE_PRESETS[String(type || "Honey")] || SOURCE_PRESETS["Honey"];
  }

  function sourceDefault(type){
    return sourcePreset(type).ppg || "35";
  }

  function sourceLocked(type){
    return Boolean(sourcePreset(type).locked);
  }

  function sourceUnitDefault(type){
    return sourcePreset(type).unit || "lb";
  }

  function defaultAdditionRow(){
    return {
      id: makeId("src"),
      sourceType: "Honey",
      description: "",
      amount: "",
      unit: "lb",
      ppg: sourceDefault("Honey")
    };
  }

  function defaultFermentChecklist(){
    return [
      { id: makeId("task"), text: "Hydrate yeast with Go-Ferm if using dry yeast", done: false },
      { id: makeId("task"), text: "Record actual OG and pitch temperature", done: false },
      { id: makeId("task"), text: "Control fermentation temperature in the yeast's happy range", done: false },
      { id: makeId("task"), text: "Degas / aerate only in the safe early window", done: false },
      { id: makeId("task"), text: "Hit nutrient additions on schedule", done: false },
      { id: makeId("task"), text: "Stop nutrient additions at the 1/3 sugar break", done: false },
      { id: makeId("task"), text: "Check gravity stability before stabilization or packaging", done: false }
    ];
  }

  function buildRecipeAwareChecklist(recipe){
    const base = defaultFermentChecklist();
    if (!recipe) return base;
    const extras = [];
    const structureAdds = Array.isArray(recipe.structureAdditions) ? recipe.structureAdditions : [];
    const secondaryAdds = structureAdds.filter((row) => row.ingredient && /secondary/i.test(row.phase || ""));
    const benchAdds = structureAdds.filter((row) => row.ingredient && /bench/i.test(row.phase || ""));
    secondaryAdds.forEach((row) => {
      extras.push({ id: makeId("task"), text: `Add ${row.ingredient} in secondary — taste every 48-72h and pull when profile is clean`, done: false });
    });
    benchAdds.forEach((row) => {
      extras.push({ id: makeId("task"), text: `Bench trial ${row.ingredient} before committing to full batch`, done: false });
    });
    if (recipe.sweetness && recipe.sweetness !== "Dry") {
      extras.push({ id: makeId("task"), text: `Plan backsweetening for ${recipe.sweetness.toLowerCase()} finish — stabilize first`, done: false });
    }
    if (recipe.carbonation && recipe.carbonation !== "Still") {
      extras.push({ id: makeId("task"), text: `Carbonation planned (${recipe.carbonation.toLowerCase()}) — use pressure-safe bottles only`, done: false });
    }
    return [...base, ...extras];
  }

  function defaultCellarChecklist(){
    return [
      { id: makeId("cellar"), text: "Confirm fermentation has actually stopped before chemical stabilization", done: false },
      { id: makeId("cellar"), text: "Use sulfite + sorbate together if chemically stabilizing for backsweetening", done: false },
      { id: makeId("cellar"), text: "Re-check gravity and watch for refermentation after sweetening", done: false },
      { id: makeId("cellar"), text: "Bench trial sweetness / acid / tannin before scaling to the whole batch", done: false },
      { id: makeId("cellar"), text: "Record final sensory read before bottling", done: false }
    ];
  }

  function defaultRecipeDraft(){
    return {
      name: "",
      style: "Traditional",
      batchGallons: "",
      targetAbv: "",
      sweetness: "Dry",
      carbonation: "Still",
      yeast: "",
      yeastOther: "",
      yeastTolerance: "",
      temp: "",
      nitrogenRequirement: "low",
      dryYeast: "",
      honeyPPG: "35",
      honeyBase: "",
      fruitAdjuncts: "",
      acidPlan: "",
      tanninPlan: "",
      quickNote: "",
      notes: "",
      tags: "",
      targetOg: "",
      targetFg: "",
      estimatedAbv: "",
      additions: [defaultAdditionRow()],
      structureAdditions: []
    };
  }

  function defaultCurrentBatch(){
    return {
      recipeId: "",
      name: "",
      style: "Traditional",
      batchGallons: "",
      targetAbv: "",
      sweetness: "Dry",
      carbonation: "Still",
      yeast: "",
      yeastOther: "",
      yeastTolerance: "",
      temp: "",
      nitrogenRequirement: "low",
      dryYeast: "",
      honeyPPG: "35",
      honeyBase: "",
      fruitAdjuncts: "",
      acidPlan: "",
      tanninPlan: "",
      quickNote: "",
      notes: "",
      tags: "",
      targetOg: "",
      targetFg: "",
      estimatedAbv: "",
      additions: [defaultAdditionRow()],
      structureAdditions: [],
      fermentNotes: "",
      stepFeedPoints: "30",
      stepFeedHoneyPpg: "35",
      stepFeedCount: "1",
      stepFeedLog: [],
      loadedAt: null,
      pitchDate: "",
      phase: "primary"
    };
  }

  function defaultNutrients(){
    return {
      batchGallons: "",
      og: "",
      brix: "",
      yeastRequirement: "low",
      dryYeast: "",
      protocol: "tosna",
      targetYanPpm: "160",
      fruitOffsetPpm: "0",
      enforceLimits: true,
      limitO: "1.2",
      limitK: "0.5",
      limitD: "0.96",
      ratioO: "60",
      ratioK: "25",
      ratioD: "15",
      notes: ""
    };
  }

  function defaultCellarAddition(){
    return {
      id: makeId("cellaradd"),
      type: "Honey",
      purpose: "Sweetness",
      amount: "",
      unit: "g",
      notes: ""
    };
  }

  function defaultCellar(){
    return {
      finishPath: "Backsweetened and still",
      stableSgA: "",
      stableDateA: "",
      stableSgB: "",
      stableDateB: "",
      currentPh: "",
      currentTemp: "",
      kmetaAmount: "",
      sorbateAmount: "",
      backsweetenVolume: "",
      backsweetenCurrentSg: "",
      backsweetenTargetSg: "",
      backsweetenSourceType: "Honey",
      backsweetenPpg: "35",
      benchBatchGallons: "",
      benchSampleMl: "100",
      benchAddition: "",
      benchUnit: "g",
      blendVol1: "",
      blendSg1: "",
      blendVol2: "",
      blendSg2: "",
      cellarGallons: "",
      cellarBottleOz: "12",
      cellarLossPct: "5",
      stabilizationNotes: "",
      packagingNotes: "",
      tastingNotes: "",
      rating: "",
      tags: "",
      wouldMakeAgain: false,
      additions: [defaultCellarAddition()]
    };
  }

  function defaultCalcs(){
    return {
      targetOg: "",
      targetBatch: "",
      targetPpg: "35",
      honeyLb: "",
      honeyBatch: "",
      honeyPpg: "35",
      abvOg: "",
      abvFg: "",
      breakOg: "",
      sgInput: "",
      brixInput: "",
      recipeBatch: "",
      recipeAbv: "",
      recipeSweetness: "Dry",
      recipeTolerance: "",
      fermenterProfiles: [],
      fermenterProfileId: "",
      fermenterProfileName: "",
      fermenterBottomDiameter: "",
      fermenterTopDiameter: "",
      fermenterTotalHeight: "",
      fermenterLiquidHeight: "",
      fermenterSedimentHeight: ""
    };
  }

  function defaultRaptSync(){
    return {
      batchKey: "active",
      lastFetchedAt: "",
      lastReadingAt: "",
      lastImportCount: 0,
      lastStatus: "Waiting for import",
      lastError: "",
      deviceName: "",
      deviceId: "",
      latestGravity: "",
      latestTempF: "",
      showGravityTrend: true,
      showTempTrend: true,
      showAbvTrend: true
    };
  }

  function defaultMentor(){
    return {
      conceptName: "",
      style: "",
      inspiration: "",
      vision: "",
      batchSize: "",
      targetAbv: "",
      sweetness: "Dry",
      carbonation: "Still",
    };
  }

  function defaultMentorKnowledgeBase(){
    return {
      honeys: clone(MENTOR_HONEY_KB),
      yeasts: clone(MENTOR_YEAST_KB),
      adjuncts: clone(MENTOR_ADJUNCT_KB),
      archetypes: clone(MENTOR_ARCHETYPE_KB)
    };
  }

  const defaultData = {
    ui: {
      activeTab: "recipes",
      selectedRecipeId: null,
      recipeSearch: "",
      archiveSearch: "",
      showAllFermentLogs: false,
      editingLogId: null
    },
    clock: { elapsedMs: 0, running: false, lastStartedAt: null },
    recipeDraft: defaultRecipeDraft(),
    recipes: [],
    currentBatch: defaultCurrentBatch(),
    fermentationLogs: [],
    fermentChecklist: defaultFermentChecklist(),
    nutrients: defaultNutrients(),
    cellar: defaultCellar(),
    cellarChecklist: defaultCellarChecklist(),
    archive: [],
    calcs: defaultCalcs(),
    rapt: defaultRaptSync(),
    mentor: defaultMentor(),
    mentorKnowledge: defaultMentorKnowledgeBase()
  };

  const stateTools = window.MeadEvilState.createTools({
    storageKey: STORAGE_KEY,
    clone,
    makeId,
    todayStr,
    defaultData,
    defaultRecipeDraft,
    defaultCurrentBatch,
    defaultNutrients,
    defaultCellar,
    defaultCalcs,
    defaultRaptSync,
    defaultMentor,
    defaultMentorKnowledgeBase,
    defaultFermentChecklist,
    defaultCellarChecklist,
    defaultAdditionRow,
    defaultCellarAddition,
    normalizeClock
  });
  const {
    normalizeMentorKnowledge,
    normalizeRecipe,
    normalizeLog,
    normalizeArchiveItem,
    normalizeData,
    loadStoredData,
    persistStoredData,
    serializeExportState,
    parseImportedState
  } = stateTools;

  /* =========================================================
     Data normalization and persistence
     ========================================================= */

  // Gravity drives the trend chart, ABV math, and the 1/3-break board, so it has
  // to be trustworthy. Mead specific gravity realistically sits between water-ish
  // (~0.985 finished) and a very strong sack-mead must (~1.180). Anything outside
  // that is almost certainly a typo or a unit slip.
  function validateGravityValue(raw){
    const trimmed = String(raw == null ? "" : raw).trim();
    if (!trimmed) return { ok: false, empty: true, reason: "Enter a gravity reading to add a log entry." };
    const value = Number(trimmed);
    if (!isFinite(value)) return { ok: false, reason: "Enter gravity as a number like 1.074." };
    if (value < 0.980 || value > 1.200) return { ok: false, reason: "That gravity looks off. Mead readings sit between 0.980 and 1.200 (for example 1.074)." };
    return { ok: true, value };
  }

  // Temp (°F) and pH are optional, but if entered they should be physically
  // sane so they do not quietly poison the readout. Empty stays valid.
  function validateOptionalReading(raw, { min, max, label }){
    const trimmed = String(raw == null ? "" : raw).trim();
    if (!trimmed) return { ok: true, value: "" };
    const value = Number(trimmed);
    if (!isFinite(value)) return { ok: false, reason: `${label} should be a number, or leave it blank.` };
    if (value < min || value > max) return { ok: false, reason: `${label} should be between ${min} and ${max}, or leave it blank.` };
    return { ok: true, value: trimmed };
  }

  function validateLogInputs({ gravity, temp, pH }){
    const g = validateGravityValue(gravity);
    if (!g.ok) return g;
    const t = validateOptionalReading(temp, { min: 20, max: 120, label: "Temp °F" });
    if (!t.ok) return t;
    const p = validateOptionalReading(pH, { min: 2, max: 5, label: "pH" });
    if (!p.ok) return p;
    return { ok: true };
  }

  function setLogEntryError(message){
    const el = $("logEntryError");
    if (!el) return;
    if (message) {
      el.textContent = message;
      el.hidden = false;
    } else {
      el.textContent = "";
      el.hidden = true;
    }
  }

  let data = loadStoredData();
  let clockInterval = null;
  let raptRefreshInterval = null;
  let raptImportPromise = null;

  function normalizeClock(clock){
    const input = clock || {};
    if (typeof input.elapsedMs === "number" || typeof input.lastStartedAt === "number"){
      return {
        elapsedMs: Number(input.elapsedMs) || 0,
        running: Boolean(input.running),
        lastStartedAt: input.running && input.lastStartedAt ? Number(input.lastStartedAt) : null
      };
    }
    const running = Boolean(input.running);
    const startedAt = input.startedAt ? Number(input.startedAt) : null;
    const elapsedMs = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
    return {
      elapsedMs,
      running,
      lastStartedAt: running ? Date.now() : null
    };
  }

  function persistData(){
    persistStoredData(data);
  }

  function normalizeIsoDate(value){
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function celsiusToFahrenheit(value){
    const numeric = Number(value);
    return Number.isFinite(numeric) ? round((numeric * 9 / 5) + 32, 1) : "";
  }

  function raptEndpointUrl(batchKey){
    const query = new URLSearchParams();
    query.set("batch", batchKey || data.rapt.batchKey || "active");
    return `/.netlify/functions/rapt-bridge?${query.toString()}`;
  }

  function buildRaptLogNote(reading){
    const bits = [
      "RAPT Pill",
      reading.deviceName || "",
      Number.isFinite(Number(reading.battery)) ? `Battery ${round(Number(reading.battery), 0)}%` : "",
      Number.isFinite(Number(reading.rssi)) ? `RSSI ${round(Number(reading.rssi), 0)}` : ""
    ].filter(Boolean);
    return bits.join(" · ");
  }

  function normalizeRaptReading(reading){
    const gravity = Number(reading.gravity);
    if (!Number.isFinite(gravity)) return null;

    const telemetryAt = normalizeIsoDate(reading.telemetryAt || reading.telemetry_at || reading.created_date || reading.createdDate) || new Date().toISOString();
    const temperatureF = celsiusToFahrenheit(reading.temperatureC ?? reading.temperature_c ?? reading.temperature);
    const deviceId = String(reading.deviceId || reading.device_id || "");
    const deviceName = String(reading.deviceName || reading.device_name || "");
    const sourceId = String(reading.readingId || reading.reading_id || `${deviceId || "rapt"}-${telemetryAt}`);

    return {
      date: telemetryAt.slice(0, 10),
      gravity: String(round(gravity, 3)),
      temp: temperatureF === "" ? "" : String(temperatureF),
      pH: "",
      note: buildRaptLogNote(reading),
      createdAt: telemetryAt,
      source: "rapt",
      sourceId,
      telemetryAt,
      deviceName,
      deviceId
    };
  }

  function mergeRaptLogs(logs){
    const existingSourceIds = new Set(
      data.fermentationLogs
        .map((entry) => String(entry.sourceId || ""))
        .filter(Boolean)
    );

    let added = 0;
    logs.forEach((log) => {
      if (!log) return;
      const sourceId = String(log.sourceId || "");
      if (sourceId && existingSourceIds.has(sourceId)) return;
      data.fermentationLogs.push(normalizeLog(log));
      if (sourceId) existingSourceIds.add(sourceId);
      added += 1;
    });
    return added;
  }

  // Generic hydrometer CSV import (Tilt, iSpindel, Brewfather, RAPT exports).
  // Finds date + gravity columns by header keywords, normalizes point-style
  // gravity (1050 -> 1.050) and Celsius temps, then downsamples to one
  // reading per 6 hours so a 15-minute Tilt log can't bloat localStorage.
  function parseGravityCsv(text){
    const rows = parseCsv(text);
    if (rows.length < 2) return null;
    const headers = rows[0].map((cell) => String(cell || "").trim().toLowerCase());
    const findCol = (...patterns) => headers.findIndex((h) => patterns.some((p) => h.includes(p)));
    const dateCol = findCol("timepoint", "timestamp", "date", "time", "created");
    const gravityCol = findCol("gravity", "sg");
    if (dateCol < 0 || gravityCol < 0 || dateCol === gravityCol) return null;
    const tempCol = findCol("temp");
    const phCol = headers.findIndex((h) => h === "ph" || h.startsWith("ph"));
    const tempHeaderCelsius = tempCol >= 0 && /\(c\)|°c|celsius|_c\b/.test(headers[tempCol]);

    const candidates = [];
    rows.slice(1).forEach((cells) => {
      const stamp = new Date(String(cells[dateCol] || "").trim());
      if (Number.isNaN(stamp.getTime())) return;
      let gravity = Number(cells[gravityCol]);
      if (gravity > 900 && gravity < 1250) gravity = gravity / 1000;
      if (!(gravity > 0.95 && gravity < 1.25)) return;
      const temp = tempCol >= 0 ? Number(cells[tempCol]) : NaN;
      const pH = phCol >= 0 ? Number(cells[phCol]) : NaN;
      candidates.push({ stamp, gravity, temp: Number.isFinite(temp) ? temp : null, pH: Number.isFinite(pH) ? pH : null });
    });
    if (!candidates.length) return { readings: [] };

    const temps = candidates.map((c) => c.temp).filter((t) => t != null);
    const tempsAreCelsius = tempHeaderCelsius || (temps.length > 0 && Math.max(...temps) < 45);

    candidates.sort((a, b) => a.stamp - b.stamp);
    const buckets = new Map();
    candidates.forEach((c) => buckets.set(Math.floor(c.stamp.getTime() / (6 * 3600 * 1000)), c));

    const readings = [...buckets.values()].map((c) => {
      const iso = c.stamp.toISOString();
      const tempF = c.temp == null ? "" : String(round(tempsAreCelsius ? (c.temp * 9 / 5) + 32 : c.temp, 1));
      const gravity = String(round(c.gravity, 3));
      return {
        date: iso.slice(0, 10),
        gravity,
        temp: tempF,
        pH: c.pH == null ? "" : String(c.pH),
        note: "CSV import",
        createdAt: iso,
        source: "csv",
        sourceId: `csv-${iso.slice(0, 16)}-${gravity}`,
        telemetryAt: iso
      };
    });
    return { readings };
  }

  function importGravityCsv(text){
    const parsed = parseGravityCsv(text);
    if (!parsed) return { added: 0, error: "Could not find date and gravity columns in that CSV. Expected headers like Date/Timepoint and SG/Gravity." };
    const added = mergeRaptLogs(parsed.readings);
    if (added){
      persistData();
      renderAll();
    }
    return { added, total: parsed.readings.length };
  }

  function latestRateWindow(logs){
    const ordered = sortLogsAscending(logs).filter((entry) => Number.isFinite(Number(entry.gravity)));
    if (ordered.length < 2) return null;

    const latest = ordered[ordered.length - 1];
    const latestTime = new Date(latest.telemetryAt || latest.createdAt || `${latest.date}T00:00:00`).getTime();
    if (!Number.isFinite(latestTime)) return null;

    let baseline = null;
    for (let index = ordered.length - 2; index >= 0; index -= 1){
      const candidate = ordered[index];
      const candidateTime = new Date(candidate.telemetryAt || candidate.createdAt || `${candidate.date}T00:00:00`).getTime();
      const hoursApart = (latestTime - candidateTime) / 3600000;
      if (Number.isFinite(candidateTime) && hoursApart >= 12){
        baseline = candidate;
        break;
      }
    }

    if (!baseline) baseline = ordered[ordered.length - 2];
    if (!baseline) return null;

    const baselineTime = new Date(baseline.telemetryAt || baseline.createdAt || `${baseline.date}T00:00:00`).getTime();
    const hoursApart = (latestTime - baselineTime) / 3600000;
    const latestGravity = Number(latest.gravity);
    const baselineGravity = Number(baseline.gravity);
    if (!Number.isFinite(hoursApart) || hoursApart <= 0 || !Number.isFinite(latestGravity) || !Number.isFinite(baselineGravity)) return null;

    const sgDrop = baselineGravity - latestGravity;
    const pointsDrop = sgDrop * 1000;
    const pointsPerDay = pointsDrop * (24 / hoursApart);

    return {
      latest,
      baseline,
      hoursApart,
      sgDrop,
      pointsDrop,
      pointsPerDay
    };
  }

  function fermentationRateSummary(logs){
    const window = latestRateWindow(logs);
    if (!window) {
      return {
        drop: "Need at least two gravity readings",
        rate: "Waiting on a trend",
        window: "No comparison window yet",
        projection: "Need a trend first"
      };
    }

    const latestGravity = Number(window.latest.gravity);
    const targetGravity = Number(data.currentBatch.targetFg || 1.000);
    const hasForwardProgress = window.pointsPerDay > 0;
    let projection = "Rate is flat or rising";
    if (hasForwardProgress && Number.isFinite(latestGravity) && Number.isFinite(targetGravity) && latestGravity > targetGravity){
      const pointsRemaining = (latestGravity - targetGravity) * 1000;
      const daysRemaining = pointsRemaining / window.pointsPerDay;
      if (Number.isFinite(daysRemaining) && daysRemaining >= 0){
        const label = data.currentBatch.targetFg ? `target FG ${round(targetGravity, 3)}` : "1.000";
        if (daysRemaining < 1){
          projection = `Under 1 day to ${label}`;
        } else {
          projection = `${round(daysRemaining, 1)} days to ${label}`;
        }
      }
    } else if (hasForwardProgress && Number.isFinite(latestGravity) && Number.isFinite(targetGravity) && latestGravity <= targetGravity){
      projection = `At or below ${data.currentBatch.targetFg ? `target FG ${round(targetGravity, 3)}` : "1.000"}`;
    }

    const direction = window.pointsPerDay >= 0 ? "dropping" : "rising";
    return {
      drop: `${round(window.sgDrop, 3)} SG over ${round(window.hoursApart, 1)} hr`,
      rate: `${Math.abs(round(window.pointsPerDay, 1))} pts/day ${direction}`,
      window: `${formatCompactDateTime(window.baseline.telemetryAt || window.baseline.createdAt || `${window.baseline.date}T00:00:00`)} to ${formatCompactDateTime(window.latest.telemetryAt || window.latest.createdAt || `${window.latest.date}T00:00:00`)}`,
      projection
    };
  }

  function shouldRaptAutoRefresh(){
    if (document.visibilityState === "hidden") return false;
    const lastFetch = new Date(data.rapt.lastFetchedAt || 0).getTime();
    return !lastFetch || (Date.now() - lastFetch) >= RAPT_VISIBILITY_REFRESH_STALE_MS;
  }

  function startRaptAutoRefresh(){
    if (raptRefreshInterval) clearInterval(raptRefreshInterval);
    raptRefreshInterval = setInterval(() => {
      if (!shouldRaptAutoRefresh()) return;
      importRaptReadings({ silent: true }).catch((error) => {
        console.warn("Background RAPT refresh failed", error);
      });
    }, RAPT_AUTO_REFRESH_MS);

    document.addEventListener("visibilitychange", () => {
      if (shouldRaptAutoRefresh()){
        importRaptReadings({ silent: true }).catch((error) => {
          console.warn("Visibility-triggered RAPT refresh failed", error);
        });
      }
    });

    window.addEventListener("focus", () => {
      if (shouldRaptAutoRefresh()){
        importRaptReadings({ silent: true }).catch((error) => {
          console.warn("Focus-triggered RAPT refresh failed", error);
        });
      }
    });
  }

  async function importRaptReadings(options = {}){
    if (raptImportPromise) return raptImportPromise;
    const silent = Boolean(options.silent);
    const batchKey = data.rapt.batchKey || "active";
    raptImportPromise = (async () => {
      data.rapt.lastError = "";
      data.rapt.lastStatus = "Checking bridge...";
      if (!silent) renderFerment();

      try{
        const response = await fetch(raptEndpointUrl(batchKey), {
          method: "GET",
          headers: { "Accept": "application/json" }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok){
          throw new Error(String(payload.error || `Bridge returned ${response.status}`));
        }
        if (payload.configured === false){
          data.rapt.lastFetchedAt = new Date().toISOString();
          data.rapt.lastImportCount = 0;
          data.rapt.lastStatus = "RAPT bridge not configured";
          data.rapt.lastError = "";
          persistData();
          renderFerment();
          return { added: 0, total: 0, configured: false };
        }

        const incoming = Array.isArray(payload.readings) ? payload.readings.map(normalizeRaptReading).filter(Boolean) : [];
        incoming.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        const added = mergeRaptLogs(incoming);
        const latest = incoming[incoming.length - 1] || null;

        data.rapt.lastFetchedAt = new Date().toISOString();
        data.rapt.lastImportCount = added;
        data.rapt.lastStatus = incoming.length ? (added ? `Imported ${added} new reading${added === 1 ? "" : "s"}` : "No new RAPT readings") : "No RAPT readings available yet";
        data.rapt.deviceName = String(payload.deviceName || latest?.deviceName || data.rapt.deviceName || "");
        data.rapt.deviceId = String(payload.deviceId || latest?.deviceId || data.rapt.deviceId || "");
        data.rapt.lastReadingAt = String(payload.lastReadingAt || latest?.telemetryAt || data.rapt.lastReadingAt || "");
        data.rapt.latestGravity = String(payload.latestGravity || latest?.gravity || data.rapt.latestGravity || "");
        data.rapt.latestTempF = String(payload.latestTempF || latest?.temp || data.rapt.latestTempF || "");

        persistData();
        renderDashboard();
        renderFerment();
        return { added, total: incoming.length };
      } catch (error){
        data.rapt.lastFetchedAt = new Date().toISOString();
        data.rapt.lastError = String(error?.message || error);
        data.rapt.lastStatus = "Bridge unavailable";
        persistData();
        renderFerment();
        return { added: 0, total: 0, error };
      } finally {
        raptImportPromise = null;
      }
    })();
    return raptImportPromise;
  }

  /* =========================================================
     Derived calculations and active state helpers
     ========================================================= */


  function displayYeastName(recipe){
    if (!recipe) return "";
    return recipe.yeast === "Other / Custom" ? (recipe.yeastOther || "") : (recipe.yeast || "");
  }

  function recipeSourceSummary(recipe){
    const rows = Array.isArray((recipe || {}).additions) ? recipe.additions : [];
    const honey = rows.filter((row) => String(row.sourceType).toLowerCase() === "honey" && (row.description || row.amount));
    const other = rows.filter((row) => String(row.sourceType).toLowerCase() !== "honey" && (row.description || row.amount));
    return {
      honey: honey.length ? honey.map((row) => row.description || row.sourceType).join(", ") : "",
      other: other.length ? other.map((row) => row.description || row.sourceType).join(", ") : ""
    };
  }

  function recipeSearchText(recipe){
    const summary = recipeSourceSummary(recipe);
    const addNames = Array.isArray(recipe.structureAdditions) ? recipe.structureAdditions.map((row) => row && row.ingredient || "").join(" ") : "";
    return [recipe.name, recipe.style, summary.honey, summary.other, addNames, recipe.tags, recipe.quickNote, recipe.notes].join(" ").toLowerCase();
  }

  function daysBetween(start, end){
    if (!start || !end) return null;
    const a = new Date(start);
    const b = new Date(end);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    return Math.round((b - a) / 86400000);
  }

  function cellarAnalysis(){
    const c = data.cellar;
    const latest = latestGravityLog();
    const sgA = Number(c.stableSgA);
    const sgB = Number(c.stableSgB);
    const spacingDays = daysBetween(c.stableDateA, c.stableDateB);
    const stablePair = sgA && sgB && Math.abs(sgA - sgB) < 0.0015;
    const gateReady = stablePair && spacingDays != null && spacingDays >= 7;
    const backsweeteningPlanned = ["Backsweetened and still","Backsweetened and force-carbonated"].includes(c.finishPath) || (Number(c.backsweetenTargetSg) > Number(c.backsweetenCurrentSg || 0));
    const warnings = [];
    const greenlights = [];
    if (!gateReady){
      warnings.push("Need two stable SG readings at least a week apart before stabilization.");
    } else {
      greenlights.push(`Gravity looks stable across ${spacingDays} day${spacingDays === 1 ? "" : "s"}.`);
    }
    if (backsweeteningPlanned && (!c.kmetaAmount || !c.sorbateAmount)){
      warnings.push("Record both k-meta and sorbate before backsweetening.");
    }
    if (c.finishPath === "Bottle-conditioned" && (backsweeteningPlanned || c.kmetaAmount || c.sorbateAmount)){
      warnings.push("Bottle-conditioning conflicts with a stabilized backsweetened finish.");
    }
    if ((c.kmetaAmount || c.sorbateAmount) && !gateReady){
      warnings.push("Chemical additions are recorded before the stability gate is clear.");
    }
    if (c.additions.some((row) => row.amount && !row.notes)){
      warnings.push("One post-fermentation addition is missing a note.");
    }
    if (Number(c.backsweetenTargetSg) > Number(c.backsweetenCurrentSg || 0) && !c.benchAddition){
      warnings.push("Run a bench trial before scaling a sweeter finish.");
    }
    if (c.currentPh) greenlights.push(`Current pH recorded at ${c.currentPh}. Re-check after any significant sweetening or acid shift.`);
    if (c.finishPath === "Oak / spice aging") greenlights.push("Oak / spice aging selected. Bench trials matter even more here than in fruit-forward batches.");
    return { gateReady, stablePair, spacingDays, warnings, greenlights, latest };
  }

  function applyYeastPresetToDraft(selected){
    const preset = YEAST_PRESETS[selected];
    const isCustom = selected === "Other / Custom";
    $("recipeYeastOtherWrap").classList.toggle("hidden-field", !isCustom);
    $("recipeYeastTolerance").readOnly = !isCustom;
    $("recipeTemp").readOnly = !isCustom;
    if (preset){
      data.recipeDraft.yeastTolerance = preset.tolerance;
      data.recipeDraft.temp = preset.temp;
      data.recipeDraft.nitrogenRequirement = preset.nitrogenRequirement || "medium";
      $("recipeYeastTolerance").value = preset.tolerance;
      $("recipeTemp").value = preset.temp;
      if ($("recipeNitrogenRequirement")) $("recipeNitrogenRequirement").value = data.recipeDraft.nitrogenRequirement;
    } else if (!isCustom && !selected){
      data.recipeDraft.yeastTolerance = "";
      data.recipeDraft.temp = "";
      data.recipeDraft.nitrogenRequirement = "low";
      $("recipeYeastTolerance").value = "";
      $("recipeTemp").value = "";
      if ($("recipeNitrogenRequirement")) $("recipeNitrogenRequirement").value = data.recipeDraft.nitrogenRequirement;
    }
    if (!isCustom) {
      data.recipeDraft.yeastOther = "";
      if ($("recipeYeastOther")) $("recipeYeastOther").value = "";
    }
  }
  function syncRecipeDerived(){
    const recipe = data.recipeDraft;
    if (recipe.targetOg){
      data.nutrients.targetYanPpm = String(suggestYanPpm({ og: recipe.targetOg, yeastRequirement: data.nutrients.yeastRequirement || recipe.nitrogenRequirement || "low" }));
    }
    const plan = estimateRecipeTargets({
      batchGallons: recipe.batchGallons,
      targetAbv: recipe.targetAbv,
      sweetness: recipe.sweetness,
      yeastTolerance: recipe.yeastTolerance,
      honeyPPG: 35
    });
    recipe.targetOg = plan ? String(round(plan.targetOg, 3)) : "";
    recipe.targetFg = plan ? String(round(plan.targetFg, 3)) : "";
    recipe.estimatedAbv = plan ? String(round(plan.targetAbv, 1)) : "";
  }

  function syncNutrientsFromRecipe(recipeLike, options = {}){
    const recipe = recipeLike || data.recipeDraft || {};
    const force = Boolean(options.force);
    const yeastName = displayYeastName(recipe);
    const preset = YEAST_PRESETS[recipe.yeast] || (YEAST_PRESETS[yeastName] || null);
    const resolvedRequirement = recipe.nitrogenRequirement || (preset ? preset.nitrogenRequirement : data.nutrients.yeastRequirement) || "low";
    if (force || !data.nutrients.batchGallons) data.nutrients.batchGallons = recipe.batchGallons || data.nutrients.batchGallons;
    if (force || !data.nutrients.og) data.nutrients.og = recipe.targetOg || data.nutrients.og;
    if (force || !data.nutrients.brix) data.nutrients.brix = recipe.targetOg ? String(round(sgToBrix(recipe.targetOg), 1)) : data.nutrients.brix;
    data.nutrients.dryYeast = recipe.dryYeast || "";
    data.nutrients.yeastRequirement = resolvedRequirement;
    if (data.nutrients.og){
      data.nutrients.targetYanPpm = String(suggestYanPpm({ og: data.nutrients.og, yeastRequirement: data.nutrients.yeastRequirement }));
    }
    if (force && !data.nutrients.protocol){
      data.nutrients.protocol = "tosna";
    }
  }

  function syncCurrentBatchDerived(){
    const batch = data.currentBatch;
    if (batch.targetOg && batch.targetFg){
      const abv = calcABV(batch.targetOg, batch.targetFg);
      batch.estimatedAbv = abv ? String(round(abv, 1)) : batch.estimatedAbv;
    }
  }

  function cellarHasData(){
    const c = data.cellar;
    if (!c) return false;
    const defaults = defaultCellar();
    const meaningfulFields = [
      "stableSgA", "stableDateA", "stableSgB", "stableDateB",
      "currentPh", "currentTemp", "kmetaAmount", "sorbateAmount",
      "backsweetenTargetSg", "benchAddition", "blendVol1", "blendSg1",
      "blendVol2", "blendSg2", "stabilizationNotes", "packagingNotes",
      "tastingNotes", "rating", "tags"
    ];
    const hasMeaningfulAddition = Array.isArray(c.additions) && c.additions.some((row) => row && (
      String(row.amount || "").trim() ||
      String(row.notes || "").trim()
    ));
    const hasChangedField = meaningfulFields.some((key) => String(c[key] || "").trim() !== String(defaults[key] || "").trim());
    return Boolean(hasMeaningfulAddition || hasChangedField || c.wouldMakeAgain !== defaults.wouldMakeAgain);
  }

  function batchHasData(){
    const b = data.currentBatch;
    const hasLogs = Array.isArray(data.fermentationLogs) && data.fermentationLogs.length > 0;
    const hasStepFeeds = Array.isArray(b.stepFeedLog) && b.stepFeedLog.length > 0;
    const hasStructure = Array.isArray(b.structureAdditions) && b.structureAdditions.some((row) => row && String(row.ingredient || "").trim());
    const hasChecklistProgress = Array.isArray(data.fermentChecklist) && data.fermentChecklist.some((item) => item && item.done);
    return Boolean(
      b.name ||
      b.targetOg ||
      displayYeastName(b) ||
      b.pitchDate ||
      String(b.fermentNotes || "").trim() ||
      hasLogs ||
      hasStepFeeds ||
      hasStructure ||
      hasChecklistProgress ||
      cellarHasData()
    );
  }

  function currentRecipe(){
    return data.recipes.find((recipe) => recipe.id === data.ui.selectedRecipeId) || null;
  }

  function latestGravityLog(){
    return sortLogsDescending(data.fermentationLogs)[0] || null;
  }

  function daysSinceLastReading(logs){
    const latest = sortLogsDescending(logs)[0];
    if (!latest || !latest.date) return Infinity;
    return Math.floor((Date.now() - new Date(latest.date).getTime()) / 86400000);
  }

  function currentSourceBill(){
    return calculateSourceBill({ batchGallons: data.recipeDraft.batchGallons, rows: data.recipeDraft.additions });
  }

  function nutrientProtocolDefaults(protocol){
    const mode = String(protocol || "tosna");
    if (mode == "tosna") return { enforceLimits: true, limitO: "1.2", limitK: "0", limitD: "0", ratioO: "100", ratioK: "0", ratioD: "0" };
    if (mode == "k_dap_20_80") return { enforceLimits: true, limitO: "0", limitK: "0.5", limitD: "0.96", ratioO: "0", ratioK: "20", ratioD: "80" };
    if (mode == "advanced") return { enforceLimits: true, limitO: "1.2", limitK: "0.5", limitD: "0.96", ratioO: "60", ratioK: "25", ratioD: "15" };
    return null;
  }

  function applyNutrientProtocolDefaults(protocol){
    const defaults = nutrientProtocolDefaults(protocol);
    if (!defaults) return;
    Object.assign(data.nutrients, defaults);
  }

  function currentTosnaPlan(){
    return calculateTosna({
      batchGallons: data.nutrients.batchGallons,
      og: data.nutrients.og,
      brix: data.nutrients.brix,
      yeastRequirement: data.nutrients.yeastRequirement
    });
  }

  function currentAdvancedPlan(){
    return calculateAdvancedNutrients({
      batchGallons: data.nutrients.batchGallons,
      og: data.nutrients.og,
      targetYanPpm: data.nutrients.targetYanPpm,
      fruitOffsetPpm: data.nutrients.fruitOffsetPpm,
      protocol: data.nutrients.protocol,
      enforceLimits: data.nutrients.enforceLimits,
      limitO: data.nutrients.limitO,
      limitK: data.nutrients.limitK,
      limitD: data.nutrients.limitD,
      ratioO: data.nutrients.ratioO,
      ratioK: data.nutrients.ratioK,
      ratioD: data.nutrients.ratioD
    });
  }

  /* =========================================================
     Navigation and global clock helpers
     ========================================================= */

  function setActiveTab(tab){
    data.ui.activeTab = tab;
    renderTabs();
    persistData();
  }

  function renderTabs(){
    document.querySelectorAll("[data-tab].tab-btn").forEach((button) => {
      const active = button.dataset.tab === data.ui.activeTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.setAttribute("tabindex", active ? "0" : "-1");
      if (active && button.parentElement && button.parentElement.scrollWidth > button.parentElement.clientWidth) {
        button.scrollIntoView({ block: "nearest", inline: "center" });
      }
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      const active = panel.id === `tab-${data.ui.activeTab}`;
      panel.classList.toggle("active", active);
      panel.setAttribute("aria-hidden", active ? "false" : "true");
    });
  }

  function formatClock(ms){
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
    const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  }

  function clockDisplay(){
    const display = $("batchClockDisplay");
    const button = $("batchClockBtn");
    if (!display) return;
    const runningMs = data.clock.running && data.clock.lastStartedAt ? (Date.now() - data.clock.lastStartedAt) : 0;
    const elapsed = (Number(data.clock.elapsedMs) || 0) + Math.max(0, runningMs);
    display.textContent = formatClock(elapsed);
    if (button){
      button.textContent = data.clock.running ? "Stop Clock" : "Start Clock";
      button.setAttribute("aria-pressed", data.clock.running ? "true" : "false");
    }
  }

  function startClockTicker(){
    if (clockInterval) clearInterval(clockInterval);
    clockDisplay();
    if (data.clock.running){
      clockInterval = setInterval(clockDisplay, 1000);
    }
  }

  /* =========================================================
     Render layer
     ========================================================= */

  function renderDashboard(){
    const batch = data.currentBatch;
    const latest = latestGravityLog();
    const tosna = currentTosnaPlan();
    const advanced = currentAdvancedPlan();
    const breakGravity = calcOneThirdBreak(batch.targetOg || data.nutrients.og);
    const rate = fermentationRateSummary(data.fermentationLogs);
    const pitchDaysAgo = batch.pitchDate ? Math.floor((Date.now() - new Date(batch.pitchDate).getTime()) / 86400000) : null;
    const phase = batch.phase || "primary";
    const nextMove = (() => {
      if (!batchHasData()) return `No active batch loaded. Start in <strong>Recipes</strong> or load a saved recipe from <strong>Archive</strong>.`;
      if (!latest) return `You have a batch loaded, but no gravity history yet. Record the real OG and pitch conditions before your memory gets cute.`;
      if (phase === "primary" && pitchDaysAgo !== null && pitchDaysAgo <= 3 && breakGravity && Number(latest.gravity) > breakGravity) return `Day ${pitchDaysAgo} since pitch. You are in the nutrient window. Stay on top of SNA additions, oxygen, and temperature.`;
      if (breakGravity && Number(latest.gravity) > breakGravity) return `Still above the 1/3 sugar break${pitchDaysAgo !== null ? ` (day ${pitchDaysAgo})` : ""}. Keep feeding nutrients and watching temp.`;
      if (phase === "primary" && breakGravity && Number(latest.gravity) <= breakGravity) return `Past the 1/3 sugar break${pitchDaysAgo !== null ? ` (day ${pitchDaysAgo})` : ""}. Stop nutrient additions and let it ferment clean.`;
      if (phase === "secondary") return `In secondary${pitchDaysAgo !== null ? ` (day ${pitchDaysAgo})` : ""}. Watch extraction times and take gravity readings to confirm stability.`;
      if (phase === "aging") return `Aging${pitchDaysAgo !== null ? ` (day ${pitchDaysAgo})` : ""}. Patience. Take a gravity reading every few weeks to confirm stability before packaging.`;
      if (phase === "stabilizing") return `Stabilizing${pitchDaysAgo !== null ? ` (day ${pitchDaysAgo})` : ""}. Confirm two stable gravity readings before backsweetening or packaging.`;
      if (phase === "packaging" || phase === "bottled") return `Ready to package or already bottled${pitchDaysAgo !== null ? ` (day ${pitchDaysAgo})` : ""}. Record tasting notes in the Finish tab.`;
      return `Keep the notes honest and the process boring. Mead gets better when you stop improvising the important parts.`;
    })();
    $("dashboardNextMove").innerHTML = nextMove;

    $("dashboardBatchPulse").innerHTML = batchHasData()
      ? `<strong>${escapeHTML(batch.name || "Unnamed batch")}</strong><br>${escapeHTML(batch.style || "Mead")} · ${escapeHTML(batch.batchGallons || "—")} gal · target OG ${escapeHTML(batch.targetOg || "—")} · target FG ${escapeHTML(batch.targetFg || "—")} · est. ${escapeHTML(batch.estimatedAbv || batch.targetAbv || "—")}% ABV<br><span class="muted">Phase: ${escapeHTML(phase)}${batch.pitchDate ? ` · Pitched ${escapeHTML(batch.pitchDate)}` : ""}${pitchDaysAgo !== null ? ` (day ${pitchDaysAgo})` : ""} · Loaded ${escapeHTML(formatDateTime(batch.loadedAt))}</span>`
      : `No active batch loaded yet.`;

    if (batchHasData()) {
      const nutrientRows = [];
      if (tosna) nutrientRows.push(["Simple plan", `${round(tosna.totalFermaidO, 1)} g Fermaid O total`]);
      if (advanced) nutrientRows.push(["Advanced plan", `${round(advanced.gramsO, 1)} g O · ${round(advanced.gramsK, 1)} g K · ${round(advanced.gramsD, 1)} g DAP`]);
      const goFerm = calculateGoFerm(data.nutrients.dryYeast);
      if (goFerm) nutrientRows.push(["Go-Ferm", `${round(goFerm.goFermGrams, 1)} g`]);
      if (nutrientRows.length) renderRows("dashboardNutrientPulse", nutrientRows);
      else $("dashboardNutrientPulse").innerHTML = `<span class="muted">Set up the feed plan to see nutrient numbers here.</span>`;

      const fermentRows = [["Phase", escapeHTML(phase) + (pitchDaysAgo !== null ? ` (day ${pitchDaysAgo})` : "")]];
      if (latest) fermentRows.push(["Latest gravity", escapeHTML(latest.gravity)]);
      if (breakGravity) fermentRows.push(["1/3 break", `${round(breakGravity, 3)}`]);
      if (latest) fermentRows.push(["Latest temp/pH", `${escapeHTML(latest.temp || "—")}°F · pH ${escapeHTML(latest.pH || "—")}`]);
      if (latest && breakGravity) fermentRows.push(["Window", Number(latest.gravity) <= breakGravity ? "Past nutrient cutoff" : "Still in feeding window"]);
      if (rate.rate && rate.rate !== "—") fermentRows.push(["Rate", escapeHTML(rate.rate)]);
      renderRows("dashboardFermentationPulse", fermentRows);
    } else {
      $("dashboardNutrientPulse").innerHTML = "";
      $("dashboardFermentationPulse").innerHTML = "";
    }

    const batchStructure = recipeSourceSummary(batch);
    $("dashboardStructure").innerHTML = batchHasData()
      ? `Honey: <strong>${escapeHTML(batchStructure.honey || "Not written yet")}</strong><br>Everything else: <strong>${escapeHTML(batchStructure.other || "None written yet")}</strong>`
      : `Structure is blank until a batch exists.`;

    const reminders = data.fermentChecklist.filter((item) => !item.done).slice(0, 4);
    $("dashboardReminders").innerHTML = reminders.length
      ? reminders.map((item) => `
          <label class="check-item">
            <input type="checkbox" data-dash-task-toggle="${item.id}" ${item.done ? "checked" : ""} />
            <span>${escapeHTML(item.text)}</span>
          </label>
        `).join("")
      : emptyState("Run sheet clear", "Nothing urgent is left on the active batch checklist.", "good", "Clear");

    const oneLiner = $("pulseOneLiner");
    if (oneLiner) {
      oneLiner.textContent = batchHasData()
        ? `${escapeHTML(batch.name || "Batch")} · ${escapeHTML(phase)}${pitchDaysAgo !== null ? ` · day ${pitchDaysAgo}` : ""}`
        : "No active batch";
    }
  }

  function renderRecipeSourceList(){
    const rows = data.recipeDraft.additions;
    $("recipeSourceList").innerHTML = rows.map((row) => {
      const locked = sourceLocked(row.sourceType);
      const presetLabel = locked ? "Auto from source" : "Editable for custom measured values";
      return `
      <div class="source-row">
        <div class="form-grid-4">
          <div class="field source-type-field">
            <label>Source</label>
            <select data-source-id="${row.id}" data-source-field="sourceType">
              ${Object.keys(SOURCE_PRESETS).map((option) => `<option ${row.sourceType === option ? "selected" : ""}>${option}</option>`).join("")}
            </select>
          </div>
          <div class="field source-desc-field"><label>Description</label><input data-source-id="${row.id}" data-source-field="description" value="${escapeHTML(row.description)}" placeholder="Orange blossom, tart cherry, medium toast oak..." /></div>
          <div class="field source-amount-field"><label>Amount</label><input data-source-id="${row.id}" data-source-field="amount" type="number" step="0.1" value="${escapeHTML(row.amount)}" /></div>
          <div class="field source-unit-field"><label>Unit</label><select data-source-id="${row.id}" data-source-field="unit"><option ${row.unit === "lb" ? "selected" : ""}>lb</option><option ${row.unit === "kg" ? "selected" : ""}>kg</option></select></div>
        </div>
        <div class="form-grid-2 source-row-footer">
          <div class="field source-ppg-field"><label>PPG</label><input data-source-id="${row.id}" data-source-field="ppg" type="number" step="0.1" value="${escapeHTML(row.ppg)}" ${locked ? "readonly" : ""} /><span class="input-hint">${presetLabel}</span></div>
          <div class="field checkbox-field"><button class="mini-btn" data-source-delete="${row.id}" type="button">Remove source</button></div>
        </div>
      </div>
    `;
    }).join("");
  }

  function renderRecipeComputed(){
    const recipe = data.recipeDraft;
    const plan = estimateRecipeTargets({
      batchGallons: recipe.batchGallons,
      targetAbv: recipe.targetAbv,
      sweetness: recipe.sweetness,
      yeastTolerance: recipe.yeastTolerance,
      honeyPPG: 35
    });
    const bill = currentSourceBill();
    const targetOg = plan ? Number(plan.targetOg) : null;
    const targetFg = plan ? Number(plan.targetFg) : null;
    const actualOg = bill ? Number(bill.estimatedOg) : null;
    const ogDeltaPoints = targetOg && actualOg ? Math.round((actualOg - targetOg) * 1000) : null;
    const topSources = bill && bill.lineItems.length
      ? clone(bill.lineItems).sort((a, b) => b.totalPoints - a.totalPoints).slice(0, 3).map((item) => `${item.description} (${round(item.perGallonPoints, 1)} pts/gal)`).join(", ")
      : "Need source rows";
    const sourceSummary = recipeSourceSummary(recipe);

    if (plan) {
      const targetRows = [
        ["Target OG", `${round(plan.targetOg, 3)}`],
        ["Target FG", `${round(plan.targetFg, 3)}`],
        ["Target ABV", `${round(plan.targetAbv, 1)}%`],
        ["Traditional mead equivalent", `${round(plan.honeyLb, 2)} lb honey (${round(plan.honeyKg, 2)} kg)`]
      ];
      if (plan.exceedsTolerance) targetRows.push(["Yeast fit", `<strong>Target exceeds the entered yeast tolerance.</strong>`]);
      renderRows("recipeTargetSummary", targetRows);
    } else {
      $("recipeTargetSummary").innerHTML = emptyState("Design target waiting", "Set batch size and target ABV to lock the north star for this batch.", "focus", "Build");
    }

    if (bill) {
      const mustRows = [
        ["Source bill OG", `${round(bill.estimatedOg, 3)}`],
        ["Gravity points", `${round(bill.gravityPointsPerGallon, 1)} pts/gal`],
        ["Top contributors", topSources]
      ];
      if (ogDeltaPoints != null) mustRows.splice(1, 0, ["OG delta vs target", ogDeltaPoints === 0 ? "On target" : `${ogDeltaPoints > 0 ? "+" : ""}${ogDeltaPoints} points`]);
      renderRows("recipeMustSummary", mustRows);
    } else {
      $("recipeMustSummary").innerHTML = emptyState("Source bill waiting", "Add fermentable rows to see the gravity this recipe really builds.", "focus", "Source");
    }

    const deltaState = (() => {
      if (plan && bill && ogDeltaPoints != null) {
        if (ogDeltaPoints === 0) {
          return `<strong>On target.</strong> The current bill is landing on the planned OG.`;
        }
        return `<strong>${ogDeltaPoints > 0 ? "Reality is high" : "Reality is low"} by ${Math.abs(ogDeltaPoints)} points.</strong> ${ogDeltaPoints > 0 ? "Trim the bill or own the stronger build." : "Add gravity or lower the target."}`;
      }
      if (!plan && !bill) {
        return `Set the target and write the bill to compare the plan against the actual build.`;
      }
      if (!plan) {
        return `Set batch size and target ABV so the bill has an ideal to measure against.`;
      }
      return `Add fermentable rows so the actual build can answer the design target.`;
    })();
    $("recipeTargetRealityDelta").innerHTML = deltaState;

    const warnings = [];
    const greenlights = [];
    if (!recipe.name) warnings.push("Name the batch so the recipe stops living as anonymous sludge in the vault.");
    if (!recipe.targetAbv) warnings.push("Set the ABV target. Without it, the rest of the design has no spine.");
    if (!displayYeastName(recipe)) warnings.push("Choose a yeast so tolerance, temp, and nutrient expectations stop being vague.");
    if (!recipe.batchGallons) warnings.push("Set the batch size. Mead math without volume is fiction.");
    if (!(bill && bill.lineItems.length)) warnings.push("Build the source bill. The source bill should be the real recipe, not a note to self.");
    if (!sourceSummary.honey) warnings.push("No honey source is described in the source bill. If that is intentional, fine — but own that it stops reading like a classic mead build.");
    if (plan && plan.exceedsTolerance) warnings.push("Your stated target ABV is above the entered yeast tolerance. Either change the target, change the yeast, or plan step-feeding deliberately.");
    if (ogDeltaPoints != null && Math.abs(ogDeltaPoints) >= 8) warnings.push(`The current source bill sits ${Math.abs(ogDeltaPoints)} gravity points ${ogDeltaPoints > 0 ? "above" : "below"} the design target. Decide whether the target or the bill is wrong.`);
    if (actualOg && Number(recipe.yeastTolerance) && calcABV(actualOg, targetFg || 1.000) > Number(recipe.yeastTolerance) + 0.3) warnings.push("At the current source-bill gravity and target finish, the projected ABV likely outruns the selected yeast tolerance.");
    if ((bill?.lineItems || []).length >= 3 && !recipe.quickNote) warnings.push("This is a multi-source build with no quick note. Future-you will forget what the actual intent was.");
    const customCount = (bill?.lineItems || []).filter((item) => item.description.toLowerCase().includes("custom")).length;
    if (customCount) warnings.push("Custom source rows are in play. That is fine, but make sure the PPG values are measured or intentionally assumed.");
    if (plan && bill && Math.abs(ogDeltaPoints || 0) <= 5) greenlights.push("The source bill is landing close to the design target.");
    if (displayYeastName(recipe) && recipe.batchGallons && bill && bill.lineItems.length) greenlights.push("The recipe has enough structure to become a real batch instead of a rough concept.");
    if ((bill?.lineItems || []).some((item) => item.perGallonPoints > 150)) warnings.push("A single source is contributing an implausibly high gravity share (over 150 points/gallon on its own). Double-check its amount and unit — this usually means grams were entered as pounds, or a similar entry slip.");

    const hasAnyInput = recipe.name || recipe.targetAbv || recipe.batchGallons || displayYeastName(recipe) || (bill && bill.lineItems.length);
    if (!hasAnyInput) {
      $("recipeReadiness").innerHTML = emptyState("Sanity engine idle", "Start the recipe and the checks will sort out what is missing or contradictory.", "focus", "Checks");
    } else {
      const visibleWarnings = warnings.slice(0, 2);
      const extraWarnings = warnings.slice(2);
      $("recipeReadiness").innerHTML = `
        ${greenlights.length ? `<div class="readiness-group good"><div class="readiness-label">Working</div>${greenlights.map((line) => `<div class="readiness-item">${escapeHTML(line)}</div>`).join("")}</div>` : ""}
        ${warnings.length ? `<div class="readiness-group warn"><div class="readiness-label">Check</div>${visibleWarnings.map((line) => `<div class="readiness-item">${escapeHTML(line)}</div>`).join("")}${extraWarnings.length ? `<details class="readiness-more"><summary>${extraWarnings.length} more check${extraWarnings.length === 1 ? "" : "s"}</summary>${extraWarnings.map((line) => `<div class="readiness-item">${escapeHTML(line)}</div>`).join("")}</details>` : ""}</div>` : `<div class="readiness-group good"><div class="readiness-label">Coherent</div><div class="readiness-item">This design looks coherent. Next question: do the fermentation plan and finish path actually support it?</div></div>`}
      `;
    }

    const selected = currentRecipe();
    $("currentRecipeLaunch").innerHTML = selected
      ? `<strong>${escapeHTML(selected.name)}</strong><br>${escapeHTML(selected.style)} · ${escapeHTML(selected.batchGallons || "—")} gal · target ${escapeHTML(selected.targetAbv || selected.estimatedAbv || "—")}% ABV<br><span class="muted">${escapeHTML(selected.quickNote || recipeSourceSummary(selected).honey || "No quick note")}</span>`
      : emptyState("Browse Vault to load a recipe", "Saved drafts will show up here when you want to compare or reuse prior work.", "calm", "Vault");
  }

  function renderRecipes(){
    renderRecipeSourceList();
    renderRecipeComputed();
  }

  function renderCurrentBatchSummary(){
    const batch = data.currentBatch;
    const batchSummary = recipeSourceSummary(batch);
    if (!batchHasData()){
      $("currentBatchSummary").innerHTML = emptyState("No active batch", "Load a recipe from Build or restore one from Vault to start fermentation tracking.", "focus", "Ferment");
      return;
    }
    const batchFacts = [
      { text: `${batch.style || "Mead"} · ${batch.batchGallons || "—"} gal · ${batch.targetAbv || batch.estimatedAbv || "—"}% target ABV` },
      { text: `Target OG ${batch.targetOg || "—"} · Target FG ${batch.targetFg || "—"} · ${batch.sweetness || "—"}` },
      batchSummary.honey ? { text: `Honey: ${batchSummary.honey}` } : null,
      batchSummary.other ? { text: `Other sources: ${batchSummary.other}` } : null,
      displayYeastName(batch) || batch.temp ? { text: `Yeast: ${displayYeastName(batch) || "—"} · Temp: ${batch.temp || "—"}` } : null,
      batch.loadedAt ? { html: `Loaded: <span class="muted">${escapeHTML(formatDateTime(batch.loadedAt))}</span>` } : null
    ].filter(Boolean);
    $("currentBatchSummary").innerHTML = `
      <div><strong>${escapeHTML(batch.name || "Unnamed mead")}</strong></div>
      ${batchFacts.map((line) => `<div>${line.html || escapeHTML(line.text)}</div>`).join("")}
    `;
  }

  function formatStructureAdditionLine(row){
    const amount = [row.amount, row.unit].filter((v) => String(v || "").trim()).join(" ").trim();
    const parts = [
      amount,
      String(row.phase || "").trim(),
      String(row.purpose || "").trim(),
      String(row.contactTime || "").trim() ? `${row.contactTime} contact` : ""
    ].filter((v) => String(v || "").trim());
    return `<strong>${escapeHTML(row.ingredient)}</strong>${parts.length ? ` — ${escapeHTML(parts.join(" · "))}` : ""}`;
  }

  function phaseWatchouts(phase){
    const map = {
      primary: "Keep temp in the yeast's range, hit nutrients on schedule, and stop nutrient additions at the 1/3 sugar break.",
      secondary: "Taste any secondary additions every 48–72h and rack off when the profile is clean — over-extraction is hard to undo.",
      aging: "Minimize headspace and oxygen pickup. Give it real time before judging the profile.",
      stabilizing: "Confirm fermentation has fully stopped before chemical stabilization. Use sulfite + sorbate together if backsweetening.",
      packaging: "Re-check gravity for refermentation risk, and bench trial sweetness / acid / tannin before scaling to the full batch.",
      bottled: "Record a final sensory read and note how it changes with age."
    };
    return map[String(phase || "primary")] || map.primary;
  }

  function renderExecutionPlan(){
    const card = $("executionPlanCard");
    const body = $("executionPlanBody");
    if (!card || !body) return;
    if (!batchHasData()){
      card.hidden = true;
      body.innerHTML = "";
      return;
    }
    const batch = data.currentBatch;
    const additions = Array.isArray(batch.structureAdditions)
      ? batch.structureAdditions.filter((row) => row && String(row.ingredient || "").trim())
      : [];
    const benchAdds = additions.filter((row) => /bench/i.test(row.phase || ""));
    const scheduledAdds = additions.filter((row) => !/bench/i.test(row.phase || ""));
    const sections = [];

    if (String(batch.quickNote || "").trim()){
      sections.push(`<div class="exec-section"><div class="exec-label">Intent</div><div>${escapeHTML(batch.quickNote)}</div></div>`);
    }

    if (scheduledAdds.length){
      sections.push(`<div class="exec-section"><div class="exec-label">Scheduled additions</div><ul class="exec-list">${scheduledAdds.map((row) => `<li>${formatStructureAdditionLine(row)}${String(row.notes || "").trim() ? `<div class="muted">${escapeHTML(row.notes)}</div>` : ""}</li>`).join("")}</ul></div>`);
    }

    const benchBits = benchAdds.map((row) => `<li>${formatStructureAdditionLine(row)}</li>`);
    if (batch.sweetness && batch.sweetness !== "Dry"){
      benchBits.push(`<li>Backsweetening bench trial for a ${escapeHTML(String(batch.sweetness).toLowerCase())} finish — stabilize first</li>`);
    }
    if (benchBits.length){
      sections.push(`<div class="exec-section"><div class="exec-label">Bench trials before committing</div><ul class="exec-list">${benchBits.join("")}</ul></div>`);
    }

    const watchBits = [escapeHTML(phaseWatchouts(batch.phase))];
    if (batch.carbonation && batch.carbonation !== "Still"){
      watchBits.push(`Carbonation planned (${escapeHTML(String(batch.carbonation).toLowerCase())}) — use pressure-safe bottles only.`);
    }
    sections.push(`<div class="exec-section"><div class="exec-label">Watchouts — ${escapeHTML(batch.phase || "primary")} phase</div><div>${watchBits.join("<br>")}</div></div>`);

    card.hidden = false;
    body.innerHTML = sections.join("");
  }

  function setFermentEmptyState(hasBatch){
    // Until a real batch exists, hide the execution controls so the Ferment tab
    // does not present phase controls, step-feed math, logging, and an archive
    // CTA that have nothing to operate on.
    const batchOnlyIds = [
      "batchActions",
      "batchPhaseFields",
      "batchNotesField",
      "fermentChecklistCard",
      "stepFeedCard",
      "fermentTrendCard",
      "gravityLogCard",
      "sugarBreakCard",
      "raptAdminCard"
    ];
    batchOnlyIds.forEach((id) => {
      const el = $(id);
      if (el) el.hidden = !hasBatch;
    });
  }

  function renderFerment(){
    renderCurrentBatchSummary();
    renderExecutionPlan();
    setFermentEmptyState(batchHasData());
    $("batchPitchDate").value = data.currentBatch.pitchDate || "";
    $("batchPhase").value = data.currentBatch.phase || "primary";
    $("batchFermentNotes").value = data.currentBatch.fermentNotes || "";
    const checklistRemaining = data.fermentChecklist.filter((item) => !item.done).length;
    $("fermentChecklistSummary").textContent = checklistRemaining ? `${checklistRemaining} open` : "All done";
    $("fermentChecklist").innerHTML = data.fermentChecklist.map((item) => `
      <label class="check-item">
        <input type="checkbox" data-task-toggle="${item.id}" ${item.done ? "checked" : ""} />
        <span>${escapeHTML(item.text)}</span>
      </label>
    `).join("");

    const webhookUrl = `${window.location.origin}/.netlify/functions/rapt-bridge`;
    const latestRaptReading = data.rapt.latestGravity
      ? `SG ${escapeHTML(data.rapt.latestGravity)}${data.rapt.latestTempF ? ` at ${escapeHTML(data.rapt.latestTempF)}°F` : ""}`
      : "Waiting for device data";
    const raptStatus = data.rapt.lastError
      ? `Sync issue: ${escapeHTML(data.rapt.lastError)}`
      : escapeHTML(data.rapt.lastStatus || "Waiting for import");
    const rate = fermentationRateSummary(data.fermentationLogs);
    $("raptAdminSummary").textContent = data.rapt.lastReadingAt ? `Latest ${formatDateTime(data.rapt.lastReadingAt)}` : "Auto sync ready";

    renderRows("raptSyncSnapshot", [
      ["Status", raptStatus],
      ["Last fetch", escapeHTML(formatDateTime(data.rapt.lastFetchedAt))],
      ["Auto refresh", `Every ${Math.round(RAPT_AUTO_REFRESH_MS / 60000)} min while this tab is active`],
      ["Latest device reading", latestRaptReading],
      ["Telemetry timestamp", escapeHTML(formatDateTime(data.rapt.lastReadingAt))],
      ["Device", escapeHTML(data.rapt.deviceName || data.rapt.deviceId || "Waiting for first webhook")]
    ]);
    $("raptWebhookHint").innerHTML = `RAPT custom webhook target: <code>${escapeHTML(webhookUrl)}</code>. Use header <code>x-meadevil-secret</code> and batch <code>${escapeHTML(data.rapt.batchKey || "active")}</code>.`;

    const logs = sortLogsDescending(data.fermentationLogs);
    renderFermentationTrend(logs);
    const latest = latestGravityLog();
    $("fermentationTrendMeta").innerHTML = [
      latest ? `<span class="trend-meta-item">Latest gravity <strong>${escapeHTML(latest.gravity)}</strong></span>` : "",
      latest ? `<span class="trend-meta-item">Latest timestamp <strong>${escapeHTML(formatLogTimestamp(latest))}</strong></span>` : "",
      latest && latest.temp ? `<span class="trend-meta-item">Latest temp <strong>${escapeHTML(latest.temp)}°F</strong></span>` : ""
    ].filter(Boolean).join("");
    $("gravityLogSummary").textContent = logs.length ? `${logs.length} readings` : "No readings yet";
    const visibleLogs = data.ui.showAllFermentLogs ? logs : logs.slice(0, 12);
    $("toggleGravityLogBtn").textContent = data.ui.showAllFermentLogs ? "Show recent only" : `Show all logs${logs.length > 12 ? ` (${logs.length})` : ""}`;
    $("toggleGravityLogBtn").style.display = logs.length > 12 ? "inline-flex" : "none";
    $("gravityLog").innerHTML = logs.length
      ? visibleLogs.map((item) => {
          const editing = data.ui.editingLogId === item.id;
          if (editing) return `
          <div class="log-row log-editing">
            <div class="form-grid-4">
              <div class="field"><label>Date</label><input data-log-edit-field="date" data-log-edit-id="${item.id}" type="date" value="${escapeHTML(item.date)}" /></div>
              <div class="field"><label>SG</label><input data-log-edit-field="gravity" data-log-edit-id="${item.id}" value="${escapeHTML(item.gravity)}" /></div>
              <div class="field"><label>Temp</label><input data-log-edit-field="temp" data-log-edit-id="${item.id}" value="${escapeHTML(item.temp || "")}" /></div>
              <div class="field"><label>pH</label><input data-log-edit-field="pH" data-log-edit-id="${item.id}" value="${escapeHTML(item.pH || "")}" /></div>
            </div>
            <div class="field"><label>Note</label><input data-log-edit-field="note" data-log-edit-id="${item.id}" value="${escapeHTML(item.note || "")}" /></div>
            <div class="item-actions">
              <button class="mini-btn" data-log-save="${item.id}" type="button">Save</button>
              <button class="mini-btn" data-log-cancel="${item.id}" type="button">Cancel</button>
            </div>
          </div>`;
          return `
          <div class="log-row">
            <strong>${escapeHTML(item.date)} — SG ${escapeHTML(item.gravity)}</strong>
            <div class="muted">Temp ${escapeHTML(item.temp || "—")}°F · pH ${escapeHTML(item.pH || "—")}</div>
            <div class="muted">${escapeHTML(item.note || "")}</div>
            <div class="item-actions">
              ${item.source === "rapt" ? `<span class="small">Imported from RAPT</span>` : ""}
              <button class="mini-btn" data-log-edit="${item.id}" type="button">Edit</button>
              <button class="mini-btn" data-log-delete="${item.id}" type="button">Delete</button>
            </div>
          </div>`;
        }).join("")
      : emptyState("No gravity trail", "Add the first reading and the fermentation record becomes usable.", "focus", "Log");
    if (logs.length > visibleLogs.length){
      $("gravityLog").insertAdjacentHTML("beforeend", emptyState("Earlier readings hidden", `${logs.length - visibleLogs.length} older reading${logs.length - visibleLogs.length === 1 ? "" : "s"} are tucked away until you expand the full log.`, "calm", "History"));
    }

    const breakGravity = calcOneThirdBreak(data.currentBatch.targetOg || data.nutrients.og);
    if (breakGravity || latest) {
      const sbRows = [];
      if (breakGravity) sbRows.push(["1/3 break target", `${round(breakGravity, 3)}`]);
      if (latest) sbRows.push(["Latest reading", escapeHTML(latest.gravity)]);
      if (latest && breakGravity) sbRows.push(["Status", Number(latest.gravity) <= breakGravity ? "Past nutrient cutoff" : "Still in feeding window"]);
      if (rate.drop && rate.drop !== "—") sbRows.push(["Recent gravity drop", escapeHTML(rate.drop)]);
      if (rate.rate && rate.rate !== "—") sbRows.push(["Fermentation rate", escapeHTML(rate.rate)]);
      if (rate.window && rate.window !== "—") sbRows.push(["Rate window", escapeHTML(rate.window)]);
      if (rate.projection && rate.projection !== "—") sbRows.push(["Projection", escapeHTML(rate.projection)]);
      renderRows("sugarBreakSnapshot", sbRows);
    } else {
      $("sugarBreakSnapshot").innerHTML = emptyState("Sugar break waiting", "Record OG and at least one gravity reading to see the nutrient cutoff window.", "focus", "Break");
    }

    const step = calculateStepFeed({
      volumeGallons: data.currentBatch.batchGallons,
      pointsPerFeed: data.currentBatch.stepFeedPoints,
      honeyPPG: data.currentBatch.stepFeedHoneyPpg,
      feedCount: data.currentBatch.stepFeedCount
    });
    $("stepFeedPoints").value = data.currentBatch.stepFeedPoints || "30";
    $("stepFeedHoneyPpg").value = data.currentBatch.stepFeedHoneyPpg || "35";
    $("stepFeedCount").value = data.currentBatch.stepFeedCount || "1";
    $("stepFeedResult").innerHTML = step
      ? `Each feed adds about <strong>${round(step.honeyLbPerFeed, 2)} lb</strong> honey (${round(step.honeyOzPerFeed, 1)} oz / ${round(step.honeyKgPerFeed, 2)} kg) to raise the batch by ${escapeHTML(String(data.currentBatch.stepFeedPoints))} gravity points. Planned total: ${round(step.totalHoneyLb, 2)} lb across ${escapeHTML(String(data.currentBatch.stepFeedCount))} feed(s).`
      : `Load a batch with a volume first.`;
    $("stepFeedLog").innerHTML = data.currentBatch.stepFeedLog.length
      ? clone(data.currentBatch.stepFeedLog).reverse().map((entry) => `
          <div class="schedule-row">
            <strong>${escapeHTML(formatDate(entry.date))}</strong>
            <div class="muted">${round(entry.honeyLb, 2)} lb honey to add ${escapeHTML(entry.points)} points</div>
          </div>
        `).join("")
      : emptyState("No step feeds logged", "Feed events will appear here once you record them against the active batch.", "calm", "Feed");
  }

  function renderNutrients(){
    const tosna = currentTosnaPlan();
    const goFerm = calculateGoFerm(data.nutrients.dryYeast);
    const advanced = currentAdvancedPlan();
    const protocol = data.nutrients.protocol || "tosna";
    $("nutrientYeastRequirementDisplay").value = String(data.nutrients.yeastRequirement || "low").replace(/^./, (m) => m.toUpperCase());
    $("nutrientDryYeastDisplay").value = data.nutrients.dryYeast || "";
    document.querySelectorAll("[data-nutrient-protocol]").forEach((button) => {
      button.classList.toggle("active", button.dataset.nutrientProtocol === protocol);
    });
    const showLimits = protocol === "custom";
    const showRatios = protocol === "custom";
    const defaults = nutrientProtocolDefaults(protocol);
    $("nutrientEnforceLimitsWrap").style.display = showLimits ? "block" : "none";
    $("nutrientLimitGrid").style.display = showLimits ? "grid" : "none";
    $("nutrientRatioGrid").style.display = showRatios ? "grid" : "none";
    ["nutrientLimitO","nutrientLimitK","nutrientLimitD","nutrientRatioO","nutrientRatioK","nutrientRatioD","nutrientEnforceLimits"].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = protocol !== "custom";
    });

    if (advanced || tosna) {
      const qRows = [];
      if (advanced) qRows.push(["Protocol", escapeHTML(advanced.protocolLabel)]);
      if (tosna) qRows.push(["Resolved Brix", `${round(tosna.brix, 1)}`]);
      if (tosna && tosna.breakGravity) qRows.push(["1/3 sugar break", `${round(tosna.breakGravity, 3)}`]);
      if (data.nutrients.dryYeast) qRows.push(["Dry yeast", `${escapeHTML(String(data.nutrients.dryYeast))} g`]);
      if (goFerm) qRows.push(["Go-Ferm", `${round(goFerm.goFermGrams, 1)} g · ${round(goFerm.rehydrationWaterMl, 0)} mL water`]);
      if (data.nutrients.og) qRows.push(["Suggested YAN", `${suggestYanPpm({ og: data.nutrients.og, yeastRequirement: data.nutrients.yeastRequirement })} ppm before fruit offset`]);
      renderRows("nutrientSummary", qRows);
    } else {
      $("nutrientSummary").innerHTML = emptyState("Quick schedule waiting", "Set batch size and OG to generate the fast feed readout.", "focus", "Inputs");
    }

    $("nutrientSchedule").innerHTML = advanced
      ? advanced.schedule.map((step) => {
          const parts = [];
          if (step.gramsO > 0) parts.push(`${round(step.gramsO, 1)} g Fermaid O`);
          if (step.gramsK > 0) parts.push(`${round(step.gramsK, 1)} g Fermaid K`);
          if (step.gramsD > 0) parts.push(`${round(step.gramsD, 1)} g DAP`);
          const line = parts.length ? parts.join(" · ") : `${round(step.totalGrams, 1)} g total`;
          return `
          <div class="schedule-row">
            <strong>${escapeHTML(step.label)}</strong>
            <div class="muted">${line}</div>
          </div>
        `;
        }).join("")
      : emptyState("No quick schedule yet", "Choose a nutrient protocol to generate staged additions.", "calm", "Protocol");

    if (advanced) {
      renderRows("advancedNutrientSummary", [
        ["Target YAN", `${escapeHTML(String(data.nutrients.targetYanPpm))} ppm`],
        ["Fruit offset", `${round(advanced.fruitOffsetPpm, 0)} ppm`],
        ["Caps", protocol === "custom" ? "Custom" : "Protocol defaults applied"],
        ["Effective YAN", `${round(advanced.effectiveYanPpm, 0)} ppm`],
        ["Fermaid O", `${round(advanced.gramsO, 1)} g`],
        ["Fermaid K", `${round(advanced.gramsK, 1)} g`],
        ["DAP", `${round(advanced.gramsD, 1)} g`]
      ]);
    } else {
      $("advancedNutrientSummary").innerHTML = emptyState("Protocol output waiting", "Select a feed protocol to see resolved YAN and nutrient totals.", "focus", "Protocol");
    }

    $("advancedNutrientSchedule").innerHTML = advanced
      ? advanced.schedule.map((step) => `
          <div class="schedule-row">
            <strong>${escapeHTML(step.label)}</strong>
            <div class="muted">O ${round(step.gramsO, 1)} g · K ${round(step.gramsK, 1)} g · DAP ${round(step.gramsD, 1)} g</div>
          </div>
        `).join("")
      : emptyState("No feed schedule yet", "Once a protocol is chosen, the staged feed plan will land here.", "calm", "Schedule");

    const suggested = data.nutrients.og ? suggestYanPpm({ og: data.nutrients.og, yeastRequirement: data.nutrients.yeastRequirement }) : null;
    const yeastContext = displayYeastName(data.currentBatch) || displayYeastName(data.recipeDraft) || "selected yeast";
    $("nutrientDiscipline").innerHTML = `${data.nutrients.notes ? `Batch note: ${escapeHTML(data.nutrients.notes)}<br><br>` : ""}${suggested ? `For ${escapeHTML(yeastContext)}, a <strong>${escapeHTML(String(data.nutrients.yeastRequirement))}</strong> nitrogen-demand profile at this gravity suggests about <strong>${suggested} ppm</strong> before fruit offset.` : "Select a protocol to generate a feed plan."}`;
  }

  function renderCellar(){
    const c = data.cellar;
    const back = calculateBacksweetening({
      volumeGallons: c.backsweetenVolume,
      currentSg: c.backsweetenCurrentSg,
      targetSg: c.backsweetenTargetSg,
      honeyPPG: c.backsweetenPpg
    });
    $("backsweetenResult").innerHTML = back
      ? `Raise ${escapeHTML(String(c.backsweetenVolume))} gal from ${escapeHTML(String(c.backsweetenCurrentSg))} to ${escapeHTML(String(c.backsweetenTargetSg))} with about <strong>${round(back.honeyLb, 2)} lb</strong> of ${escapeHTML(String(c.backsweetenSourceType || "Honey").toLowerCase())} equivalent (${round(back.honeyOz, 1)} oz / ${round(back.honeyKg, 2)} kg).`
      : `Enter current and target gravity.`;

    const bench = calculateBenchTrial({
      batchGallons: c.benchBatchGallons,
      sampleMl: c.benchSampleMl,
      additionAmount: c.benchAddition
    });
    $("benchTrialResult").innerHTML = bench
      ? `The bench trial sample scales to about <strong>${round(bench.scaledAmount, c.benchUnit === "drops" ? 0 : 2)} ${escapeHTML(c.benchUnit)}</strong> for the whole batch.`
      : `Enter batch size, sample size, and the bench trial sample dose.`;

    const blend = calculateBlend({
      volume1: c.blendVol1,
      sg1: c.blendSg1,
      volume2: c.blendVol2,
      sg2: c.blendSg2
    });
    $("blendResult").innerHTML = blend
      ? `Blending yields about <strong>${round(blend.totalVolume, 2)} gal</strong> at roughly <strong>${round(blend.blendedSg, 3)}</strong> SG.`
      : `Enter two blend components.`;

    const bottles = calculateBottleCount({
      gallons: c.cellarGallons,
      bottleOz: c.cellarBottleOz,
      lossPct: c.cellarLossPct
    });
    $("cellarBottleResult").innerHTML = bottles
      ? `About <strong>${bottles.fullBottles}</strong> full ${escapeHTML(String(c.cellarBottleOz))} oz bottles with roughly ${round(bottles.leftoverOz, 1)} oz left after ${escapeHTML(String(c.cellarLossPct))}% loss.`
      : `Enter packaging values.`;

    $("cellarAdditionList").innerHTML = c.additions.length
      ? c.additions.map((row) => `
          <div class="recipe-source-row">
            <div class="compact-addition-top">
              <div class="field"><label>Type</label><select data-cellar-addition-id="${row.id}" data-cellar-addition-field="type"><option ${row.type === "Honey" ? "selected" : ""}>Honey</option><option ${row.type === "Fruit" ? "selected" : ""}>Fruit</option><option ${row.type === "Juice / Concentrate" ? "selected" : ""}>Juice / Concentrate</option><option ${row.type === "Oak" ? "selected" : ""}>Oak</option><option ${row.type === "Spice / Tincture" ? "selected" : ""}>Spice / Tincture</option><option ${row.type === "Acid" ? "selected" : ""}>Acid</option><option ${row.type === "Tannin" ? "selected" : ""}>Tannin</option><option ${row.type === "Finings" ? "selected" : ""}>Finings</option><option ${row.type === "Other" ? "selected" : ""}>Other</option></select></div>
              <div class="field"><label>Purpose</label><select data-cellar-addition-id="${row.id}" data-cellar-addition-field="purpose"><option ${row.purpose === "Sweetness" ? "selected" : ""}>Sweetness</option><option ${row.purpose === "Aroma" ? "selected" : ""}>Aroma</option><option ${row.purpose === "Flavor" ? "selected" : ""}>Flavor</option><option ${row.purpose === "Structure" ? "selected" : ""}>Structure</option><option ${row.purpose === "Clarification" ? "selected" : ""}>Clarification</option><option ${row.purpose === "Aging" ? "selected" : ""}>Aging</option></select></div>
              <div class="field"><label>Amount</label><input data-cellar-addition-id="${row.id}" data-cellar-addition-field="amount" value="${escapeHTML(row.amount || "")}" /></div>
              <div class="field"><label>Unit</label><select data-cellar-addition-id="${row.id}" data-cellar-addition-field="unit">${CELLAR_ADDITION_UNITS.map((unit) => `<option ${row.unit === unit ? "selected" : ""}>${unit}</option>`).join("")}</select></div>
              <div class="item-actions"><button class="mini-btn" data-cellar-addition-delete="${row.id}" type="button">Remove</button></div>
            </div>
            <div class="field source-notes"><label>Note</label><textarea data-cellar-addition-id="${row.id}" data-cellar-addition-field="notes" placeholder="Why it was added, trial result, timing, extraction goal…">${escapeHTML(row.notes || "")}</textarea></div>
          </div>
        `).join("")
      : emptyState("No finish additions logged", "Add honey, acid, tannin, fruit, oak, or finings only when they actually become part of the batch.", "calm", "Cellar");

    const analysis = cellarAnalysis();
    const statusLabel = analysis.gateReady ? "Gate clear" : "Gate waiting";
    const statusClass = analysis.gateReady ? "good" : "warn";
    const greenlightHtml = analysis.greenlights.length
      ? `<div class="cellar-status-line">${analysis.greenlights.map(escapeHTML).join("</div><div class=\"cellar-status-line\">")}</div>`
      : "";
    const stabVolume = Number(c.backsweetenVolume) || Number(c.cellarGallons) || Number(data.currentBatch.batchGallons) || null;
    const stabOg = fermentationOg();
    const stabLatestSg = analysis.latest ? Number(analysis.latest.gravity) : null;
    const measuredAbv = (stabOg && stabLatestSg) ? calcABV(stabOg, stabLatestSg) : null;
    const stabAbv = measuredAbv || Number(data.currentBatch.estimatedAbv) || Number(data.currentBatch.targetAbv) || null;
    const stab = calculateStabilizers ? calculateStabilizers({ volumeGallons: stabVolume, abv: stabAbv, ph: c.currentPh }) : null;
    if (stab){
      const sorbateBit = stab.sorbateUnnecessary
        ? `no sorbate needed — at ${round(stab.abv, 1)}% ABV the alcohol already blocks refermentation`
        : `<strong>${round(stab.sorbateGrams, 1)} g</strong> potassium sorbate`;
      const phBit = stab.phAssumed
        ? `pH assumed 3.6 — record the actual pH above to tighten the dose`
        : `pH ${stab.ph}`;
    }
    const stabilizerHtml = stab
      ? `<div class="cellar-status-line">Dose ${round(stab.volumeGallons, 2)} gal at ${round(stab.abv, 1)}% ABV: <strong>${round(stab.kmetaGrams, 1)} g</strong> k-meta for ${stab.so2Ppm} ppm free SO2 plus ${sorbateBit}. <span>${phBit}.</span></div>`
      : "";
    const [primaryWarning, ...extraWarnings] = analysis.warnings;
    const warningHtml = primaryWarning
      ? `<div class="cellar-status-check"><strong>Check</strong><span>${escapeHTML(primaryWarning)}</span></div>`
      : `<div class="cellar-status-check good"><strong>Ready</strong><span>Stability gate and finish path are internally consistent.</span></div>`;
    const extraWarningHtml = extraWarnings.length
      ? `<details class="cellar-status-more"><summary>${extraWarnings.length} more finish check${extraWarnings.length === 1 ? "" : "s"}</summary>${extraWarnings.map((line) => `<div>${escapeHTML(line)}</div>`).join("")}</details>`
      : "";
    $("cellarSmartSummary").innerHTML = `
      <div class="cellar-status ${statusClass}">
        <div class="cellar-status-head">
          <span>${escapeHTML(c.finishPath)}</span>
          <strong>${statusLabel}</strong>
        </div>
        ${greenlightHtml}
        ${stabilizerHtml}
        ${warningHtml}
        ${extraWarningHtml}
      </div>
    `;

    const additionCount = c.additions.filter((row) => row.amount || row.notes).length;
    const structureCount = Array.isArray(data.currentBatch.structureAdditions) ? data.currentBatch.structureAdditions.filter((row) => row && String(row.ingredient || "").trim()).length : 0;
    const archiveParts = [
      `the gravity trail`,
      `nutrient setup`,
      structureCount ? `<strong>${structureCount}</strong> structure addition${structureCount === 1 ? "" : "s"}` : "",
      `<strong>${additionCount}</strong> post-fermentation addition${additionCount === 1 ? "" : "s"}`,
      `the finish path, tasting notes, tags, and rebrew verdict`
    ].filter(Boolean).join(", ");
    $("archivePrepSummary").innerHTML = batchHasData()
      ? `Archiving right now would save <strong>${escapeHTML(data.currentBatch.name || "this batch")}</strong>, ${archiveParts}.`
      : emptyState("Finish a live batch before archiving", "Vault prep will summarize the batch once there is an active finish record.", "calm", "Vault");
  }

  function renderArchive(){
    $("recipeSearch").value = data.ui.recipeSearch || "";
    $("archiveSearch").value = data.ui.archiveSearch || "";
    const recipeSearch = (data.ui.recipeSearch || "").trim().toLowerCase();
    const recipes = clone(data.recipes)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .filter((recipe) => {
        if (!recipeSearch) return true;
        return recipeSearchText(recipe).includes(recipeSearch);
      });

    $("recipeList").innerHTML = recipes.length
      ? recipes.map((recipe) => `
          <div class="recipe-item ${data.ui.selectedRecipeId === recipe.id ? "active" : ""}">
            <div class="kicker">Updated ${escapeHTML(formatDate(recipe.updatedAt))}</div>
            <strong>${escapeHTML(recipe.name || "Unnamed recipe")}</strong>
            <div class="muted">${escapeHTML(recipe.style || "Mead")} · ${escapeHTML(recipe.batchGallons || "—")} gal · ${escapeHTML(recipe.targetAbv || recipe.estimatedAbv || "—")}% ABV</div>
            <div class="muted">${escapeHTML(recipe.quickNote || recipeSourceSummary(recipe).honey || "No quick note")}</div>
            <div class="item-actions">
              <button class="mini-btn" data-recipe-edit="${recipe.id}" type="button">Open in Build</button>
              <button class="mini-btn" data-recipe-load="${recipe.id}" type="button">Start batch</button>
              <button class="mini-btn" data-recipe-copy="${recipe.id}" type="button">Copy notes</button>
              <button class="mini-btn" data-recipe-delete="${recipe.id}" type="button">Delete</button>
            </div>
          </div>
        `).join("")
      : emptyState("Save a recipe from Build", "That will start the reusable build library here.", "focus", "Vault");

    const archiveSearch = (data.ui.archiveSearch || "").trim().toLowerCase();
    const items = clone(data.archive)
      .sort((a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime())
      .filter((item) => {
        if (!archiveSearch) return true;
        const addNames = Array.isArray(item.batch.structureAdditions) ? item.batch.structureAdditions.map((row) => row && row.ingredient || "").join(" ") : "";
        return [item.batch.name, item.batch.style, recipeSourceSummary(item.batch).honey, recipeSourceSummary(item.batch).other, addNames, item.cellar.tags, item.cellar.tastingNotes].join(" ").toLowerCase().includes(archiveSearch);
      });

    $("archiveList").innerHTML = items.length
      ? items.map((item) => {
          const linkedRecipe = item.batch.recipeId ? data.recipes.find((r) => r.id === item.batch.recipeId) : null;
          const archiveAdds = Array.isArray(item.batch.structureAdditions)
            ? item.batch.structureAdditions.filter((row) => row && String(row.ingredient || "").trim())
            : [];
          const addsSummary = archiveAdds.length
            ? archiveAdds.map((row) => {
                const amt = [row.amount, row.unit].filter((v) => String(v || "").trim()).join(" ").trim();
                return escapeHTML(row.ingredient) + (amt ? ` (${escapeHTML(amt)})` : "");
              }).join(", ")
            : "";
          return `
          <div class="archive-card">
            <div class="kicker">Archived ${escapeHTML(formatDate(item.archivedAt))}${linkedRecipe ? ` · From recipe: <strong>${escapeHTML(linkedRecipe.name)}</strong>` : ""}</div>
            <strong>${escapeHTML(item.batch.name || "Unnamed batch")}</strong>
            <div class="muted">${escapeHTML(item.batch.style || "Mead")} · OG ${escapeHTML(item.batch.targetOg || "—")} · FG ${escapeHTML(item.batch.targetFg || "—")} · ABV ${escapeHTML(item.batch.targetAbv || item.batch.estimatedAbv || "—")}%</div>
            <div class="muted">Honey: ${escapeHTML(recipeSourceSummary(item.batch).honey || "—")}</div>
            ${addsSummary ? `<div class="muted">Structure: ${addsSummary}</div>` : ""}
            <div class="muted">Finish: ${escapeHTML(item.cellar.finishPath || "—")} · Rating: ${escapeHTML(item.cellar.rating || "—")} · Tags: ${escapeHTML(item.cellar.tags || "—")} · Rebrew: ${item.cellar.wouldMakeAgain ? "Yes" : "No"}</div>
            <div class="muted">${escapeHTML(item.cellar.tastingNotes || "")}</div>
            <div class="item-actions">
              <button class="mini-btn" data-archive-load="${item.id}" type="button">Resume batch</button>
              <button class="mini-btn" data-archive-clone="${item.id}" type="button">Open as recipe</button>
              <button class="mini-btn" data-archive-delete="${item.id}" type="button">Delete</button>
            </div>
          </div>`;
        }).join("")
      : emptyState("Archive a finished batch from Finish", "That will start the cellar history here.", "focus", "Vault");
  }

  function renderCalcs(){
    const honey = estimateHoneyForTargetOG({ targetOg: data.calcs.targetOg, batchGallons: data.calcs.targetBatch, honeyPPG: data.calcs.targetPpg });
    $("calcHoneyNeededResult").innerHTML = honey
      ? `<strong>${round(honey.honeyLb, 2)} lb</strong> honey · ${round(honey.honeyKg, 2)} kg`
      : `Need OG, batch, and PPG.`;

    const og = estimateOGFromHoney({ honeyLb: data.calcs.honeyLb, batchGallons: data.calcs.honeyBatch, honeyPPG: data.calcs.honeyPpg });
    $("calcOgResult").innerHTML = og
      ? `<strong>${round(og.og, 3)}</strong> OG`
      : `Need honey, batch, and PPG.`;

    const abv = calcABV(data.calcs.abvOg, data.calcs.abvFg);
    $("calcAbvResult").innerHTML = abv
      ? `<strong>${round(abv, 2)}%</strong> ABV`
      : `Need OG + FG.`;

    const breakGravity = calcOneThirdBreak(data.calcs.breakOg);
    $("calcBreakResult").innerHTML = breakGravity
      ? `<strong>${round(breakGravity, 3)}</strong> SG`
      : `Need OG.`;

    const brix = sgToBrix(data.calcs.sgInput);
    $("calcBrixResult").innerHTML = brix
      ? `<strong>${round(brix, 1)} °Bx</strong>`
      : `Need SG.`;

    const sg = brixToSg(data.calcs.brixInput);
    $("calcSgResult").innerHTML = sg
      ? `<strong>${round(sg, 3)}</strong> SG`
      : `Need Brix.`;

    const targetRecipe = estimateRecipeTargets({
      batchGallons: data.calcs.recipeBatch,
      targetAbv: data.calcs.recipeAbv,
      sweetness: data.calcs.recipeSweetness,
      yeastTolerance: data.calcs.recipeTolerance,
      honeyPPG: 35
    });
    $("calcTargetRecipeResult").innerHTML = targetRecipe
      ? `<strong>${round(targetRecipe.targetOg, 3)}</strong> OG start · <strong>${round(targetRecipe.honeyLb, 2)} lb</strong> honey`
      : `Need batch + target ABV.`;

    renderFermenterProfileSelect();
    const updateProfileBtn = $("updateFermenterProfileBtn");
    const deleteProfileBtn = $("deleteFermenterProfileBtn");
    const selectedProfile = getSelectedFermenterProfile();
    if (updateProfileBtn) updateProfileBtn.disabled = !selectedProfile;
    if (deleteProfileBtn) deleteProfileBtn.disabled = !selectedProfile;
    const selectedCapacity = selectedProfile
      ? calculateFermenterVolumeEstimate({
          bottomDiameter: selectedProfile.bottomDiameter,
          topDiameter: selectedProfile.topDiameter,
          totalHeight: selectedProfile.totalHeight,
          liquidHeight: selectedProfile.totalHeight,
          sedimentHeight: 0
        })
      : null;
    $("calcFermenterProfileMeta").innerHTML = selectedProfile
      ? `${selectedCapacity ? `<span class="calc-profile-badge capacity">Full ${round(selectedCapacity.totalGallons, 2)} gal</span>` : ""}<span class="calc-profile-badge">Saved profile</span>`
      : "";

    const fermenter = calculateFermenterVolumeEstimate({
      bottomDiameter: data.calcs.fermenterBottomDiameter,
      topDiameter: data.calcs.fermenterTopDiameter,
      totalHeight: data.calcs.fermenterTotalHeight,
      liquidHeight: data.calcs.fermenterLiquidHeight,
      sedimentHeight: data.calcs.fermenterSedimentHeight
    });
    const liquidHeight = Number(data.calcs.fermenterLiquidHeight);
    const totalHeight = Number(data.calcs.fermenterTotalHeight);
    const sedimentHeight = Number(data.calcs.fermenterSedimentHeight || 0);
    const fermenterName = String((selectedProfile && selectedProfile.name) || data.calcs.fermenterProfileName || "Custom vessel").trim() || "Custom vessel";
    const fillPct = fermenter && fermenter.totalHeight > 0 ? Math.max(0, Math.min(100, (fermenter.liquidHeight / fermenter.totalHeight) * 100)) : 0;
    const cakePct = fermenter && fermenter.totalHeight > 0 ? Math.max(0, Math.min(fillPct, (fermenter.sedimentHeight / fermenter.totalHeight) * 100)) : 0;
    $("calcFermenterVolumeResult").innerHTML = fermenter
      ? `<div class="calc-fermenter-readout">
          <div class="calc-fermenter-topline">
            <div class="calc-fermenter-eyebrow">Live vessel estimate</div>
            <div class="calc-fermenter-profile-row">
              <div class="calc-fermenter-profile-pill">${escapeHTML(fermenterName)}</div>
              ${selectedCapacity ? `<div class="calc-profile-badge capacity">Full ${round(selectedCapacity.totalGallons, 2)} gal</div>` : ""}
            </div>
          </div>
          <div class="calc-fermenter-hero">
            <div class="calc-fermenter-viz">
              <div class="calc-fermenter-vessel" style="--fill-pct:${fillPct.toFixed(2)}%;--cake-pct:${cakePct.toFixed(2)}%">
                <div class="calc-fermenter-fill"></div>
                <div class="calc-fermenter-cake"></div>
                <div class="calc-fermenter-line"></div>
              </div>
              <div class="calc-fermenter-viz-caption">Fill line ${round(fermenter.liquidHeight, 2)} in</div>
            </div>
            <div class="calc-fermenter-hero-copy">
              <div class="calc-fermenter-big-label">Usable volume</div>
              <div class="calc-fermenter-big-number">${round(fermenter.netLiquidGallons, 2)} gal</div>
              <div class="calc-fermenter-subline">${round(fermenter.totalGallons, 2)} gal at fill line · ${round(fermenter.sedimentGallons, 2)} gal in cake layer</div>
            </div>
          </div>
          <div class="calc-fermenter-stat-grid">
            <div class="calc-fermenter-stat">
              <div class="calc-fermenter-stat-label">At Fill Line</div>
              <div class="calc-fermenter-stat-value">${round(fermenter.totalGallons, 2)} gal</div>
              <div class="calc-fermenter-stat-meta">${round(fermenter.totalLiters, 2)} L · ${round(fermenter.totalFluidOunces, 1)} fl oz</div>
            </div>
            <div class="calc-fermenter-stat">
              <div class="calc-fermenter-stat-label">Usable</div>
              <div class="calc-fermenter-stat-value">${round(fermenter.netLiquidGallons, 2)} gal</div>
              <div class="calc-fermenter-stat-meta">${round(fermenter.netLiquidLiters, 2)} L · ${round(fermenter.netLiquidFluidOunces, 1)} fl oz</div>
            </div>
            <div class="calc-fermenter-stat">
              <div class="calc-fermenter-stat-label">Cake Layer</div>
              <div class="calc-fermenter-stat-value">${round(fermenter.sedimentGallons, 2)} gal</div>
              <div class="calc-fermenter-stat-meta">${round(fermenter.sedimentHeight, 2)} in cake depth · fill diameter ${round(fermenter.fillLineDiameter, 2)} in</div>
            </div>
          </div>
        </div>`
      : liquidHeight > 0 && totalHeight > 0 && liquidHeight > totalHeight
        ? `<div class="calc-fermenter-empty error"><strong>Liquid height is above vessel height.</strong></div>`
        : sedimentHeight > liquidHeight && liquidHeight > 0
          ? `<div class="calc-fermenter-empty error"><strong>Cake height cannot exceed fill height.</strong></div>`
          : `<div class="calc-fermenter-empty"><strong>Enter vessel dimensions and a fill line.</strong></div>`;
  }

  function mentorKeywordBag(state){
    let beginner = {};
    try {
      const enhRaw = localStorage.getItem(ENHANCEMENT_KEY);
      const enh = enhRaw ? JSON.parse(enhRaw) : null;
      beginner = (enh && enh.mentor && enh.mentor.beginner) || {};
    } catch(e) {}
    return [
      state.conceptName,
      state.style,
      state.inspiration,
      state.vision,
      beginner.mustHaveSimple,
      beginner.avoidSimple,
      beginner.ingredientsOnHand,
      beginner.serveContext,
      beginner.noGo
    ].join(" ").toLowerCase();
  }

  function mentorFindMatches(bag, library){
    const haystack = String(bag || "").toLowerCase();
    if (!haystack) return [];
    return library
      .map((entry) => {
        const terms = [entry.name, ...(entry.aliases || [])]
          .map((term) => String(term || "").toLowerCase())
          .filter(Boolean);
        const score = terms.reduce((total, term) => total + (haystack.includes(term) ? (term.length + 20) : 0), 0);
        return { entry, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.entry);
  }

  function mentorResolveEntryFromText(text, library){
    const bag = String(text || "").toLowerCase();
    if (!bag) return null;
    return mentorFindMatches(bag, library)[0] || null;
  }

  function activeMentorKnowledge(){
    return normalizeMentorKnowledge((data || {}).mentorKnowledge);
  }

  function mentorPickArchetype(bag, archetypeLibrary){
    const list = Array.isArray(archetypeLibrary) ? archetypeLibrary : [];
    const haystack = String(bag || "").toLowerCase();
    let best = null;
    let bestScore = 0;
    list.forEach((archetype) => {
      const score = (archetype.aliases || []).reduce((total, alias) => {
        const term = String(alias || "").toLowerCase();
        return total + (term && haystack.includes(term) ? term.length + 30 : 0);
      }, 0);
      if (score > bestScore){
        best = archetype;
        bestScore = score;
      }
    });
    return best || list.find((item) => item.key === "honey_first") || list[0] || null;
  }

  function mentorResolveYeastName(inputText, fallback, yeastLibrary){
    const upper = String(inputText || "").toUpperCase();
    const directPreset = Object.keys(YEAST_PRESETS).find((name) => upper.includes(name));
    if (directPreset) return directPreset;
    const kbMatch = mentorResolveEntryFromText(inputText, Array.isArray(yeastLibrary) ? yeastLibrary : []);
    if (kbMatch && kbMatch.name) return kbMatch.name;
    return fallback || "";
  }

  function mentorResolveRecipeStyle(raw, fallback){
    const normalized = String(raw || "").toLowerCase().trim();
    if (!normalized) return fallback;
    const exact = RECIPE_STYLE_OPTIONS.find((option) => option.toLowerCase() === normalized);
    if (exact) return exact;
    const partial = RECIPE_STYLE_OPTIONS.find((option) => normalized.includes(option.toLowerCase()));
    return partial || fallback;
  }

  function mentorScaledRange(adjunct, gallons){
    const perGalMin = Number(adjunct.perGalMin);
    const perGalMax = Number(adjunct.perGalMax);
    if (!(perGalMin > 0 && perGalMax > 0 && gallons > 0)){
      return `${adjunct.stage}: ${adjunct.role}.`;
    }
    const precision = String(adjunct.unit || "").includes("zest") ? 1 : 2;
    const minTotal = round(perGalMin * gallons, precision);
    const maxTotal = round(perGalMax * gallons, precision);
    return `${adjunct.stage}: ${perGalMin}-${perGalMax} ${adjunct.unit}/gal (${minTotal}-${maxTotal} ${adjunct.unit} for ${round(gallons, 1)} gal). ${adjunct.role}.`;
  }

  function buildMentor(state){
    const kb = activeMentorKnowledge();
    const honeyLibrary = Array.isArray(kb.honeys) && kb.honeys.length ? kb.honeys : clone(MENTOR_HONEY_KB);
    const yeastLibrary = Array.isArray(kb.yeasts) && kb.yeasts.length ? kb.yeasts : clone(MENTOR_YEAST_KB);
    const adjunctLibrary = Array.isArray(kb.adjuncts) && kb.adjuncts.length ? kb.adjuncts : clone(MENTOR_ADJUNCT_KB);
    const archetypeLibrary = Array.isArray(kb.archetypes) && kb.archetypes.length ? kb.archetypes : clone(MENTOR_ARCHETYPE_KB);

    const bag = mentorKeywordBag(state);
    const archetype = mentorPickArchetype(bag, archetypeLibrary);
    const matchedAdjuncts = mentorFindMatches(bag, adjunctLibrary).slice(0, 4);
    const matchedHoneys = mentorFindMatches(bag, honeyLibrary);

    const selectedHoney = mentorResolveEntryFromText(state.honey, honeyLibrary)
      || matchedHoneys[0]
      || mentorResolveEntryFromText(archetype ? archetype.defaultHoney : "", honeyLibrary)
      || honeyLibrary[0]
      || MENTOR_HONEY_KB[0];

    const defaultYeast = archetype ? archetype.defaultYeast : "71B";
    const resolvedYeastName = mentorResolveYeastName(state.yeast, defaultYeast, yeastLibrary);
    const yeastPreset = YEAST_PRESETS[resolvedYeastName] || null;
    const yeastKb = yeastLibrary.find((entry) => entry.name === resolvedYeastName) || null;

    const batchGallons = Number(state.batchSize) > 0 ? Number(state.batchSize) : MENTOR_DEFAULT_BATCH_GAL;
    const targetAbv = Number(state.targetAbv) > 0 ? Number(state.targetAbv) : (Number(archetype && archetype.defaultAbv) || MENTOR_DEFAULT_ABV);
    const sweetness = state.sweetness || (archetype && archetype.defaultSweetness) || "Semi-sweet";
    const carbonation = state.carbonation || "Still";
    const recipeStyle = mentorResolveRecipeStyle(state.style, (archetype && archetype.recipeStyle) || "Traditional");

    const projected = estimateRecipeTargets({
      batchGallons,
      targetAbv,
      sweetness,
      yeastTolerance: yeastPreset ? yeastPreset.tolerance : "",
      honeyPPG: 35
    });

    const totalHoneyLb = projected && projected.honeyLb ? projected.honeyLb : null;
    const baseHoneyLb = totalHoneyLb ? round(totalHoneyLb * 0.88, 2) : null;
    const reserveHoneyLb = totalHoneyLb ? round(totalHoneyLb - baseHoneyLb, 2) : null;
    const yanTarget = projected && projected.targetOg
      ? suggestYanPpm({ og: projected.targetOg, yeastRequirement: yeastPreset ? yeastPreset.nitrogenRequirement : "low" })
      : null;

    const pairings = [];
    const architecture = [];
    const ingredientPlan = [];
    const conflicts = [];
    const finish = [];
    const title = state.conceptName || "This mead concept";
    const adjunctLabel = matchedAdjuncts.length ? matchedAdjuncts.map((adjunct) => adjunct.name).join(", ") : "No adjuncts locked yet";

    pairings.push(["Identity", archetype ? archetype.lead : "Pick a clear lead actor for the glass (honey, fruit, oak, spice, or finish)."]);
    pairings.push(["Aroma stack", `${selectedHoney.name} honey + ${adjunctLabel}`]);
    pairings.push(["Palate target", state.vision || "Define the exact mouthfeel and finish in one sentence before buying ingredients."]);
    pairings.push(["Service posture", archetype ? archetype.packaging : `Planned as ${carbonation.toLowerCase()} mead.`]);

    architecture.push(["Batch target", `${round(batchGallons, 1)} gal at ${round(targetAbv, 1)}% ABV (${sweetness.toLowerCase()}, ${carbonation.toLowerCase()})`]);
    architecture.push(["Gravity track", projected ? `OG ${round(projected.targetOg, 3)} to FG ${round(projected.targetFg, 3)}.` : "Set batch size and ABV to generate OG/FG targets."]);
    architecture.push(["Fermentables", totalHoneyLb ? `${round(totalHoneyLb, 2)} lb honey total. Start around ${baseHoneyLb} lb in primary and hold about ${reserveHoneyLb} lb for finish tuning.` : "Need ABV + batch size for fermentable weight guidance."]);
    architecture.push(["Yeast lane", `${resolvedYeastName}${yeastPreset ? ` (tolerance ${yeastPreset.tolerance}% | ${yeastPreset.temp})` : ""}${yeastKb ? ` - ${yeastKb.lane}.` : "."}`]);
    architecture.push(["Recommendation basis", "Style/archetype matching + editable honey/yeast/adjunct libraries + dose guardrails from the local knowledge base."]);
    architecture.push(["Structure rail", state.structure || (archetype ? `${archetype.acidPlan} ${archetype.tanninPlan}` : "Define acid and tannin posture now so sweetness is not carrying the whole concept." )]);
    architecture.push(["Nutrition intent", yanTarget ? `Target roughly ${yanTarget} ppm YAN and keep additions complete by the one-third sugar break.` : "Target YAN will appear once gravity targets are set."]);

    ingredientPlan.push(["Primary honey", `${selectedHoney.name}: ${selectedHoney.profile}. Best lane: ${selectedHoney.bestUse}.`]);
    if (matchedAdjuncts.length){
      matchedAdjuncts.forEach((adjunct) => {
        ingredientPlan.push([adjunct.name, mentorScaledRange(adjunct, batchGallons)]);
      });
    } else {
      ingredientPlan.push(["Adjunct ranges", "Add adjunct ideas in the concept notes to unlock stage-specific dose ranges."]);
    }

    matchedAdjuncts.forEach((adjunct) => {
      conflicts.push([`${adjunct.name} risk`, adjunct.caution]);
    });
    if (projected && projected.exceedsTolerance){
      conflicts.push(["Yeast mismatch", `Target ABV (${round(targetAbv, 1)}%) is above ${resolvedYeastName} tolerance. Lower ABV or pick a harder yeast lane.`]);
    }
    if (state.avoid){
      conflicts.push(["Avoid list lock", `Guardrail: ${state.avoid}. Build every process choice to avoid these failure notes.`]);
    }
    if (state.constraints){
      conflicts.push(["Constraints", state.constraints]);
    }
    if (!conflicts.length){
      conflicts.push(["No major clashes flagged", "Main risk is execution drift: poor extraction timing, no bench trials, or uncontrolled fermentation temp."]);
    }

    finish.push(["Stage 1 - Primary", projected ? `Build must to OG ${round(projected.targetOg, 3)}, run a healthy pitch, and keep temperature steady in ${yeastPreset ? yeastPreset.temp : "the yeast comfort zone"}.` : "Set gravity target before moving to production steps."]);
    finish.push(["Stage 2 - Secondary", matchedAdjuncts.length ? `Run staged adjunct extraction: ${matchedAdjuncts.map((adjunct) => adjunct.name).join(", ")}. Taste every 48-72 hours and pull when profile is clean.` : "Define secondary additions and extraction windows."]);
    finish.push(["Stage 3 - Bench tuning", "After stabilization, run sweetness/acid/tannin bench trials and lock a target that protects aroma while keeping line on the finish."]);
    finish.push(["Stage 4 - Package", archetype ? archetype.packaging : `Package as ${carbonation.toLowerCase()} once stable gravity and sensory targets hold for at least two readings.`]);

    const summary = `${title} now has a full build lane: ${archetype ? archetype.lead : "custom profile"}. This board is generating a numeric recipe skeleton and stage-by-stage execution plan instead of generic brainstorming text.`;

    const noteSections = [
      state.inspiration ? `Inspiration: ${state.inspiration}` : "",
      state.vision ? `Drinking experience: ${state.vision}` : "",
      `Flavor map: ${pairings.map((row) => `${row[0]} - ${row[1]}`).join(" | ")}`,
      `Process plan: ${finish.map((row) => `${row[0]} - ${row[1]}`).join(" | ")}`,
      conflicts.length ? `Risk controls: ${conflicts.map((row) => `${row[0]} - ${row[1]}`).join(" | ")}` : ""
    ].filter(Boolean);

    const blueprint = {
      style: recipeStyle,
      batchGallons: String(round(batchGallons, 1)),
      targetAbv: String(round(targetAbv, 1)),
      sweetness,
      carbonation,
      yeast: YEAST_PRESETS[resolvedYeastName] ? resolvedYeastName : "Other / Custom",
      yeastOther: YEAST_PRESETS[resolvedYeastName] ? "" : resolvedYeastName,
      yeastTolerance: yeastPreset ? yeastPreset.tolerance : "",
      temp: yeastPreset ? yeastPreset.temp : "",
      nitrogenRequirement: yeastPreset ? yeastPreset.nitrogenRequirement : "low",
      honeyBase: selectedHoney ? selectedHoney.name : "",
      fruitAdjuncts: matchedAdjuncts.map((adjunct) => adjunct.name).join(", "),
      acidPlan: state.structure || (archetype ? archetype.acidPlan : ""),
      tanninPlan: archetype ? archetype.tanninPlan : "Bench-test tannin so the finish has grip but no harshness.",
      quickNote: state.mustHave || (archetype ? archetype.lead : ""),
      notes: noteSections.join("\n\n"),
      targetOg: projected ? String(round(projected.targetOg, 3)) : "",
      targetFg: projected ? String(round(projected.targetFg, 3)) : "",
      estimatedAbv: projected ? String(round(projected.targetAbv, 1)) : "",
      additions: totalHoneyLb
        ? [{
            ...defaultAdditionRow(),
            sourceType: "Honey",
            description: `${selectedHoney.name} base honey`,
            amount: String(baseHoneyLb || round(totalHoneyLb, 2)),
            unit: "lb",
            ppg: sourceDefault("Honey")
          }]
        : [defaultAdditionRow()]
    };

    return { summary, pairings, architecture, ingredientPlan, conflicts, finish, blueprint };
  }

  function renderMentor(){
    const built = buildMentor(data.mentor);
    renderRows("mentorPairings", built.pairings);
    renderRows("mentorIngredientPlan", built.ingredientPlan);
  }

  function renderAll(){
    syncRecipeDerived();
    renderTabs();
    clockDisplay();
    renderDashboard();
    renderRecipes();
    renderFerment();
    renderNutrients();
    renderCellar();
    renderArchive();
    renderCalcs();
    renderMentor();
  }

  /* =========================================================
     Form hydration helpers
     ========================================================= */

  function populateRecipeForm(){
    const r = data.recipeDraft;
    $("recipeName").value = r.name || "";
    $("recipeStyle").value = r.style || "Traditional";
    $("recipeBatchGallons").value = r.batchGallons || "";
    $("recipeTargetAbv").value = r.targetAbv || "";
    $("recipeSweetness").value = r.sweetness || "Dry";
    $("recipeCarbonation").value = r.carbonation || "Still";
    $("recipeYeast").value = r.yeast || "";
    $("recipeDryYeast").value = r.dryYeast || "";
    $("recipeYeastTolerance").value = r.yeastTolerance || "";
    $("recipeTemp").value = r.temp || "";
    if ($("recipeNitrogenRequirement")) $("recipeNitrogenRequirement").value = r.nitrogenRequirement || "low";
    if ($("recipeYeastOther")) $("recipeYeastOther").value = r.yeastOther || "";
    applyYeastPresetToDraft(r.yeast || "");
    $("recipeTags").value = r.tags || "";
    $("recipeQuickNote").value = r.quickNote || "";
    $("recipeNotes").value = r.notes || "";
  }

  function populateNutrientForm(){
    const n = data.nutrients;
    $("nutrientBatchGallons").value = n.batchGallons || "";
    $("nutrientOg").value = n.og || "";
    $("nutrientBrix").value = n.brix || "";
    $("nutrientYeastRequirementDisplay").value = n.yeastRequirement || "low";
    $("nutrientDryYeastDisplay").value = n.dryYeast || "";
    document.querySelectorAll("[data-nutrient-protocol]").forEach((button) => {
      button.classList.toggle("active", button.dataset.nutrientProtocol === (n.protocol || "tosna"));
    });
    $("nutrientFruitOffset").value = n.fruitOffsetPpm || "0";
    $("nutrientTargetYan").value = n.targetYanPpm || "160";
    $("nutrientEnforceLimits").checked = Boolean(n.enforceLimits);
    $("nutrientLimitO").value = n.limitO || "1.2";
    $("nutrientLimitK").value = n.limitK || "0.5";
    $("nutrientLimitD").value = n.limitD || "0.96";
    $("nutrientRatioO").value = n.ratioO || "60";
    $("nutrientRatioK").value = n.ratioK || "25";
    $("nutrientRatioD").value = n.ratioD || "15";
    $("nutrientNotes").value = n.notes || "";
  }

  function populateCellarForm(){
    const c = data.cellar;
    $("finishPath").value = c.finishPath || "Backsweetened and still";
    $("stableSgA").value = c.stableSgA || "";
    $("stableDateA").value = c.stableDateA || "";
    $("stableSgB").value = c.stableSgB || "";
    $("stableDateB").value = c.stableDateB || "";
    $("cellarCurrentPh").value = c.currentPh || "";
    $("cellarCurrentTemp").value = c.currentTemp || "";
    $("kmetaAmount").value = c.kmetaAmount || "";
    $("sorbateAmount").value = c.sorbateAmount || "";
    $("backsweetenVolume").value = c.backsweetenVolume || "";
    $("backsweetenCurrentSg").value = c.backsweetenCurrentSg || "";
    $("backsweetenTargetSg").value = c.backsweetenTargetSg || "";
    $("backsweetenSourceType").value = c.backsweetenSourceType || "Honey";
    $("backsweetenPpg").value = c.backsweetenPpg || "35";
    $("backsweetenPpg").disabled = sourceLocked(c.backsweetenSourceType || "Honey");
    $("benchBatchGallons").value = c.benchBatchGallons || "";
    $("benchSampleMl").value = c.benchSampleMl || "100";
    $("benchAddition").value = c.benchAddition || "";
    $("benchUnit").value = c.benchUnit || "g";
    $("blendVol1").value = c.blendVol1 || "";
    $("blendSg1").value = c.blendSg1 || "";
    $("blendVol2").value = c.blendVol2 || "";
    $("blendSg2").value = c.blendSg2 || "";
    $("cellarGallons").value = c.cellarGallons || "";
    $("cellarBottleOz").value = c.cellarBottleOz || "12";
    $("cellarLossPct").value = c.cellarLossPct || "5";
    $("stabilizationNotes").value = c.stabilizationNotes || "";
    $("packagingNotes").value = c.packagingNotes || "";
    $("tastingNotes").value = c.tastingNotes || "";
    $("cellarRating").value = c.rating || "";
    $("cellarTags").value = c.tags || "";
    $("wouldMakeAgain").checked = Boolean(c.wouldMakeAgain);
  }

  function populateCalcForm(){
    const c = data.calcs;
    $("calcTargetOg").value = c.targetOg || "";
    $("calcTargetBatch").value = c.targetBatch || "";
    $("calcTargetPpg").value = c.targetPpg || "35";
    $("calcHoneyLb").value = c.honeyLb || "";
    $("calcHoneyBatch").value = c.honeyBatch || "";
    $("calcHoneyPpg").value = c.honeyPpg || "35";
    $("calcAbvOg").value = c.abvOg || "";
    $("calcAbvFg").value = c.abvFg || "";
    $("calcBreakOg").value = c.breakOg || "";
    $("calcSgInput").value = c.sgInput || "";
    $("calcBrixInput").value = c.brixInput || "";
    $("calcRecipeBatch").value = c.recipeBatch || "";
    $("calcRecipeAbv").value = c.recipeAbv || "";
    $("calcRecipeSweetness").value = c.recipeSweetness || "Dry";
    $("calcRecipeTolerance").value = c.recipeTolerance || "";
    $("calcFermenterProfileName").value = c.fermenterProfileName || "";
    $("calcFermenterBottomDiameter").value = c.fermenterBottomDiameter || "";
    $("calcFermenterTopDiameter").value = c.fermenterTopDiameter || "";
    $("calcFermenterTotalHeight").value = c.fermenterTotalHeight || "";
    $("calcFermenterLiquidHeight").value = c.fermenterLiquidHeight || "";
    $("calcFermenterSedimentHeight").value = c.fermenterSedimentHeight || "";
    renderFermenterProfileSelect();
  }

  function getFermenterProfiles(){
    const raw = Array.isArray(data.calcs.fermenterProfiles) ? data.calcs.fermenterProfiles : [];
    return raw
      .map((profile, index) => ({
        id: profile && profile.id ? String(profile.id) : `fermenter-${index}`,
        name: String((profile && profile.name) || "").trim(),
        bottomDiameter: profile && profile.bottomDiameter != null ? String(profile.bottomDiameter) : "",
        topDiameter: profile && profile.topDiameter != null ? String(profile.topDiameter) : "",
        totalHeight: profile && profile.totalHeight != null ? String(profile.totalHeight) : ""
      }))
      .filter((profile) => profile.name);
  }

  function getSelectedFermenterProfile(){
    const selectedId = String(data.calcs.fermenterProfileId || "");
    if (!selectedId) return null;
    return getFermenterProfiles().find((profile) => profile.id === selectedId) || null;
  }

  function renderFermenterProfileSelect(){
    const select = $("calcFermenterProfileSelect");
    if (!select) return;
    const profiles = getFermenterProfiles().slice().sort((a, b) => a.name.localeCompare(b.name));
    const currentValue = String(data.calcs.fermenterProfileId || "");
    select.innerHTML = "";
    const custom = document.createElement("option");
    custom.value = "";
    custom.textContent = "Custom / unsaved";
    select.appendChild(custom);
    profiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name;
      select.appendChild(option);
    });
    select.value = profiles.some((profile) => profile.id === currentValue) ? currentValue : "";
  }

  function currentFermenterProfileDraft(){
    return {
      name: String(data.calcs.fermenterProfileName || "").trim(),
      bottomDiameter: String(data.calcs.fermenterBottomDiameter || "").trim(),
      topDiameter: String(data.calcs.fermenterTopDiameter || "").trim(),
      totalHeight: String(data.calcs.fermenterTotalHeight || "").trim()
    };
  }

  function validateFermenterProfileDraft(profile){
    if (!profile.name) return "Enter a fermenter profile name.";
    const estimate = calculateFermenterVolumeEstimate({
      bottomDiameter: profile.bottomDiameter,
      topDiameter: profile.topDiameter,
      totalHeight: profile.totalHeight,
      liquidHeight: profile.totalHeight,
      sedimentHeight: 0
    });
    if (!estimate) return "Enter valid positive inside dimensions for the fermenter profile.";
    return "";
  }

  function applyFermenterProfile(profile){
    if (!profile) return;
    data.calcs.fermenterProfileId = profile.id;
    data.calcs.fermenterProfileName = profile.name;
    data.calcs.fermenterBottomDiameter = profile.bottomDiameter;
    data.calcs.fermenterTopDiameter = profile.topDiameter;
    data.calcs.fermenterTotalHeight = profile.totalHeight;
  }

  function populateMentorForm(){
    const m = data.mentor;
    const setField = (id, value) => {
      const el = $(id);
      if (!el) return;
      el.value = value;
    };
    setField("mentorConceptName", m.conceptName || "");
    setField("mentorStyle", m.style || "");
    setField("mentorInspiration", m.inspiration || "");
    setField("mentorVision", m.vision || "");
    setField("mentorBatchSize", m.batchSize || "");
    setField("mentorTargetAbv", m.targetAbv || "");
    setField("mentorSweetness", m.sweetness || "Dry");
    setField("mentorCarbonation", m.carbonation || "Still");
  }

  function recipeFromDraft(){
    syncRecipeDerived();
    return normalizeRecipe({ ...data.recipeDraft, updatedAt: new Date().toISOString() });
  }

  function readEnhancementStructureAdditions(context){
    try {
      const raw = localStorage.getItem(ENHANCEMENT_KEY);
      const enh = raw ? JSON.parse(raw) : null;
      if (!enh) return [];
      if (context === "recipeDraft") return Array.isArray(enh.recipeDraft && enh.recipeDraft.structureAdditions) ? enh.recipeDraft.structureAdditions : [];
      if (context === "currentBatch") return Array.isArray(enh.currentBatch && enh.currentBatch.structureAdditions) ? enh.currentBatch.structureAdditions : [];
      return [];
    } catch(e) { return []; }
  }

  function applyRecipeToBatch(recipe){
    data.currentBatch = {
      ...defaultCurrentBatch(),
      ...clone(recipe),
      recipeId: recipe.id || "",
      // Carry recipe notes forward so the operator can still see the design
      // intent after loading the batch into Ferment.
      fermentNotes: recipe.notes || "",
      stepFeedPoints: "30",
      stepFeedHoneyPpg: "35",
      stepFeedCount: "1",
      stepFeedLog: [],
      loadedAt: new Date().toISOString()
    };
    data.fermentationLogs = [];
    data.fermentChecklist = buildRecipeAwareChecklist(recipe);
    let structureAdds = Array.isArray(recipe.structureAdditions) && recipe.structureAdditions.length
      ? recipe.structureAdditions
      : readEnhancementStructureAdditions("recipeDraft");
    data.currentBatch.structureAdditions = clone(structureAdds);
    // Cellar is post-fermentation truth: it must only ever hold additions that
    // actually happened. Planned structure additions stay on the batch (and are
    // shown in the Ferment execution plan) but are NOT pre-logged here.
    data.cellar = { ...defaultCellar(), cellarGallons: recipe.batchGallons || "", backsweetenVolume: recipe.batchGallons || "", benchBatchGallons: recipe.batchGallons || "", backsweetenCurrentSg: recipe.targetFg || "" };
    data.cellarChecklist = defaultCellarChecklist();
    syncNutrientsFromRecipe(recipe, { force: true });
    data.nutrients.protocol = "tosna";
    applyNutrientProtocolDefaults("tosna");
    syncCurrentBatchDerived();
    persistData();
    populateNutrientForm();
    populateCellarForm();
    renderAll();
    setActiveTab("ferment");
  }

  /* =========================================================
     Event binding layer
     ========================================================= */

  function bindTabs(){
    document.querySelectorAll("[data-tab].tab-btn").forEach((button) => {
      button.addEventListener("click", () => setActiveTab(button.dataset.tab));
    });
    document.querySelectorAll("[data-open-tab]").forEach((button) => {
      button.addEventListener("click", () => setActiveTab(button.dataset.openTab));
    });
  }

  function bindClock(){
    $("batchClockBtn").addEventListener("click", () => {
      if (data.clock.running){
        if (data.clock.lastStartedAt){
          data.clock.elapsedMs = (Number(data.clock.elapsedMs) || 0) + Math.max(0, Date.now() - data.clock.lastStartedAt);
        }
        data.clock.running = false;
        data.clock.lastStartedAt = null;
      } else {
        data.clock.running = true;
        data.clock.lastStartedAt = Date.now();
      }
      persistData();
      startClockTicker();
    });

    $("batchClockResetBtn").addEventListener("click", () => {
      data.clock.elapsedMs = 0;
      data.clock.running = false;
      data.clock.lastStartedAt = null;
      persistData();
      startClockTicker();
    });
  }

  function bindRecipeFields(){
    const mapping = {
      recipeName: "name",
      recipeStyle: "style",
      recipeBatchGallons: "batchGallons",
      recipeTargetAbv: "targetAbv",
      recipeSweetness: "sweetness",
      recipeCarbonation: "carbonation",
      recipeDryYeast: "dryYeast",
      recipeYeastTolerance: "yeastTolerance",
      recipeTemp: "temp",
      recipeNitrogenRequirement: "nitrogenRequirement",
      recipeYeastOther: "yeastOther",
      recipeTags: "tags",
      recipeQuickNote: "quickNote",
      recipeNotes: "notes"
    };
    $("recipeYeast").addEventListener("change", () => {
      data.recipeDraft.yeast = $("recipeYeast").value;
      applyYeastPresetToDraft(data.recipeDraft.yeast);
      syncRecipeDerived();
      syncNutrientsFromRecipe(data.recipeDraft, { force: true });
      persistData();
      populateNutrientForm();
      renderRecipes();
      renderNutrients();
      renderCalcs();
    });

    Object.entries(mapping).forEach(([id, key]) => {
      const el = $(id);
      const handler = () => {
        data.recipeDraft[key] = el.value;
        syncRecipeDerived();
        if (["batchGallons","targetAbv","dryYeast","nitrogenRequirement","yeastTolerance","temp"].includes(key)){
          syncNutrientsFromRecipe(data.recipeDraft);
          populateNutrientForm();
          renderNutrients();
        }
        persistData();
        renderRecipes();
        renderCalcs();
      };
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });

    $("addRecipeSourceBtn").addEventListener("click", () => {
      data.recipeDraft.additions.push(defaultAdditionRow());
      persistData();
      renderRecipes();
    });

    $("recipeSourceList").addEventListener("input", (event) => {
      const id = event.target.dataset.sourceId;
      const field = event.target.dataset.sourceField;
      if (!id || !RECIPE_SOURCE_FIELDS.has(field)) return;
      const row = data.recipeDraft.additions.find((item) => item.id === id);
      if (!row) return;
      row[field] = event.target.value;
      persistData();
      renderRecipeComputed();
    });
    $("recipeSourceList").addEventListener("change", (event) => {
      const id = event.target.dataset.sourceId;
      const field = event.target.dataset.sourceField;
      if (!id || !RECIPE_SOURCE_FIELDS.has(field)) return;
      const row = data.recipeDraft.additions.find((item) => item.id === id);
      if (!row) return;
      row[field] = event.target.value;
      if (field === "sourceType"){
        row.ppg = sourceDefault(row.sourceType);
        row.unit = sourceUnitDefault(row.sourceType);
      }
      persistData();
      renderRecipes();
    });
    $("recipeSourceList").addEventListener("click", (event) => {
      const id = event.target.dataset.sourceDelete;
      if (!id) return;
      data.recipeDraft.additions = data.recipeDraft.additions.filter((row) => row.id !== id);
      if (!data.recipeDraft.additions.length) data.recipeDraft.additions = [defaultAdditionRow()];
      persistData();
      renderRecipes();
    });

    $("clearRecipeBtn").addEventListener("click", () => {
      if (!confirm("Start a new Build draft? This clears the current Build form only. Saved recipes in Vault stay untouched.")) return;
      data.recipeDraft = defaultRecipeDraft();
      data.ui.selectedRecipeId = null;
      syncNutrientsFromRecipe(data.recipeDraft, { force: true });
      populateRecipeForm();
      persistData();
      renderAll();
    });

    $("saveRecipeBtn").addEventListener("click", () => {
      syncRecipeDerived();
      if (!data.recipeDraft.name.trim()) return;
      const existingId = data.ui.selectedRecipeId;
      const record = recipeFromDraft();
      if (existingId){
        record.id = existingId;
        record.createdAt = (data.recipes.find((item) => item.id === existingId) || {}).createdAt || record.createdAt;
        data.recipes = data.recipes.map((item) => item.id === existingId ? record : item);
      } else {
        // A draft cloned from a batch or archive entry can still carry the
        // source recipe's id; a brand-new save must never collide with an
        // existing recipe or edits/deletes start hitting the wrong record.
        if (data.recipes.some((item) => item.id === record.id)) record.id = makeId("recipe");
        data.recipes.unshift(record);
      }
      data.ui.selectedRecipeId = record.id;
      persistData();
      renderAll();
    });

    $("loadDraftToBatchBtn").addEventListener("click", () => {
      if (batchHasData() && !confirm("Start a new active batch from this Build draft? The current Ferment, Feed, Finish, and gravity records will be replaced.")) return;
      const recipe = recipeFromDraft();
      applyRecipeToBatch(recipe);
    });
  }

  function bindFerment(){
    $("batchPitchDate").addEventListener("change", () => {
      data.currentBatch.pitchDate = $("batchPitchDate").value;
      persistData();
      renderDashboard();
    });
    $("batchPhase").addEventListener("change", () => {
      const newPhase = $("batchPhase").value;
      const oldPhase = data.currentBatch.phase || "primary";
      data.currentBatch.phase = newPhase;
      if (newPhase !== oldPhase) {
        const latest = latestGravityLog();
        if (!latest || daysSinceLastReading(data.fermentationLogs) > 3) {
          alert(`Phase changed to ${newPhase}. Take a gravity reading to mark this transition.`);
        }
        const structureAdds = (Array.isArray(data.currentBatch.structureAdditions) && data.currentBatch.structureAdditions.length)
          ? data.currentBatch.structureAdditions
          : readEnhancementStructureAdditions("currentBatch");
        const phaseAdds = structureAdds.filter((row) => row.ingredient && row.phase && row.phase.toLowerCase() === newPhase.toLowerCase());
        if (phaseAdds.length) {
          const names = phaseAdds.map((row) => row.ingredient).join(", ");
          alert(`Reminder: ${names} scheduled for ${newPhase}. Check your structure additions.`);
        }
      }
      persistData();
      renderDashboard();
      renderFerment();
    });
    $("batchFermentNotes").addEventListener("input", () => {
      data.currentBatch.fermentNotes = $("batchFermentNotes").value;
      persistData();
    });

    $("copyRaptWebhookBtn").addEventListener("click", () => {
      copyText(`${window.location.origin}/.netlify/functions/rapt-bridge`);
    });
    $("refreshRaptBtn").addEventListener("click", () => {
      importRaptReadings();
    });
    $("toggleGravityLogBtn").addEventListener("click", () => {
      data.ui.showAllFermentLogs = !data.ui.showAllFermentLogs;
      persistData();
      renderFerment();
    });
    $("importGravityCsvBtn").addEventListener("click", () => $("gravityCsvFileInput").click());
    $("gravityCsvFileInput").addEventListener("change", async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try{
        const result = importGravityCsv(await file.text());
        if (result.error){
          alert(result.error);
        } else if (result.added){
          alert(`Imported ${result.added} new reading${result.added === 1 ? "" : "s"} from ${file.name} (downsampled to one per 6 hours).`);
        } else {
          alert("No new readings found — everything in that file is already in the log.");
        }
      } catch(error){
        console.error("Gravity CSV import failed", error);
        alert("That file could not be read as a CSV.");
      }
      event.target.value = "";
    });
    $("fermentationTrendSummary").addEventListener("click", (event) => {
      const toggle = event.target.closest("[data-trend-series-toggle]");
      if (!toggle) return;
      const key = toggle.dataset.trendSeriesToggle;
      if (key === "gravity") data.rapt.showGravityTrend = !data.rapt.showGravityTrend;
      if (key === "temp") data.rapt.showTempTrend = !data.rapt.showTempTrend;
      if (key === "abv") data.rapt.showAbvTrend = !data.rapt.showAbvTrend;
      persistData();
      renderFerment();
    });
    $("fermentationTrendChart").addEventListener("mousemove", (event) => {
      const hit = event.target.closest("[data-trend-point]");
      if (!hit) {
        hideTrendTooltip();
        return;
      }
      const index = Number(hit.dataset.trendPoint);
      const point = trendHoverPoints[index];
      if (!point) {
        hideTrendTooltip();
        return;
      }
      const hostBounds = $("fermentationTrendChart").getBoundingClientRect();
      const left = Math.max(12, Math.min(hostBounds.width - 180, event.clientX - hostBounds.left + 14));
      const top = Math.max(12, Math.min(hostBounds.height - 92, event.clientY - hostBounds.top - 12));
      renderTrendTooltip(point, left, top);
    });
    $("fermentationTrendChart").addEventListener("mouseleave", () => {
      hideTrendTooltip();
    });

    $("fermentChecklist").addEventListener("change", (event) => {
      const item = data.fermentChecklist.find((task) => task.id === event.target.dataset.taskToggle);
      if (!item) return;
      item.done = event.target.checked;
      persistData();
      renderDashboard();
    });
    $("dashboardReminders").addEventListener("change", (event) => {
      const item = data.fermentChecklist.find((task) => task.id === event.target.dataset.dashTaskToggle);
      if (!item) return;
      item.done = event.target.checked;
      persistData();
      renderDashboard();
      renderFerment();
    });

    $("logDate").value = todayStr();
    $("addLogBtn").addEventListener("click", () => {
      const gravity = $("logGravity").value;
      const temp = $("logTemp").value;
      const pH = $("logPH").value;
      const check = validateLogInputs({ gravity, temp, pH });
      if (!check.ok) {
        setLogEntryError(check.reason);
        return;
      }
      setLogEntryError("");
      data.fermentationLogs.push(normalizeLog({
        date: $("logDate").value || todayStr(),
        gravity,
        temp,
        pH,
        note: $("logNote").value
      }));
      $("logGravity").value = "";
      $("logTemp").value = "";
      $("logPH").value = "";
      $("logNote").value = "";
      persistData();
      renderDashboard();
      renderFerment();
    });
    ["logGravity","logTemp","logPH"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("input", () => setLogEntryError(""));
    });
    $("clearLogsBtn").addEventListener("click", () => {
      if (!confirm("Clear all gravity readings for the active batch? The batch, nutrient, and finish records will stay.")) return;
      data.fermentationLogs = [];
      persistData();
      renderDashboard();
      renderFerment();
    });
    $("gravityLog").addEventListener("click", (event) => {
      const deleteId = event.target.dataset.logDelete;
      if (deleteId) {
        data.fermentationLogs = data.fermentationLogs.filter((entry) => entry.id !== deleteId);
        persistData();
        renderDashboard();
        renderFerment();
        return;
      }
      const editId = event.target.dataset.logEdit;
      if (editId) {
        data.ui.editingLogId = editId;
        renderFerment();
        return;
      }
      const cancelId = event.target.dataset.logCancel;
      if (cancelId) {
        data.ui.editingLogId = null;
        renderFerment();
        return;
      }
      const saveId = event.target.dataset.logSave;
      if (saveId) {
        const entry = data.fermentationLogs.find((item) => item.id === saveId);
        if (entry) {
          const fields = $("gravityLog").querySelectorAll(`[data-log-edit-id="${saveId}"]`);
          const pending = {};
          fields.forEach((field) => { pending[field.dataset.logEditField] = field.value; });
          const check = validateLogInputs({ gravity: pending.gravity, temp: pending.temp, pH: pending.pH });
          if (!check.ok) {
            alert(check.reason);
            return;
          }
          Object.keys(pending).forEach((key) => { entry[key] = pending[key]; });
        }
        data.ui.editingLogId = null;
        persistData();
        renderDashboard();
        renderFerment();
      }
    });

    ["stepFeedPoints","stepFeedHoneyPpg","stepFeedCount"].forEach((id) => {
      $(id).addEventListener("input", () => {
        if (id === "stepFeedPoints") data.currentBatch.stepFeedPoints = $(id).value;
        if (id === "stepFeedHoneyPpg") data.currentBatch.stepFeedHoneyPpg = $(id).value;
        if (id === "stepFeedCount") data.currentBatch.stepFeedCount = $(id).value;
        persistData();
        renderFerment();
      });
    });
    $("recordStepFeedBtn").addEventListener("click", () => {
      const plan = calculateStepFeed({ volumeGallons: data.currentBatch.batchGallons, pointsPerFeed: data.currentBatch.stepFeedPoints, honeyPPG: data.currentBatch.stepFeedHoneyPpg, feedCount: 1 });
      if (!plan) return;
      data.currentBatch.stepFeedLog.push({ date: new Date().toISOString(), points: data.currentBatch.stepFeedPoints, honeyLb: plan.honeyLbPerFeed });
      persistData();
      renderFerment();
    });

    $("clearActiveBatchBtn").addEventListener("click", () => {
      if (!confirm("Reset the active batch? This clears Ferment, Feed, Finish, and gravity history for the current batch. Saved recipes and Vault entries stay untouched.")) return;
      data.currentBatch = defaultCurrentBatch();
      data.fermentationLogs = [];
      data.fermentChecklist = defaultFermentChecklist();
      data.nutrients = defaultNutrients();
      data.cellar = defaultCellar();
      data.cellarChecklist = defaultCellarChecklist();
      persistData();
      populateNutrientForm();
      populateCellarForm();
      renderAll();
    });

    $("archiveBatchBtn").addEventListener("click", () => {
      if (!batchHasData()) return;
      data.archive.unshift(normalizeArchiveItem({
        archivedAt: new Date().toISOString(),
        batch: clone(data.currentBatch),
        nutrients: clone(data.nutrients),
        cellar: clone(data.cellar),
        fermentChecklist: clone(data.fermentChecklist),
        cellarChecklist: clone(data.cellarChecklist),
        fermentationLogs: clone(data.fermentationLogs),
        summary: data.cellar.tastingNotes || data.currentBatch.quickNote || data.currentBatch.notes || ""
      }));
      data.currentBatch = defaultCurrentBatch();
      data.fermentationLogs = [];
      data.fermentChecklist = defaultFermentChecklist();
      data.nutrients = defaultNutrients();
      data.cellar = defaultCellar();
      data.cellarChecklist = defaultCellarChecklist();
      persistData();
      populateNutrientForm();
      populateCellarForm();
      renderAll();
      setActiveTab("archive");
    });
  }

  function bindNutrients(){
    const mapping = {
      nutrientBatchGallons: "batchGallons",
      nutrientOg: "og",
      nutrientBrix: "brix",
      nutrientFruitOffset: "fruitOffsetPpm",
      nutrientTargetYan: "targetYanPpm",
      nutrientLimitO: "limitO",
      nutrientLimitK: "limitK",
      nutrientLimitD: "limitD",
      nutrientRatioO: "ratioO",
      nutrientRatioK: "ratioK",
      nutrientRatioD: "ratioD",
      nutrientNotes: "notes"
    };
    Object.entries(mapping).forEach(([id, key]) => {
      const el = $(id);
      if (!el) return;
      const handler = () => {
        data.nutrients[key] = el.value;
        if (["batchGallons","og","brix"].includes(key) && data.nutrients.og) {
          data.nutrients.targetYanPpm = String(suggestYanPpm({ og: data.nutrients.og, yeastRequirement: data.nutrients.yeastRequirement }));
          if ($("nutrientTargetYan")) $("nutrientTargetYan").value = data.nutrients.targetYanPpm;
        }
        persistData();
        renderDashboard();
        renderNutrients();
      };
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });
    $("nutrientEnforceLimits").addEventListener("change", () => {
      data.nutrients.enforceLimits = $("nutrientEnforceLimits").checked;
      persistData();
      renderDashboard();
      renderNutrients();
    });
    document.querySelectorAll("[data-nutrient-protocol]").forEach((button) => {
      button.addEventListener("click", () => {
        data.nutrients.protocol = button.dataset.nutrientProtocol || "tosna";
        if (data.nutrients.protocol !== "custom") applyNutrientProtocolDefaults(data.nutrients.protocol);
        persistData();
        renderDashboard();
        renderNutrients();
      });
    });
  }

  function bindCellar(){
    const mapping = {
      finishPath: "finishPath",
      stableSgA: "stableSgA",
      stableDateA: "stableDateA",
      stableSgB: "stableSgB",
      stableDateB: "stableDateB",
      cellarCurrentPh: "currentPh",
      cellarCurrentTemp: "currentTemp",
      kmetaAmount: "kmetaAmount",
      sorbateAmount: "sorbateAmount",
      backsweetenVolume: "backsweetenVolume",
      backsweetenCurrentSg: "backsweetenCurrentSg",
      backsweetenTargetSg: "backsweetenTargetSg",
      backsweetenSourceType: "backsweetenSourceType",
      backsweetenPpg: "backsweetenPpg",
      benchBatchGallons: "benchBatchGallons",
      benchSampleMl: "benchSampleMl",
      benchAddition: "benchAddition",
      benchUnit: "benchUnit",
      blendVol1: "blendVol1",
      blendSg1: "blendSg1",
      blendVol2: "blendVol2",
      blendSg2: "blendSg2",
      cellarGallons: "cellarGallons",
      cellarBottleOz: "cellarBottleOz",
      cellarLossPct: "cellarLossPct",
      stabilizationNotes: "stabilizationNotes",
      packagingNotes: "packagingNotes",
      tastingNotes: "tastingNotes",
      cellarRating: "rating",
      cellarTags: "tags"
    };
    Object.entries(mapping).forEach(([id, key]) => {
      const el = $(id);
      const handler = () => {
        data.cellar[key] = el.value;
        if (id === "backsweetenSourceType"){
          const locked = sourceLocked(el.value);
          data.cellar.backsweetenPpg = sourceDefault(el.value) || data.cellar.backsweetenPpg;
          $("backsweetenPpg").value = data.cellar.backsweetenPpg;
          $("backsweetenPpg").disabled = locked;
        }
        persistData();
        renderCellar();
      };
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });
    $("wouldMakeAgain").addEventListener("change", () => {
      data.cellar.wouldMakeAgain = $("wouldMakeAgain").checked;
      persistData();
      renderCellar();
    });
    $("addCellarAdditionBtn").addEventListener("click", () => {
      data.cellar.additions.push(defaultCellarAddition());
      persistData();
      renderCellar();
    });
    $("cellarAdditionList").addEventListener("input", (event) => {
      const id = event.target.dataset.cellarAdditionId;
      const field = event.target.dataset.cellarAdditionField;
      if (!id || !CELLAR_ADDITION_FIELDS.has(field)) return;
      const row = data.cellar.additions.find((item) => item.id === id);
      if (!row) return;
      row[field] = event.target.value;
      persistData();
    });
    $("cellarAdditionList").addEventListener("change", (event) => {
      const id = event.target.dataset.cellarAdditionId;
      const field = event.target.dataset.cellarAdditionField;
      if (!id || !CELLAR_ADDITION_FIELDS.has(field)) return;
      const row = data.cellar.additions.find((item) => item.id === id);
      if (!row) return;
      row[field] = event.target.value;
      persistData();
      renderCellar();
    });
    $("cellarAdditionList").addEventListener("click", (event) => {
      const id = event.target.dataset.cellarAdditionDelete;
      if (!id) return;
      data.cellar.additions = data.cellar.additions.filter((row) => row.id !== id);
      if (!data.cellar.additions.length) data.cellar.additions = [defaultCellarAddition()];
      persistData();
      renderCellar();
    });
  }

  function bindArchive(){
    $("recipeSearch").addEventListener("input", () => {
      data.ui.recipeSearch = $("recipeSearch").value;
      persistData();
      renderArchive();
    });
    $("archiveSearch").addEventListener("input", () => {
      data.ui.archiveSearch = $("archiveSearch").value;
      persistData();
      renderArchive();
    });

    $("recipeList").addEventListener("click", (event) => {
      const { recipeEdit, recipeLoad, recipeDelete, recipeCopy } = event.target.dataset;
      if (recipeEdit){
        const recipe = data.recipes.find((item) => item.id === recipeEdit);
        if (!recipe) return;
        data.recipeDraft = clone(recipe);
        data.ui.selectedRecipeId = recipe.id;
        populateRecipeForm();
        persistData();
        renderAll();
        setActiveTab("recipes");
      }
      if (recipeLoad){
        const recipe = data.recipes.find((item) => item.id === recipeLoad);
        if (!recipe) return;
        if (batchHasData() && !confirm("Start a new active batch from this saved recipe? The current Ferment, Feed, Finish, and gravity records will be replaced.")) return;
        data.ui.selectedRecipeId = recipe.id;
        applyRecipeToBatch(recipe);
      }
      if (recipeDelete){
        if (!confirm("Delete this saved recipe? This cannot be undone.")) return;
        data.recipes = data.recipes.filter((item) => item.id !== recipeDelete);
        if (data.ui.selectedRecipeId === recipeDelete) data.ui.selectedRecipeId = null;
        persistData();
        renderAll();
      }
      if (recipeCopy){
        const recipe = data.recipes.find((item) => item.id === recipeCopy);
        if (!recipe) return;
        const summary = recipeSourceSummary(recipe);
        copyText([recipe.name, recipe.style, summary.honey ? `Honey: ${summary.honey}` : "", summary.other ? `Other: ${summary.other}` : "", recipe.quickNote, recipe.notes].filter(Boolean).join("\n"));
      }
    });

    $("archiveList").addEventListener("click", (event) => {
      const { archiveLoad, archiveClone, archiveDelete } = event.target.dataset;
      if (archiveLoad){
        const item = data.archive.find((entry) => entry.id === archiveLoad);
        if (!item) return;
        if (batchHasData() && !confirm("Resume this archived batch as the active batch? The current live batch will be replaced.")) return;
        data.currentBatch = clone(item.batch);
        data.fermentationLogs = clone(item.fermentationLogs);
        data.fermentChecklist = clone(item.fermentChecklist);
        data.nutrients = clone(item.nutrients);
        data.cellar = clone(item.cellar);
        data.cellarChecklist = clone(item.cellarChecklist);
        data.currentBatch.loadedAt = new Date().toISOString();
        persistData();
        populateNutrientForm();
        populateCellarForm();
        renderAll();
        setActiveTab("ferment");
      }
      if (archiveClone){
        const item = data.archive.find((entry) => entry.id === archiveClone);
        if (!item) return;
        const batch = item.batch;
        const draft = {
          ...defaultRecipeDraft(),
          ...clone(batch),
          name: `${batch.name || "Archived batch"} clone`,
          additions: clone(batch.additions || [defaultAdditionRow()])
        };
        // The batch snapshot carries identity and execution-only fields that
        // must not leak into a recipe draft (a stale id would collide with
        // the original recipe on save).
        ["id","createdAt","updatedAt","recipeId","fermentNotes","stepFeedPoints","stepFeedHoneyPpg","stepFeedCount","stepFeedLog","loadedAt","pitchDate","phase"].forEach((key) => { delete draft[key]; });
        data.recipeDraft = draft;
        data.ui.selectedRecipeId = null;
        populateRecipeForm();
        persistData();
        renderAll();
        setActiveTab("recipes");
      }
      if (archiveDelete){
        if (!confirm("Delete this archived batch? This cannot be undone.")) return;
        data.archive = data.archive.filter((entry) => entry.id !== archiveDelete);
        persistData();
        renderArchive();
      }
    });
  }

  function bindCalcs(){
    const mapping = {
      calcTargetOg: "targetOg",
      calcTargetBatch: "targetBatch",
      calcTargetPpg: "targetPpg",
      calcHoneyLb: "honeyLb",
      calcHoneyBatch: "honeyBatch",
      calcHoneyPpg: "honeyPpg",
      calcAbvOg: "abvOg",
      calcAbvFg: "abvFg",
      calcBreakOg: "breakOg",
      calcSgInput: "sgInput",
      calcBrixInput: "brixInput",
      calcRecipeBatch: "recipeBatch",
      calcRecipeAbv: "recipeAbv",
      calcRecipeSweetness: "recipeSweetness",
      calcRecipeTolerance: "recipeTolerance",
      calcFermenterProfileName: "fermenterProfileName",
      calcFermenterBottomDiameter: "fermenterBottomDiameter",
      calcFermenterTopDiameter: "fermenterTopDiameter",
      calcFermenterTotalHeight: "fermenterTotalHeight",
      calcFermenterLiquidHeight: "fermenterLiquidHeight",
      calcFermenterSedimentHeight: "fermenterSedimentHeight"
    };
    Object.entries(mapping).forEach(([id, key]) => {
      const el = $(id);
      const handler = () => {
        data.calcs[key] = el.value;
        persistData();
        renderCalcs();
      };
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });

    $("calcFermenterProfileSelect").addEventListener("change", (event) => {
      const selectedId = String(event.target.value || "");
      data.calcs.fermenterProfileId = selectedId;
      if (selectedId){
        const profile = getFermenterProfiles().find((item) => item.id === selectedId);
        if (profile) applyFermenterProfile(profile);
      }
      populateCalcForm();
      persistData();
      renderCalcs();
    });

    $("saveFermenterProfileBtn").addEventListener("click", () => {
      const draft = currentFermenterProfileDraft();
      const error = validateFermenterProfileDraft(draft);
      if (error){
        alert(error);
        return;
      }
      const existingName = getFermenterProfiles().find((profile) => profile.name.toLowerCase() === draft.name.toLowerCase());
      if (existingName){
        alert(`A fermenter profile named "${draft.name}" already exists. Use Update selected instead or choose a different name.`);
        return;
      }
      const nextProfile = { id: makeId("fermenter"), ...draft };
      data.calcs.fermenterProfiles = [...getFermenterProfiles(), nextProfile];
      applyFermenterProfile(nextProfile);
      populateCalcForm();
      persistData();
      renderCalcs();
    });

    $("updateFermenterProfileBtn").addEventListener("click", () => {
      const selected = getSelectedFermenterProfile();
      if (!selected){
        alert("Select a saved fermenter profile to update.");
        return;
      }
      const draft = currentFermenterProfileDraft();
      const error = validateFermenterProfileDraft(draft);
      if (error){
        alert(error);
        return;
      }
      const profiles = getFermenterProfiles();
      const conflicting = profiles.find((profile) => profile.id !== selected.id && profile.name.toLowerCase() === draft.name.toLowerCase());
      if (conflicting){
        alert(`A fermenter profile named "${draft.name}" already exists. Choose a different name before updating.`);
        return;
      }
      const updated = { id: selected.id, ...draft };
      data.calcs.fermenterProfiles = profiles.map((profile) => profile.id === selected.id ? updated : profile);
      applyFermenterProfile(updated);
      populateCalcForm();
      persistData();
      renderCalcs();
    });

    $("deleteFermenterProfileBtn").addEventListener("click", () => {
      const selected = getSelectedFermenterProfile();
      if (!selected){
        alert("Select a saved fermenter profile to delete.");
        return;
      }
      if (!confirm(`Delete fermenter profile "${selected.name}"? This cannot be undone.`)) return;
      data.calcs.fermenterProfiles = getFermenterProfiles().filter((profile) => profile.id !== selected.id);
      data.calcs.fermenterProfileId = "";
      populateCalcForm();
      persistData();
      renderCalcs();
    });
  }

  function bindMentor(){
    const mapping = {
      mentorConceptName: "conceptName",
      mentorStyle: "style",
      mentorInspiration: "inspiration",
      mentorVision: "vision",
      mentorBatchSize: "batchSize",
      mentorTargetAbv: "targetAbv",
      mentorSweetness: "sweetness",
      mentorCarbonation: "carbonation",
    };
    Object.entries(mapping).forEach(([id, key]) => {
      const el = $(id);
      if (!el) return;
      const handler = () => {
        data.mentor[key] = el.value;
        persistData();
        renderMentor();
      };
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });
  }


  function csvEscape(value){
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function parseCsv(text){
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1){
      const ch = text[i];
      const next = text[i + 1];
      if (inQuotes){
        if (ch === '"' && next === '"'){
          cell += '"';
          i += 1;
        } else if (ch === '"'){
          inQuotes = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"'){
        inQuotes = true;
      } else if (ch === ','){
        row.push(cell);
        cell = "";
      } else if (ch === "\n"){
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (ch === "\r"){
        continue;
      } else {
        cell += ch;
      }
    }
    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((r) => r.some((cellValue) => String(cellValue).trim() !== ""));
  }

  function recipeCsvHeaders(){
    const base = ["name","style","batchGallons","targetAbv","sweetness","carbonation","yeast","dryYeast","nitrogenRequirement","yeastTolerance","temp","quickNote","notes","tags"];
    for (let i = 1; i <= CSV_SOURCE_SLOTS; i += 1){
      base.push(`source${i}Type`, `source${i}Description`, `source${i}Amount`, `source${i}Unit`, `source${i}Ppg`);
    }
    return base;
  }

  function recipeToCsvRow(recipe){
    const row = {
      name: recipe.name || "",
      style: recipe.style || "",
      batchGallons: recipe.batchGallons || "",
      targetAbv: recipe.targetAbv || "",
      sweetness: recipe.sweetness || "",
      carbonation: recipe.carbonation || "",
      yeast: displayYeastName(recipe) || "",
      dryYeast: recipe.dryYeast || "",
      nitrogenRequirement: recipe.nitrogenRequirement || "",
      yeastTolerance: recipe.yeastTolerance || "",
      temp: recipe.temp || "",
      quickNote: recipe.quickNote || "",
      notes: recipe.notes || "",
      tags: recipe.tags || ""
    };
    const additions = Array.isArray(recipe.additions) ? recipe.additions : [];
    for (let i = 0; i < CSV_SOURCE_SLOTS; i += 1){
      const src = additions[i] || {};
      row[`source${i + 1}Type`] = src.sourceType || "";
      row[`source${i + 1}Description`] = src.description || "";
      row[`source${i + 1}Amount`] = src.amount || "";
      row[`source${i + 1}Unit`] = src.unit || "";
      row[`source${i + 1}Ppg`] = src.ppg || "";
    }
    return row;
  }

  function downloadTextFile(filename, text, type = "text/plain"){
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadRecipeCsvTemplate(){
    const headers = recipeCsvHeaders();
    const example = {
      name: "Velvet Guillotine",
      style: "Melomel",
      batchGallons: "3",
      targetAbv: "12",
      sweetness: "Semi-sweet",
      carbonation: "Still",
      yeast: "71B",
      dryYeast: "6",
      nitrogenRequirement: "low",
      yeastTolerance: "14",
      temp: "59–86°F",
      quickNote: "Cherry-forward dessert mead with oak restraint",
      notes: "Rack off fruit early if tannin is already where you want it.",
      tags: "cherry,dessert,still",
      source1Type: "Honey",
      source1Description: "Orange blossom",
      source1Amount: "7.5",
      source1Unit: "lb",
      source1Ppg: "35",
      source2Type: "Fruit / Puree",
      source2Description: "Tart cherry puree",
      source2Amount: "3",
      source2Unit: "lb",
      source2Ppg: "10"
    };
    const csvText = [headers.join(","), headers.map((header) => csvEscape(example[header] || "")).join(",")].join("\n");
    downloadTextFile("meadevil-recipes-template.csv", csvText, "text/csv");
  }

  function printRecipeCard(){
    syncRecipeDerived();
    const r = data.recipeDraft;
    const bill = currentSourceBill();
    const plan = estimateRecipeTargets({ batchGallons: r.batchGallons, targetAbv: r.targetAbv, sweetness: r.sweetness, yeastTolerance: r.yeastTolerance, honeyPPG: 35 });
    const draftStructure = Array.isArray(r.structureAdditions) && r.structureAdditions.length
      ? r.structureAdditions
      : readEnhancementStructureAdditions("recipeDraft");
    const adjuncts = draftStructure.filter((a) => a && a.ingredient && a.ingredient.trim());
    const tosna = currentTosnaPlan();
    const goFerm = calculateGoFerm(data.nutrients.dryYeast);
    const sources = (r.additions || []).filter((row) => row.description && row.description.trim());

    const lines = [
      `RECIPE CARD: ${r.name || "Untitled"}`,
      `${"=".repeat(50)}`,
      `Style: ${r.style || "Mead"}  |  Batch: ${r.batchGallons || "?"} gal  |  Target ABV: ${r.targetAbv || "?"}%`,
      `Sweetness: ${r.sweetness || "?"}  |  Carbonation: ${r.carbonation || "?"}`,
      `Yeast: ${displayYeastName(r) || "?"}  |  Tolerance: ${r.yeastTolerance || "?"}%  |  Temp: ${r.temp || "?"}`,
      plan ? `Target OG: ${round(plan.targetOg, 3)}  |  Target FG: ${round(plan.targetFg, 3)}` : "",
      plan ? `Honey equivalent: ${round(plan.honeyLb, 2)} lb (${round(plan.honeyKg, 2)} kg)` : "",
      ``,
      `SOURCE BILL`,
      `${"-".repeat(30)}`,
      ...sources.map((row) => `  ${row.sourceType}: ${row.description} — ${row.amount || "?"} ${row.unit} (PPG ${row.ppg || "?"})`),
      bill ? `  Estimated OG: ${round(bill.estimatedOg, 3)} (${round(bill.gravityPointsPerGallon, 1)} pts/gal)` : "",
      ``,
      adjuncts.length ? `STRUCTURE ADDITIONS` : "",
      adjuncts.length ? `${"-".repeat(30)}` : "",
      ...adjuncts.map((a) => `  ${a.ingredient}${a.amount ? ` — ${a.amount} ${a.unit || ""}` : ""} (${a.phase || "secondary"}) ${a.purpose || ""}`),
      adjuncts.length ? `` : "",
      `NUTRIENT PLAN`,
      `${"-".repeat(30)}`,
      tosna ? `  TOSNA: ${round(tosna.totalFermaidO, 1)} g Fermaid O total (${round(tosna.addEach, 1)} g × ${tosna.schedule.length} doses)` : "  No nutrient plan calculated yet.",
      goFerm ? `  Go-Ferm: ${round(goFerm.goFermGrams, 1)} g in ${round(goFerm.rehydrationWaterMl, 0)} mL water` : "",
      r.dryYeast ? `  Dry yeast: ${r.dryYeast} g` : "",
      ``,
      r.quickNote ? `QUICK NOTE: ${r.quickNote}` : "",
      r.notes ? `NOTES:\n${r.notes}` : "",
      ``,
      `Generated by MeadEvil — ${new Date().toLocaleDateString()}`
    ].filter((line) => line !== undefined).join("\n");

    const blob = new Blob([lines], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(r.name || "recipe").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-card.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportRecipesCsv(){
    const headers = recipeCsvHeaders();
    const lines = [headers.join(",")];
    data.recipes.forEach((recipe) => {
      const row = recipeToCsvRow(recipe);
      lines.push(headers.map((header) => csvEscape(row[header] || "")).join(","));
    });
    downloadTextFile(`meadevil-recipes-${todayStr()}.csv`, lines.join("\n"), "text/csv");
  }

  function beerJsonFermentableType(sourceType){
    const normalized = String(sourceType || "").toLowerCase();
    if (normalized.includes("honey")) return "honey";
    if (normalized.includes("fruit")) return "fruit";
    if (normalized.includes("juice")) return "juice";
    if (normalized.includes("sugar") || normalized.includes("syrup")) return "sugar";
    return "other";
  }

  function recipeToBeerJson(recipe){
    const fermentables = (recipe.additions || [])
      .filter((row) => row && (String(row.description || "").trim() || Number(row.amount) > 0))
      .map((row) => ({
        name: row.description || row.sourceType || "Fermentable",
        type: beerJsonFermentableType(row.sourceType),
        amount: {
          unit: String(row.unit || "lb").toLowerCase() === "kg" ? "kg" : "lb",
          value: Number(row.amount) || 0
        }
      }));
    const yeastName = displayYeastName(recipe);
    const out = {
      name: recipe.name || "Untitled mead",
      type: "mead",
      author: "MeadEvil",
      batch_size: { unit: "gal", value: Number(recipe.batchGallons) || 0 },
      efficiency: { brewhouse: { unit: "%", value: 100 } },
      ingredients: {
        fermentable_additions: fermentables,
        culture_additions: yeastName ? [{
          name: yeastName,
          type: "wine",
          form: "dry",
          ...(Number(recipe.yeastTolerance) > 0 ? { alcohol_tolerance: { unit: "%", value: Number(recipe.yeastTolerance) } } : {})
        }] : []
      }
    };
    if (Number(recipe.targetOg) > 0) out.original_gravity = { unit: "sg", value: Number(recipe.targetOg) };
    if (Number(recipe.targetFg) > 0) out.final_gravity = { unit: "sg", value: Number(recipe.targetFg) };
    if (Number(recipe.targetAbv) > 0) out.alcohol_by_volume = { unit: "%", value: Number(recipe.targetAbv) };
    const notes = [recipe.quickNote, recipe.notes].filter(Boolean).join("\n");
    if (notes) out.notes = notes;
    return out;
  }

  function exportRecipesBeerJson(){
    const recipes = data.recipes.length ? data.recipes : [data.recipeDraft];
    const doc = { beerjson: { version: 1, recipes: recipes.map(recipeToBeerJson) } };
    downloadTextFile(`meadevil-recipes-${todayStr()}.beerjson.json`, JSON.stringify(doc, null, 2), "application/json");
  }

  function importRecipesFromCsv(text){
    const rows = parseCsv(text);
    if (!rows.length) return 0;
    const headers = rows[0].map((header) => String(header || "").trim());
    const body = rows.slice(1);
    let imported = 0;
    body.forEach((values) => {
      const row = {};
      headers.forEach((header, idx) => row[header] = String(values[idx] || "").trim());
      if (!row.name) return;
      const yeastLabel = row.yeast || "";
      const preset = YEAST_PRESETS[yeastLabel];
      const additions = [];
      for (let i = 1; i <= CSV_SOURCE_SLOTS; i += 1){
        const sourceType = row[`source${i}Type`] || "";
        const description = row[`source${i}Description`] || "";
        const amount = row[`source${i}Amount`] || "";
        const unit = row[`source${i}Unit`] || "";
        const ppg = row[`source${i}Ppg`] || "";
        if (!(sourceType || description || amount)) continue;
        additions.push({
          ...defaultAdditionRow(),
          sourceType: sourceType || "Honey",
          description,
          amount,
          unit: unit || sourceUnitDefault(sourceType || "Honey"),
          ppg: ppg || sourceDefault(sourceType || "Honey")
        });
      }
      const recipe = normalizeRecipe({
        name: row.name,
        style: row.style || "Traditional",
        batchGallons: row.batchGallons || "",
        targetAbv: row.targetAbv || "",
        sweetness: row.sweetness || "Dry",
        carbonation: row.carbonation || "Still",
        yeast: preset ? yeastLabel : (yeastLabel ? "Other / Custom" : ""),
        yeastOther: preset ? "" : yeastLabel,
        dryYeast: row.dryYeast || "",
        nitrogenRequirement: row.nitrogenRequirement || (preset ? preset.nitrogenRequirement : "medium"),
        yeastTolerance: row.yeastTolerance || (preset ? preset.tolerance : ""),
        temp: row.temp || (preset ? preset.temp : ""),
        quickNote: row.quickNote || "",
        notes: row.notes || "",
        tags: row.tags || "",
        additions: additions.length ? additions : [defaultAdditionRow()]
      });
      const existing = data.recipes.find((item) => item.name.trim().toLowerCase() === recipe.name.trim().toLowerCase());
      if (existing){
        recipe.id = existing.id;
        recipe.createdAt = existing.createdAt;
        recipe.updatedAt = new Date().toISOString();
        data.recipes = data.recipes.map((item) => item.id === existing.id ? recipe : item);
      } else {
        data.recipes.unshift(recipe);
      }
      imported += 1;
    });
    persistData();
    renderAll();
    return imported;
  }

  function bindUtilities(){
    $("downloadRecipeCsvTemplateBtn").addEventListener("click", downloadRecipeCsvTemplate);
    $("exportRecipeCsvBtn").addEventListener("click", exportRecipesCsv);
    $("exportBeerJsonBtn").addEventListener("click", exportRecipesBeerJson);
    $("printRecipeCardBtn").addEventListener("click", printRecipeCard);
    $("importRecipeCsvBtn").addEventListener("click", () => $("recipeCsvFileInput").click());
    $("recipeCsvFileInput").addEventListener("change", async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try{
        const raw = await file.text();
        importRecipesFromCsv(raw);
      } catch(error){
        console.error("Recipe CSV import failed", error);
      }
      event.target.value = "";
    });
    $("exportDataBtn").addEventListener("click", () => {
      let enhancement = null;
      try {
        const enhRaw = localStorage.getItem(ENHANCEMENT_KEY);
        if (enhRaw) enhancement = JSON.parse(enhRaw);
      } catch(e) {}
      const exportPayload = serializeExportState(data, enhancement);
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `meadevilapp-backup-${todayStr()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    $("importDataBtn").addEventListener("click", () => $("importFileInput").click());
    $("importFileInput").addEventListener("change", async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try{
        const raw = await file.text();
        const imported = parseImportedState(raw);
        if (imported.enhancement) {
          try { localStorage.setItem(ENHANCEMENT_KEY, JSON.stringify(imported.enhancement)); } catch(e) {}
        }
        data = imported.normalizedData;
        populateRecipeForm();
        populateNutrientForm();
        populateCellarForm();
        populateCalcForm();
        populateMentorForm();
        persistData();
        renderAll();
      } catch(error){
        console.error("Import failed", error);
      }
      event.target.value = "";
    });
    $("resetAppBtn").addEventListener("click", () => {
      if (!confirm("Factory reset MeadEvil? This deletes saved recipes, active batch data, archive history, mentor history, and settings.")) return;
      try { localStorage.removeItem(ENHANCEMENT_KEY); } catch(e) {}
      data = normalizeData(null);
      populateRecipeForm();
      populateNutrientForm();
      populateCellarForm();
      populateCalcForm();
      populateMentorForm();
      persistData();
      renderAll();
    });
  }

  /* =========================================================
     Application boot
     ========================================================= */

  function populateYeastSelect(){
    if (!Array.isArray(window.MeadYeasts) || !window.MeadYeasts.length) return;
    const select = $("recipeYeast");
    if (!select) return;
    const groups = new Map();
    window.MeadYeasts.forEach((strain) => {
      if (!strain || !strain.name) return;
      const brand = strain.brand || "Other";
      if (!groups.has(brand)) groups.set(brand, []);
      groups.get(brand).push(strain.name);
    });
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose yeast";
    select.appendChild(placeholder);
    [...groups.keys()].sort((a, b) => a.localeCompare(b)).forEach((brand) => {
      const group = document.createElement("optgroup");
      group.label = brand;
      groups.get(brand).forEach((name) => {
        const option = document.createElement("option");
        option.textContent = name;
        group.appendChild(option);
      });
      select.appendChild(group);
    });
    const custom = document.createElement("option");
    custom.textContent = "Other / Custom";
    select.appendChild(custom);
    // Saved drafts may reference a strain that predates the library; keep it selectable.
    const saved = (data.recipeDraft || {}).yeast || "";
    if (saved && !YEAST_PRESETS[saved] && saved !== "Other / Custom"){
      const legacy = document.createElement("option");
      legacy.textContent = saved;
      select.appendChild(legacy);
    }
  }

  function boot(){
    populateYeastSelect();
    populateRecipeForm();
    populateNutrientForm();
    populateCellarForm();
    populateCalcForm();
    populateMentorForm();
    bindTabs();
    bindClock();
    bindRecipeFields();
    bindFerment();
    bindNutrients();
    bindCellar();
    bindArchive();
    bindCalcs();
    bindMentor();
    bindUtilities();
    startClockTicker();
    startRaptAutoRefresh();
    renderAll();
    importRaptReadings({ silent: true }).catch((error) => {
      console.warn("Initial RAPT refresh failed", error);
    });
  }

  // The Brainstorm layer owns the structure-additions editor and stores rows in
  // its enhancement key before merging them into the main state. Refresh our
  // in-memory copy whenever it changes, otherwise the next persistData() lets
  // the merge layer harvest a stale (often empty) list back over the new rows.
  window.addEventListener("meadevil-structure-sync", () => {
    data.recipeDraft.structureAdditions = clone(readEnhancementStructureAdditions("recipeDraft"));
    data.currentBatch.structureAdditions = clone(readEnhancementStructureAdditions("currentBatch"));
  });

  window.addEventListener("meadevil-cloud-restore", () => {
    data = loadStoredData();
    populateRecipeForm();
    populateNutrientForm();
    populateCellarForm();
    populateCalcForm();
    populateMentorForm();
    renderAll();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
