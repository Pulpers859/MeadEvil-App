const KNOWLEDGE_SOURCES = {
  bjcp_mead: {
    label: "BJCP Mead Guidelines",
    url: "https://www.bjcp.org/style/2015/mead/",
    strength: "gold_standard"
  },
  lallemand_71b: {
    label: "Lalvin 71B official profile",
    url: "https://www.lallemandwine.com/en/united-states/products/wine-yeasts/lalvin-71b/",
    strength: "gold_standard"
  },
  lallemand_d47: {
    label: "Lalvin D47 official profile",
    url: "https://www.lallemandwine.com/en/united-states/products/wine-yeasts/lalvin-icv-d47/",
    strength: "gold_standard"
  },
  lallemand_qa23: {
    label: "Lalvin QA23 official profile",
    url: "https://www.lallemandwine.com/en/united-states/products/wine-yeasts/lalvin-qa23/",
    strength: "gold_standard"
  },
  lallemand_ec1118: {
    label: "Lalvin EC-1118 official profile",
    url: "https://www.lallemandwine.com/en/united-states/products/wine-yeasts/lalvin-ec-1118/",
    strength: "gold_standard"
  },
  scott_handbook: {
    label: "Scott Laboratories Winemaking Handbook 2025-2026",
    url: "https://scottlab.com/content/files/documents/handbooks/rev/scott%20laboratories%202025-2026%20winemaking%20handbook%20aug.pdf",
    strength: "gold_standard"
  },
  morewine_mead_manual: {
    label: "Guide to Mead Making (MoreWine manual mirror)",
    url: "https://docslib.org/doc/3053534/guide-to-mead-making-a-moremanual-by-shea-a-j",
    strength: "common_practice"
  }
};

