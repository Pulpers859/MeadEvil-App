(function(){
  "use strict";

  const STORAGE_KEY = "meadevil-app-v2";
  const ENHANCEMENT_KEY = "meadevil-app-v2-meadevil-mentor";
  const VALID_MODELS = ["gpt-4o-mini","gpt-4o","gpt-4-turbo"];
  const ADJUNCT_UNITS = ["g","mL","oz","lb","tsp","tbsp","drops","berries","zest of 1 fruit","whole fruit","sticks","pods","bags","days"];
  const ADJUNCT_PHASES = ["primary","secondary","bench trial","packaging"];
  const ADJUNCT_CATEGORIES = ["botanical","citrus","tea","oak","acid","tannin","spice","fruit","other"];

  const $ = (id) => document.getElementById(id);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const makeId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;

  const originalSetItem = Storage.prototype.setItem;
  const ADJUNCT_FIELDS = new Set(["phase","category","ingredient","amount","unit","purpose","contactTime","notes"]);
  let pendingContext = { fromDraftToBatch: false };

  function escapeHTML(value){
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function parseJSON(raw, fallback){
    try{
      return JSON.parse(raw);
    } catch(error){
      return fallback;
    }
  }

  function splitTerms(text){
    return String(text || "")
      .split(/[\n,;|]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function isPlainObject(value){
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeEntryMap(value){
    return isPlainObject(value) ? { ...value } : {};
  }

  function normalizeStructureAdditions(rows, { ensureOne = false } = {}){
    const normalized = Array.isArray(rows)
      ? rows.filter(isPlainObject).map(normalizeAdjunctRow)
      : [];
    if (normalized.length || !ensureOne) return normalized;
    return [defaultAdjunctRow()];
  }

  function defaultAdjunctRow(){
    return {
      id: makeId("adj"),
      phase: "secondary",
      category: "botanical",
      ingredient: "",
      amount: "",
      unit: "g",
      purpose: "",
      contactTime: "",
      notes: ""
    };
  }

  function normalizeAdjunctRow(row){
    return { ...defaultAdjunctRow(), ...(row || {}), id: (row && row.id) || makeId("adj") };
  }

  function defaultMentorState(){
    return {
      mode: "scout",
      blunt: true,
      provider: "openai",
      model: "gpt-4o-mini",
      beginner: {
        serveContext: "",
        mustHaveSimple: "",
        avoidSimple: "",
        ingredientsOnHand: "",
        noGo: "",
        skillLevel: "beginner",
        riskTolerance: "keep it safe",
        processComfort: "secondary additions are fine",
        timePatience: "a few months is fine",
        budget: "normal"
      },
      outputs: {
        headline: "",
        summary: "",
        summaryHtml: "",
        coachReplyHtml: "",
        packet: {
          leadImpression: "",
          dominantNotes: [],
          supportNotes: [],
          tensionSources: [],
          ruiners: [],
          styleLane: "",
          finishDirection: "",
          yeastLane: "",
          sourceBillCandidates: [],
          adjunctCandidates: [],
          riskControls: [],
          productionSequence: []
        }
      },
      status: {
        mode: "local",
        message: "MeadEvil Mentor ready. No live endpoint checked yet.",
        lastRunAt: "",
        lastError: ""
      }
    };
  }

  function normalizeMentorState(value){
    const defaults = defaultMentorState();
    const source = isPlainObject(value) ? value : {};
    const outputs = isPlainObject(source.outputs) ? source.outputs : {};
    return {
      ...defaults,
      ...source,
      beginner: { ...defaults.beginner, ...(isPlainObject(source.beginner) ? source.beginner : {}) },
      outputs: {
        ...defaults.outputs,
        ...outputs,
        packet: { ...defaults.outputs.packet, ...(isPlainObject(outputs.packet) ? outputs.packet : {}) }
      },
      status: { ...defaults.status, ...(isPlainObject(source.status) ? source.status : {}) }
    };
  }

  function defaultEnhancementState(){
    return {
      recipeDraft: { structureAdditions: [defaultAdjunctRow()] },
      recipes: {},
      currentBatch: { structureAdditions: [defaultAdjunctRow()] },
      archive: {},
      mentor: defaultMentorState()
    };
  }

  function loadEnhancement(){
    const raw = localStorage.getItem(ENHANCEMENT_KEY);
    const parsed = parseJSON(raw || "null", null) || {};
    const base = defaultEnhancementState();
    const merged = {
      ...base,
      ...parsed,
      recipeDraft: { ...base.recipeDraft, ...(isPlainObject(parsed.recipeDraft) ? parsed.recipeDraft : {}) },
      recipes: normalizeEntryMap(parsed.recipes),
      currentBatch: { ...base.currentBatch, ...(isPlainObject(parsed.currentBatch) ? parsed.currentBatch : {}) },
      archive: normalizeEntryMap(parsed.archive),
      mentor: normalizeMentorState(parsed.mentor)
    };
    merged.recipeDraft.structureAdditions = normalizeStructureAdditions(merged.recipeDraft.structureAdditions, { ensureOne: true });
    if (!Array.isArray(merged.currentBatch.structureAdditions) || !merged.currentBatch.structureAdditions.length){
      merged.currentBatch.structureAdditions = clone(merged.recipeDraft.structureAdditions);
    }
    merged.currentBatch.structureAdditions = normalizeStructureAdditions(merged.currentBatch.structureAdditions, { ensureOne: true });
    Object.keys(merged.recipes).forEach((id) => {
      const entry = merged.recipes[id] || {};
      entry.structureAdditions = normalizeStructureAdditions(entry.structureAdditions);
      merged.recipes[id] = entry;
    });
    Object.keys(merged.archive).forEach((id) => {
      const entry = merged.archive[id] || {};
      entry.structureAdditions = normalizeStructureAdditions(entry.structureAdditions);
      merged.archive[id] = entry;
    });
    return merged;
  }

  function saveEnhancement(enhancement){
    originalSetItem.call(localStorage, ENHANCEMENT_KEY, JSON.stringify(enhancement));
  }


  function harvestEnhancementFromMain(main, enhancement){
    if (!main || typeof main !== "object") return enhancement;
    if (main.recipeDraft && Array.isArray(main.recipeDraft.structureAdditions)){
      enhancement.recipeDraft.structureAdditions = main.recipeDraft.structureAdditions.map(normalizeAdjunctRow);
    }
    if (Array.isArray(main.recipes)){
      main.recipes.forEach((recipe) => {
        if (recipe && recipe.id && Array.isArray(recipe.structureAdditions)){
          enhancement.recipes[recipe.id] = { structureAdditions: recipe.structureAdditions.map(normalizeAdjunctRow) };
        }
      });
    }
    if (main.currentBatch && Array.isArray(main.currentBatch.structureAdditions)){
      enhancement.currentBatch.structureAdditions = main.currentBatch.structureAdditions.map(normalizeAdjunctRow);
    }
    if (Array.isArray(main.archive)){
      main.archive.forEach((item) => {
        if (item && item.id && item.batch && Array.isArray(item.batch.structureAdditions)){
          enhancement.archive[item.id] = { structureAdditions: item.batch.structureAdditions.map(normalizeAdjunctRow) };
        }
      });
    }
    if (main.meadevilMentor){
      enhancement.mentor = normalizeMentorState(main.meadevilMentor);
    }
    return enhancement;
  }

  function mergeEnhancementIntoMain(main, enhancement){
    if (!main || typeof main !== "object") return main;

    main.meadevilMentor = clone(enhancement.mentor);
    main.recipeDraft = main.recipeDraft || {};
    main.recipeDraft.structureAdditions = clone(enhancement.recipeDraft.structureAdditions);

    const selectedRecipeId = main.ui && main.ui.selectedRecipeId ? main.ui.selectedRecipeId : "";
    if (Array.isArray(main.recipes)){
      main.recipes = main.recipes.map((recipe) => {
        if (!recipe || !recipe.id) return recipe;
        const extra = enhancement.recipes[recipe.id];
        if (extra && Array.isArray(extra.structureAdditions)){
          return { ...recipe, structureAdditions: clone(extra.structureAdditions) };
        }
        if (selectedRecipeId && recipe.id === selectedRecipeId){
          return { ...recipe, structureAdditions: clone(enhancement.recipeDraft.structureAdditions) };
        }
        return recipe;
      });
    }

    if (main.currentBatch){
      let batchAdditions = enhancement.currentBatch.structureAdditions;
      if ((!batchAdditions || !batchAdditions.length) && main.currentBatch.recipeId && enhancement.recipes[main.currentBatch.recipeId]){
        batchAdditions = enhancement.recipes[main.currentBatch.recipeId].structureAdditions;
      }
      if ((!batchAdditions || !batchAdditions.length) && pendingContext.fromDraftToBatch){
        batchAdditions = enhancement.recipeDraft.structureAdditions;
      }
      main.currentBatch.structureAdditions = clone(batchAdditions && batchAdditions.length ? batchAdditions : enhancement.recipeDraft.structureAdditions);
    }

    if (Array.isArray(main.archive)){
      main.archive = main.archive.map((item) => {
        if (!item || !item.id) return item;
        const archiveExtra = enhancement.archive[item.id];
        if (archiveExtra && Array.isArray(archiveExtra.structureAdditions) && item.batch){
          return { ...item, batch: { ...item.batch, structureAdditions: clone(archiveExtra.structureAdditions) } };
        }
        return item;
      });
      if (main.archive.length && enhancement.currentBatch.structureAdditions && enhancement.currentBatch.structureAdditions.length){
        const top = main.archive[0];
        if (top && top.batch && !Array.isArray(top.batch.structureAdditions)){
          top.batch.structureAdditions = clone(enhancement.currentBatch.structureAdditions);
        }
      }
    }

    return main;
  }

  function mergedMainString(rawValue){
    const enhancement = loadEnhancement();
    let main = parseJSON(rawValue, null);
    if (!main || typeof main !== "object") return rawValue;
    harvestEnhancementFromMain(main, enhancement);
    saveEnhancement(enhancement);
    main = mergeEnhancementIntoMain(main, enhancement);
    return JSON.stringify(main);
  }

  Storage.prototype.setItem = function(key, value){
    if (this === localStorage && key === STORAGE_KEY && typeof value === "string"){
      const merged = mergedMainString(value);
      return originalSetItem.call(this, key, merged);
    }
    return originalSetItem.call(this, key, value);
  };

  function getMainState(){
    const raw = localStorage.getItem(STORAGE_KEY);
    return parseJSON(raw || "null", {}) || {};
  }

  function saveMergedMain(updateEnhancementFn){
    const enhancement = loadEnhancement();
    if (typeof updateEnhancementFn === "function") updateEnhancementFn(enhancement);
    saveEnhancement(enhancement);
    const main = getMainState();
    const merged = mergeEnhancementIntoMain(main, enhancement);
    originalSetItem.call(localStorage, STORAGE_KEY, JSON.stringify(merged));
    return { main: merged, enhancement };
  }

  function currentEnhancementState(){
    const enhancement = loadEnhancement();
    const main = getMainState();
    harvestEnhancementFromMain(main, enhancement);
    return { main, enhancement };
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

  function formatIngredientList(list){
    return list && list.length ? list.map(escapeHTML).join(", ") : "Still undefined";
  }

  function detectKeywords(text){
    const lower = String(text || "").toLowerCase();
    const matches = (arr) => arr.filter((term) => lower.includes(term));
    return {
      dark: matches(["dark","brooding","rich","black","winter","midnight","deep"]),
      bright: matches(["bright","fresh","crisp","electric","citrus","clean","sharp"]),
      floral: matches(["floral","elderflower","lavender","rose","blossom","hibiscus","violet"]),
      fruit: matches(["blueberry","cherry","blackberry","raspberry","apple","pear","peach","plum","fig","currant","fruit"]),
      structure: matches(["tea","tannin","oak","juniper","citrus","lemon","lime","grapefruit","acid","grip"]),
      risk: matches(["lavender","chili","coffee","oak","juniper","hibiscus","smoke","vanilla","maple","molasses"]),
      dessert: matches(["dessert","sweet","pastry","chocolate","vanilla","marshmallow","caramel"]) 
    };
  }

  function uniq(list){
    return Array.from(new Set((list || []).filter(Boolean)));
  }

  function buildLocalPacket(){
    const { main, enhancement } = currentEnhancementState();
    const beginner = enhancement.mentor.beginner;
    const conceptName = $("mentorConceptName")?.value.trim() || (main.mentor || {}).conceptName || "Untitled concept";
    const style = $("mentorStyle")?.value.trim() || (main.mentor || {}).style || "Open lane";
    const inspiration = $("mentorInspiration")?.value.trim() || (main.mentor || {}).inspiration || "";
    const vision = $("mentorVision")?.value.trim() || (main.mentor || {}).vision || "";
    const mustHave = splitTerms(beginner.mustHaveSimple);
    const avoid = splitTerms(beginner.avoidSimple);
    const combinedText = [style, inspiration, vision, beginner.serveContext, beginner.mustHaveSimple, beginner.avoidSimple, beginner.ingredientsOnHand, beginner.noGo].join(" ");
    const k = detectKeywords(combinedText);
    const targetAbv = Number($("mentorTargetAbv")?.value || (main.mentor || {}).targetAbv || 0);
    const sweetness = $("mentorSweetness")?.value || (main.mentor || {}).sweetness || "Dry";

    let leadImpression = "A mead with a visible concept, but not fully sharpened yet.";
    if (k.dark.length && k.floral.length) leadImpression = "Dark fruit or dark mood lifted by something aromatic.";
    else if (k.bright.length && k.fruit.length) leadImpression = "Bright fruit-first mead with a cleaner, more alert edge.";
    else if (k.floral.length && !k.structure.length) leadImpression = "Aromatic concept that still needs a clearer spine.";
    else if (mustHave.length) leadImpression = `A ${escapeHTML(mustHave[0])}-led concept that needs the rest of the architecture to support it.`;

    const dominantNotes = mustHave.slice(0, 2);
    const supportNotes = mustHave.slice(2, 4);
    const tensionSources = [];
    if (k.structure.length) tensionSources.push(...k.structure.map((item) => item === "acid" ? "acid line" : item));
    if (!tensionSources.length && (vision.toLowerCase().includes("sharp") || vision.toLowerCase().includes("clean") || vision.toLowerCase().includes("tense"))){
      tensionSources.push("citrus edge", "tea or tannin discipline");
    }
    if (!tensionSources.length && k.floral.length && k.fruit.length) tensionSources.push("something brighter or drier than the fruit/floral core");
    if (!tensionSources.length && k.dark.length) tensionSources.push("tannin or bitterness kept under control");

    const ruiners = uniq([
      ...avoid,
      beginner.noGo,
      k.floral.length && sweetness !== "Dry" ? "too much sweetness pushing the florals into perfume" : "",
      k.fruit.length && !k.structure.length ? "fruit going soft, vague, or jammy" : "",
      targetAbv >= 14 && beginner.skillLevel === "beginner" ? "alcohol heat overpowering the concept" : "",
      beginner.riskTolerance === "keep it safe" && k.risk.length > 1 ? "too many high-risk adjuncts fighting each other" : ""
    ]).filter(Boolean);

    let styleLane = style || "Mead";
    if (!style.trim()){
      if (k.fruit.length && k.floral.length) styleLane = "Botanical melomel";
      else if (k.fruit.length) styleLane = "Melomel";
      else if (k.floral.length || k.structure.length) styleLane = "Metheglin";
      else styleLane = "Traditional mead";
    }

    let yeastLane = "71B";
    if (targetAbv >= 15 || combinedText.toLowerCase().includes("sparkling")) yeastLane = "EC-1118";
    else if (k.bright.length && combinedText.toLowerCase().includes("tropical")) yeastLane = "QA23";
    else if (k.dark.length && !k.fruit.length) yeastLane = "D47";

    const finishDirection = sweetness === "Dry" ? "Dry finish" : sweetness === "Off-dry" ? "Dry to off-dry finish" : `${sweetness} finish with discipline`;
    const sourceBillCandidates = mustHave.filter((item) => !/(juniper|tea|oak|zest|peel|lavender|elderflower|hibiscus|spice|vanilla|cinnamon)/i.test(item)).map((item) => ({ type: /juice|cider/.test(item) ? "Juice (single strength)" : /honey|maple|sugar/.test(item) ? "Honey" : "Fruit / Puree", name: item }));
    const adjunctCandidates = mustHave.filter((item) => /(juniper|tea|oak|zest|peel|lavender|elderflower|hibiscus|spice|vanilla|cinnamon|citrus)/i.test(item)).map((item) => ({ phase: item.toLowerCase().includes("tea") ? "bench trial" : "secondary", category: item.toLowerCase().includes("tea") ? "tea" : item.toLowerCase().includes("oak") ? "oak" : item.toLowerCase().includes("zest") || item.toLowerCase().includes("citrus") ? "citrus" : "botanical", ingredient: item }));

    const riskControls = uniq([
      beginner.skillLevel === "beginner" ? "Keep the ingredient list tighter than your imagination wants." : "",
      k.floral.length ? "Florals should usually read as lift, not the loudest thing in the glass." : "",
      k.risk.length ? `High-risk ingredients detected: ${k.risk.join(", ")}. Treat them like scalpels, not identity fillers.` : "",
      targetAbv >= 14 ? "Higher ABV makes balancing harder and aging more annoying. Make sure the concept actually needs the extra force." : "",
      beginner.processComfort === "simple fermentation only" ? "Do not design a mead that secretly depends on complicated secondary correction work." : "",
      beginner.timePatience === "drink young" ? "Choose ingredients and structure that still taste coherent before long aging can rescue them." : ""
    ]).filter(Boolean);

    const productionSequence = [
      "Lock the concept before buying cute ingredients.",
      "Keep fermentables and non-fermentable structure additions mentally separate.",
      "Ferment the base cleanly first.",
      beginner.processComfort !== "simple fermentation only" ? "Add secondary structure with restraint and taste windows, not blind hope." : "Keep secondary moves optional and conservative.",
      beginner.processComfort.includes("bench") || beginner.processComfort.includes("backsweetening") ? "Reserve fine-tuning moves like tea, acid, tannin, or sweetness for bench trials." : "Do not count on bench trials to save a weak concept."
    ];

    const blunt = Boolean($("mentorBluntMode")?.checked ?? enhancement.mentor.blunt);
    const mode = enhancement.mentor.mode || "scout";
    const pushback = [];
    if (!mustHave.length) pushback.push("You still have not named the flavors that actually matter. Right now this is mostly moodboard energy.");
    if (mustHave.length > 4) pushback.push("Too many must-haves usually means you are avoiding a harder choice. Pick the identity, not the whole grocery cart.");
    if (k.floral.length && !tensionSources.length) pushback.push("You are leaning aromatic and soft. Something needs to sharpen this or it will drink vague.");
    if (beginner.riskTolerance === "keep it safe" && k.risk.length > 1) pushback.push("Your stated risk tolerance and your ingredient fantasy are fighting each other.");
    if (targetAbv >= 15 && beginner.skillLevel === "beginner") pushback.push("A high-ABV concept is a stupid place to learn basic process discipline.");
    if (!pushback.length) pushback.push("The idea is coherent enough to move forward, but it still needs restraint more than complexity.");

    const headline = mode === "pushback"
      ? (pushback[0] || "The concept has promise, but it is still hiding from a harder decision.")
      : mode === "forge"
        ? "This is close enough to turn into a real build." : "Good concept seed. Now give it a clearer center of gravity.";

    const summaryHtml = `
      <strong>${escapeHTML(headline)}</strong><br>
      ${escapeHTML(leadImpression)}<br><br>
      <span class="muted">Preferred lane:</span> <strong>${escapeHTML(styleLane)}</strong><br>
      <span class="muted">Lead impression:</span> ${escapeHTML(leadImpression)}
    `;

    const coachReplyHtml = `
      <strong>${escapeHTML(headline)}</strong><br><br>
      ${blunt ? `<span class="muted">Blunt read:</span> ${escapeHTML(pushback[0])}<br><br>` : ""}
      <span class="muted">What is working:</span> ${escapeHTML(leadImpression)}<br>
      <span class="muted">What still needs help:</span> ${escapeHTML((tensionSources[0] || "A clearer source of structure or contrast."))}<br><br>
      <span class="muted">Next move:</span> ${escapeHTML(mode === "forge" ? "Turn this into a Build draft and keep the ingredient list disciplined." : mode === "pushback" ? "Kill anything that does not clearly support the identity." : "Choose the dominant note, then decide what keeps it from going soft or generic.")}
    `;

    return {
      conceptName,
      style,
      inspiration,
      vision,
      beginner,
      headline,
      summaryHtml,
      coachReplyHtml,
      packet: {
        leadImpression,
        dominantNotes,
        supportNotes,
        tensionSources,
        ruiners,
        styleLane,
        finishDirection,
        yeastLane,
        sourceBillCandidates,
        adjunctCandidates,
        riskControls,
        productionSequence,
        pushback
      }
    };
  }

  function renderMentorOutputs(output){
    if (!output) return;
    $("mentorSummary").innerHTML = output.summaryHtml || "";
    $("mentorCoachReply").innerHTML = output.coachReplyHtml || "";
    renderRows("mentorPairings", [
      ["Lead impression", escapeHTML(output.packet.leadImpression || "Still forming")],
      ["Dominant notes", formatIngredientList(output.packet.dominantNotes)],
      ["Support notes", formatIngredientList(output.packet.supportNotes)],
      ["Tension sources", formatIngredientList(output.packet.tensionSources)],
      ["Serve context", escapeHTML((loadEnhancement().mentor.beginner || {}).serveContext || "Not specified")]
    ]);
    renderRows("mentorArchitecture", [
      ["Style lane", escapeHTML(output.packet.styleLane || "Open")],
      ["Suggested yeast lane", escapeHTML(output.packet.yeastLane || "Still open")],
      ["Finish direction", escapeHTML(output.packet.finishDirection || "Still open")],
      ["Build discipline", output.packet.pushback && output.packet.pushback.length ? escapeHTML(output.packet.pushback[0]) : "Keep the ingredient list honest"]
    ]);
    renderRows("mentorIngredientPlan", [
      ["Fermentable candidates", formatIngredientList((output.packet.sourceBillCandidates || []).map((item) => item.name))],
      ["Structure additions", formatIngredientList((output.packet.adjunctCandidates || []).map((item) => `${item.ingredient} (${item.phase})`))],
      ["Keep optional", output.packet.adjunctCandidates && output.packet.adjunctCandidates.some((item) => item.phase === "bench trial") ? "Bench-trial items stay optional until the base mead proves it needs them." : "No bench-trial-only items flagged yet"]
    ]);
    renderRows("mentorConflicts", (output.packet.riskControls || ["No risk notes yet"]).map((item, idx) => [`Risk ${idx + 1}`, escapeHTML(item)]));
    renderRows("mentorFinishPlan", (output.packet.productionSequence || ["No production sequence yet"]).map((item, idx) => [`Step ${idx + 1}`, escapeHTML(item)]));
  }

  function renderAdjunctList(rows){
    const el = $("recipeAdjunctList");
    if (!el) return;
    el.innerHTML = rows.map((row) => `
      <div class="source-row">
        <div class="form-grid-4">
          <div class="field">
            <label>Phase</label>
            <select data-adjunct-id="${row.id}" data-adjunct-field="phase">
              ${ADJUNCT_PHASES.map((option) => `<option ${row.phase === option ? "selected" : ""}>${option}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Category</label>
            <select data-adjunct-id="${row.id}" data-adjunct-field="category">
              ${ADJUNCT_CATEGORIES.map((option) => `<option ${row.category === option ? "selected" : ""}>${option}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label>Ingredient</label><input data-adjunct-id="${row.id}" data-adjunct-field="ingredient" value="${escapeHTML(row.ingredient)}" placeholder="Juniper berries, lemon zest, white tea…" /></div>
          <div class="field"><label>Purpose</label><input data-adjunct-id="${row.id}" data-adjunct-field="purpose" value="${escapeHTML(row.purpose)}" placeholder="lift, edge, tannin, brightness…" /></div>
        </div>
        <div class="form-grid-4">
          <div class="field"><label>Amount</label><input data-adjunct-id="${row.id}" data-adjunct-field="amount" type="number" step="0.01" value="${escapeHTML(row.amount)}" /></div>
          <div class="field"><label>Unit</label><select data-adjunct-id="${row.id}" data-adjunct-field="unit">${ADJUNCT_UNITS.map((option) => `<option ${row.unit === option ? "selected" : ""}>${option}</option>`).join("")}</select></div>
          <div class="field"><label>Contact / window</label><input data-adjunct-id="${row.id}" data-adjunct-field="contactTime" value="${escapeHTML(row.contactTime)}" placeholder="3–5 days, bench trial only, pull early…" /></div>
          <div class="field checkbox-field"><button class="mini-btn" data-adjunct-delete="${row.id}" type="button">Remove</button></div>
        </div>
        <div class="field"><label>Notes</label><input data-adjunct-id="${row.id}" data-adjunct-field="notes" value="${escapeHTML(row.notes)}" placeholder="What this does, how easy it is to overdo, what to watch for…" /></div>
      </div>
    `).join("");
  }

  function syncLegacyBridge(output){
    const enhancement = loadEnhancement();
    const main = getMainState();
    main.mentor = main.mentor || {};
    main.mentor.honey = (output.packet.sourceBillCandidates || []).filter((item) => /honey|maple|sugar/i.test(item.name || item.type || "")).map((item) => item.name).join(", ");
    main.mentor.yeast = output.packet.yeastLane || "";
    main.mentor.fruitSpiceOak = formatIngredientList(output.packet.supportNotes).replace(/<[^>]+>/g, "");
    main.mentor.structure = formatIngredientList(output.packet.tensionSources).replace(/<[^>]+>/g, "");
    main.mentor.mustHave = enhancement.mentor.beginner.mustHaveSimple || "";
    main.mentor.avoid = enhancement.mentor.beginner.avoidSimple || "";
    main.mentor.constraints = [enhancement.mentor.beginner.skillLevel, enhancement.mentor.beginner.riskTolerance, enhancement.mentor.beginner.processComfort, enhancement.mentor.beginner.timePatience].filter(Boolean).join(" | ");
    main.meadevilMentor = clone(enhancement.mentor);
    originalSetItem.call(localStorage, STORAGE_KEY, JSON.stringify(mergeEnhancementIntoMain(main, enhancement)));
  }

  function renderAll(){
    const { main, enhancement } = currentEnhancementState();
    const recipeRows = enhancement.recipeDraft.structureAdditions && enhancement.recipeDraft.structureAdditions.length
      ? enhancement.recipeDraft.structureAdditions
      : [defaultAdjunctRow()];
    renderAdjunctList(recipeRows);

    if ($("mentorServeContext")) $("mentorServeContext").value = enhancement.mentor.beginner.serveContext || "";
    if ($("mentorMustHaveSimple")) $("mentorMustHaveSimple").value = enhancement.mentor.beginner.mustHaveSimple || "";
    if ($("mentorAvoidSimple")) $("mentorAvoidSimple").value = enhancement.mentor.beginner.avoidSimple || "";
    if ($("mentorIngredientsOnHand")) $("mentorIngredientsOnHand").value = enhancement.mentor.beginner.ingredientsOnHand || "";
    if ($("mentorNoGo")) $("mentorNoGo").value = enhancement.mentor.beginner.noGo || "";
    if ($("mentorSkillLevel")) $("mentorSkillLevel").value = enhancement.mentor.beginner.skillLevel || "beginner";
    if ($("mentorRiskTolerance")) $("mentorRiskTolerance").value = enhancement.mentor.beginner.riskTolerance || "keep it safe";
    if ($("mentorProcessComfort")) $("mentorProcessComfort").value = enhancement.mentor.beginner.processComfort || "secondary additions are fine";
    if ($("mentorTimePatience")) $("mentorTimePatience").value = enhancement.mentor.beginner.timePatience || "a few months is fine";
    if ($("mentorBudget")) $("mentorBudget").value = enhancement.mentor.beginner.budget || "normal";
    if ($("mentorProvider")) $("mentorProvider").value = enhancement.mentor.provider || "openai";
    if ($("mentorModel")) $("mentorModel").value = VALID_MODELS.includes(enhancement.mentor.model) ? enhancement.mentor.model : "gpt-4o-mini";
    if ($("mentorBluntMode")) $("mentorBluntMode").checked = Boolean(enhancement.mentor.blunt);
    document.querySelectorAll(".mentor-mode-btn").forEach((button) => button.classList.toggle("active", button.dataset.mentorMode === enhancement.mentor.mode));

    const statusMode = enhancement.mentor.status.lastError ? "mentor-status-bad" : enhancement.mentor.status.mode === "remote" ? "mentor-status-good" : "mentor-status-warn";
    if ($("mentorCoachStatus")) $("mentorCoachStatus").innerHTML = `<span class="${statusMode}">${escapeHTML(enhancement.mentor.status.message || "MeadEvil Mentor ready.")}</span>${enhancement.mentor.status.lastRunAt ? `<br><span class="muted">Last run: ${escapeHTML(new Date(enhancement.mentor.status.lastRunAt).toLocaleString())}</span>` : ""}`;
    if ($("mentorKnowledgeStatus")){
      const provider = enhancement.mentor.provider || "openai";
      const brainLine = provider === "openai"
        ? `GPT brain active (${enhancement.mentor.model || "gpt-4o-mini"}). Key lives in Netlify environment variables.`
        : "Local-only mode. No API calls will be made.";
      $("mentorKnowledgeStatus").innerHTML = `${escapeHTML(brainLine)}<br><span class="muted">Structure additions persist separately and are re-merged into the main app state so the existing build loop does not get stomped.</span>`;
    }

    if (enhancement.mentor.outputs && enhancement.mentor.outputs.packet){
      renderMentorOutputs(enhancement.mentor.outputs);
    }

    if ($("mentorHoney")) $("mentorHoney").value = (main.mentor || {}).honey || "";
    if ($("mentorYeast")) $("mentorYeast").value = (main.mentor || {}).yeast || "";
    if ($("mentorFruitSpiceOak")) $("mentorFruitSpiceOak").value = (main.mentor || {}).fruitSpiceOak || "";
    if ($("mentorStructure")) $("mentorStructure").value = (main.mentor || {}).structure || "";
    if ($("mentorMustHave")) $("mentorMustHave").value = (main.mentor || {}).mustHave || "";
    if ($("mentorAvoid")) $("mentorAvoid").value = (main.mentor || {}).avoid || "";
    if ($("mentorConstraints")) $("mentorConstraints").value = (main.mentor || {}).constraints || "";
  }

  function updateBeginnerField(field, value){
    saveMergedMain((enhancement) => {
      enhancement.mentor.beginner[field] = value;
      enhancement.mentor.blunt = Boolean($("mentorBluntMode")?.checked ?? enhancement.mentor.blunt);
    });
    renderAll();
  }

  function handleAdjunctInput(event){
    const id = event.target.dataset.adjunctId;
    const field = event.target.dataset.adjunctField;
    if (!id || !ADJUNCT_FIELDS.has(field)) return;
    saveMergedMain((enhancement) => {
      const rows = enhancement.recipeDraft.structureAdditions || [defaultAdjunctRow()];
      const row = rows.find((item) => item.id === id);
      if (!row) return;
      row[field] = event.target.value;
      enhancement.recipeDraft.structureAdditions = rows.map(normalizeAdjunctRow);
      if ((getMainState().ui || {}).selectedRecipeId){
        enhancement.recipes[(getMainState().ui || {}).selectedRecipeId] = { structureAdditions: clone(enhancement.recipeDraft.structureAdditions) };
      }
    });
  }

  function buildMentorPayload(localPacket){
    return {
      app: "MeadEvil Mentor",
      mode: loadEnhancement().mentor.mode,
      blunt: Boolean($("mentorBluntMode")?.checked),
      beginner_inputs: {
        conceptName: localPacket.conceptName,
        style: localPacket.style,
        inspiration: localPacket.inspiration,
        vision: localPacket.vision,
        serveContext: localPacket.beginner.serveContext,
        mustHaveSimple: localPacket.beginner.mustHaveSimple,
        avoidSimple: localPacket.beginner.avoidSimple,
        ingredientsOnHand: localPacket.beginner.ingredientsOnHand,
        noGo: localPacket.beginner.noGo,
        skillLevel: localPacket.beginner.skillLevel,
        riskTolerance: localPacket.beginner.riskTolerance,
        processComfort: localPacket.beginner.processComfort,
        timePatience: localPacket.beginner.timePatience,
        budget: localPacket.beginner.budget,
        batchSize: $("mentorBatchSize")?.value || "",
        targetAbv: $("mentorTargetAbv")?.value || "",
        sweetness: $("mentorSweetness")?.value || "Dry",
        carbonation: $("mentorCarbonation")?.value || "Still"
      },
      local_packet: localPacket.packet
    };
  }

  function normalizeRemoteResponse(json, localPacket){
    const reply = isPlainObject(json.mentor_reply) ? json.mentor_reply : isPlainObject(json.reply) ? json.reply : {};
    const concept = isPlainObject(json.concept_outputs) ? json.concept_outputs : isPlainObject(json.packet) ? json.packet : {};
    const build = isPlainObject(json.build_mapping) ? json.build_mapping : {};
    const pickText = (...values) => {
      for (const value of values){
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return "";
    };
    const stringList = (value, fallback) => Array.isArray(value)
      ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
      : clone(fallback);
    const objectList = (value, fallback) => Array.isArray(value)
      ? value.filter(isPlainObject).map((item) => ({ ...item }))
      : clone(fallback);
    const pushback = stringList(reply.pushback, localPacket.packet.pushback || []);
    const mergedPacket = {
      ...localPacket.packet,
      leadImpression: pickText(concept.lead_impression, concept.leadImpression, localPacket.packet.leadImpression),
      dominantNotes: stringList(concept.dominant_notes ?? concept.dominantNotes, localPacket.packet.dominantNotes),
      supportNotes: stringList(concept.support_notes ?? concept.supportNotes, localPacket.packet.supportNotes),
      tensionSources: stringList(concept.tension_sources ?? concept.tensionSources, localPacket.packet.tensionSources),
      ruiners: stringList(concept.ruiners, localPacket.packet.ruiners),
      styleLane: pickText(concept.style_lane, concept.styleLane, localPacket.packet.styleLane),
      finishDirection: pickText(concept.finish_direction, concept.finishDirection, localPacket.packet.finishDirection),
      yeastLane: pickText(build.yeast, concept.yeast_lane, concept.yeastLane, localPacket.packet.yeastLane),
      sourceBillCandidates: objectList(build.source_bill_candidates ?? build.sourceBillCandidates, localPacket.packet.sourceBillCandidates),
      adjunctCandidates: objectList(build.adjunct_candidates ?? build.adjunctCandidates, localPacket.packet.adjunctCandidates),
      riskControls: stringList(reply.risk_controls ?? json.risk_controls, localPacket.packet.riskControls),
      productionSequence: stringList(reply.production_sequence ?? json.production_sequence, localPacket.packet.productionSequence),
      pushback
    };
    return {
      headline: pickText(reply.headline, localPacket.headline),
      summaryHtml: `<strong>${escapeHTML(pickText(reply.headline, localPacket.headline))}</strong><br>${escapeHTML(pickText(reply.assessment, localPacket.packet.leadImpression))}`,
      coachReplyHtml: `<strong>${escapeHTML(pickText(reply.headline, localPacket.headline))}</strong><br><br>${escapeHTML(pickText(reply.assessment, localPacket.packet.leadImpression))}${pushback.length ? `<br><br><span class="muted">Pushback:</span> ${escapeHTML(pushback[0])}` : ""}`,
      packet: mergedPacket
    };
  }

  const FUNCTION_URL = "/.netlify/functions/meadevil-mentor";

  async function callMentorFunction(payload, model){
    const body = { ...payload, model };
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok){
      const text = await response.text().catch(() => "");
      let msg = `Mentor function returned ${response.status}`;
      const parsed = parseJSON(text, null);
      if (parsed && typeof parsed.error === "string" && parsed.error.trim()){
        msg = parsed.error.trim();
      } else if (typeof text === "string" && text.trim()){
        msg = text.trim();
      }
      throw new Error(msg);
    }
    return await response.json();
  }

  async function runMentor(){
    const localPacket = buildLocalPacket();
    const enhancementNow = loadEnhancement();
    const provider = enhancementNow.mentor.provider || "openai";
    const model = enhancementNow.mentor.model || "gpt-4o-mini";

    saveMergedMain((enhancement) => {
      enhancement.mentor.status = {
        ...enhancement.mentor.status,
        mode: provider === "openai" ? "remote" : "local",
        message: provider === "openai" ? "Asking GPT…" : "Thinking through the concept locally…",
        lastError: ""
      };
    });
    renderAll();

    const payload = buildMentorPayload(localPacket);
    let finalOutput = {
      headline: localPacket.headline,
      summaryHtml: localPacket.summaryHtml,
      coachReplyHtml: localPacket.coachReplyHtml,
      packet: localPacket.packet
    };
    let status = { mode: "local", message: "Rendered with local mentor logic.", lastRunAt: new Date().toISOString(), lastError: "" };

    if (provider === "openai"){
      try {
        const json = await callMentorFunction(payload, model);
        if (json.error){
          throw new Error(json.error);
        }
        finalOutput = normalizeRemoteResponse(json, localPacket);
        status = { mode: "remote", message: `GPT response received (${model}).`, lastRunAt: new Date().toISOString(), lastError: "" };
      } catch(error){
        status = { mode: "local", message: `GPT call failed. Falling back to local logic. ${String(error.message || error)}`, lastRunAt: new Date().toISOString(), lastError: String(error.message || error) };
      }
    }

    saveMergedMain((enhancement) => {
      enhancement.mentor.outputs = clone(finalOutput);
      enhancement.mentor.status = status;
      enhancement.mentor.provider = provider;
      enhancement.mentor.model = model;
      enhancement.mentor.blunt = Boolean($("mentorBluntMode")?.checked);
    });
    syncLegacyBridge(finalOutput);
    renderAll();
  }

  const missingBridgeIds = [];
  function recipeFieldSet(id, value){
    const el = $(id);
    if (!el){
      missingBridgeIds.push(id);
      return false;
    }
    el.value = value ?? "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function mapStyleLane(styleLane){
    const lower = String(styleLane || "").toLowerCase();
    if (lower.includes("melomel")) return "Melomel";
    if (lower.includes("cyser")) return "Cyser";
    if (lower.includes("pyment")) return "Pyment";
    if (lower.includes("bochet")) return "Bochet";
    if (lower.includes("acerglyn")) return "Acerglyn";
    if (lower.includes("metheglin") || lower.includes("botanical")) return "Metheglin";
    return $("recipeStyle")?.value || "Traditional";
  }

  function seedRecipeSourceBill(packet){
    const currentMain = getMainState();
    const currentRows = (((currentMain || {}).recipeDraft || {}).additions) || [];
    const trulyBlank = !currentRows.length || currentRows.every((row) => !String((row && (row.description || row.amount || row.sourceType !== "Honey" ? row.description || row.amount : "")) || "").trim());
    if (!trulyBlank) return;
    if (!packet.sourceBillCandidates || !packet.sourceBillCandidates.length) return;
    const list = $("recipeSourceList");
    if (!list) return;
    const currentCount = list.querySelectorAll("[data-source-delete]").length || 1;
    const neededAdds = Math.max(0, packet.sourceBillCandidates.length - currentCount);
    for (let i = 0; i < neededAdds; i += 1){
      $("addRecipeSourceBtn")?.click();
    }
    setTimeout(() => {
      packet.sourceBillCandidates.forEach((candidate, index) => {
        const sourceSelects = list.querySelectorAll('[data-source-field="sourceType"]');
        const descInputs = list.querySelectorAll('[data-source-field="description"]');
        if (sourceSelects[index]){
          sourceSelects[index].value = candidate.type || "Custom";
          sourceSelects[index].dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (descInputs[index]){
          descInputs[index].value = candidate.name || "";
          descInputs[index].dispatchEvent(new Event("input", { bubbles: true }));
          descInputs[index].dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    }, 40);
  }

  function applyMentorToBuild(){
    const enhancement = loadEnhancement();
    const output = enhancement.mentor.outputs;
    if (!output || !output.packet){
      if ($("mentorCoachStatus")) $("mentorCoachStatus").innerHTML = `<span class="mentor-status-warn">Run the mentor first. There is no output to apply yet.</span>`;
      return;
    }
    missingBridgeIds.length = 0;

    recipeFieldSet("recipeName", $("mentorConceptName")?.value || "");
    recipeFieldSet("recipeStyle", mapStyleLane(output.packet.styleLane));
    recipeFieldSet("recipeBatchGallons", $("mentorBatchSize")?.value || "");
    recipeFieldSet("recipeTargetAbv", $("mentorTargetAbv")?.value || "");
    recipeFieldSet("recipeSweetness", $("mentorSweetness")?.value || "Dry");
    recipeFieldSet("recipeCarbonation", $("mentorCarbonation")?.value || "Still");
    recipeFieldSet("recipeQuickNote", output.headline || "");

    const noteBits = [
      `Concept read: ${output.packet.leadImpression || ""}`,
      output.packet.pushback && output.packet.pushback.length ? `Pushback: ${output.packet.pushback[0]}` : "",
      output.packet.riskControls && output.packet.riskControls.length ? `Risk controls: ${output.packet.riskControls.join(" | ")}` : "",
      output.packet.productionSequence && output.packet.productionSequence.length ? `Production sequence: ${output.packet.productionSequence.join(" → ")}` : ""
    ].filter(Boolean).join("\n");
    recipeFieldSet("recipeNotes", noteBits);

    seedRecipeSourceBill(output.packet);

    saveMergedMain((enh) => {
      const adjunctRows = (output.packet.adjunctCandidates || []).length
        ? output.packet.adjunctCandidates.map((item) => normalizeAdjunctRow({
            phase: item.phase || "secondary",
            category: item.category || "other",
            ingredient: item.ingredient || "",
            purpose: item.purpose || "",
            notes: item.notes || ""
          }))
        : enh.recipeDraft.structureAdditions;
      enh.recipeDraft.structureAdditions = adjunctRows.length ? adjunctRows : [defaultAdjunctRow()];
    });

    document.querySelector('[data-tab="recipes"]')?.click();
    setTimeout(() => {
      if (missingBridgeIds.length && $("mentorCoachStatus")){
        const list = Array.from(new Set(missingBridgeIds)).join(", ");
        $("mentorCoachStatus").innerHTML = `<span class="mentor-status-warn">Applied, but these Build fields were not found: ${escapeHTML(list)}. The Build DOM may have changed.</span>`;
      }
      renderAll();
    }, 60);
  }

  function bindEvents(){
    $("addRecipeAdjunctBtn")?.addEventListener("click", () => {
      saveMergedMain((enhancement) => {
        enhancement.recipeDraft.structureAdditions.push(defaultAdjunctRow());
      });
      renderAll();
    });

    $("recipeAdjunctList")?.addEventListener("input", handleAdjunctInput);
    $("recipeAdjunctList")?.addEventListener("change", handleAdjunctInput);
    $("recipeAdjunctList")?.addEventListener("click", (event) => {
      const id = event.target.dataset.adjunctDelete;
      if (!id) return;
      saveMergedMain((enhancement) => {
        enhancement.recipeDraft.structureAdditions = (enhancement.recipeDraft.structureAdditions || []).filter((row) => row.id !== id);
        if (!enhancement.recipeDraft.structureAdditions.length) enhancement.recipeDraft.structureAdditions = [defaultAdjunctRow()];
      });
      renderAll();
    });

    [
      ["mentorServeContext", "serveContext"],
      ["mentorMustHaveSimple", "mustHaveSimple"],
      ["mentorAvoidSimple", "avoidSimple"],
      ["mentorIngredientsOnHand", "ingredientsOnHand"],
      ["mentorNoGo", "noGo"],
      ["mentorSkillLevel", "skillLevel"],
      ["mentorRiskTolerance", "riskTolerance"],
      ["mentorProcessComfort", "processComfort"],
      ["mentorTimePatience", "timePatience"],
      ["mentorBudget", "budget"]
    ].forEach(([id, field]) => {
      const el = $(id);
      if (!el) return;
      const handler = () => updateBeginnerField(field, el.value);
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });

    $("mentorProvider")?.addEventListener("change", () => {
      saveMergedMain((enh) => { enh.mentor.provider = $("mentorProvider").value || "openai"; });
      renderAll();
    });
    $("mentorModel")?.addEventListener("change", () => {
      saveMergedMain((enh) => { enh.mentor.model = $("mentorModel").value || "gpt-4o-mini"; });
      renderAll();
    });
    $("mentorBluntMode")?.addEventListener("change", () => saveMergedMain((enh) => { enh.mentor.blunt = $("mentorBluntMode").checked; }));
    document.querySelectorAll(".mentor-mode-btn").forEach((button) => {
      button.addEventListener("click", () => {
        saveMergedMain((enh) => { enh.mentor.mode = button.dataset.mentorMode; });
        renderAll();
      });
    });

    $("mentorRunBtn")?.addEventListener("click", runMentor);
    $("mentorApplyBtn")?.addEventListener("click", applyMentorToBuild);

    $("clearMentorBtn")?.addEventListener("click", () => {
      saveMergedMain((enh) => { enh.mentor = defaultMentorState(); });
      setTimeout(renderAll, 60);
    });

    $("clearRecipeBtn")?.addEventListener("click", () => {
      saveMergedMain((enh) => { enh.recipeDraft.structureAdditions = [defaultAdjunctRow()]; });
      setTimeout(renderAll, 60);
    });

    $("loadDraftToBatchBtn")?.addEventListener("click", () => {
      pendingContext.fromDraftToBatch = true;
      saveMergedMain((enh) => { enh.currentBatch.structureAdditions = clone(enh.recipeDraft.structureAdditions); });
      setTimeout(() => { pendingContext.fromDraftToBatch = false; renderAll(); }, 120);
    });

    $("saveRecipeBtn")?.addEventListener("click", () => {
      setTimeout(() => {
        saveMergedMain((enh) => {
          const main = getMainState();
          const recipeId = (((main || {}).ui || {}).selectedRecipeId) || "";
          if (recipeId) enh.recipes[recipeId] = { structureAdditions: clone(enh.recipeDraft.structureAdditions) };
        });
        renderAll();
      }, 80);
    });

    $("recipeList")?.addEventListener("click", (event) => {
      const id = event.target.dataset.recipeEdit || event.target.dataset.recipeLoad || "";
      if (!id) return;
      setTimeout(() => {
        const enhancement = loadEnhancement();
        if (enhancement.recipes[id]){
          saveMergedMain((enh) => { enh.recipeDraft.structureAdditions = clone(enhancement.recipes[id].structureAdditions || [defaultAdjunctRow()]); });
        }
        renderAll();
      }, 80);
    });

    $("archiveList")?.addEventListener("click", (event) => {
      const loadId = event.target.dataset.archiveLoad || event.target.dataset.archiveClone || "";
      if (!loadId) return;
      setTimeout(() => {
        const enhancement = loadEnhancement();
        if (enhancement.archive[loadId]){
          saveMergedMain((enh) => {
            enh.currentBatch.structureAdditions = clone(enhancement.archive[loadId].structureAdditions || enh.currentBatch.structureAdditions);
            enh.recipeDraft.structureAdditions = clone(enhancement.archive[loadId].structureAdditions || enh.recipeDraft.structureAdditions);
          });
        }
        renderAll();
      }, 80);
    });

    $("archiveBatchBtn")?.addEventListener("click", () => {
      setTimeout(() => {
        saveMergedMain((enh) => {
          const main = getMainState();
          const archiveId = main.archive && main.archive[0] && main.archive[0].id ? main.archive[0].id : "";
          if (archiveId) enh.archive[archiveId] = { structureAdditions: clone(enh.currentBatch.structureAdditions || enh.recipeDraft.structureAdditions) };
        });
        renderAll();
      }, 120);
    });

    $("exportDataBtn")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const main = mergeEnhancementIntoMain(getMainState(), loadEnhancement());
      const blob = new Blob([JSON.stringify(main, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `meadevil-app-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, true);
  }

  function boot(){
    saveMergedMain(() => {});
    bindEvents();
    renderAll();
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY || event.key === ENHANCEMENT_KEY){
        renderAll();
      }
    });
    document.addEventListener("click", (event) => {
      const tabBtn = event.target.closest(".tab-btn");
      if (tabBtn && tabBtn.dataset.tab === "meadmaker"){
        setTimeout(renderAll, 30);
      }
    });
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
