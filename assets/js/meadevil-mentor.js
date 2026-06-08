(function(){
  "use strict";

  const STORAGE_KEY = "meadevil-app-v2";
  const ENHANCEMENT_KEY = "meadevil-app-v2-meadevil-mentor";
  const VALID_MODELS = ["gpt-4o-mini","gpt-4o","gpt-4-turbo"];
  const ADJUNCT_UNITS = ["g","mL","oz","lb","tsp","tbsp","each","drops","berries","zest of 1 fruit","whole fruit","sticks","pods","bags","days"];
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

  // Kept in sync with netlify/functions/meadevil-mentor.mjs
  function isLowInformationGreetingText(text){
    const lower = String(text || "").trim().toLowerCase();
    if (!lower) return false;
    const normalized = lower.replace(/[^a-z0-9]+/g, " ").trim();
    return [
      "hi",
      "hello",
      "hey",
      "ready",
      "hello ready",
      "hey ready",
      "hi ready",
      "lets get started",
      "let s get started",
      "let us get started",
      "lets begin",
      "let s begin",
      "ready when you are"
    ].includes(normalized);
  }

  // Kept in sync with netlify/functions/meadevil-mentor.mjs
  function isSimpleAckText(text){
    const lower = String(text || "").trim().toLowerCase();
    if (!lower) return false;
    const normalized = lower.replace(/[^a-z0-9]+/g, " ").trim();
    return ["yes","yes do that","do that","sounds good","that works","okay","ok","cool","great","great do that","works for me","bench trial only sounds right","that sounds right"].includes(normalized);
  }

  function normalizeConceptTerm(term){
    const raw = String(term || "").trim().replace(/[.,;:!?]+$/, "");
    const lower = raw.toLowerCase();
    if (!lower) return [];
    if (/agave\s*\/\s*tequila|tequila\s*\/\s*agave/.test(lower)) return ["agave character", "tequila-style lift"];
    if (/toasted coconut flakes?|toasted coconut/.test(lower)) return ["toasted coconut"];
    if (/coconut flakes?/.test(lower)) return ["coconut"];
    if (/agave nectar|agave syrup/.test(lower)) return ["agave syrup"];
    if (/lime zest|lime peel/.test(lower)) return ["lime zest"];
    if (/lime juice/.test(lower)) return ["lime juice"];
    if (/wildflower( honey)?/.test(lower)) return ["wildflower honey"];
    if (/orange blossom( honey)?/.test(lower)) return ["orange blossom honey"];
    if (/clover( honey)?/.test(lower)) return ["clover honey"];
    if (/clove honey/.test(lower)) return ["clove honey"];
    if (/linden( honey)?/.test(lower)) return ["linden honey"];
    if (/buckwheat( honey)?/.test(lower)) return ["buckwheat honey"];
    if (/tequila/.test(lower) && !/agave/.test(lower)) return ["tequila-style lift"];
    return [raw];
  }

  function normalizeConceptTerms(value){
    const sourceTerms = Array.isArray(value) ? value : splitTerms(value);
    return uniq(sourceTerms.flatMap(normalizeConceptTerm).map((item) => String(item || "").trim()).filter(Boolean));
  }

  function displayConceptTerm(term){
    const lower = String(term || "").toLowerCase().trim();
    if (!lower) return "";
    if (lower === "agave character") return "agave side";
    if (lower === "tequila-style lift") return "tequila-style edge";
    return String(term || "").trim();
  }

  function conceptFamily(term){
    const lower = String(term || "").toLowerCase();
    if (/coconut/.test(lower)) return "coconut";
    if (/agave/.test(lower)) return "agave";
    if (/tequila/.test(lower)) return "tequila";
    if (/honey|maple|sugar|syrup|nectar/.test(lower)) return "fermentable";
    if (/lime|lemon|orange|grapefruit|citrus/.test(lower)) return "citrus";
    if (/tea|tannin|oak|acid/.test(lower)) return "structure";
    if (/juniper|elderflower|lavender|hibiscus|vanilla|spice/.test(lower)) return "botanical";
    if (/blueberry|cherry|berry|fruit|apple|pear|peach|plum|fig/.test(lower)) return "fruit";
    return lower;
  }

  function uniqueConceptTermsByFamily(terms, limit = Infinity){
    const seen = new Set();
    const picked = [];
    for (const term of normalizeConceptTerms(terms)){
      const family = conceptFamily(term);
      if (seen.has(family)) continue;
      seen.add(family);
      picked.push(term);
      if (picked.length >= limit) break;
    }
    return picked;
  }

  function preferredConceptTerms(terms){
    const familyPriority = {
      coconut: 0,
      fruit: 1,
      agave: 2,
      fermentable: 3,
      tequila: 4,
      citrus: 5,
      botanical: 6,
      structure: 7
    };
    return uniqueConceptTermsByFamily(terms).sort((left, right) => {
      const leftRank = familyPriority[conceptFamily(left)] ?? 50;
      const rightRank = familyPriority[conceptFamily(right)] ?? 50;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return String(left).localeCompare(String(right));
    });
  }

  function isLikelyFermentableTerm(term){
    const lower = String(term || "").toLowerCase();
    if (/toasted coconut|coconut|tequila-style lift|agave character|lime|zest|peel|tea|oak|acid|tannin|juniper|elderflower|hibiscus|spice|vanilla/.test(lower)) return false;
    return /honey|maple|sugar|juice|cider|must|nectar|syrup|fruit|puree|berries|blueberry|cherry|apple|pear|peach|plum|fig/.test(lower);
  }

  function isDescriptorPhrase(term){
    const lower = String(term || "").toLowerCase();
    if (/carbonation|effervescence|sparkl|fizz|bubbl/.test(lower)) return true;
    if (/\baroma\b|\bfinish\b|\bmouthfeel\b|\bcharacter\b|\bprofile\b|\bimpression\b|\bexperience\b|\benergy\b/.test(lower)) return true;
    return false;
  }

  function buildDirectionName(carries, supports){
    const primary = displayConceptTerm(carries[0] || "main note");
    const support = displayConceptTerm(supports[0] || "");
    if (/coconut/i.test(primary) && /agave/i.test(support)) return "Toasted coconut leading with agave tucked underneath";
    if (/coconut/i.test(primary) && /tequila/i.test(support)) return "Toasted coconut first with a tequila-style edge";
    if (/agave/i.test(primary) && /citrus/i.test(support)) return "Agave spine with a cleaner citrus edge";
    if (support) return `${titleCase(primary)} carrying the glass while ${support.toLowerCase()} stays in support`;
    return `Keep ${titleCase(primary)} firmly in the lead`;
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

  function normalizeStringList(value, fallback = []){
    if (!Array.isArray(value)) return clone(fallback);
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }

  function defaultMentorPacket(){
    return {
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
      pushback: [],
      riskControls: [],
      productionSequence: [],
      strongestDirection: {
        name: "",
        why: "",
        buildSignal: ""
      },
      alternateDirections: [],
      ingredientRoles: {
        carries: [],
        supports: [],
        liftStructure: [],
        dangerNotes: []
      },
      decisionStage: "",
      nextQuestion: "",
      nextStep: ""
    };
  }

  function defaultMentorOutputs(){
    return {
      headline: "",
      conversationReply: "",
      conversationReplyHtml: "",
      summary: "",
      summaryHtml: "",
      coachReplyHtml: "",
      packet: defaultMentorPacket()
    };
  }

  function normalizeDirectionCard(value){
    const source = isPlainObject(value) ? value : {};
    return {
      name: String(source.name || source.title || "").trim(),
      why: String(source.why || source.summary || source.whyItWins || "").trim(),
      risk: String(source.risk || source.whyItRisks || "").trim(),
      buildSignal: String(source.buildSignal || source.build_signal || "").trim()
    };
  }

  function normalizeMentorPacket(value){
    const defaults = defaultMentorPacket();
    const source = isPlainObject(value) ? value : {};
    const strongestDirection = normalizeDirectionCard(source.strongestDirection || source.strongest_direction);
    const ingredientRolesRaw = isPlainObject(source.ingredientRoles || source.ingredient_roles) ? (source.ingredientRoles || source.ingredient_roles) : {};
    return {
      ...defaults,
      ...source,
      dominantNotes: normalizeStringList(source.dominantNotes, defaults.dominantNotes),
      supportNotes: normalizeStringList(source.supportNotes, defaults.supportNotes),
      tensionSources: normalizeStringList(source.tensionSources, defaults.tensionSources),
      ruiners: normalizeStringList(source.ruiners, defaults.ruiners),
      sourceBillCandidates: Array.isArray(source.sourceBillCandidates) ? source.sourceBillCandidates.filter(isPlainObject).map((item) => ({ ...item })) : [],
      adjunctCandidates: Array.isArray(source.adjunctCandidates) ? source.adjunctCandidates.filter(isPlainObject).map((item) => ({ ...item })) : [],
      pushback: normalizeStringList(source.pushback, defaults.pushback),
      riskControls: normalizeStringList(source.riskControls, defaults.riskControls),
      productionSequence: normalizeStringList(source.productionSequence, defaults.productionSequence),
      strongestDirection: { ...defaults.strongestDirection, ...strongestDirection },
      alternateDirections: Array.isArray(source.alternateDirections || source.alternate_directions)
        ? (source.alternateDirections || source.alternate_directions).filter(isPlainObject).map(normalizeDirectionCard).filter((item) => item.name || item.why || item.risk)
        : [],
      ingredientRoles: {
        carries: normalizeStringList(ingredientRolesRaw.carries, defaults.ingredientRoles.carries),
        supports: normalizeStringList(ingredientRolesRaw.supports, defaults.ingredientRoles.supports),
        liftStructure: normalizeStringList(ingredientRolesRaw.liftStructure ?? ingredientRolesRaw.lift_or_structure, defaults.ingredientRoles.liftStructure),
        dangerNotes: normalizeStringList(ingredientRolesRaw.dangerNotes ?? ingredientRolesRaw.danger_notes, defaults.ingredientRoles.dangerNotes)
      },
      decisionStage: String(source.decisionStage || source.decision_stage || "").trim(),
      nextQuestion: String(source.nextQuestion || source.next_question || "").trim(),
      nextStep: String(source.nextStep || source.next_step || "").trim()
    };
  }

  function defaultMentorTurn(overrides = {}){
    return {
      id: makeId("mentor-turn"),
      role: "user",
      mode: "scout",
      text: "",
      createdAt: new Date().toISOString(),
      ...overrides
    };
  }

  function normalizeMentorTurn(value){
    const turn = defaultMentorTurn(isPlainObject(value) ? value : {});
    turn.role = turn.role === "mentor" ? "mentor" : "user";
    turn.mode = ["scout","pushback","forge","concept"].includes(turn.mode) ? turn.mode : "scout";
    turn.text = String(turn.text || "").trim();
    turn.createdAt = String(turn.createdAt || new Date().toISOString()).trim();
    return turn;
  }

  function normalizeMentorConversation(value){
    return Array.isArray(value)
      ? value.map(normalizeMentorTurn).filter((turn) => turn.text)
      : [];
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
        timePatience: "a few months is fine"
      },
      conversation: [],
      outputs: defaultMentorOutputs(),
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
      conversation: normalizeMentorConversation(source.conversation),
      outputs: {
        ...defaults.outputs,
        ...outputs,
        packet: normalizeMentorPacket(outputs.packet)
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

  function blankMentorLegacyBridge(main){
    main.mentor = {
      ...(main.mentor || {}),
      conceptName: "",
      style: "",
      inspiration: "",
      vision: "",
      batchSize: "",
      targetAbv: "",
      sweetness: "Dry",
      carbonation: "Still",
      honey: "",
      yeast: "",
      fruitSpiceOak: "",
      structure: "",
      mustHave: "",
      avoid: "",
      constraints: ""
    };
  }

  function blankMentorThreadState(existingMentor){
    return {
      ...normalizeMentorState(existingMentor),
      conversation: [],
      outputs: defaultMentorOutputs(),
      status: {
        mode: existingMentor && existingMentor.provider === "openai" ? "remote" : "local",
        message: "Brainstorm thread cleared. Same concept, fresh read.",
        lastRunAt: "",
        lastError: ""
      }
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

  function saveMentorMirrorToMain(updateMainFn){
    const enhancement = loadEnhancement();
    const main = getMainState();
    main.mentor = main.mentor || {};
    main.meadevilMentor = clone(enhancement.mentor);
    if (typeof updateMainFn === "function") updateMainFn(main);
    originalSetItem.call(localStorage, STORAGE_KEY, JSON.stringify(mergeEnhancementIntoMain(main, enhancement)));
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

  function titleCase(value){
    return String(value || "")
      .split(/[\s/-]+/)
      .filter(Boolean)
      .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
      .join(" ");
  }

  function humanJoin(list){
    const clean = normalizeStringList(list);
    if (!clean.length) return "";
    if (clean.length === 1) return clean[0];
    if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
    return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
  }

  function chooseVerb(list, singular, plural){
    return normalizeStringList(list).length === 1 ? singular : (plural || singular);
  }

  const KNOWN_HONEY_TERMS = [
    "orange blossom honey",
    "orange blossom",
    "wildflower honey",
    "wildflower",
    "clove honey",
    "clover honey",
    "buckwheat honey",
    "buckwheat",
    "linden honey",
    "linden",
    "meadowfoam honey",
    "meadowfoam",
    "mesquite honey",
    "sage honey",
    "acacia honey",
    "alfalfa honey",
    "tupelo honey",
    "avocado honey"
  ];

  function extractHoneyMentions(text){
    const lower = String(text || "").toLowerCase();
    const hits = KNOWN_HONEY_TERMS.filter((term) => lower.includes(term));
    if (!hits.length && /\bhoney\b/.test(lower)) hits.push("unspecified honey");
    return uniq(hits);
  }

  function extractHoneyTerms(text){
    return extractHoneyMentions(text).filter((term) => term !== "unspecified honey");
  }

  function inferUserNeed(text, conversation){
    const lower = String(text || "").trim().toLowerCase();
    if (!lower) return conversation.length ? "continue_thread" : "open_brainstorm";
    if (isLowInformationGreetingText(lower)) return conversation.length ? "continue_thread" : "open_brainstorm";
    if (/you tell me|that is why i am asking|that's why i am asking|what do you think|what would you do|recommend|pick one|if forced to choose|help me choose|decide for me|i don't know|i dont know|what i want your help for|you choose|pick for me/.test(lower)) return "help_me_choose";
    if (/\bvs\b|versus|which is better|which is stronger|which one|should i use|would .* work better|or would/.test(lower)) return "compare_options";
    if (/must use|mandatory|requirement|have to use|need to use|constraint|changed things|turns out/.test(lower)) return "constraint_change";
    if (/build|recipe|batch|how much|exact|amount|schedule|step by step|turn this into/.test(lower)) return "build_request";
    return "continue_thread";
  }

  function buildConceptSnapshot({
    conceptName,
    style,
    inspiration,
    vision,
    beginner,
    batchSize,
    targetAbv,
    sweetness,
    carbonation,
    followupNote,
    mode,
    conversation
  }){
    const sourceText = [
      style,
      inspiration,
      vision,
      beginner.serveContext,
      beginner.mustHaveSimple,
      beginner.avoidSimple,
      beginner.ingredientsOnHand,
      beginner.noGo,
      followupNote
    ].filter(Boolean).join(" ");
    const keywords = detectKeywords(sourceText);
    const honeyMentions = extractHoneyMentions([
      beginner.mustHaveSimple,
      beginner.ingredientsOnHand,
      inspiration,
      vision,
      followupNote
    ].filter(Boolean).join(" "));
    const mustHave = normalizeConceptTerms(beginner.mustHaveSimple);
    const avoid = normalizeConceptTerms(beginner.avoidSimple);
    const onHand = normalizeConceptTerms(beginner.ingredientsOnHand);
    const userNeed = inferUserNeed(followupNote, conversation);
    const summaryBits = [];
    if (conceptName && conceptName !== "Untitled concept") summaryBits.push(`Project: ${conceptName}.`);
    if (inspiration) summaryBits.push(`Inspiration: ${inspiration}`);
    if (vision) summaryBits.push(`Glass target: ${vision}`);
    if (beginner.serveContext) summaryBits.push(`Serve context: ${beginner.serveContext}`);
    if (beginner.mustHaveSimple) summaryBits.push(`Must-haves: ${beginner.mustHaveSimple}`);
    if (beginner.avoidSimple) summaryBits.push(`Avoid: ${beginner.avoidSimple}`);
    if (beginner.ingredientsOnHand) summaryBits.push(`On hand: ${beginner.ingredientsOnHand}`);
    if (beginner.noGo) summaryBits.push(`Failure condition: ${beginner.noGo}`);
    const batchBits = [
      batchSize ? `${batchSize} gal` : "",
      targetAbv ? `${targetAbv}% ABV` : "",
      sweetness || "",
      carbonation || ""
    ].filter(Boolean);
    if (batchBits.length) summaryBits.push(`Batch guardrails: ${batchBits.join(", ")}.`);
    summaryBits.push(`Process comfort: ${beginner.skillLevel}, ${beginner.riskTolerance}, ${beginner.processComfort}, ${beginner.timePatience}.`);
    return {
      mode,
      userNeed,
      summary: summaryBits.join(" "),
      conceptName,
      style,
      inspiration,
      vision,
      serveContext: beginner.serveContext,
      mustHave,
      avoid,
      onHand,
      noGo: beginner.noGo,
      batch: {
        sizeGallons: batchSize || "",
        targetAbv: targetAbv || "",
        sweetness: sweetness || "",
        carbonation: carbonation || ""
      },
      skill: {
        level: beginner.skillLevel,
        riskTolerance: beginner.riskTolerance,
        processComfort: beginner.processComfort,
        timePatience: beginner.timePatience
      },
      keywordSignals: {
        dark: keywords.dark,
        bright: keywords.bright,
        floral: keywords.floral,
        fruit: keywords.fruit,
        structure: keywords.structure,
        risky: keywords.risk,
        dessert: keywords.dessert
      },
      honeyMentions,
      unresolved: {
        honey: !honeyMentions.length,
        serveContext: !String(beginner.serveContext || "").trim(),
        mustHave: !mustHave.length,
        failureMode: !String(beginner.noGo || "").trim() && !avoid.length,
        structure: !keywords.structure.length && !/(sharp|clean|tense|bright|lift|edge|snap|dry)/i.test(sourceText)
      }
    };
  }

  function summarizeUserContext(localPacket){
    const bits = [];
    if (localPacket.conceptName && localPacket.conceptName !== "Untitled concept") bits.push(`Project: ${localPacket.conceptName}.`);
    if (localPacket.inspiration) bits.push(`Inspiration: ${localPacket.inspiration}`);
    if (localPacket.vision) bits.push(`Glass target: ${localPacket.vision}`);
    if (localPacket.beginner.serveContext) bits.push(`Serve context: ${localPacket.beginner.serveContext}`);
    if (localPacket.beginner.mustHaveSimple) bits.push(`Must-haves: ${localPacket.beginner.mustHaveSimple}`);
    if (localPacket.beginner.avoidSimple) bits.push(`Avoid: ${localPacket.beginner.avoidSimple}`);
    if (localPacket.beginner.ingredientsOnHand) bits.push(`On hand: ${localPacket.beginner.ingredientsOnHand}`);
    if (localPacket.beginner.noGo) bits.push(`Failure condition: ${localPacket.beginner.noGo}`);
    const batchBits = [
      $("mentorBatchSize")?.value ? `${$("mentorBatchSize").value} gal` : "",
      $("mentorTargetAbv")?.value ? `${$("mentorTargetAbv").value}% ABV` : "",
      $("mentorSweetness")?.value || "",
      $("mentorCarbonation")?.value || ""
    ].filter(Boolean);
    if (batchBits.length) bits.push(`Batch guardrails: ${batchBits.join(", ")}.`);
    bits.push(`Process comfort: ${localPacket.beginner.skillLevel}, ${localPacket.beginner.riskTolerance}, ${localPacket.beginner.processComfort}, ${localPacket.beginner.timePatience}.`);
    return bits.join(" ");
  }

  function buildConceptPreviewHtml(){
    const { main, enhancement } = currentEnhancementState();
    const mentorMain = main.mentor || {};
    const beginner = enhancement.mentor.beginner || {};
    const project = String(mentorMain.conceptName || "").trim();
    const inspiration = String(mentorMain.inspiration || "").trim();
    const vision = String(mentorMain.vision || "").trim();
    const style = String(mentorMain.style || "").trim();
    const mustHave = String(beginner.mustHaveSimple || "").trim();
    const avoid = String(beginner.avoidSimple || "").trim();
    const onHand = String(beginner.ingredientsOnHand || "").trim();
    const serveContext = String(beginner.serveContext || "").trim();
    const batchBits = [
      mentorMain.batchSize ? `${mentorMain.batchSize} gal` : "",
      mentorMain.targetAbv ? `${mentorMain.targetAbv}% ABV` : "",
      mentorMain.sweetness || "",
      mentorMain.carbonation || ""
    ].filter(Boolean);
    const title = project || "Untitled concept";
    const summary = vision || inspiration || "Describe what you want in the glass and the Brainstorm partner will start shaping lanes.";
    return `
      <div class="kicker">Loaded concept</div>
      <div class="mentor-concept-title-row">
        <strong class="mentor-concept-title">${escapeHTML(title)}</strong>
        ${style ? `<span class="mentor-concept-style">${escapeHTML(style)}</span>` : ""}
      </div>
      <p class="mentor-concept-summary">${escapeHTML(summary)}</p>
      <div class="mentor-pill-row">
        ${batchBits.length ? `<span class="mentor-pill"><strong>Batch</strong> ${escapeHTML(batchBits.join(" | "))}</span>` : ""}
        ${mustHave ? `<span class="mentor-pill"><strong>Must-have</strong> ${escapeHTML(mustHave)}</span>` : ""}
        ${avoid ? `<span class="mentor-pill"><strong>Avoid</strong> ${escapeHTML(avoid)}</span>` : ""}
        ${onHand ? `<span class="mentor-pill"><strong>On hand</strong> ${escapeHTML(onHand)}</span>` : ""}
        ${serveContext ? `<span class="mentor-pill"><strong>Serve</strong> ${escapeHTML(serveContext)}</span>` : ""}
      </div>
    `;
  }

  function renderConceptPreview(){
    const el = $("mentorConceptPreview");
    if (!el) return;
    el.innerHTML = buildConceptPreviewHtml();
  }

  function buildConceptSparkTranscriptText(localPacket){
    return summarizeUserContext(localPacket);
  }

  function latestConceptSparkText(conversation){
    const turns = normalizeMentorConversation(conversation);
    for (let idx = turns.length - 1; idx >= 0; idx -= 1){
      if (turns[idx].mode === "concept"){
        return String(turns[idx].text || "").trim();
      }
    }
    return "";
  }

  function composeUserTurnText(localPacket, followupText, conversation){
    const note = String(followupText || "").trim();
    if (note) return note;
    return "";
  }

  function formatInlineMentorText(text){
    return escapeHTML(String(text || ""))
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }

  function formatTurnText(text){
    const normalized = String(text || "").replace(/\r/g, "").trim();
    if (!normalized) return "";
    const lines = normalized.split("\n");
    const blocks = [];
    let index = 0;

    while (index < lines.length){
      const line = lines[index].trim();
      if (!line){
        index += 1;
        continue;
      }

      if (/^\d+\.\s+/.test(line)){
        const items = [];
        while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())){
          items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
          index += 1;
        }
        blocks.push(`<ol class="mentor-rich-list">${items.map((item) => `<li>${formatInlineMentorText(item)}</li>`).join("")}</ol>`);
        continue;
      }

      if (/^[-*]\s+/.test(line)){
        const items = [];
        while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())){
          items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
          index += 1;
        }
        blocks.push(`<ul class="mentor-rich-list">${items.map((item) => `<li>${formatInlineMentorText(item)}</li>`).join("")}</ul>`);
        continue;
      }

      const paragraphLines = [];
      while (index < lines.length){
        const candidate = lines[index].trim();
        if (!candidate) break;
        if (/^\d+\.\s+/.test(candidate) || /^[-*]\s+/.test(candidate)) break;
        paragraphLines.push(candidate);
        index += 1;
      }
      blocks.push(`<p>${paragraphLines.map((part) => formatInlineMentorText(part)).join("<br>")}</p>`);
    }

    return blocks.join("");
  }

  function buildMentorTurnText(output){
    if (output && output.conversationReply) return String(output.conversationReply || "").trim();
    const packet = normalizeMentorPacket(output && output.packet);
    const bits = [];
    const carries = humanJoin(packet.ingredientRoles.carries);
    const supports = humanJoin(packet.ingredientRoles.supports);
    const lift = humanJoin(packet.ingredientRoles.liftStructure);
    if (output && output.headline) bits.push(output.headline);
    if (output && output.provisionalTake) bits.push(`Current lean: ${sanitizeProvisionalTakeText(output.provisionalTake)}`);
    if (output && output.assessment) bits.push(`Read: ${output.assessment}`);
    if (packet.strongestDirection.name){
      const why = packet.strongestDirection.why ? `: ${packet.strongestDirection.why}` : "";
      bits.push(`Strongest direction: ${packet.strongestDirection.name}${why}`);
    }
    if (carries || supports || lift){
      bits.push(`Carrier / support / structure: ${[
        carries ? `carries = ${carries}` : "",
        supports ? `supports = ${supports}` : "",
        lift ? `structure = ${lift}` : ""
      ].filter(Boolean).join("; ")}`);
    }
    if (packet.pushback && packet.pushback[0]) bits.push(`Pushback: ${packet.pushback[0]}`);
    if (packet.nextQuestion) bits.push(`Next question: ${packet.nextQuestion}`);
    return bits.join("\n\n");
  }

  function buildSummaryHtml(headline, assessment, packet){
    const safePacket = normalizeMentorPacket(packet);
    const strongest = safePacket.strongestDirection || {};
    const carries = humanJoin(safePacket.ingredientRoles.carries);
    const supports = humanJoin(safePacket.ingredientRoles.supports);
    const lift = humanJoin(safePacket.ingredientRoles.liftStructure);
    return `
      <strong>${escapeHTML(strongest.name || headline || "Current best version still forming")}</strong><br>
      ${escapeHTML(strongest.why || assessment || safePacket.leadImpression || "Still pressure-testing the idea.")}<br><br>
      ${carries ? `<span class="muted">Carries:</span> ${escapeHTML(carries)}<br>` : ""}
      ${supports ? `<span class="muted">Supports:</span> ${escapeHTML(supports)}<br>` : ""}
      ${lift ? `<span class="muted">Structure:</span> ${escapeHTML(lift)}<br>` : ""}
      <span class="muted">Decision stage:</span> <strong>${escapeHTML(safePacket.decisionStage || "concept shaping")}</strong>
    `;
  }

  function sanitizeProvisionalTakeText(value){
    const text = String(value || "").trim();
    if (!text) return "";
    const segments = text.match(/[^.!?]+[.!?]?/g);
    if (!segments || !segments.length) return text;
    const cleaned = segments.map((segment) => segment.trim()).filter(Boolean);
    if (cleaned.length > 1 && /\?$/.test(cleaned[cleaned.length - 1])) {
      return cleaned.slice(0, -1).join(" ").trim();
    }
    return text;
  }

  function buildDefaultProvisionalTake(packet, assessment){
    const safePacket = normalizeMentorPacket(packet);
    const strongest = safePacket.strongestDirection || {};
    const carries = humanJoin(safePacket.ingredientRoles.carries);
    const supports = humanJoin(safePacket.ingredientRoles.supports);
    const lift = humanJoin(safePacket.ingredientRoles.liftStructure);
    if (strongest.name && strongest.why){
      return `My lean right now is ${strongest.name}. ${strongest.why}`;
    }
    if (carries && supports){
      return `My lean right now is to keep ${carries} carrying this while ${supports} stays clearly subordinate.`;
    }
    if (carries && lift){
      return `My lean right now is to keep ${carries} in front and let ${lift} stop the concept from going soft.`;
    }
    return assessment || "My lean right now is that the concept has promise, but it still needs a clearer center of gravity.";
  }

  function sentenceCaseFirst(text){
    const value = String(text || "").trim();
    if (!value) return "";
    return value.charAt(0).toLowerCase() + value.slice(1);
  }

  function includesLooseText(haystack, needle){
    const source = String(haystack || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const target = String(needle || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!source || !target) return false;
    return source.includes(target);
  }


  function buildCollaborativeReplyText({ headline, provisionalTake, assessment, packet, mode, userNeed }){
    const safePacket = normalizeMentorPacket(packet);
    const strongest = safePacket.strongestDirection || {};
    const alternates = (safePacket.alternateDirections || []).slice(0, 2);
    const carries = humanJoin(safePacket.ingredientRoles.carries);
    const supports = humanJoin(safePacket.ingredientRoles.supports);
    const lift = humanJoin(safePacket.ingredientRoles.liftStructure);
    const dangers = humanJoin(safePacket.ingredientRoles.dangerNotes.length ? safePacket.ingredientRoles.dangerNotes : safePacket.ruiners);
    const take = sanitizeProvisionalTakeText(provisionalTake) || buildDefaultProvisionalTake(safePacket, assessment);

    if (userNeed === "help_me_choose"){
      const helpParts = [];
      helpParts.push("Alright, let me make the call instead of bouncing the question back.");
      if (strongest.name){
        helpParts.push(`I would go with ${strongest.name.toLowerCase()}. ${strongest.why || ""}`);
      }
      const steps = [];
      if (carries) steps.push(`keep ${carries} as the lead voice`);
      if (supports) steps.push(`let ${supports} play backup`);
      if (lift) steps.push(`use ${lift} to keep the finish defined`);
      if (steps.length) helpParts.push(`In practice: ${steps.join(", ")}.`);
      if (dangers) helpParts.push(`Watch out for ${dangers}.`);
      if (safePacket.nextStep) helpParts.push(safePacket.nextStep);
      else if (safePacket.nextQuestion) helpParts.push(`The next thing to sort out: ${safePacket.nextQuestion}`);
      return helpParts.filter(Boolean).join("\n\n");
    }

    const paragraphs = [];

    if (take) paragraphs.push(take);
    if (strongest.name){
      if (includesLooseText(take, strongest.name)) paragraphs.push(strongest.why || strongest.buildSignal || "");
      else paragraphs.push(`If forced to choose, I would build around ${strongest.name.toLowerCase()}. ${strongest.why || strongest.buildSignal || ""}`.trim());
    } else if (assessment && assessment !== take) {
      paragraphs.push(assessment);
    }

    if (!strongest.why && (strongest.name || carries || supports || lift)){
      const architectureBits = [
        carries ? `${carries} ${chooseVerb(safePacket.ingredientRoles.carries, "carries", "carry")} the concept` : "",
        supports ? `${supports} ${chooseVerb(safePacket.ingredientRoles.supports, "stays", "stay")} in support` : "",
        lift ? `${lift} ${chooseVerb(safePacket.ingredientRoles.liftStructure, "keeps", "keep")} it from going soft or vague` : ""
      ].filter(Boolean);
      if (architectureBits.length){
        paragraphs.push(architectureBits.join(". ") + ".");
      }
    }

    if (alternates.length){
      const altText = alternates.map((direction) => {
        const why = direction.why ? ` ${direction.why}` : "";
        const riskLead = sentenceCaseFirst(direction.risk);
        const riskPrefix = /^(that|it|this)\b/i.test(riskLead) ? "" : /^can\b/i.test(riskLead) ? "it " : "that ";
        const risk = direction.risk ? ` The risk is ${riskPrefix}${riskLead}` : "";
        return `${direction.name || "Alternate cut"} would pull it another way.${why}${risk}`;
      }).join(" ");
      paragraphs.push(altText);
    }

    if (dangers){
      paragraphs.push(`The thing I would watch most is ${dangers}.`);
    } else if (headline){
      paragraphs.push(headline);
    }

    if (safePacket.nextQuestion){
      const leadIn = mode === "forge"
        ? "Before I lock this into a build, the next real decision is this:"
        : "The next real decision is this:";
      paragraphs.push(`${leadIn} ${safePacket.nextQuestion}`);
    }

    return paragraphs.filter(Boolean).join("\n\n");
  }


  function buildCoachReplyHtml(headline, provisionalTake, assessment, packet, blunt){
    const safePacket = normalizeMentorPacket(packet);
    const strongest = safePacket.strongestDirection || {};
    const firstAlt = safePacket.alternateDirections && safePacket.alternateDirections[0];
    const pushback = safePacket.pushback && safePacket.pushback.length ? safePacket.pushback[0] : "";
    const carries = humanJoin(safePacket.ingredientRoles.carries);
    const lift = humanJoin(safePacket.ingredientRoles.liftStructure);
    const supports = humanJoin(safePacket.ingredientRoles.supports);
    const take = sanitizeProvisionalTakeText(provisionalTake) || buildDefaultProvisionalTake(safePacket, assessment);
    return `
      <strong>${escapeHTML(headline || "The idea has promise, but it still needs a harder choice.")}</strong><br><br>
      ${take ? `<span class="muted">My current lean:</span> ${escapeHTML(take)}<br><br>` : ""}
      ${assessment && assessment !== take ? `${escapeHTML(assessment)}<br><br>` : ""}
      ${blunt && pushback ? `<span class="muted">Blunt read:</span> ${escapeHTML(pushback)}<br><br>` : ""}
      ${strongest.name ? `<span class="muted">Winning lane:</span> <strong>${escapeHTML(strongest.name)}</strong><br>${escapeHTML(strongest.why || strongest.buildSignal || "")}<br><br>` : ""}
      ${carries ? `<span class="muted">What carries this:</span> ${escapeHTML(carries)}<br>` : ""}
      ${supports ? `<span class="muted">What only supports it:</span> ${escapeHTML(supports)}<br>` : ""}
      ${lift ? `<span class="muted">What keeps it honest:</span> ${escapeHTML(lift)}<br><br>` : "<br>"}
      ${firstAlt && firstAlt.name ? `<span class="muted">Tempting but riskier lane:</span> ${escapeHTML(firstAlt.name)}${firstAlt.risk ? ` - ${escapeHTML(firstAlt.risk)}` : ""}` : ""}
    `;
  }

  function buildLocalPacket(){
    const { main, enhancement } = currentEnhancementState();
    const beginner = enhancement.mentor.beginner;
    const conceptName = $("mentorConceptName")?.value.trim() || (main.mentor || {}).conceptName || "Untitled concept";
    const style = $("mentorStyle")?.value.trim() || (main.mentor || {}).style || "Open lane";
    const inspiration = $("mentorInspiration")?.value.trim() || (main.mentor || {}).inspiration || "";
    const vision = $("mentorVision")?.value.trim() || (main.mentor || {}).vision || "";
    const followupNote = $("mentorFollowup")?.value.trim() || "";
    const mustHave = preferredConceptTerms(beginner.mustHaveSimple);
    const avoid = preferredConceptTerms(beginner.avoidSimple);
    const onHand = preferredConceptTerms(beginner.ingredientsOnHand);
    const combinedText = [style, inspiration, vision, beginner.serveContext, beginner.mustHaveSimple, beginner.avoidSimple, beginner.ingredientsOnHand, beginner.noGo, followupNote].join(" ");
    const k = detectKeywords(combinedText);
    const targetAbv = Number($("mentorTargetAbv")?.value || (main.mentor || {}).targetAbv || 0);
    const sweetness = $("mentorSweetness")?.value || (main.mentor || {}).sweetness || "Dry";
    const mode = enhancement.mentor.mode || "scout";
    const blunt = Boolean($("mentorBluntMode")?.checked ?? enhancement.mentor.blunt);
    const conversation = normalizeMentorConversation(enhancement.mentor.conversation);
    const batchSize = $("mentorBatchSize")?.value || (main.mentor || {}).batchSize || "";
    const carbonation = $("mentorCarbonation")?.value || (main.mentor || {}).carbonation || "Still";
    const snapshot = buildConceptSnapshot({
      conceptName,
      style,
      inspiration,
      vision,
      beginner,
      batchSize,
      targetAbv: targetAbv ? String(targetAbv) : "",
      sweetness,
      carbonation,
      followupNote,
      mode,
      conversation
    });

    const hasCoconut = mustHave.some((item) => conceptFamily(item) === "coconut") || /\bcoconut\b/i.test(combinedText);
    const hasAgave = mustHave.some((item) => conceptFamily(item) === "agave") || /\bagave\b/i.test(combinedText);
    const hasTequila = mustHave.some((item) => conceptFamily(item) === "tequila") || /\btequila\b/i.test(combinedText);
    const hasCitrusGoal = /\bcitrus\b|\blime\b|\blemon\b|\bgrapefruit\b/i.test(combinedText);
    const finishNeedsDiscipline = /\bclean\b|\bnon-syrupy\b|\bcrisp\b|\bsharp\b|\brefreshing\b/i.test(combinedText);
    const avoidLower = avoid.map((item) => String(item || "").toLowerCase());
    const honeyTerms = preferredConceptTerms([...snapshot.honeyMentions, ...onHand, ...mustHave].filter((item) => /honey/i.test(String(item || ""))))
      .filter((item) => !avoidLower.some((a) => String(item || "").toLowerCase().includes(a) || a.includes(String(item || "").toLowerCase())));

    let leadImpression = "A mead with a visible concept, but not fully sharpened yet.";
    if (hasCoconut && hasAgave && hasTequila) leadImpression = "Beachy coconut concept that only works if the agave side stays sharp instead of turning cocktail-sweet.";
    else if (k.dark.length && k.floral.length) leadImpression = "Dark fruit or dark mood lifted by something aromatic.";
    else if (k.bright.length && k.fruit.length) leadImpression = "Bright fruit-first mead with a cleaner, more alert edge.";
    else if (k.floral.length && !k.structure.length) leadImpression = "Aromatic concept that still needs a clearer spine.";
    else if (mustHave.length) leadImpression = `A ${displayConceptTerm(mustHave[0])}-led concept that needs the rest of the architecture to support it.`;

    const visibleFlavorTerms = preferredConceptTerms(mustHave.filter((item) => !["citrus","structure","fermentable"].includes(conceptFamily(item))));
    const dominantNotes = visibleFlavorTerms.slice(0, 2).map(displayConceptTerm);
    const supportNotes = preferredConceptTerms([
      ...mustHave.filter((item) => !visibleFlavorTerms.slice(0, 2).includes(item) && !["structure"].includes(conceptFamily(item))),
      ...honeyTerms
    ]).slice(0, 3).map(displayConceptTerm);
    const tensionSources = [];
    if (k.structure.length) tensionSources.push(...k.structure.map((item) => {
      if (item === "acid") return "acid line";
      if (item === "citrus") return "citrus lift";
      if (item === "lime") return "lime lift";
      if (item === "grapefruit") return "grapefruit lift";
      return item;
    }));
    if (hasCitrusGoal && !tensionSources.some((item) => /citrus|lime|lemon|grapefruit/i.test(item))) tensionSources.push(/lime/i.test(combinedText) ? "lime lift" : "citrus lift");
    if (finishNeedsDiscipline && !tensionSources.some((item) => /finish|discipline|dry|acid|tannin/i.test(item))) tensionSources.push("clean finish discipline");
    if (!tensionSources.length && (vision.toLowerCase().includes("sharp") || vision.toLowerCase().includes("clean") || vision.toLowerCase().includes("tense"))){
      tensionSources.push("citrus edge", "tea or tannin discipline");
    }
    if (!tensionSources.length && k.floral.length && k.fruit.length) tensionSources.push("something brighter or drier than the fruit/floral core");
    if (!tensionSources.length && k.dark.length) tensionSources.push("tannin or bitterness kept under control");

    const ruiners = uniq([
      ...avoid,
      beginner.noGo,
      avoid.length && honeyTerms.some((item) => avoid.includes(item)) ? "defaulting to the honey you have instead of the honey this concept wants" : "",
      k.floral.length && sweetness !== "Dry" ? "too much sweetness pushing the florals into perfume" : "",
      k.fruit.length && !k.structure.length ? "fruit going soft, vague, or jammy" : "",
      hasTequila && !hasCitrusGoal ? "the tequila idea reading heavy instead of bright" : "",
      hasCoconut && finishNeedsDiscipline ? "coconut and sweetness turning this into sunscreen syrup" : "",
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

    const yeastNameMap = { "71b": "71B", "d47": "D47", "qa23": "QA23", "ec-1118": "EC-1118" };
    const yeastMention = combinedText.match(/\b(71b|d47|qa23|ec-1118)\b/i);
    let yeastLane = "71B";
    if (yeastMention) yeastLane = yeastNameMap[yeastMention[1].toLowerCase()] || yeastMention[1];
    else if (targetAbv >= 15 || combinedText.toLowerCase().includes("sparkling")) yeastLane = "EC-1118";
    else if (k.bright.length && combinedText.toLowerCase().includes("tropical")) yeastLane = "QA23";
    else if (k.dark.length && !k.fruit.length) yeastLane = "D47";

    const finishDirection = sweetness === "Dry" ? "Dry finish" : sweetness === "Off-dry" ? "Dry to off-dry finish" : `${sweetness} finish with discipline`;
    const explicitFermentables = preferredConceptTerms([...onHand, ...mustHave])
      .filter((item) => isLikelyFermentableTerm(item))
      .filter((item) => !avoidLower.some((a) => String(item || "").toLowerCase().includes(a) || a.includes(String(item || "").toLowerCase())))
      .map((item) => ({
        type: /juice|cider/.test(item) ? "Juice (single strength)" : /honey/.test(item) ? "Honey" : /agave syrup|agave nectar/.test(item) ? "Custom" : "Fruit / Puree",
        name: displayConceptTerm(item)
      }));
    const hasExplicitHoney = explicitFermentables.some((item) => item.type === "Honey");
    const sourceBillCandidates = [...explicitFermentables];
    if (!hasExplicitHoney) {
      const honeyName = honeyTerms[0] ? displayConceptTerm(honeyTerms[0]) : "Honey";
      sourceBillCandidates.unshift({ type: "Honey", name: honeyName });
    }
    const adjunctPool = preferredConceptTerms([...mustHave, ...onHand].filter((item) => !isLikelyFermentableTerm(item)));
    const adjunctCandidates = adjunctPool
      .filter((item) => !/tequila-style lift|agave character/.test(item))
      .filter((item) => !isDescriptorPhrase(item))
      .map((item) => ({
        phase: /tea/.test(item) ? "bench trial" : "secondary",
        category: /tea/.test(item) ? "tea" : /oak/.test(item) ? "oak" : /zest|peel|citrus|lime|lemon|grapefruit/.test(item) ? "citrus" : /acid/.test(item) ? "acid" : /tannin/.test(item) ? "tannin" : /strawberry|blueberry|cherry|raspberry|blackberry|berry|fruit/.test(item) ? "fruit" : "botanical",
        ingredient: displayConceptTerm(item),
        purpose: /tea/.test(item)
          ? "add structure only if the finished mead still feels too soft"
          : /coconut/.test(item)
            ? "make the coconut read clearly without turning oily or fake"
            : /agave/.test(item)
              ? "support the agave illusion without turning the finish syrupy"
              : "support the core concept without taking over",
        notes: /tea/.test(item)
          ? "Bench trial instead of committing the whole batch."
          : /coconut/.test(item)
            ? "Taste early and pull before it starts muting the rest of the glass."
            : "Taste early and pull before it gets loud."
      }));

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

    const pushback = [];
    if (!mustHave.length) pushback.push("You still have not named the flavors that actually matter. Right now this is mostly moodboard energy.");
    if (mustHave.length > 4) pushback.push("Too many must-haves usually means you are avoiding a harder choice. Pick the identity, not the whole grocery cart.");
    if (k.floral.length && !tensionSources.length) pushback.push("You are leaning aromatic and soft. Something needs to sharpen this or it will drink vague.");
    if (avoid.length && honeyTerms.some((item) => avoid.includes(item))) pushback.push("Do not let ingredient availability overrule the lane you already said you want.");
    if (beginner.riskTolerance === "keep it safe" && k.risk.length > 1) pushback.push("Your stated risk tolerance and your ingredient fantasy are fighting each other.");
    if (targetAbv >= 15 && beginner.skillLevel === "beginner") pushback.push("A high-ABV concept is a stupid place to learn basic process discipline.");
    if (!pushback.length) pushback.push("The idea is coherent enough to move forward, but it still needs restraint more than complexity.");

    const carryPool = preferredConceptTerms([
      ...visibleFlavorTerms.filter((item) => !["tequila"].includes(conceptFamily(item))),
      ...honeyTerms
    ]);
    const carries = (carryPool.length ? carryPool.slice(0, 1) : mustHave.slice(0, 1)).map(displayConceptTerm);
    const supports = preferredConceptTerms([
      ...visibleFlavorTerms.filter((item) => !carryPool.slice(0, 1).includes(item)),
      ...mustHave.filter((item) => conceptFamily(item) === "tequila"),
      ...honeyTerms.filter((item) => !carryPool.slice(0, 1).includes(item))
    ]).slice(0, 3).map(displayConceptTerm);
    const liftStructure = uniq(tensionSources.length ? tensionSources : [sweetness === "Dry" ? "dry finish discipline" : "a drier or brighter line than the concept currently has"]);
    const dangerNotes = ruiners.length ? ruiners.slice(0, 3) : pushback.slice(0, 1);
    const mentorTurnCount = conversation.filter((t) => t.role === "mentor").length;
    const strongestDirection = {
      name: buildDirectionName(carries, supports),
      why: `This keeps ${humanJoin(carries) || "the main note"} carrying the concept while ${humanJoin(supports) || "everything else"} ${chooseVerb(supports, "stays", "stay")} in support and ${humanJoin(liftStructure) || "a cleaner finish"} ${chooseVerb(liftStructure, "keeps", "keep")} it from going soft.`,
      buildSignal: (mode === "forge" || mentorTurnCount >= 3) ? "This is coherent enough to map into a disciplined batch build." : "Do not turn this into a full recipe yet. First make sure the supporting notes stay subordinate."
    };
    const alternateDirections = [
      {
        name: k.bright.length ? "Colder, sharper cut" : "Brighter, leaner cut",
        why: "Strip the softer support notes back and let tension do more of the work.",
        risk: "Can get thin if the base honey or fruit character is not strong enough."
      },
      {
        name: k.dark.length || sweetness === "Sweet" ? "Broader, warmer cut" : "Richer, rounder cut",
        why: "Let the darker or sweeter side take up more space in the glass.",
        risk: "This is the fastest route to muddy, jammy, or concept-diluting results if you lose discipline."
      }
    ];

    let decisionStage = "concept shaping";
    if (mode === "forge") decisionStage = "batch ready";
    else if (!mustHave.length || !beginner.serveContext) decisionStage = "concept shaping";
    else if (!k.structure.length && !tensionSources.length) decisionStage = "structure pass";
    else if (!/honey|blossom|wildflower|clove|orange blossom|buckwheat|linden|maple/i.test(combinedText)) decisionStage = "constraint lock";
    else decisionStage = "structure pass";

    let nextQuestion = "";
    if (!/honey|blossom|wildflower|clove|buckwheat|orange blossom|linden|maple/i.test(combinedText)){
      nextQuestion = "What honey is actually carrying this, and is it mandatory or just available?";
    } else if (!beginner.serveContext){
      nextQuestion = "When and where are you drinking this, and what should that pour feel like?";
    } else if (!mustHave.length){
      nextQuestion = "What are the one or two flavors that absolutely must stay visible in the glass?";
    } else if (hasCoconut && hasAgave && !/lime zest|lime juice|grapefruit|lemon|orange/.test(combinedText.toLowerCase())){
      nextQuestion = "Do you want the tequila illusion to read brighter through lime, or rounder through the agave side itself?";
    } else if (hasAgave && !/agave syrup|agave nectar/.test(combinedText.toLowerCase())){
      nextQuestion = "Are you creating the agave side with agave syrup, or do you only want the finished mead to imply agave without tasting sweet?";
    } else if (!beginner.noGo && !avoid.length && !hasCoconut && !hasAgave){
      nextQuestion = "What outcome would make you say this missed the whole point?";
    } else if (!tensionSources.length){
      nextQuestion = "What is providing the edge or structure so this does not go soft or generic?";
    } else if (carries.length && supports.length && mode !== "forge"){
      nextQuestion = "What is keeping this fresh and defined in the finish instead of letting it drift soft or syrupy?";
    } else if (mode !== "forge"){
      nextQuestion = "Which ingredient is carrying the identity, and which one is only support?";
    } else {
      nextQuestion = "What production constraint is still unresolved before this becomes a real batch?";
    }

    const nextStep = mode === "forge"
      ? "Turn the winning lane into a Build draft, keep bench-trial items optional, and do not stuff every nice idea into primary."
      : mode === "pushback"
        ? "Kill or demote the weakest supporting idea, then rerun the brainstorm with that cleaner constraint set."
        : "Answer the next question directly, then run the mentor again so it can tighten the same concept instead of inventing a new one.";

    const headline = mode === "pushback"
      ? (pushback[0] || "The concept has promise, but it is still hiding from a harder decision.")
      : mode === "forge"
        ? "This is close enough to turn into a real build." : "Good concept seed. Now give it a clearer center of gravity.";
    const assessment = mode === "forge"
      ? `The concept is coherent enough to start mapping into a real batch. ${strongestDirection.why}`
      : mode === "pushback"
        ? `${leadImpression} ${pushback[0]}`
        : `${leadImpression} ${strongestDirection.why}`;
    const provisionalTake = mode === "pushback"
      ? `If I had to lean right now, I would simplify toward ${strongestDirection.name.toLowerCase()} and cut anything that weakens that identity.`
      : mode === "forge"
        ? `If I had to lean right now, this is ready to move forward as ${strongestDirection.name.toLowerCase()}.`
        : `If I had to lean right now, I would build around ${strongestDirection.name.toLowerCase()} before adding any extra cleverness.`;

    const packet = normalizeMentorPacket({
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
      pushback,
      strongestDirection,
      alternateDirections,
      ingredientRoles: {
        carries,
        supports,
        liftStructure,
        dangerNotes
      },
      decisionStage,
      nextQuestion,
      nextStep
    });

    return {
      conceptName,
      style,
      inspiration,
      vision,
      beginner,
      snapshot,
      headline,
      provisionalTake,
      assessment,
      conversationReply: buildCollaborativeReplyText({
        headline,
        provisionalTake,
        assessment,
        packet,
        mode,
        userNeed: snapshot.userNeed
      }),
      summaryHtml: buildSummaryHtml(headline, assessment, packet),
      coachReplyHtml: buildCoachReplyHtml(headline, provisionalTake, assessment, packet, blunt),
      packet,
      conversation,
      draftUserTurn: composeUserTurnText({
        conceptName,
        style,
        inspiration,
        vision,
        beginner
      }, $("mentorFollowup")?.value || "", conversation)
    };
  }

  function renderTranscript(conversation){
    const el = $("mentorTranscript");
    if (!el) return;
    const turns = normalizeMentorConversation(conversation);
    el.innerHTML = turns.length ? turns.map((turn) => `
      <div class="mentor-turn ${turn.role} ${turn.mode === "concept" ? "concept" : ""}">
        <div class="mentor-turn-head">
          <span class="mentor-turn-role">${turn.mode === "concept" ? "Concept Spark" : turn.role === "mentor" ? "MeadEvil Mentor" : "You"}</span>
          <span class="mentor-turn-mode">${escapeHTML(turn.mode === "concept" ? "snapshot" : turn.mode)}</span>
        </div>
        <div class="mentor-turn-text">${formatTurnText(turn.text)}</div>
      </div>
    `).join("") : "";
  }


  function clearMentorOutputs(){
    [
      "mentorCoachReply",
      "mentorPairings",
      "mentorIngredientPlan"
    ].forEach((id) => {
      if ($(id)) $(id).innerHTML = "";
    });
  }

  function renderMentorOutputs(output){
    if (!output) return;
    const safePacket = normalizeMentorPacket(output.packet);
    if ($("mentorCoachReply")) $("mentorCoachReply").innerHTML = output.conversationReplyHtml || output.coachReplyHtml || "";
    renderRows("mentorPairings", [
      ["What carries the concept", formatIngredientList(safePacket.ingredientRoles.carries)],
      ["What only supports it", formatIngredientList(safePacket.ingredientRoles.supports)],
      ["What keeps it honest", formatIngredientList(safePacket.ingredientRoles.liftStructure)],
      ["What could ruin it", formatIngredientList(safePacket.ingredientRoles.dangerNotes.length ? safePacket.ingredientRoles.dangerNotes : safePacket.ruiners)],
      ["Serve context", escapeHTML((loadEnhancement().mentor.beginner || {}).serveContext || "Not specified")]
    ]);
    renderRows("mentorIngredientPlan", [
      ["Fermentable candidates", formatIngredientList((safePacket.sourceBillCandidates || []).map((item) => item.name))],
      ["Structure additions", formatIngredientList((safePacket.adjunctCandidates || []).map((item) => `${item.ingredient} (${item.phase})`))],
      ["Keep optional", safePacket.adjunctCandidates && safePacket.adjunctCandidates.some((item) => item.phase === "bench trial") ? "Bench-trial items stay optional until the base mead proves it needs them." : "No bench-trial-only items flagged yet"]
    ]);
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
    main.meadevilMentor = clone(enhancement.mentor);
    originalSetItem.call(localStorage, STORAGE_KEY, JSON.stringify(mergeEnhancementIntoMain(main, enhancement)));
  }

  function renderAll(){
    const { main, enhancement } = currentEnhancementState();
    const recipeRows = enhancement.recipeDraft.structureAdditions && enhancement.recipeDraft.structureAdditions.length
      ? enhancement.recipeDraft.structureAdditions
      : [defaultAdjunctRow()];
    renderAdjunctList(recipeRows);
    renderTranscript(enhancement.mentor.conversation);

    if ($("mentorConceptName")) $("mentorConceptName").value = (main.mentor || {}).conceptName || "";
    if ($("mentorStyle")) $("mentorStyle").value = (main.mentor || {}).style || "";
    if ($("mentorBatchSize")) $("mentorBatchSize").value = (main.mentor || {}).batchSize || "";
    if ($("mentorTargetAbv")) $("mentorTargetAbv").value = (main.mentor || {}).targetAbv || "";
    if ($("mentorSweetness")) $("mentorSweetness").value = (main.mentor || {}).sweetness || "Dry";
    if ($("mentorCarbonation")) $("mentorCarbonation").value = (main.mentor || {}).carbonation || "Still";
    if ($("mentorInspiration")) $("mentorInspiration").value = (main.mentor || {}).inspiration || "";
    if ($("mentorVision")) $("mentorVision").value = (main.mentor || {}).vision || "";
    if ($("mentorServeContext")) $("mentorServeContext").value = enhancement.mentor.beginner.serveContext || "";
    if ($("mentorMustHaveSimple")) $("mentorMustHaveSimple").value = enhancement.mentor.beginner.mustHaveSimple || "";
    if ($("mentorAvoidSimple")) $("mentorAvoidSimple").value = enhancement.mentor.beginner.avoidSimple || "";
    if ($("mentorIngredientsOnHand")) $("mentorIngredientsOnHand").value = enhancement.mentor.beginner.ingredientsOnHand || "";
    if ($("mentorNoGo")) $("mentorNoGo").value = enhancement.mentor.beginner.noGo || "";
    if ($("mentorSkillLevel")) $("mentorSkillLevel").value = enhancement.mentor.beginner.skillLevel || "beginner";
    if ($("mentorRiskTolerance")) $("mentorRiskTolerance").value = enhancement.mentor.beginner.riskTolerance || "keep it safe";
    if ($("mentorProcessComfort")) $("mentorProcessComfort").value = enhancement.mentor.beginner.processComfort || "secondary additions are fine";
    if ($("mentorTimePatience")) $("mentorTimePatience").value = enhancement.mentor.beginner.timePatience || "a few months is fine";
    if ($("mentorModel")) $("mentorModel").value = VALID_MODELS.includes(enhancement.mentor.model) ? enhancement.mentor.model : "gpt-4o-mini";
    if ($("mentorBluntMode")) $("mentorBluntMode").checked = Boolean(enhancement.mentor.blunt);
    document.querySelectorAll(".mentor-mode-btn").forEach((button) => button.classList.toggle("active", button.dataset.mentorMode === enhancement.mentor.mode));

    const statusMode = enhancement.mentor.status.lastError ? "mentor-status-bad" : enhancement.mentor.status.mode === "remote" ? "mentor-status-good" : "mentor-status-warn";
    if ($("mentorCoachStatus")) $("mentorCoachStatus").innerHTML = `<span class="${statusMode}">${escapeHTML(enhancement.mentor.status.message || "MeadEvil Mentor ready.")}</span>${enhancement.mentor.status.lastRunAt ? `<br><span class="muted">Last run: ${escapeHTML(new Date(enhancement.mentor.status.lastRunAt).toLocaleString())}</span>` : ""}`;
    if (enhancement.mentor.outputs && enhancement.mentor.outputs.packet){
      renderMentorOutputs(enhancement.mentor.outputs);
    } else {
      clearMentorOutputs();
    }

    renderConceptPreview();
  }

  function updateBeginnerField(field, value){
    saveMergedMain((enhancement) => {
      enhancement.mentor.beginner[field] = value;
      enhancement.mentor.blunt = Boolean($("mentorBluntMode")?.checked ?? enhancement.mentor.blunt);
    });
    renderAll();
  }

  function updateMentorConceptField(field, value){
    saveMentorMirrorToMain((main) => {
      main.mentor = main.mentor || {};
      main.mentor[field] = value;
    });
    renderConceptPreview();
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

  function buildMentorPayload(localPacket, conversation, userTurnText){
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
        batchSize: $("mentorBatchSize")?.value || "",
        targetAbv: $("mentorTargetAbv")?.value || "",
        sweetness: $("mentorSweetness")?.value || "Dry",
        carbonation: $("mentorCarbonation")?.value || "Still"
      },
      concept_snapshot: localPacket.snapshot,
      fallback_packet: localPacket.packet,
      conversation_history: normalizeMentorConversation(conversation).map((turn) => ({
        role: turn.role,
        mode: turn.mode,
        text: turn.text
      })),
      current_user_turn: String(userTurnText || "").trim()
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
    const objectList = (value, fallback) => Array.isArray(value)
      ? value.filter(isPlainObject).map((item) => ({ ...item }))
      : clone(fallback);
    const safeLocalPacket = normalizeMentorPacket(localPacket.packet);
    const pushback = normalizeStringList(reply.pushback, safeLocalPacket.pushback || []);
    const strongestDirection = normalizeDirectionCard(reply.strongest_direction || reply.strongestDirection || {});
    const alternateDirections = Array.isArray(reply.alternate_directions || reply.alternateDirections)
      ? (reply.alternate_directions || reply.alternateDirections).filter(isPlainObject).map(normalizeDirectionCard)
      : safeLocalPacket.alternateDirections;
    const ingredientRolesRaw = isPlainObject(reply.ingredient_roles || reply.ingredientRoles) ? (reply.ingredient_roles || reply.ingredientRoles) : {};
    const mergedPacket = normalizeMentorPacket({
      ...safeLocalPacket,
      leadImpression: pickText(concept.lead_impression, concept.leadImpression, localPacket.packet.leadImpression),
      dominantNotes: normalizeStringList(concept.dominant_notes ?? concept.dominantNotes, localPacket.packet.dominantNotes),
      supportNotes: normalizeStringList(concept.support_notes ?? concept.supportNotes, localPacket.packet.supportNotes),
      tensionSources: normalizeStringList(concept.tension_sources ?? concept.tensionSources, localPacket.packet.tensionSources),
      ruiners: normalizeStringList(concept.ruiners, localPacket.packet.ruiners),
      styleLane: pickText(concept.style_lane, concept.styleLane, localPacket.packet.styleLane),
      finishDirection: pickText(concept.finish_direction, concept.finishDirection, localPacket.packet.finishDirection),
      yeastLane: pickText(build.yeast, concept.yeast_lane, concept.yeastLane, localPacket.packet.yeastLane),
      sourceBillCandidates: objectList(build.source_bill_candidates ?? build.sourceBillCandidates, localPacket.packet.sourceBillCandidates),
      adjunctCandidates: objectList(build.adjunct_candidates ?? build.adjunctCandidates, localPacket.packet.adjunctCandidates),
      riskControls: normalizeStringList(reply.risk_controls ?? json.risk_controls, localPacket.packet.riskControls),
      productionSequence: normalizeStringList(reply.production_sequence ?? json.production_sequence, localPacket.packet.productionSequence),
      pushback,
      strongestDirection: strongestDirection.name || strongestDirection.why || strongestDirection.buildSignal ? strongestDirection : safeLocalPacket.strongestDirection,
      alternateDirections,
      ingredientRoles: {
        carries: normalizeStringList(ingredientRolesRaw.carries, safeLocalPacket.ingredientRoles.carries),
        supports: normalizeStringList(ingredientRolesRaw.supports, safeLocalPacket.ingredientRoles.supports),
        liftStructure: normalizeStringList(ingredientRolesRaw.lift_or_structure ?? ingredientRolesRaw.liftStructure, safeLocalPacket.ingredientRoles.liftStructure),
        dangerNotes: normalizeStringList(ingredientRolesRaw.danger_notes ?? ingredientRolesRaw.dangerNotes, safeLocalPacket.ingredientRoles.dangerNotes)
      },
      decisionStage: pickText(concept.decision_stage, concept.decisionStage, safeLocalPacket.decisionStage),
      nextQuestion: pickText(reply.next_question, reply.nextQuestion, safeLocalPacket.nextQuestion),
      nextStep: pickText(reply.next_step, reply.nextStep, safeLocalPacket.nextStep)
    });
    const headline = pickText(reply.headline, localPacket.headline);
    const provisionalTake = sanitizeProvisionalTakeText(pickText(
      reply.provisional_take,
      reply.provisionalTake,
      localPacket.provisionalTake,
      buildDefaultProvisionalTake(mergedPacket, pickText(reply.assessment, localPacket.assessment, safeLocalPacket.leadImpression))
    ));
    const assessment = pickText(reply.assessment, localPacket.assessment, safeLocalPacket.leadImpression);
    const conversationReply = pickText(
      reply.conversation_reply,
      reply.conversationReply,
      buildCollaborativeReplyText({
        headline,
        provisionalTake,
        assessment,
        packet: mergedPacket,
        mode: loadEnhancement().mentor.mode || "scout"
      })
    );
    const conversationReplyHtml = formatTurnText(conversationReply);
    return {
      headline,
      conversationReply,
      conversationReplyHtml,
      provisionalTake,
      assessment,
      summaryHtml: buildSummaryHtml(headline, assessment, mergedPacket),
      coachReplyHtml: buildCoachReplyHtml(headline, provisionalTake, assessment, mergedPacket, Boolean($("mentorBluntMode")?.checked)),
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
        const stripped = text
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (response.status === 404 || response.status === 405 || response.status === 501 || /unsupported method/i.test(stripped)){
          msg = "Mentor endpoint is not available on this local static server.";
        } else {
          msg = stripped || text.trim();
        }
      }
      throw new Error(msg);
    }
    return await response.json();
  }

  async function runMentor(){
    const localPacket = buildLocalPacket();
    const enhancementNow = loadEnhancement();
    const provider = "openai";
    const model = enhancementNow.mentor.model || "gpt-4o-mini";
    const followupValue = $("mentorFollowup")?.value || "";
    const baseConversation = normalizeMentorConversation(enhancementNow.mentor.conversation);
    const conceptSparkText = buildConceptSparkTranscriptText(localPacket);
    const shouldAppendConceptSpark = Boolean(conceptSparkText) && conceptSparkText !== latestConceptSparkText(baseConversation);
    const userTurnText = composeUserTurnText(localPacket, followupValue, baseConversation);
    const hasExplicitUserTurn = Boolean(String(userTurnText || "").trim());
    const workingConversation = [
      ...baseConversation,
      ...(shouldAppendConceptSpark ? [normalizeMentorTurn({
          role: "user",
          mode: "concept",
          text: conceptSparkText,
          createdAt: new Date().toISOString()
        })] : []),
      ...(hasExplicitUserTurn ? [normalizeMentorTurn({
          role: "user",
          mode: enhancementNow.mentor.mode || "scout",
          text: userTurnText,
          createdAt: new Date().toISOString()
        })] : [])
    ];

    saveMergedMain((enhancement) => {
      enhancement.mentor.conversation = workingConversation;
      enhancement.mentor.status = {
        ...enhancement.mentor.status,
        mode: provider === "openai" ? "remote" : "local",
        message: provider === "openai" ? "Sending concept to GPT…" : "Thinking through the concept locally…",
        lastError: ""
      };
    });
    renderAll();
    if ($("mentorRunBtn")) $("mentorRunBtn").disabled = true;

    const payload = buildMentorPayload(localPacket, workingConversation, userTurnText);
    let finalOutput = {
      headline: localPacket.headline,
      conversationReply: localPacket.conversationReply,
      conversationReplyHtml: formatTurnText(localPacket.conversationReply || ""),
      provisionalTake: localPacket.provisionalTake,
      assessment: localPacket.assessment,
      summaryHtml: localPacket.summaryHtml,
      coachReplyHtml: localPacket.coachReplyHtml,
      packet: localPacket.packet
    };
    let status = { mode: "local", message: "Rendered with local mentor logic.", lastRunAt: new Date().toISOString(), lastError: "" };

    if (provider === "openai"){
      try {
        if ($("mentorCoachStatus")) $("mentorCoachStatus").innerHTML = `<span class="mentor-status-warn">Designing the mead with GPT…</span>`;
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

    const mentorTurn = normalizeMentorTurn({
      role: "mentor",
      mode: enhancementNow.mentor.mode || "scout",
      text: buildMentorTurnText(finalOutput),
      createdAt: new Date().toISOString()
    });

    saveMergedMain((enhancement) => {
      enhancement.mentor.outputs = clone(finalOutput);
      enhancement.mentor.conversation = [...workingConversation, mentorTurn];
      enhancement.mentor.status = status;
      enhancement.mentor.provider = provider;
      enhancement.mentor.model = model;
      enhancement.mentor.blunt = Boolean($("mentorBluntMode")?.checked);
    });
    if ($("mentorFollowup")) $("mentorFollowup").value = "";
    if ($("mentorRunBtn")) $("mentorRunBtn").disabled = false;
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

  function sourcePresetPpg(type){
    const presets = {
      "Honey": "35", "Maple Syrup": "29.8", "Table Sugar": "46",
      "Juice (single strength)": "5", "Juice Concentrate": "48",
      "Fruit / Puree": "10", "Custom": ""
    };
    return presets[type] || "35";
  }

  function sourcePresetUnit(type){
    return "lb";
  }

  function extractAmountFromText(text, term){
    const lower = String(text || "").toLowerCase();
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const weightPatterns = [
      new RegExp(`(\\d+\\.?\\d*)\\s*(?:to\\s*\\d+\\.?\\d*\\s*)?(lb|lbs|pound|pounds|oz|ounces|kg|g)\\b[^.]{0,80}${escaped}`, "i"),
      new RegExp(`${escaped}[^.]{0,80}?(\\d+\\.?\\d*)\\s*(?:to\\s*\\d+\\.?\\d*\\s*)?(lb|lbs|pound|pounds|oz|ounces|kg|g)`, "i"),
      new RegExp(`(\\d+\\.?\\d*)\\s*(lb|lbs|pound|pounds|oz|ounces|kg|g)\\b[\\s\\S]{0,120}${escaped}`, "i")
    ];
    for (const pat of weightPatterns){
      const m = lower.match(pat);
      if (m){
        const raw = (m[2] || "lb").toLowerCase();
        const unit = /^(lb|lbs|pound|pounds)$/.test(raw) ? "lb" : /^(oz|ounces)$/.test(raw) ? "oz" : /^(kg)$/.test(raw) ? "kg" : /^(g)$/.test(raw) ? "g" : "lb";
        return { amount: m[1], unit };
      }
    }
    const baseTerm = term.replace(/\s*(zest|peel|juice|slices?|chunks?)$/i, "").trim();
    const baseEsc = baseTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const countPatterns = [
      new RegExp(`(\\d+\\.?\\d*)\\s*(?:to|-)\\s*(\\d+\\.?\\d*)\\s+(?:whole\\s+)?${baseEsc}s?\\b`, "i"),
      new RegExp(`${escaped}[^.]{0,60}?(\\d+\\.?\\d*)\\s*(?:to|-)\\s*(\\d+\\.?\\d*)\\s+${baseEsc}s?\\b`, "i"),
      new RegExp(`(\\d+\\.?\\d*)\\s+(?:whole\\s+)?${baseEsc}s?\\b(?!\\s*(?:lb|lbs|oz|g|kg|pound|gallon))`, "i")
    ];
    for (const pat of countPatterns){
      const m = lower.match(pat);
      if (m){
        if (m[2]){
          const mid = (parseFloat(m[1]) + parseFloat(m[2])) / 2;
          return { amount: String(Math.round(mid * 10) / 10), unit: "each" };
        }
        return { amount: m[1], unit: "each" };
      }
    }
    return null;
  }

  function seedRecipeSourceBill(packet, batchGallons, targetAbv, sweetness, yeastTolerance){
    if (!packet.sourceBillCandidates || !packet.sourceBillCandidates.length) return;
    const currentMain = getMainState();
    const currentRows = (((currentMain || {}).recipeDraft || {}).additions) || [];
    const trulyBlank = !currentRows.length || currentRows.every((row) => {
      const desc = String((row && row.description) || "").trim();
      const amt = String((row && row.amount) || "").trim();
      return !desc && !amt;
    });
    if (!trulyBlank && !confirm("The source bill already has entries. Replace them with the Mentor's recommendations?")) return;

    const MeadLogic = window.MeadLogic || {};
    let honeyLb = null;
    if (MeadLogic.estimateRecipeTargets && batchGallons && targetAbv) {
      const projected = MeadLogic.estimateRecipeTargets({ batchGallons, targetAbv, sweetness, yeastTolerance, honeyPPG: 35 });
      if (projected && projected.honeyLb) honeyLb = projected.honeyLb;
    }

    const rows = packet.sourceBillCandidates.map((candidate) => {
      const type = candidate.type || "Custom";
      const amount = candidate.amount
        || (type === "Honey" && honeyLb ? String(Math.round(honeyLb * 100) / 100) : "");
      return {
        id: makeId("src"),
        sourceType: type,
        description: candidate.name || "",
        amount: amount,
        unit: candidate.unit || sourcePresetUnit(type),
        ppg: sourcePresetPpg(type)
      };
    });

    saveMentorMirrorToMain((main) => {
      main.recipeDraft = main.recipeDraft || {};
      main.recipeDraft.additions = rows.length ? rows : [{ id: makeId("src"), sourceType: "Honey", description: "", amount: "", unit: "lb", ppg: "35" }];
    });
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

    if (output.packet.yeastLane) {
      const knownYeasts = ["71B", "D47", "QA23", "EC-1118"];
      if (knownYeasts.includes(output.packet.yeastLane)) {
        recipeFieldSet("recipeYeast", output.packet.yeastLane);
      } else {
        recipeFieldSet("recipeYeast", "Other / Custom");
        recipeFieldSet("recipeYeastOther", output.packet.yeastLane);
      }
    }

    const lastMentorReply = (enhancement.mentor.conversation || [])
      .filter((turn) => turn.role === "mentor" && turn.text)
      .slice(-1)
      .map((turn) => turn.text.replace(/<[^>]+>/g, "").slice(0, 500))[0] || "";
    const noteBits = [
      `Concept read: ${output.packet.leadImpression || ""}`,
      output.packet.pushback && output.packet.pushback.length ? `Pushback: ${output.packet.pushback[0]}` : "",
      output.packet.riskControls && output.packet.riskControls.length ? `Risk controls: ${output.packet.riskControls.join(" | ")}` : "",
      output.packet.productionSequence && output.packet.productionSequence.length ? `Production sequence: ${output.packet.productionSequence.join(" → ")}` : "",
      lastMentorReply ? `\nMentor's last word:\n${lastMentorReply}` : ""
    ].filter(Boolean).join("\n");
    recipeFieldSet("recipeNotes", noteBits);

    const batchGallons = $("mentorBatchSize")?.value || "";
    const targetAbv = $("mentorTargetAbv")?.value || "";
    const sweetness = $("mentorSweetness")?.value || "Dry";
    const yeastTolerance = output.packet.yeastLane && ["71B","D47","QA23","EC-1118"].includes(output.packet.yeastLane)
      ? ({ "71B": "14", "D47": "15", "QA23": "16", "EC-1118": "18" })[output.packet.yeastLane] || ""
      : "";

    const avoidText = String(enhancement.mentor.beginner.avoidSimple || "").toLowerCase();
    const mentorProseText = (enhancement.mentor.conversation || [])
      .filter((turn) => turn.role === "mentor" && turn.text)
      .map((turn) => turn.text.replace(/<[^>]+>/g, ""))
      .join("\n");

    const cleanedPacket = { ...output.packet };
    if (cleanedPacket.sourceBillCandidates) {
      cleanedPacket.sourceBillCandidates = cleanedPacket.sourceBillCandidates
        .filter((c) => !avoidText || !avoidText.includes(String(c.name || "").toLowerCase()))
        .map((c) => {
          if (c.amount) return c;
          const extracted = extractAmountFromText(mentorProseText, c.name || "");
          return extracted ? { ...c, amount: extracted.amount, unit: extracted.unit } : c;
        });
    }

    seedRecipeSourceBill(cleanedPacket, batchGallons, targetAbv, sweetness, yeastTolerance);

    const enrichedAdjuncts = (output.packet.adjunctCandidates || []).map((item) => {
      const amount = item.amount || "";
      const unit = item.unit || "g";
      if (amount) return { ...item, amount, unit };
      const extracted = extractAmountFromText(mentorProseText, item.ingredient || "");
      return extracted ? { ...item, amount: extracted.amount, unit: extracted.unit } : item;
    });

    saveMergedMain((enh) => {
      const adjunctRows = enrichedAdjuncts.length
        ? enrichedAdjuncts.map((item) => normalizeAdjunctRow({
            phase: item.phase || "secondary",
            category: item.category || "other",
            ingredient: item.ingredient || "",
            amount: item.amount || "",
            unit: item.unit || "g",
            purpose: item.purpose || "",
            notes: item.notes || ""
          }))
        : enh.recipeDraft.structureAdditions;
      enh.recipeDraft.structureAdditions = adjunctRows.length ? adjunctRows : [defaultAdjunctRow()];
    });

    window.dispatchEvent(new Event("meadevil-cloud-restore"));
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
      ["mentorTimePatience", "timePatience"]
    ].forEach(([id, field]) => {
      const el = $(id);
      if (!el) return;
      const handler = () => updateBeginnerField(field, el.value);
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });

    [
      ["mentorConceptName", "conceptName"],
      ["mentorStyle", "style"],
      ["mentorBatchSize", "batchSize"],
      ["mentorTargetAbv", "targetAbv"],
      ["mentorSweetness", "sweetness"],
      ["mentorCarbonation", "carbonation"],
      ["mentorInspiration", "inspiration"],
      ["mentorVision", "vision"]
    ].forEach(([id, field]) => {
      const el = $(id);
      if (!el) return;
      const handler = () => updateMentorConceptField(field, el.value);
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
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
    $("mentorToRecipeBtn")?.addEventListener("click", applyMentorToBuild);

    $("mentorClearThreadBtn")?.addEventListener("click", () => {
      if (!confirm("Clear the mentor conversation thread? Your concept fields will stay, but all conversation history will be lost.")) return;
      saveMergedMain((enh) => {
        enh.mentor = blankMentorThreadState(enh.mentor);
      });
      saveMentorMirrorToMain((main) => {
        main.meadevilMentor = clone(loadEnhancement().mentor);
      });
      if ($("mentorFollowup")) $("mentorFollowup").value = "";
      setTimeout(renderAll, 60);
    });

    $("clearMentorBtn")?.addEventListener("click", () => {
      if (!confirm("Start a completely new brew? All concept fields and conversation history will be reset.")) return;
      saveMergedMain((enh) => { enh.mentor = defaultMentorState(); });
      saveMentorMirrorToMain((main) => {
        blankMentorLegacyBridge(main);
      });
      if ($("mentorFollowup")) $("mentorFollowup").value = "";
      window.dispatchEvent(new Event("meadevil-cloud-restore"));
      setTimeout(renderAll, 60);
    });

    $("clearRecipeBtn")?.addEventListener("click", () => {
      setTimeout(() => {
        const main = getMainState();
        const draft = (main && main.recipeDraft) || {};
        const cleared = !draft.name && !draft.targetAbv && !draft.batchGallons;
        if (!cleared) return;
        saveMergedMain((enh) => { enh.recipeDraft.structureAdditions = [defaultAdjunctRow()]; });
        renderAll();
      }, 20);
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