const KNOWLEDGE_ENTRIES = [
  {
    id: "concept_first",
    tier: "gold_standard",
    topics: ["concept", "general"],
    guidance: "Concept architecture comes before mechanics. Decide what carries the glass, what only supports it, and what would ruin it before you get specific about yeast, nutrient timing, or dosing.",
    validator: "Do not jump into process detail when the user is still choosing lanes or only greeting the assistant.",
    sources: ["bjcp_mead", "morewine_mead_manual"]
  },
  {
    id: "bench_trials",
    tier: "gold_standard",
    topics: ["bench_trial", "dosing", "finishing"],
    guidance: "Bench trials are the safest default for potent finishing moves such as spirits, tea, tannin, acid, oak extract, and backsweetening agents. Use them before scaling additions to the batch.",
    validator: "If a reply recommends exact whole-batch dosing for a potent finishing addition, it should also frame bench trials as the safer first move.",
    sources: ["scott_handbook"]
  },
  {
    id: "fermentation_health",
    tier: "gold_standard",
    topics: ["fermentation", "nutrition", "general"],
    guidance: "Mead must is nutrient-poor compared with grape must. Healthy fermentation depends on yeast preparation, nutrition planning, and avoiding fake precision when YAN and stress conditions are unknown.",
    validator: "Do not invent exact nutrient schedules or false confidence when YAN, gravity, and temperature control are not established.",
    sources: ["morewine_mead_manual", "scott_handbook"]
  },
  {
    id: "post_primary_protection",
    tier: "gold_standard",
    topics: ["fermentation", "aging", "packaging"],
    guidance: "After primary fermentation, oxygen protection and restraint matter more. Fine-tuning additions should be conservative because oxidation and overcorrection are easier at this stage.",
    validator: "Do not talk about late-stage flavor tweaking as risk-free.",
    sources: ["morewine_mead_manual", "scott_handbook"]
  },
  {
    id: "stabilization_basics",
    tier: "gold_standard",
    topics: ["stabilization", "backsweetening", "packaging"],
    guidance: "If the plan includes backsweetening or sugar-bearing finishing additions, chemical stabilization with sulfite plus sorbate is standard hobby practice unless the batch is sterile filtered or otherwise secured.",
    validator: "Do not recommend sweet finishing additions in a finished mead without acknowledging stabilization or an equivalent control path.",
    sources: ["morewine_mead_manual"]
  },
  {
    id: "sorbate_mlf_caution",
    tier: "gold_standard",
    topics: ["stabilization", "malolactic"],
    guidance: "Sorbate is for preventing renewed yeast reproduction, not for active fermentation control, and it should not be treated casually if malolactic activity is in play.",
    validator: "Do not present sorbate as a universal magic stop button.",
    sources: ["scott_handbook"]
  },
  {
    id: "citrus_aroma_timing",
    tier: "common_practice",
    topics: ["citrus", "timing", "secondary", "bench_trial"],
    guidance: "For aroma-driven citrus lift, late additions, secondary contact, or controlled post-fermentation trials are usually safer than primary because vigorous fermentation can scrub delicate aromatics.",
    validator: "If the reply pushes zest or peel into primary for aroma-first goals, it should frame that as experimental or justify it clearly instead of calling it the obvious default.",
    sources: ["morewine_mead_manual", "scott_handbook"]
  },
  {
    id: "citrus_juice_balance",
    tier: "common_practice",
    topics: ["citrus", "juice", "timing", "bench_trial"],
    guidance: "Citrus juice changes both flavor and acid balance. For a clean-finish mead, juice is usually a bench-trial or controlled late-stage move rather than an automatic design choice.",
    validator: "Do not treat citrus juice like a free brightness button. It changes acid structure and can push a mead toward cocktail territory.",
    sources: ["morewine_mead_manual"]
  },
  {
    id: "coconut_timing",
    tier: "common_practice",
    topics: ["coconut", "timing", "secondary"],
    guidance: "Toasted coconut is usually easier to control in secondary or in contained contact because primary fermentation can mute aroma and make over-extraction harder to read in real time.",
    validator: "Do not casually tell the user to throw toasted coconut into primary as if that were the obvious safe lane.",
    sources: ["morewine_mead_manual"]
  },
  {
    id: "tea_tannin_acid_trials",
    tier: "gold_standard",
    topics: ["tea", "tannin", "acid", "bench_trial", "finishing"],
    guidance: "Tea, tannin, and acid are structure tools. When the base mead is already fermented, they are best treated like bench-trial adjustments rather than blind whole-batch commitments.",
    validator: "If the mead is already conceptually complete, structure corrections should be framed as bench-trial territory.",
    sources: ["scott_handbook"]
  },
  {
    id: "fruit_primary_secondary",
    tier: "common_practice",
    topics: ["fruit", "timing", "secondary", "fermentation"],
    guidance: "Primary fruit gives a more fermented, integrated fruit expression. Secondary fruit is the cleaner lane when the goal is fresher fruit aroma and a less cooked or jammy profile.",
    validator: "When the target is fresh fruit skin, seed, or youthful aroma, do not casually recommend primary fruit as the obvious default.",
    sources: ["morewine_mead_manual"]
  },
  {
    id: "agave_finished_glass",
    tier: "common_practice",
    topics: ["agave", "timing", "backsweetening"],
    guidance: "If the design goal is agave character in the finished glass, fermenting all of the agave contribution away is not the only option. A controlled late-stage or stabilized adjustment can preserve more identity than primary alone.",
    validator: "Do not present primary agave additions as the only intelligent lane when the user is clearly chasing finished-glass agave character.",
    sources: ["morewine_mead_manual"]
  },
  {
    id: "spirits_finishing",
    tier: "common_practice",
    topics: ["spirits", "bench_trial", "packaging"],
    guidance: "If a spirit addition is explicitly reopened, the safest way to handle it is as a conservative bench-trial finishing move, because small changes can swing a mead from subtle to cocktail-like quickly.",
    validator: "Do not jump straight to whole-batch spirit dosing without a trial-first framing.",
    sources: ["scott_handbook"]
  },
  {
    id: "71b_profile",
    tier: "gold_standard",
    topics: ["yeast", "71b"],
    guidance: "71B is useful when you want fruit friendliness and a softer acid profile. It is not the universal answer for every crisp or sparkling concept.",
    validator: "Prefer 71B for fruit-softening or rounder fruit-driven lanes, not as a lazy default.",
    sources: ["lallemand_71b"]
  },
  {
    id: "d47_profile",
    tier: "gold_standard",
    topics: ["yeast", "d47"],
    guidance: "D47 is often chosen for mouthfeel, volume, and a fuller white-wine style expression, but it asks for decent temperature discipline.",
    validator: "Do not present D47 as a frictionless beginner choice in every warm or sloppy setup.",
    sources: ["lallemand_d47"]
  },
  {
    id: "qa23_profile",
    tier: "gold_standard",
    topics: ["yeast", "qa23"],
    guidance: "QA23 is a strong fit when you want a brighter aromatic white-wine style, especially for citrus, tropical, or lifted fresh-fruit expression.",
    validator: "Use QA23 when the goal is freshness and aromatic lift, not when the concept wants a broader or softer mouthfeel.",
    sources: ["lallemand_qa23"]
  },
  {
    id: "ec1118_profile",
    tier: "gold_standard",
    topics: ["yeast", "ec1118", "sparkling", "high_abv"],
    guidance: "EC-1118 is the robust, neutral, high-reliability lane for difficult ferments, sparkling work, and restart scenarios. It is more of a workhorse than a personality yeast.",
    validator: "Do not recommend EC-1118 as a flavor-first answer when the concept wants a more characterful aromatic lane.",
    sources: ["lallemand_ec1118"]
  },
  {
    id: "honey_should_show",
    tier: "gold_standard",
    topics: ["honey", "general"],
    guidance: "Mead should still read like a honey-based drink. The chosen honey does not need to dominate, but it should support the concept instead of fighting it.",
    validator: "Do not choose a honey lane that actively blurs the intended concept unless the user explicitly accepts that compromise.",
    sources: ["bjcp_mead"]
  },
  {
    id: "experimental_primary_aromatics",
    tier: "experimental",
    topics: ["citrus", "coconut", "primary", "experimental"],
    guidance: "Primary-fermentation aromatic additions are not automatically wrong, but they are experimental because fermentation can strip aroma and hide timing mistakes until later.",
    validator: "If the reply recommends primary aroma additions, it should label the move as experimental or situational rather than gold-standard default.",
    sources: ["morewine_mead_manual"]
  },
  {
    id: "hydromel_sizing",
    tier: "gold_standard",
    topics: ["honey", "dosing", "fermentation", "general"],
    guidance: "Honey sizing: approximately 1.5 lb per gallon for a hydromel (~7% ABV, OG ~1.053-1.055). Quick references: 1 gal = 1.5 lb; 2 gal = 3.0 lb; 3 gal = 4.5 lb; 5 gal = 7.5 lb. For standard strength (~12-14%), use 2.5-3 lb per gallon. Honey displaces volume (~0.085 gal per lb), so dissolve honey first then top up water to target must volume.",
    validator: "If the reply recommends honey amounts, verify the math: approximately 1.5 lb/gal for hydromels or 2.5-3 lb/gal for standard. For a 2-gallon hydromel, that means ~3 lb of honey, not 1.5 lb.",
    sources: ["morewine_mead_manual"]
  },
  {
    id: "carbonation_methods",
    tier: "gold_standard",
    topics: ["sparkling", "packaging", "carbonation"],
    guidance: "For sparkling mead, force carbonation in a keg is the safest and most controllable method, especially for gifting. Bottle conditioning with priming sugar is viable but riskier because residual yeast activity is harder to predict in mead than in beer. If force carbonating, chill the keg cold before applying CO2 for cleaner carbonation. For a champagne-like sparkle, target 2.5-3.0 volumes CO2.",
    validator: "If the concept is sparkling and the user is concerned about safety or gifting, lead with force carbonation as the safer path rather than defaulting to bottle conditioning.",
    sources: ["morewine_mead_manual"]
  },
  {
    id: "bottle_safety_sparkling",
    tier: "gold_standard",
    topics: ["sparkling", "packaging", "carbonation"],
    guidance: "Sparkling mead must go into pressure-rated vessels. Champagne bottles, Belgian bottles, thick beer bottles, and truly pressure-rated swing-tops are safe. Standard wine bottles and decorative bottles are not rated for carbonation pressure and can shatter. When bottling from a keg, bottle cold to minimize foam and CO2 loss, and cap immediately.",
    validator: "If the plan includes sparkling mead for gifting, the reply must address bottle safety. Do not casually say 'bottle it' without specifying pressure-safe containers.",
    sources: ["morewine_mead_manual"]
  },
  {
    id: "fermentation_temperature",
    tier: "gold_standard",
    topics: ["fermentation", "yeast", "general"],
    guidance: "Fermentation temperature shapes the final character more than most beginners realize. Cooler fermentation (60-66°F) preserves delicate floral and fruit aromas and produces a cleaner finish. Warmer fermentation can produce fusel alcohols, solventy off-flavors, and an unpleasantly hot or sharp finish, especially in lighter meads and hydromels where there is less body to hide flaws.",
    validator: "If the concept is a delicate floral or fruit-forward mead, recommend cool fermentation rather than ignoring temperature entirely.",
    sources: ["scott_handbook", "morewine_mead_manual"]
  },
  {
    id: "nutrient_staggering",
    tier: "gold_standard",
    topics: ["fermentation", "nutrition"],
    guidance: "Staggered nutrient additions (SNA) are standard practice for healthy mead fermentation. A common approach: split the total Fermaid O dose into 3 equal additions at 24h, 48h, and 72h (or the 1/3 sugar break, whichever comes first). Avoid nutrient additions after the 1/3 sugar break. Degas gently at each nutrient addition.",
    validator: "Do not present a single upfront nutrient dump as the standard approach. Staggered additions are the established practice.",
    sources: ["morewine_mead_manual", "scott_handbook"]
  },
  {
    id: "pectic_enzyme_fruit",
    tier: "common_practice",
    topics: ["fruit", "fermentation", "secondary"],
    guidance: "Pectic enzyme helps break down pectin for better clarity, especially important when adding fruit. Add it in primary before pitching yeast for general haze prevention, and optionally add a small dose directly onto fruit in secondary if the fruit is pulpy or haze-prone.",
    validator: "If fruit is part of the plan, mention pectic enzyme as a clarity tool rather than treating haze as an unavoidable surprise.",
    sources: ["morewine_mead_manual"]
  },
  {
    id: "acid_carbonation_interaction",
    tier: "common_practice",
    topics: ["acid", "sparkling", "finishing", "bench_trial"],
    guidance: "Carbonation sharpens perceived acidity. In a sparkling mead, acid additions that taste right in a still sample may read too sharp once carbonated. For sparkling concepts, err on the side of less acid and only add it after bench-trialing the carbonated version if possible.",
    validator: "If the mead is sparkling, do not recommend upfront acid additions without warning that carbonation will amplify them.",
    sources: ["scott_handbook"]
  }
];

