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

    // Record ids are interpolated straight into `data-*` HTML attributes by the
    // renderers (e.g. `data-recipe-edit="${recipe.id}"`), so an id carrying a
    // quote character breaks out of the attribute and injects markup. Imported
    // backups and cloud-synced documents are attacker-reachable, so ids are
    // hard-restricted to an id-safe charset HERE, at the single choke point every
    // inbound record passes through. Anything else is replaced with a fresh id
    // rather than silently mangled.
    const ID_SAFE = /^[A-Za-z0-9_-]{1,64}$/;
    function safeId(value, prefix){
      const text = String(value ?? "");
      return ID_SAFE.test(text) ? text : makeId(prefix);
    }

    // Checklists arrive from imports/sync too and their `id` reaches
    // `data-task-toggle="${item.id}"`, so they need the same treatment.
    function normalizeChecklist(list, fallback){
      if (!Array.isArray(list) || !list.length) return fallback();
      return list
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          ...item,
          id: safeId(item.id, "task"),
          text: String(item.text ?? ""),
          done: Boolean(item.done)
        }));
    }

    function normalizeRecipe(recipe){
      const input = recipe || {};
      const merged = { ...defaultRecipeDraft(), ...input };
      merged.id = safeId(input.id, "recipe");
      merged.createdAt = input.createdAt || new Date().toISOString();
      merged.updatedAt = input.updatedAt || merged.createdAt;
      merged.additions = Array.isArray(input.additions) && input.additions.length
        ? input.additions.map((row) => ({ ...defaultAdditionRow(), ...row, id: safeId(row.id, "src") }))
        : [defaultAdditionRow()];
      merged.structureAdditions = Array.isArray(input.structureAdditions)
        ? input.structureAdditions
          .filter((row) => row && typeof row === "object")
          .map((row) => ({ ...row, id: safeId(row.id, "adj") }))
        : [];
      return merged;
    }

    function normalizeLog(log){
      const input = log || {};
      return {
        id: safeId(input.id, "grav"),
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
        id: safeId(input.id, "arch"),
        archivedAt: input.archivedAt || new Date().toISOString(),
        batch: { ...defaultCurrentBatch(), ...(input.batch || {}) },
        nutrients: { ...defaultNutrients(), ...(input.nutrients || {}) },
        cellar: { ...defaultCellar(), ...(input.cellar || {}) },
        fermentChecklist: normalizeChecklist(input.fermentChecklist, defaultFermentChecklist),
        cellarChecklist: normalizeChecklist(input.cellarChecklist, defaultCellarChecklist),
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
        ? merged.recipeDraft.additions.map((row) => ({ ...defaultAdditionRow(), ...row, id: safeId(row && row.id, "src") }))
        : [defaultAdditionRow()];
      merged.recipeDraft.structureAdditions = Array.isArray(merged.recipeDraft.structureAdditions)
        ? merged.recipeDraft.structureAdditions
          .filter((row) => row && typeof row === "object")
          .map((row) => ({ ...row, id: safeId(row.id, "adj") }))
        : [];
      merged.currentBatch.additions = Array.isArray(merged.currentBatch.additions) && merged.currentBatch.additions.length
        ? merged.currentBatch.additions.map((row) => ({ ...defaultAdditionRow(), ...row, id: safeId(row && row.id, "src") }))
        : [defaultAdditionRow()];
      merged.currentBatch.structureAdditions = Array.isArray(merged.currentBatch.structureAdditions)
        ? merged.currentBatch.structureAdditions
          .filter((row) => row && typeof row === "object")
          .map((row) => ({ ...row, id: safeId(row.id, "adj") }))
        : [];
      merged.currentBatch.stepFeedLog = Array.isArray(merged.currentBatch.stepFeedLog) ? merged.currentBatch.stepFeedLog : [];
      merged.cellar.additions = Array.isArray(merged.cellar.additions) && merged.cellar.additions.length
        ? merged.cellar.additions.map((row) => ({ ...defaultCellarAddition(), ...row, id: safeId(row && row.id, "cellaradd") }))
        : [defaultCellarAddition()];
      merged.recipes = Array.isArray(input.recipes) ? input.recipes.map(normalizeRecipe) : [];
      merged.fermentationLogs = Array.isArray(input.fermentationLogs) ? input.fermentationLogs.map(normalizeLog) : [];
      merged.fermentChecklist = normalizeChecklist(input.fermentChecklist, defaultFermentChecklist);
      merged.cellarChecklist = normalizeChecklist(input.cellarChecklist, defaultCellarChecklist);
      merged.archive = Array.isArray(input.archive) ? input.archive.map(normalizeArchiveItem) : [];
      merged.tombstones = Array.isArray(input.tombstones)
        ? input.tombstones.filter((entry) => entry && entry.collection && entry.id)
        : [];
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
      const raw = (() => { try { return localStorage.getItem(storageKey); } catch { return null; } })();
      try{
        const parsed = JSON.parse(raw || "null");
        return normalizeData(unwrapPayload(parsed).state);
      } catch(error){
        console.error("Could not load app data", error);
        // Preserve the unparseable blob under a backup key so a subsequent save
        // doesn't destroy data that might still be manually recoverable.
        let backedUp = false;
        if (raw){
          try{
            localStorage.setItem(`${storageKey}-corrupt-backup`, raw);
            backedUp = true;
          } catch(_){ /* best effort */ }
        }
        // TELL THE USER. Silently returning a blank ledger made the app open
        // looking factory-fresh: no recipes, no batch, no archive. The natural
        // reaction is to start re-entering everything, and the first save then
        // cements the empty state as the new truth.
        // loadStoredData() runs during module init, BEFORE app.js has attached its
        // listeners, so a bare event would be dispatched into the void. Record the
        // fact on a well-known flag as well and let boot drain it.
        const detail = { backedUp, backupKey: `${storageKey}-corrupt-backup` };
        try{ window.__meadevilStorageCorrupt = detail; } catch(_){ /* non-browser host */ }
        try{
          window.dispatchEvent(new CustomEvent("meadevil-storage-corrupt", { detail }));
        } catch(_){ /* environments without CustomEvent */ }
        return normalizeData(null);
      }
    }

    function persistStoredData(data){
      try{
        localStorage.setItem(storageKey, JSON.stringify(serializeState(data)));
        return true;
      } catch(error){
        console.error("Could not save app data", error);
        // Signal so the UI can warn the user their changes are not being saved
        // (full quota, private-mode storage disabled, etc.).
        try{
          window.dispatchEvent(new CustomEvent("meadevil-storage-error", {
            detail: { name: error && error.name, message: error && error.message }
          }));
        } catch(_){ /* environments without CustomEvent */ }
        return false;
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
