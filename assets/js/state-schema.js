(function(){
  "use strict";

  const APP_NAME = "MeadEvil";
  const SCHEMA_VERSION = 1;

  function createTools(options){
    const {
      storageKey,
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
    } = options;

    function normalizeRecipe(recipe){
      const input = recipe || {};
      const merged = { ...defaultRecipeDraft(), ...input };
      merged.id = input.id || makeId("recipe");
      merged.createdAt = input.createdAt || new Date().toISOString();
      merged.updatedAt = input.updatedAt || merged.createdAt;
      merged.additions = Array.isArray(input.additions) && input.additions.length
        ? input.additions.map((row) => ({ ...defaultAdditionRow(), ...row, id: row.id || makeId("src") }))
        : [defaultAdditionRow()];
      merged.structureAdditions = Array.isArray(input.structureAdditions) ? input.structureAdditions : [];
      return merged;
    }

    function normalizeLog(log){
      const input = log || {};
      return {
        id: input.id || makeId("grav"),
        date: input.date || todayStr(),
        gravity: String(input.gravity || ""),
        temp: String(input.temp || ""),
        pH: String(input.pH || ""),
        note: String(input.note || ""),
        createdAt: input.createdAt || new Date().toISOString(),
        source: String(input.source || "manual"),
        sourceId: String(input.sourceId || ""),
        telemetryAt: String(input.telemetryAt || ""),
        deviceName: String(input.deviceName || ""),
        deviceId: String(input.deviceId || "")
      };
    }

    function normalizeArchiveItem(item){
      const input = item || {};
      return {
        id: input.id || makeId("arch"),
        archivedAt: input.archivedAt || new Date().toISOString(),
        batch: { ...defaultCurrentBatch(), ...(input.batch || {}) },
        nutrients: { ...defaultNutrients(), ...(input.nutrients || {}) },
        cellar: { ...defaultCellar(), ...(input.cellar || {}) },
        fermentChecklist: Array.isArray(input.fermentChecklist) && input.fermentChecklist.length ? input.fermentChecklist : defaultFermentChecklist(),
        cellarChecklist: Array.isArray(input.cellarChecklist) && input.cellarChecklist.length ? input.cellarChecklist : defaultCellarChecklist(),
        fermentationLogs: Array.isArray(input.fermentationLogs) ? input.fermentationLogs.map(normalizeLog) : [],
        summary: input.summary || ""
      };
    }

    function normalizeMentorKnowledge(input){
      const defaults = defaultMentorKnowledgeBase();
      const source = input && typeof input === "object" ? input : {};

      function mergeListWithDefaults(list, fallback, keyField){
        if (!Array.isArray(list)) return clone(fallback);
        const normalized = list
          .filter((item) => item && typeof item === "object")
          .map((item) => clone(item));
        const existing = new Set(
          normalized
            .map((item) => String((item[keyField] || item.name || "")).toLowerCase().trim())
            .filter(Boolean)
        );
        fallback.forEach((item) => {
          const key = String((item[keyField] || item.name || "")).toLowerCase().trim();
          if (key && !existing.has(key)) normalized.push(clone(item));
        });
        return normalized;
      }

      return {
        honeys: mergeListWithDefaults(source.honeys, defaults.honeys, "name"),
        yeasts: mergeListWithDefaults(source.yeasts, defaults.yeasts, "name"),
        adjuncts: mergeListWithDefaults(source.adjuncts, defaults.adjuncts, "key"),
        archetypes: mergeListWithDefaults(source.archetypes, defaults.archetypes, "key")
      };
    }

    function unwrapPayload(parsed){
      if (!parsed || typeof parsed !== "object") {
        return { state: parsed, schema: null, enhancement: null };
      }
      if (parsed._schema && parsed.data && typeof parsed.data === "object") {
        return {
          state: parsed.data,
          schema: parsed._schema,
          enhancement: parsed._enhancement || null
        };
      }
      const legacy = { ...parsed };
      const enhancement = legacy._enhancement || null;
      delete legacy._enhancement;
      return { state: legacy, schema: null, enhancement };
    }

    function normalizeData(parsed){
      const base = clone(defaultData);
      const input = parsed || {};
      const merged = {
        ...base,
        ...input,
        ui: { ...base.ui, ...((input.ui) || {}) },
        clock: normalizeClock(input.clock),
        recipeDraft: { ...defaultRecipeDraft(), ...((input.recipeDraft) || {}) },
        currentBatch: { ...defaultCurrentBatch(), ...((input.currentBatch) || {}) },
        nutrients: { ...defaultNutrients(), ...((input.nutrients) || {}) },
        cellar: { ...defaultCellar(), ...((input.cellar) || {}) },
        calcs: { ...defaultCalcs(), ...((input.calcs) || {}) },
        rapt: { ...defaultRaptSync(), ...((input.rapt) || {}) },
        mentor: { ...defaultMentor(), ...((input.mentor) || {}) },
        mentorKnowledge: normalizeMentorKnowledge(input.mentorKnowledge)
      };
      merged.recipeDraft.additions = Array.isArray(merged.recipeDraft.additions) && merged.recipeDraft.additions.length
        ? merged.recipeDraft.additions.map((row) => ({ ...defaultAdditionRow(), ...row, id: row.id || makeId("src") }))
        : [defaultAdditionRow()];
      merged.currentBatch.additions = Array.isArray(merged.currentBatch.additions) && merged.currentBatch.additions.length
        ? merged.currentBatch.additions.map((row) => ({ ...defaultAdditionRow(), ...row, id: row.id || makeId("src") }))
        : [defaultAdditionRow()];
      merged.currentBatch.stepFeedLog = Array.isArray(merged.currentBatch.stepFeedLog) ? merged.currentBatch.stepFeedLog : [];
      merged.cellar.additions = Array.isArray(merged.cellar.additions) && merged.cellar.additions.length
        ? merged.cellar.additions.map((row) => ({ ...defaultCellarAddition(), ...row, id: row.id || makeId("cellaradd") }))
        : [defaultCellarAddition()];
      merged.recipes = Array.isArray(input.recipes) ? input.recipes.map(normalizeRecipe) : [];
      merged.fermentationLogs = Array.isArray(input.fermentationLogs) ? input.fermentationLogs.map(normalizeLog) : [];
      merged.fermentChecklist = Array.isArray(input.fermentChecklist) && input.fermentChecklist.length ? input.fermentChecklist : defaultFermentChecklist();
      merged.cellarChecklist = Array.isArray(input.cellarChecklist) && input.cellarChecklist.length ? input.cellarChecklist : defaultCellarChecklist();
      merged.archive = Array.isArray(input.archive) ? input.archive.map(normalizeArchiveItem) : [];
      if (!merged.ui.activeTab || merged.ui.activeTab === "dashboard" || merged.ui.activeTab === "calcs") {
        merged.ui.activeTab = "recipes";
      }
      return merged;
    }

    function serializeState(data, { enhancement = null, stampKey = "savedAt" } = {}){
      const state = clone(data || {});
      delete state.meadevilMentor;
      const payload = {
        _schema: {
          app: APP_NAME,
          version: SCHEMA_VERSION,
          [stampKey]: new Date().toISOString()
        },
        data: state
      };
      if (enhancement != null) payload._enhancement = enhancement;
      return payload;
    }

    function loadStoredData(){
      try{
        const parsed = JSON.parse(localStorage.getItem(storageKey) || "null");
        return normalizeData(unwrapPayload(parsed).state);
      } catch(error){
        console.error("Could not load app data", error);
        return normalizeData(null);
      }
    }

    function persistStoredData(data){
      try{
        localStorage.setItem(storageKey, JSON.stringify(serializeState(data)));
      } catch(error){
        console.error("Could not save app data", error);
      }
    }

    function serializeExportState(data, enhancement){
      return serializeState(data, { enhancement, stampKey: "exportedAt" });
    }

    function parseImportedState(raw){
      const parsed = JSON.parse(raw);
      const unwrapped = unwrapPayload(parsed);
      return {
        normalizedData: normalizeData(unwrapped.state),
        enhancement: unwrapped.enhancement,
        schema: unwrapped.schema
      };
    }

    return {
      APP_NAME,
      SCHEMA_VERSION,
      normalizeMentorKnowledge,
      normalizeRecipe,
      normalizeLog,
      normalizeArchiveItem,
      normalizeData,
      loadStoredData,
      persistStoredData,
      serializeExportState,
      parseImportedState
    };
  }

  window.MeadEvilState = {
    APP_NAME,
    SCHEMA_VERSION,
    createTools
  };
})();