function unique(list) {
  return Array.from(new Set((list || []).filter(Boolean)));
}

function uniqueEntriesById(entries) {
  const seen = new Set();
  return (entries || []).filter((entry) => {
    const id = entry && entry.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function textParts(userMessage) {
  const snapshot = userMessage.concept_snapshot || {};
  const inputs = userMessage.inputs || {};
  return [
    snapshot.summary,
    inputs.conceptName,
    inputs.style,
    inputs.inspiration,
    inputs.vision,
    inputs.serveContext,
    inputs.mustHaveSimple,
    inputs.avoidSimple,
    inputs.ingredientsOnHand,
    inputs.noGo,
    userMessage.current_user_turn,
    ...(Array.isArray(snapshot.mustHave) ? snapshot.mustHave : []),
    ...(Array.isArray(snapshot.avoid) ? snapshot.avoid : []),
    ...(Array.isArray(snapshot.onHand) ? snapshot.onHand : []),
    ...(Array.isArray(snapshot.honeyMentions) ? snapshot.honeyMentions : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function currentTurnText(userMessage) {
  return String(userMessage.current_user_turn || "").toLowerCase();
}

function inferTopics(userMessage) {
  const text = textParts(userMessage);
  const turn = currentTurnText(userMessage);
  const topics = ["general", "concept"];

  if (/honey|wildflower|orange blossom|linden|buckwheat|clover|clove/.test(text)) topics.push("honey");
  if (/citrus|lime|lemon|grapefruit|zest|peel|juice/.test(text)) topics.push("citrus");
  if (/coconut/.test(text)) topics.push("coconut");
  if (/agave/.test(text)) topics.push("agave");
  if (/tequila|spirit/.test(text)) topics.push("spirits");
  if (/strawberry|blueberry|raspberry|blackberry|fruit|skin|seed|jammy|rosier/.test(text)) topics.push("fruit");
  if (/yeast|71b|d47|qa23|ec-1118|ec1118/.test(text)) topics.push("yeast");
  if (/71b/.test(text)) topics.push("71b");
  if (/d47/.test(text)) topics.push("d47");
  if (/qa23/.test(text)) topics.push("qa23");
  if (/ec-1118|ec1118/.test(text)) topics.push("ec1118");
  if (/tea|tannin/.test(text)) topics.push("tea", "tannin");
  if (/\bacid\b/.test(text)) topics.push("acid");
  if (/stabiliz|sorbate|sulfite|backsweet|bottle|packag/.test(text)) topics.push("stabilization", "packaging");
  if (/bench trial|bench-trial|dose|dosing|how much|amount|ounces|grams|ml|tsp|tbsp/.test(text)) topics.push("bench_trial", "dosing");
  if (/primary|secondary|ferment|timing|when do i add|when should i add/.test(text)) topics.push("timing", "fermentation");
  if (/sparkling|petillant|carbonat|force carb|keg/.test(text)) topics.push("sparkling", "carbonation");
  if (/bottle|gift.*bottle|pressure.*bottle|champagne bottle/.test(text)) topics.push("packaging");
  if (/pectic enzyme|pectin|haze|clarity/.test(text)) topics.push("fruit");
  if (/nutrient|fermaid|go-ferm|sna|stagger/.test(text)) topics.push("nutrition");
  if (/temperature|temp control|cool ferment|warm ferment/.test(text)) topics.push("fermentation");
  if (/process|step by step|plan the fermentation/.test(turn)) topics.push("fermentation");

  return unique(topics);
}

function stageHints(userMessage) {
  const turn = currentTurnText(userMessage);
  const snapshot = userMessage.concept_snapshot || {};
  const unresolved = snapshot.unresolved || {};
  if (!String(turn).trim()) return ["open"];
  if (/hello|ready|lets get started|let s get started|let us get started|lets begin|ready when you are/.test(turn)) return ["kickoff"];
  if (/how much|dose|dosing|ounces|grams|ml|tsp|tbsp/.test(turn)) return ["dosing"];
  if (/primary|secondary|stabiliz|backsweet|bottle|ferment|process/.test(turn)) return ["process"];
  if (/i dont know|i don't know|you tell me|help me choose|what would you do|recommend/.test(turn)) return ["decision"];
  if (!unresolved.honey || !unresolved.mustHave || !unresolved.serveContext) return ["design"];
  return ["open"];
}

function userOnlyHistoryText(userMessage) {
  return (Array.isArray(userMessage && userMessage.conversation_history) ? userMessage.conversation_history : [])
    .filter((turn) => String(turn && turn.role ? turn.role : "") === "user")
    .map((turn) => String(turn && turn.text ? turn.text : ""))
    .join(" ")
    .toLowerCase();
}

function detectResolvedState(userMessage) {
  const text = `${textParts(userMessage)} ${userOnlyHistoryText(userMessage)}`;
  const honey = /wildflower honey/.test(text)
    ? "wildflower honey"
    : /orange blossom honey/.test(text)
      ? "orange blossom honey"
      : /linden honey/.test(text)
        ? "linden honey"
        : /buckwheat honey/.test(text)
          ? "buckwheat honey"
          : "";

  return {
    honey,
    coconutForm: /toasted coconut flakes?/.test(text) ? "toasted coconut flakes" : /toasted coconut/.test(text) ? "toasted coconut" : "",
    agavePath: /agave syrup/.test(text) ? "agave syrup" : /agave nectar/.test(text) ? "agave nectar" : "",
    citrusDirection: /brighter through lime|lime-driven|lime zest|lime peel|through lime/.test(text)
      ? "lime-driven"
      : /rounder through the agave|agave-driven/.test(text)
        ? "agave-driven"
        : "",
    noActualSpirits: /no actual spirits|without actual spirits|no spirits/.test(text)
  };
}

function detectDecisionFocus(userMessage) {
  const turn = currentTurnText(userMessage);
  const snapshot = userMessage.concept_snapshot || {};
  const honeyUnresolved = snapshot.unresolved && snapshot.unresolved.honey;

  if (/hello|ready|lets get started|let s get started|let us get started|lets begin|ready when you are/.test(turn)) return "kickoff";
  if (/i dont know|i don't know|you tell me|help me choose|recommend|what would you do/.test(turn)) return "decision_help";

  if (honeyUnresolved && /honey|floral|varietal|which honey|what honey/.test(turn)) return "honey_lane";

  const isFullProcessAsk = /full process|walk me through|everything i need|start to finish|must.*to.*bottl|fermentation schedule.*and|nutrient.*and.*stabili|the whole thing/.test(turn);
  if (isFullProcessAsk) return "process_planning";

  if (/what yeast|which yeast|pick.*yeast|choose.*yeast|yeast lane/.test(turn)) return "yeast_selection";
  if (/fruit belongs|primary or secondary|fresh skin|fresh seeds|fuller|rosier|fully primary|late-fruit|split/.test(turn)) return "fruit_expression";
  if (/lime|lemon|grapefruit|citrus|zest|peel|juice/.test(turn)) return "citrus_execution";
  if (/coconut/.test(turn)) return "coconut_execution";
  if (/agave/.test(turn)) return "agave_execution";
  if (/tequila|spirit/.test(turn)) return "spirit_execution";
  if (/\btea\b/.test(turn)) return "tea_structure";
  if (/stabiliz|sulfite|sorbate|backsweet/.test(turn)) return "stabilization";
  if (/carbonate|carbonation|bottle bomb|force carb|keg/.test(turn)) return "carbonation_packaging";
  if (/bottle.*safe|gift.*bottle|pressure.*bottle|champagne bottle/.test(turn)) return "carbonation_packaging";
  if (/petillant|sparkling|sparkle|youthful/.test(turn)) return "sparkling_profile";
  if (/fermentation process|plan the fermentation|game plan|process lane|cleanest process|step by step|process/.test(turn)) return "process_planning";
  if (/how much|dose|dosing|ounces|grams|ml|tsp|tbsp/.test(turn)) return "dosing";
  if (/packag/.test(turn)) return "carbonation_packaging";

  if (honeyUnresolved) return "honey_lane";
  if (/yeast/.test(turn)) return "yeast_selection";
  return "general_progression";
}

export function buildKnowledgeContext(userMessage) {
  const topics = inferTopics(userMessage);
  const stages = stageHints(userMessage);
  const focus = detectDecisionFocus(userMessage);
  const resolved = detectResolvedState(userMessage);
  const retrieved = KNOWLEDGE_ENTRIES.filter((entry) => entry.topics.some((topic) => topics.includes(topic) || stages.includes(topic)));
  const prioritized = uniqueEntriesById([
    ...retrieved,
    ...KNOWLEDGE_ENTRIES.filter((entry) => entry.topics.includes("general"))
  ]).slice(0, 8);

  return {
    topics,
    stages,
    focus,
    resolved,
    entries: prioritized,
    summary: prioritized.map((entry) => {
      const sourceLabels = entry.sources.map((id) => KNOWLEDGE_SOURCES[id]?.label || id).join("; ");
      return `- [${entry.tier}] ${entry.guidance} Sources: ${sourceLabels}.`;
    }).join("\n")
  };
}

export function buildKnowledgePromptBlock(userMessage) {
  const context = buildKnowledgeContext(userMessage);
  const resolvedBits = [
    context.resolved.honey ? `honey = ${context.resolved.honey}` : "",
    context.resolved.coconutForm ? `coconut form = ${context.resolved.coconutForm}` : "",
    context.resolved.agavePath ? `agave path = ${context.resolved.agavePath}` : "",
    context.resolved.citrusDirection ? `citrus direction = ${context.resolved.citrusDirection}` : "",
    context.resolved.noActualSpirits ? "spirits boundary = no actual spirits by default" : ""
  ].filter(Boolean);
  return {
    ...context,
    promptBlock: [
      `Active decision focus: ${context.focus}. Answer that focus first and do not wander into unrelated lanes.`,
      resolvedBits.length ? `Already resolved: ${resolvedBits.join("; ")}.` : "Already resolved: none locked hard enough to summarize yet.",
      "Grounded mead knowledge for this turn:",
      context.summary,
      "Confidence rule:",
      "- gold_standard = safe to state as standard best practice",
      "- common_practice = present as usual/safer lane, not universal law",
      "- experimental = label as situational or risky, not default"
    ].join("\n")
  };
}

export function buildKnowledgeIssues(reply, userMessage, knowledgeContext = buildKnowledgeContext(userMessage)) {
  const issues = [];
  const lower = String(reply || "").toLowerCase();
  const turn = currentTurnText(userMessage);
  const stages = knowledgeContext.stages || [];
  const text = textParts(userMessage);
  const focus = knowledgeContext.focus || "";
  const resolved = knowledgeContext.resolved || {};

  if ((stages.includes("kickoff") || stages.includes("design")) && /\b\d+(\.\d+)?\s*(lb|oz|g|ml|tsp|tbsp|pounds|ounces|grams)\b/.test(lower)) {
    issues.push("The reply jumped into exact dosing before the conversation had actually reached a dosing stage.");
  }
  if ((stages.includes("kickoff") || stages.includes("design")) && /primary fermentation|secondary fermentation|pitching your yeast|stabiliz|bottl/i.test(lower)) {
    issues.push("The reply moved into process mechanics before the conversation had fully earned a process stage.");
  }
  if (/lime zest|lime peel|lemon zest|grapefruit zest|citrus zest/.test(lower) && /primary fermentation|in primary|before pitching/.test(lower)) {
    issues.push("The reply treated primary citrus-zest use like a default safe lane instead of framing it as an experimental or clearly justified move.");
  }
  if (/toasted coconut/.test(lower) && /primary fermentation|in primary|before pitching/.test(lower)) {
    issues.push("The reply treated primary toasted-coconut use like the obvious default even though secondary is usually the safer control lane.");
  }
  if (/lime juice|lemon juice|grapefruit juice|citrus juice/.test(lower) && !/bench trial|bench-trial|start small|small trial/.test(lower)) {
    issues.push("The reply recommended citrus juice without framing it as an acid-balance-sensitive move that usually deserves a controlled trial.");
  }
  if (/tea|tannin|acid/.test(lower) && /\b\d+(\.\d+)?\s*(g|ml|tsp|tbsp)\b/.test(lower) && !/bench trial|bench-trial|trial/.test(lower)) {
    issues.push("The reply gave structure-adjustment dosing without bench-trial framing.");
  }
  if (/agave syrup|agave nectar/.test(text) && /agave syrup .* or .* extract|agave nectar .* or .* extract|are you leaning towards agave syrup|thinking about an extract/.test(lower)) {
    issues.push("The reply reopened an agave decision that was already substantially established.");
  }
  if (/71b|d47|qa23|ec-1118|ec1118/.test(lower) && !/because|since|so that|for a/i.test(lower)) {
    issues.push("The reply named a yeast without explaining why it fits better than nearby alternatives.");
  }
  if ((focus === "citrus_execution" || focus === "decision_help") && /71b|d47|qa23|ec-1118|ec1118|yeast/.test(lower) && !/yeast/.test(turn)) {
    issues.push("The reply wandered into yeast selection even though the active decision was not yeast.");
  }
  if (focus === "tea_structure" && /(ginger|lemongrass|elderflower|citrus zest|lime zest|lemon zest)/.test(lower) && !/(ginger|lemongrass|elderflower|citrus|lime|lemon)/.test(text)) {
    issues.push("The reply introduced a new lift ingredient even though the active decision was whether tea belongs.");
  }
  if (focus === "fruit_expression" && /(elderflower|floral tea|lemongrass|ginger)/.test(lower) && !/(elderflower|tea|lemongrass|ginger)/.test(text)) {
    issues.push("The reply introduced a new side ingredient while the active decision was fruit expression.");
  }
  if (focus === "citrus_execution" && resolved.agavePath && /agave syrup .* or .*extract|agave nectar .* or .*extract|how to achieve the agave|focus on .* agave/i.test(lower)) {
    issues.push("The reply reopened the agave lane even though the active decision was citrus execution and the agave path was already substantially resolved.");
  }
  if (/are you ready to proceed|does this align|what do you think about the zest addition|are you comfortable with those proportions/.test(lower)) {
    issues.push("The reply falls back into soft permission-seeking instead of naming the next downstream decision.");
  }
  if (/how does that sound|does that make sense|what do you think\??$/m.test(lower)) {
    issues.push("The reply ends by asking for soft approval instead of naming the next real downstream choice.");
  }

  return issues;
}

export { KNOWLEDGE_ENTRIES, KNOWLEDGE_SOURCES };

function numericBatchSize(userMessage) {
  const raw = String((userMessage.inputs || {}).batchSize || "").trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function chooseYeastForContext(conceptText) {
  if (/juniper|lifted aromatics|dry snap|alert/.test(conceptText)) {
    return {
      pick: "QA23",
      why: "it keeps the lane brighter and more aromatic instead of softening the whole frame",
      contrast: "71B would soften it more, D47 would broaden it, and EC-1118 would be the reliability pick if fermentation security mattered more than personality"
    };
  }
  if (/coconut|tequila|agave|lime/.test(conceptText)) {
    return {
      pick: "QA23",
      why: "it gives the cleanest bright aromatic frame for a coconut-lime-agave concept",
      contrast: "D47 is the rounder coconut lane if you want more volume, while EC-1118 is more workhorse than personality"
    };
  }
  if (/petillant|sparkling|strawberry|fresh skin|youthful/.test(conceptText)) {
    return {
      pick: "QA23",
      why: "it protects bright strawberry freshness and floral lift without rounding the whole mead into a softer rosier lane",
      contrast: "71B would soften the fruit too much, D47 would broaden it more than this concept wants, and EC-1118 is the safer carbonation workhorse if sparkle reliability becomes the top priority"
    };
  }
  if (/round|textured|broader/.test(conceptText)) {
    return {
      pick: "D47",
      why: "it gives a broader white-wine texture without randomly changing the concept",
      contrast: "QA23 is brighter and 71B is softer if you want the fruit rounder"
    };
  }
  return {
    pick: "71B",
    why: "it is the softer fruit-friendly middle lane when the concept does not need a sharper aromatic cut",
    contrast: "QA23 is the brighter aromatic lane, D47 is the broader textured lane, and EC-1118 is the workhorse"
  };
}

export function buildEvidenceDrivenReply(userMessage, knowledgeContext = buildKnowledgeContext(userMessage)) {
  const focus = knowledgeContext.focus || "";
  const resolved = knowledgeContext.resolved || {};
  const batchSize = numericBatchSize(userMessage);
  const packet = userMessage.fallback_packet || {};
  const strongest = packet.strongestDirection || {};
  const nextQuestion = String(packet.nextQuestion || "").trim();
  const carries = Array.isArray(packet.ingredientRoles?.carries) ? packet.ingredientRoles.carries.join(" and ") : "";
  const supports = Array.isArray(packet.ingredientRoles?.supports) ? packet.ingredientRoles.supports.join(" and ") : "";
  const honeyResolved = Boolean(resolved.honey);
  const turn = currentTurnText(userMessage);
  const hasCompoundQuestion = (turn.match(/\?/g) || []).length > 1 || /\band\b.*\?|how much.*\?/.test(turn);

  if (focus === "citrus_execution") {
    const turn = currentTurnText(userMessage);
    const wantsMethod = /how|use|add|timing|when|method/.test(turn);
    const batchLine = batchSize
      ? `For ${batchSize} gallons, I would start lower and taste rather than pretend there is one magic number. Think roughly the zest from 2 to 4 limes in a sanitized bag, then taste every day or two and pull it as soon as the lift is where you want it.`
      : "Start lower and taste rather than pretend there is one magic number. Hold the zest in a bag, taste frequently, and pull it as soon as the lift is where you want it.";
    if (!wantsMethod) {
      return [
        "Good. Then I would make lime zest the tool, not lime juice in primary.",
        "That gives you a brighter tequila-style lift without turning the whole drink more acidic or more cocktail-like. If juice belongs anywhere, it belongs in a small post-fermentation trial where you can judge the acid change instead of guessing.",
        "The next real decision after that is how visible you want the agave side once the lime is doing the lifting."
      ].join("\n\n");
    }
    return [
      "My instinct is lime zest in secondary, not juice in primary.",
      "That keeps the tequila-style lift aromatic and bright instead of turning the whole drink more acidic or more cocktail-like. If you want lime juice at all, treat it like a bench-trial move after fermentation so you can judge the acid change instead of guessing.",
      batchLine
    ].join("\n\n");
  }

  if (focus === "agave_execution") {
    const turn = currentTurnText(userMessage);
    if (/visible but not sweet|noticeable but not sweet|clear but not sweet/.test(turn)) {
      return [
        "Good. That means I would treat agave like a controlled late-stage flavor adjustment, not a big fermentable statement in primary.",
        "You want it visible in the mid-palate without letting it drag the finish toward syrup. So the safer lane is stabilize first, then add agave in measured trials until it reads clearly enough without turning sticky.",
        "I would prove that in a sample glass first, then scale the winner to the batch once you know exactly where the agave stops reading clean and starts reading sweet."
      ].join("\n\n");
    }
    return [
      "If the goal is agave character in the finished glass, my safer lean is a late-stage agave adjustment after stabilization, not relying on primary alone.",
      "Primary fermentation can ferment away the exact character you are chasing. A controlled late-stage addition lets you decide how visible the agave actually is instead of hoping it survives the ferment the way you imagined.",
      "The next real decision is whether you want that agave side barely implied, or clearly noticeable in the mid-palate."
    ].join("\n\n");
  }

  if (focus === "tea_structure") {
    const turn = currentTurnText(userMessage);
    if (/sharpen it more with tea|tea and dryness discipline/.test(turn)) {
      return [
        "Good. Then tea should stay a structure tool, not part of the identity.",
        "That means blueberry still carries the glass, juniper stays like a cold accent, and tea only earns its place if the finished mead still needs a drier snap."
      ].join("\n\n");
    }
    return [
      "Tea belongs here only if the finished mead still feels too soft after the fruit and juniper are already doing their job.",
      "So I would not build the whole batch around tea. I would keep it as a bench-trial structure tool, because that lets you sharpen the finish without flattening the blueberry or turning the juniper into background noise."
    ].join("\n\n");
  }

  if (focus === "fruit_expression") {
    if (hasCompoundQuestion && /how much|how many|pounds|amount/.test(turn)) return "";
    const conceptText = textParts(userMessage);
    if (/fresh skin|seed|not fuller/.test(turn) && /strawberry/.test(conceptText)) {
      return [
        "Good call. That basically kills the fuller rosier lane.",
        "So I would build around strawberry in secondary, not primary. Primary is the lane for a more integrated fermented-fruit read, and that is exactly the direction you just told me not to chase."
      ].join("\n\n");
    }
    if (/fully primary|late-fruit|split/.test(turn) && /blueberry/.test(conceptText)) {
      return [
        "For this blueberry concept, I would not go all the way to a big late-fruit split unless the base mead proves it needs more top-note fruit.",
        "My safer lean is blueberry doing most of its work through fermentation so the core stays dark and integrated, then only using a small late-fruit lift if the finished mead feels too buried or too sleepy. That keeps the mood intact and avoids turning the whole thing juicier than you wanted."
      ].join("\n\n");
    }
    if (/fruit belongs|primary or secondary/.test(turn)) {
      if (/strawberry/.test(conceptText)) {
        return [
          "Secondary, and I would not overcomplicate that one.",
          "Primary is the rosier more integrated lane. Secondary is the fresher lane, which is the whole point if you want strawberry skin and lift instead of a more fermented pink-fruit read. I would not split the difference unless the finished base proves it actually needs more fruit on top."
        ].join("\n\n");
      }
      return [
        "Secondary. If your target is fresh fruit skin and seed character, that is the safer lane.",
        "Primary fruit gives a more fermented, integrated expression. Secondary fruit is what you choose when freshness is the point and you do not want the fruit reading cooked or jammy. I would not split the difference unless the finished base proves it actually needs more fruit on top."
      ].join("\n\n");
    }
    return [
      "If you want fresh fruit skin and seed character instead of fuller jam, my safer lane is fruit in secondary, not as the main event in primary.",
      "Primary fruit reads more fermented and integrated. Secondary fruit is the better lane when freshness is the actual point and you are trying to protect top-note aroma instead of cooking it into the base."
    ].join("\n\n");
  }

  if (focus === "sparkling_profile") {
    if (!honeyResolved) return "";
    const carrierLine = carries ? `without blurring the ${carries.toLowerCase()} line` : "without blurring the core identity";
    return [
      "Good call. Then I would protect freshness over depth.",
      "That means a clean base ferment, fruit later if the fruit aroma is supposed to feel youthful, and no extra sugar or soft floral clutter that starts pushing the drink toward wine-cooler territory. This should drink brisk and alive, not rounded off.",
      `The next clean move is choosing the process lane that gets sparkle ${carrierLine}.`
    ].join("\n\n");
  }

  if (focus === "yeast_selection") {
    const conceptText = textParts(userMessage);
    const yeast = chooseYeastForContext(conceptText);
    const explicitPick = /pick.*yeast|choose.*yeast|what yeast|which yeast|yeast lane/.test(currentTurnText(userMessage));
    const nextLine = explicitPick ? "" : /blueberry|juniper/.test(conceptText)
      ? "The next real decision after yeast is whether you want the blueberry more integrated through fermentation, or fresher with at least some late-fruit energy left in the glass."
      : /toasted coconut|agave|tequila/.test(conceptText)
        ? "The next real decision after yeast is how visible you want the toasted coconut once the lime and agave are both doing their jobs."
      : /strawberry|linden/.test(conceptText)
        ? "The next real decision after yeast is whether the strawberry should stay all in the fresh lane, or have just a little more body without drifting jammy."
      : nextQuestion
        ? `The next real decision is this: ${nextQuestion}`
        : "The next real decision is whether the flavor architecture is fully locked before we map the rest of the process.";
    return [
      `If forced to choose, I would use ${yeast.pick} here because ${yeast.why}.`,
      yeast.contrast.charAt(0).toUpperCase() + yeast.contrast.slice(1) + ".",
      nextLine
    ].filter(Boolean).join("\n\n");
  }

  if (focus === "stabilization") {
    if (!honeyResolved) return "";
    return [
      "Yes, potassium metabisulfite plus potassium sorbate is the standard hobby lane if you are going to backsweeten or add sugar-bearing finishing ingredients.",
      "That is the practical control path because sulfite protects the mead and sorbate helps stop renewed yeast reproduction. I still would not talk about it like magic. It only makes sense once fermentation is actually finished and you are treating the batch like a finished mead rather than an active ferment.",
      "The next real decision after stabilization is whether the sweetening or finishing addition belongs in the whole batch or only proves itself in a bench trial first."
    ].join("\n\n");
  }

  if (focus === "carbonation_packaging") {
    if (!honeyResolved) return "";
    const conceptText = textParts(userMessage);
    const isSparkling = /sparkling|petillant|carbonat/.test(conceptText);
    if (!isSparkling) return "";
    const giftLine = /gift|gifting|give|present/.test(conceptText)
      ? "Since this is for gifting, bottle safety is non-negotiable. Use champagne bottles, Belgian bottles, thick beer bottles, or truly pressure-rated swing-tops. Standard wine bottles and decorative bottles are not built for carbonation pressure and can shatter."
      : "Use pressure-rated bottles only: champagne bottles, Belgian bottles, thick beer bottles, or truly pressure-rated swing-tops. Standard wine bottles cannot handle carbonation pressure.";
    return [
      "Force carbonation in a keg is the safest and most controllable lane for sparkling mead, especially if you are bottling for other people.",
      "Chill the keg cold before applying CO2 — colder liquid absorbs carbonation more cleanly. For a champagne-like sparkle, target around 2.7-2.8 volumes CO2. At 34-38°F that typically lands around 18-25 PSI depending on exact temperature. Use a carbonation chart rather than guessing.",
      "Bottle cold from the keg to minimize foam and CO2 loss. A counter-pressure filler is ideal, but a picnic tap with a bottling wand can work with a bit more foam loss. Cap immediately.",
      giftLine
    ].join("\n\n");
  }

  if (focus === "dosing" && /tequila|spirit/.test(currentTurnText(userMessage))) {
    return [
      "My safer lane is a bench trial first, then scale the winner to the whole batch.",
      "Spirits are exactly the kind of finishing move that feels subtle until it suddenly does not. I would test measured sample pours first, find the point where the tequila read is real but not cocktail-like, and only then scale that ratio up.",
      "The next real decision is whether you want the tequila read barely there as lift, or obvious enough that someone names it without being told."
    ].join("\n\n");
  }

  if (focus === "process_planning" && strongest.name) {
    if (!honeyResolved) return "";
    if (/full process|everything i need|step by step|detailed|schedule|timeline|nutrient timing/.test(turn)) return "";
    const text = textParts(userMessage);
    const honeyName = resolved.honey || "the honey";
    if (/strawberry/.test(text)) {
      return [
        "My instinct is to run a boringly clean base ferment on purpose, then let the strawberry freshness happen later where you can actually control it.",
        `That means no heroic flavor pile in primary. Let ${honeyName} carry the base, put the strawberry in secondary if the goal is fresh skin and aroma, and keep any structure additions as optional bench trials instead of acting like they are mandatory from the start.`,
        "The clean process lane is: clean base ferment, fresh-fruit secondary, fine-tuning only if needed, then package once the flavor balance is actually where you want it. I would keep backsweetening off the default plan unless the finished mead proves it truly needs a little softening, and I would rather finish slightly lean than blur the whole thing trying to make it pretty."
      ].join("\n\n");
    }
    if (/toasted coconut|agave|tequila/.test(text)) {
      return [
        "My instinct is to keep the ferment cleaner than the flavor fantasy.",
        "So the clean lane is: ferment the wildflower base clean, leave toasted coconut and lime zest for secondary where their aroma is controllable, and hold the agave decision for a late-stage adjustment if you want that note visible in the finished glass instead of fermented mostly away.",
        "That keeps the process disciplined without turning the mead generic: base ferment first, aroma work later, and any agave fine-tuning only after stabilization and tasting."
      ].join("\n\n");
    }
    return [
      `My instinct is to let ${strongest.name.toLowerCase()} stay the boss and make the process serve that.`,
      `${carries ? `${carries} should stay in front` : "The core identity should stay in front"}${supports ? ` while ${supports} stay in support` : ""}. Ferment the base cleanly, keep aroma-first additions later where you can control them, and reserve fine-tuning moves for trials instead of heroic guessing.`,
      "The next real process decision is which pieces belong in primary because they can survive fermentation, and which ones only make sense later because their aroma is the whole point."
    ].join("\n\n");
  }

  return "";
}
