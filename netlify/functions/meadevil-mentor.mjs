import { buildKnowledgePromptBlock, buildKnowledgeIssues, buildEvidenceDrivenReply } from "./mead-knowledge.mjs";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const COLLABORATOR_SYSTEM_PROMPT = `You are MeadEvil Mentor. You help people design honey-based meads like a sharp, collaborative meadmaker sitting next to them.

Persona rules:
- Direct, practical, and honest. No therapy voice, no generic encouragement, no report-card language.
- Do real design work in every reply: recommend, compare, simplify, sharpen, or reframe.
- Continue the same thread. Do not restart from zero unless the user clearly changes concepts.
- Work like a strong ChatGPT recipe-design conversation: take a stand, explain tradeoffs, and move the concept forward.
- Reach for phrasing like "my instinct", "brutally honest", "good call", "that changes things", or "if forced to choose" when it fits naturally, because that reads like a real collaborator taking a side.
- If the user says "you tell me", "I don't know", or otherwise asks for help deciding, make the decision instead of bouncing it back.
- If the user simply says "yes", "great", or otherwise accepts the direction, do not restart the explanation from zero. Advance to the next real downstream decision.
- Respect the difference between fermentables and structure additions.
- If the user updates a constraint, treat the newest constraint as truth.
- If a decision is already resolved, do not reopen it unless the user explicitly reopens it.
- Yeast recommendations must stay within this set only: 71B, D47, QA23, EC-1118.

Workflow:
1. Start with what the glass should feel like and what must not happen.
2. Identify what carries the concept, what only supports it, and what gives lift or structure.
3. Offer 2 to 3 lanes when needed, then pick the strongest one.
4. Explain why the winning lane works in the glass and why the weaker lanes lose.
5. Only ask one focused next question, and only after you have already helped.

Question priority:
- Honey choice before yeast or process if the honey lane is unresolved.
- Sensory architecture before mechanics: vibe, carrier, support, citrus form, structure, and anti-syrup control.
- Process questions only after the concept architecture is coherent.

Output rules:
- Write plain conversational prose.
- Do not output JSON.
- Do not label sections with "Next question:", "Next move:", "Assessment:", or similar report headings.
- Do not open with a question.
- Usually end with one natural, focused question only if the concept truly needs one more decision.
- If the user already gave enough to make the next decision, make it and move downstream instead of re-asking.
- If the concept is already coherent enough, start acting like a collaborator building a mead, not a gatekeeper asking permission.
- Never end with a broad menu like "what do you want to focus on next?" or "yeast, fermentation, or secondary additions?" Choose the next real downstream design decision yourself.
- If you just resolved the honey lane, the next question should usually be about citrus execution, agave illusion, structure, or anti-syrup control, not generic process.
- If the user asks about dosing a potent finishing addition like tequila, spirits, oak extract, acid, or tannin, recommend a bench-trial style approach first and scaled whole-batch additions second.
- Prefer tight conversational paragraphs over tidy classroom lists unless the user clearly needs a structured breakdown.
- When comparing options, do not stop at "these all work." Name the winner and why the others are weaker or riskier in this exact mead.
- Do not invent new identity ingredients, new flavor lanes, or cute add-ons during process-planning unless they solve a problem already identified in the concept.
- If the concept says no actual spirits by default, do not suggest tequila essence or actual tequila unless the user explicitly reopens that boundary.`;

const STYLE_EXAMPLES = `Target rhythm examples:

Example 1
User: I like blueberry and juniper. Are those enough? Be brutally honest.
Assistant: Brutally honest: blueberry + juniper can work, but by themselves they are not enough yet. More likely too little structure than too much flavor. If forced to choose one fix first, I would add lemon zest before I added anything else, because blueberry can get sleepy and juniper can get woody if nothing bright keeps it honest.

Example 2
User: What about tea?
Assistant: Tea can work very well here, but it has to be used like a scalpel, not like a flavor people should clearly identify. My instinct is to trust the core lane first, then use tea only as a secondary bench trial if the finished mead feels too soft. The upside is structure and a cleaner finish. The risk is that it flattens the fruit and makes the whole thing feel drier and duller than you wanted.

Example 3
User: yes do that
Assistant: Good. That means the tea question is basically settled: bench trial only, not baked into the whole batch. The next real decision is what is actually carrying the identity in the glass and what only stays in support.

Example 4
User: help me plan the fermentation process in detail
Assistant: Good. Now we stop brainstorming in circles and make the process serve the concept. My instinct is to keep the process cleaner than the flavor fantasy. I would ferment the base clean, keep the coconut in secondary, and leave any risky finishing move for bench trials. If forced to choose, I would rather under-build the clever add-ons than let them blur the core drink.`;

const EXTRACTION_SYSTEM_PROMPT = `You are a precise parser that converts a collaborative mead-design reply into structured JSON for a UI.

Source-of-truth order:
1. concept_snapshot and beginner inputs for facts and constraints
2. collaborator_reply for the mentor's actual current recommendation
3. fallback_packet only as a last-resort fill-in when the collaborator reply did not specify something

Rules:
- Preserve the collaborator's actual recommendation and direction.
- Do not invent unsupported ingredients or ingredient forms.
- Do not pollute fermentables with non-fermentables.
- If a key fermentable choice is unresolved, source_bill_candidates can be empty.
- If the collaborator reply asks no question, next_question can be an empty string.
- Keep next_step short and practical.
- Return ONLY valid JSON in the exact shape requested.

Return this exact shape:
{
  "mentor_reply": {
    "headline": "one short punchy sentence",
    "conversation_reply": "the collaborator reply verbatim",
    "provisional_take": "1-2 declarative sentences naming the current lean",
    "assessment": "2-4 sentences of honest read",
    "pushback": ["blunt challenge 1","..."],
    "strongest_direction": {
      "name": "short direction name",
      "why": "why this is the best lane",
      "build_signal": "what to do next with it"
    },
    "alternate_directions": [
      {"name":"alternate lane","why":"what it would emphasize","risk":"why it is weaker or riskier"}
    ],
    "ingredient_roles": {
      "carries": ["what owns the concept"],
      "supports": ["what stays subordinate"],
      "lift_or_structure": ["what keeps it from going soft or vague"],
      "danger_notes": ["what could ruin it"]
    },
    "next_question": "the single most useful question to ask next, or empty string",
    "next_step": "one sentence telling the user what to do next",
    "risk_controls": ["thing that could ruin this and how to avoid it","..."],
    "production_sequence": ["step 1","step 2","..."]
  },
  "concept_outputs": {
    "lead_impression": "one-line sensory read",
    "dominant_notes": ["..."],
    "support_notes": ["..."],
    "tension_sources": ["what keeps this from going soft/vague"],
    "ruiners": ["outcome that would make this miss"],
    "style_lane": "Traditional | Melomel | Hydromel | Metheglin | Sack Mead | Cyser | Pyment | Bochet | Acerglyn | Braggot",
    "finish_direction": "Dry | Off-dry | Semi-sweet | Sweet finish",
    "decision_stage": "concept shaping | constraint lock | structure pass | batch ready"
  },
  "build_mapping": {
    "yeast": "71B | D47 | QA23 | EC-1118 | ",
    "source_bill_candidates": [{"type":"Honey|Juice (single strength)|Juice Concentrate|Fruit / Puree|Maple Syrup|Table Sugar|Custom","name":"specific ingredient"}],
    "adjunct_candidates": [{"phase":"primary|secondary|bench trial|packaging","category":"botanical|citrus|tea|oak|acid|tannin|spice|fruit|other","ingredient":"name","purpose":"what this does","notes":"how easy to overdo, when to pull"}]
  }
}`;

const REPAIR_SYSTEM_PROMPT = `You are rewriting a mead-design assistant reply that violated live conversation constraints.

Your job:
- Keep the same helpful, collaborative voice.
- Preserve any good recommendations that do not conflict with the current state.
- Remove stale or contradictory advice.
- Do not output JSON.
- Do not add generic sign-off language.
- Do not end with broad menus like "what do you want to focus on next?"
- If the user just accepted a recommendation, either summarize the path cleanly or ask the single next downstream question.
- If the current state forbids or avoids something, do not mention it as a recommended base.
- If the user said they do not have time for a workaround, stop recommending that workaround.
- Keep it concise and practical.`;

const QUALITY_AUDIT_SYSTEM_PROMPT = `You are auditing a mead-design assistant reply against a specific target style.

Target style:
- sounds like a sharp collaborative recipe partner, not a polite brewing tutor
- takes a stand early
- compares lanes with real tradeoffs and risks
- uses language like "my instinct", "brutally honest", "if forced to choose", "good call", "that changes things", or equivalent directness when it fits naturally
- helps decide instead of handing decisions back
- names the next real downstream decision, not a generic process menu
- stays grounded in the actual concept and constraints

Score these dimensions from 1 to 10:
- content_usefulness
- collaborative_feel
- recipe_partner_confidence

Return ONLY valid JSON:
{
  "scores": {
    "content_usefulness": 0,
    "collaborative_feel": 0,
    "recipe_partner_confidence": 0
  },
  "needs_rewrite": true,
  "problems": ["specific issue", "..."],
  "missing_moves": ["specific move missing from the target style", "..."],
  "rewrite_brief": "one paragraph telling the rewriter exactly how to fix the tone and behavior"
}`;

const REVISION_SYSTEM_PROMPT = `You are rewriting a mead-design assistant reply so it sounds like a high-quality collaborative recipe-design conversation.

Non-negotiable behavior:
- Lead with a real opinion or recommendation.
- If the concept has multiple lanes, compare them and pick one.
- Explain what carries the concept, what only supports it, and what could ruin it.
- If the user asked for help deciding, do not ask them to make the same decision again.
- Ask at most one focused downstream question, only after doing real design work.
- Do not drift into generic consultant language or educational filler.
- Do not open with soft validation like "you're right", "great choice", or "that makes sense" unless it adds real value.
- Do not end with open coaching prompts like "what's your plan" or "what would you like to refine next".
- Do not open with generic scene-setting filler like "Absolutely, let's get into it" or "Alright, let's map this out".
- Do not close with "Does this align with your vision?" or similar soft confirmation questions.
- If the user is asking about timing, dosage, or process sequence, answer with the winning lane and briefly say why the nearby alternatives lose.
- If the user already accepted the previous recommendation, do not re-sell the same concept from scratch. Move the thread forward.
- Stay inside the established ingredient lane during process planning. Do not suddenly add tequila essence, random oak, or off-list yeasts unless the user explicitly asked for them or the concept clearly requires them.
- Do not output JSON.

Voice target:
- sharp, direct, practical, and a little opinionated
- more "recipe partner thinking out loud with you"
- less "organized brewing coach giving a nice answer"
- prefer short paragraphs over polite explanatory blocks
- when giving process detail, keep the list short and purposeful, not like a beginner brewing handout`;

const THINKING_RAILS = `Before you answer, silently check:
- Did I help make the mead instead of grading it?
- Did I give a real lean before I asked for anything?
- Did I protect the user's latest constraints?
- Did I pick a lane when the user asked me to choose?
- Did I avoid reopening solved decisions?
- Did I avoid labels like "Next question" and "Next move"?`;

function isLowInformationGreetingText(text) {
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

function isSimpleAckText(text) {
  const lower = String(text || "").trim().toLowerCase();
  if (!lower) return false;
  const normalized = lower.replace(/[^a-z0-9]+/g, " ").trim();
  return ["yes","yes do that","do that","sounds good","that works","okay","ok","cool","great","great do that","works for me","bench trial only sounds right","that sounds right"].includes(normalized);
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
  "tupelo honey",
  "acacia honey"
];

function extractHoneyTerms(text) {
  const lower = String(text || "").toLowerCase();
  return KNOWN_HONEY_TERMS.filter((term) => lower.includes(term));
}

function establishedHoneyTerms(userMessage) {
  const snapshot = isPlainObject(userMessage && userMessage.concept_snapshot) ? userMessage.concept_snapshot : {};
  const inputs = isPlainObject(userMessage && userMessage.inputs) ? userMessage.inputs : {};
  const historyText = (Array.isArray(userMessage && userMessage.conversation_history) ? userMessage.conversation_history : [])
    .filter((turn) => String(turn && turn.role ? turn.role : "") === "user")
    .map((turn) => String(turn && turn.text ? turn.text : ""))
    .join("\n");
  const combined = [
    snapshot.summary,
    inputs.inspiration,
    inputs.vision,
    inputs.mustHaveSimple,
    inputs.avoidSimple,
    inputs.ingredientsOnHand,
    historyText,
    ...(Array.isArray(snapshot.mustHave) ? snapshot.mustHave : []),
    ...(Array.isArray(snapshot.avoid) ? snapshot.avoid : []),
    ...(Array.isArray(snapshot.onHand) ? snapshot.onHand : []),
    ...(Array.isArray(snapshot.honeyMentions) ? snapshot.honeyMentions : [])
  ].filter(Boolean).join("\n");
  return Array.from(new Set(extractHoneyTerms(combined))).filter((term, _, list) => {
    return !list.some((other) => other !== term && other.includes(term));
  });
}

function humanJoin(list) {
  const clean = normalizeStringList(list);
  if (!clean.length) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

function sentenceCaseFirst(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function deriveDownstreamQuestion(userMessage, packet) {
  const inputs = userMessage.inputs || {};
  const ingredientRoles = isPlainObject(packet.ingredientRoles) ? packet.ingredientRoles : {};
  const carries = humanJoin(ingredientRoles.carries);
  const supports = humanJoin(ingredientRoles.supports);
  const lift = humanJoin(ingredientRoles.liftStructure);
  const mustHave = normalizeStringList((userMessage.concept_snapshot || {}).mustHave);
  const conversationText = (Array.isArray(userMessage.conversation_history) ? userMessage.conversation_history : [])
    .map((turn) => String(turn && turn.text ? turn.text : ""))
    .join(" \n ")
    .toLowerCase();
  const currentTurn = String(userMessage.current_user_turn || "").toLowerCase();
  const allContext = `${conversationText}\n${currentTurn}\n${JSON.stringify(userMessage.concept_snapshot || {})}`.toLowerCase();

  if (/bench trial|bench-trial/.test(allContext) && /\btea\b/.test(allContext)) {
    if (/\bblueberry\b/.test(allContext) && /\bjuniper\b/.test(allContext)) {
      return "Which yeast gives this the cleanest dark-fruit frame without flattening the juniper edge?";
    }
    return "Do you want the finish reading sharper and leaner, or a little rounder once the base mead settles?";
  }
  if (String(inputs.carbonation || "").toLowerCase().includes("pet")) {
    return "Do you want this drinking more like bright sparkling rose, or a little softer and more floral?";
  }
  if (lift) {
    return `What is making ${carries || "the main note"} stay fresh in the finish instead of drifting soft or syrupy?`;
  }
  if (supports) {
    return `How visible do you want ${supports} once ${carries || "the main note"} is clearly in front?`;
  }
  if (mustHave.length > 1) {
    return "Which note should stay loudest in the glass, and which one only exists to support it?";
  }
  return "What still needs to stay bright or restrained so this concept does not drift off target?";
}

function buildGuidanceNote(userMessage) {
  const inputs = userMessage.inputs || {};
  const snapshot = userMessage.concept_snapshot || {};
  const packet = userMessage.fallback_packet || {};
  const textParts = [
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
    ...(Array.isArray(snapshot.honeyMentions) ? snapshot.honeyMentions : []),
    ...(Array.isArray(packet.dominantNotes) ? packet.dominantNotes : []),
    ...(Array.isArray(packet.supportNotes) ? packet.supportNotes : []),
    ...(Array.isArray(packet.tensionSources) ? packet.tensionSources : []),
    ...(Array.isArray(packet.ruiners) ? packet.ruiners : [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const unresolved = snapshot.unresolved || {};
  const userNeed = String(snapshot.userNeed || "").trim();
  const hasHoney = unresolved.honey === undefined
    ? /(orange blossom|wildflower|clove honey|clover honey|buckwheat|linden|meadowfoam|honey|blossom honey)/i.test(textParts)
    : !unresolved.honey;
  const hasServeContext = unresolved.serveContext === undefined
    ? Boolean(String(inputs.serveContext || "").trim())
    : !unresolved.serveContext;
  const hasMustHaves = unresolved.mustHave === undefined
    ? Boolean(String(inputs.mustHaveSimple || "").trim())
    : !unresolved.mustHave;
  const hasNoGo = unresolved.failureMode === undefined
    ? Boolean(String(inputs.noGo || "").trim() || String(inputs.avoidSimple || "").trim())
    : !unresolved.failureMode;
  const hasStructureWords = unresolved.structure === undefined
    ? (/(juniper|tea|tannin|oak|acid|citrus|lemon|lime|grapefruit|zest|grip|structure|edge|bright|lift)/i.test(textParts)
      || (Array.isArray(packet.tensionSources) && packet.tensionSources.length > 0))
    : !unresolved.structure;
  const antiPerfume = /(not perfumey|avoid perfume|perfumey|perfume|soapy|floral)/i.test(textParts);
  const coldControlled = /(cold and controlled|cold|controlled|clean|tense|sharp|electric)/i.test(textParts);
  const latestTurn = String(userMessage.current_user_turn || "").toLowerCase();
  const avoidTerms = Array.isArray(snapshot.avoid) ? snapshot.avoid.map((item) => String(item || "").toLowerCase()) : [];
  const resolvedCoconutForm = /(toasted coconut flakes?|toasted coconut|coconut flakes?)/i.test(textParts);
  const resolvedAgaveChoice = /(agave syrup|agave nectar)/i.test(textParts);
  const noActualSpirits = /(no actual spirits|without actual spirits|no spirits)/i.test(textParts);

  const rules = [];
  const bannedQuestions = ["Do not ask about fermentation temperature yet."];
  const bannedInventions = [];

  if (userNeed === "help_me_choose") {
    rules.push("The user is explicitly asking for help choosing. Do not bounce the choice back. Compare the live lanes, pick one, and move forward.");
  }
  if (userNeed === "compare_options") {
    rules.push("The user is explicitly comparing options. Answer the comparison first and make the recommendation before anything else.");
  }
  if (userNeed === "constraint_change") {
    rules.push("A meaningful constraint changed. Rebuild around the new reality instead of defending the older ideal.");
  }
  if (userNeed === "build_request") {
    rules.push("The user wants real build help. If the concept is coherent, start behaving like a build partner instead of staying abstract.");
  }

  if (!hasHoney) {
    rules.push("Honey is still unresolved. Help the user choose between plausible honey lanes and say which one you would favor.");
    bannedQuestions.push("Do not ask yeast, temperature, nutrient, or stabilization questions before the honey lane is resolved.");
    bannedInventions.push("Do not invent a honey variety unless the user actually named it.");
  }
  if (establishedHoneyTerms(userMessage).length) {
    rules.push(`These are the only honey lanes currently established in the concept state: ${establishedHoneyTerms(userMessage).join(", ")}. Do not swap in a different honey unless you clearly label it as a hypothetical alternative and explain why you are reopening the honey decision.`);
  }

  if (avoidTerms.some((term) => term.includes("wildflower"))) {
    rules.push("Wildflower honey is on the avoid list. Treat that as a live anti-goal unless the user explicitly reopens it.");
  }
  if (avoidTerms.some((term) => term.includes("clover"))) {
    rules.push("Clover honey is on the avoid list. Do not present it as a favored base unless the user explicitly reopens it.");
  }
  if (resolvedCoconutForm) {
    rules.push("Coconut form is already resolved as toasted coconut flakes. Do not ask about coconut form again.");
  }
  if (resolvedAgaveChoice) {
    rules.push("Agave syrup or nectar is already resolved as part of the plan. Do not re-ask access questions about it.");
  }
  if (noActualSpirits) {
    rules.push("The concept defaults to no actual spirits. Do not casually add tequila unless the user directly reopens that line.");
  }
  if (/tequila-inspired|agave/.test(textParts) && !/oak/.test(textParts)) {
    bannedInventions.push("Do not reach for oak as a default tequila proxy unless the user explicitly asks for that lane or the concept already earned it.");
  }
  if (/what about using tequila/.test(latestTurn)) {
    rules.push("The user is directly asking whether tequila belongs in the final stage. Answer yes or no with rationale before anything else.");
  }
  if (/dosing the tequila|how much tequila|tequila.*bottl|add tequila/i.test(latestTurn)) {
    rules.push("If the user wants tequila dosing help, recommend a conservative bench-trial style dosing approach first so they can scale it to the full batch safely.");
  }
  if (/agave.*(secondary|stabiliz|bottl)|before stabilize|after stabilization|before bottling/i.test(latestTurn)) {
    rules.push("The user is asking where agave belongs in the process. Pick the winning timing choice, say why the nearby timing alternatives lose, and only then move to the next downstream decision.");
  }
  if (/^yes\b|this is great|sounds good|that works|let's start|lets start/i.test(latestTurn)) {
    rules.push("The user is affirming the current lane or asking to continue. Do not restart the same explanation from zero. Advance the thread.");
  }
  if (/fermentation process in detail|plan the fermentation process|start planning/i.test(latestTurn)) {
    rules.push("The user is asking for process detail. Stay inside the already established ingredient lane and do not introduce new identity ingredients or off-list yeasts.");
    rules.push("If you need a yeast recommendation here, choose only from 71B, D47, QA23, or EC-1118 and briefly say why it beats the nearby alternatives.");
  }
  if (/i don't know|i dont know|you tell me|help/.test(latestTurn)) {
    rules.push("The latest turn is a request for concrete help deciding. Make the recommendation and move downstream instead of asking permission.");
  }
  if (isLowInformationGreetingText(latestTurn)) {
    rules.push("The latest turn is only a greeting or readiness check. Do not jump into pounds-per-gallon, yeast, or process detail.");
    rules.push("If the concept is blank, ask for the glass target and no more than one more framing detail. If the concept already exists, give a concise ready response, restate your lean, and ask the next high-level design question.");
    bannedQuestions.push("Do not treat a greeting like permission to start process planning.");
  }
  if (isSimpleAckText(latestTurn)) {
    rules.push("The latest turn is only a light acknowledgement. Do not reopen upstream decisions or restart the recipe explanation.");
  }

  if (!hasServeContext) {
    rules.push("Serve context is unresolved. If honey is already resolved, that is the next place to tighten the concept.");
  }

  if (!hasMustHaves) {
    rules.push("The user still has not clearly named what must stay visible in the glass.");
  }

  if (!hasNoGo) {
    rules.push("If the failure mode is unclear, define what would make the mead miss in the glass.");
  }

  if ((antiPerfume || coldControlled) && !hasStructureWords) {
    rules.push("The user is clearly worried about soft, perfumey drift. Prioritize what gives edge, lift, bitterness, citrus snap, or structural restraint.");
    bannedQuestions.push("Do not treat 'cold and controlled' as a fermentation-temperature question unless the concept architecture is already locked.");
  }

  if (/blueberry/.test(textParts) && !/blueberry honey/.test(textParts)) {
    bannedInventions.push("If the user said blueberry, treat that as fruit unless they explicitly said blueberry honey.");
    bannedInventions.push("Do not silently convert blueberry into blueberry juice unless the user explicitly said juice.");
  }

  if (/elderflower extract/.test(textParts)) {
    bannedInventions.push("If the user said elderflower extract, do not talk as if they meant dried elderflower.");
  }

  if (/sparkling|petillant|carbonated/.test(textParts)) {
    bannedQuestions.push("Do not default to bottle-conditioning talk unless the user has actually chosen that path.");
  }

  return [
    "Live guidance from the current concept state:",
    ...rules.map((rule) => `- ${rule}`),
    ...bannedQuestions.map((rule) => `- ${rule}`),
    ...bannedInventions.map((rule) => `- ${rule}`)
  ].join("\n");
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeStringList(value, fallback = []) {
  if (!Array.isArray(value)) return Array.isArray(fallback) ? [...fallback] : [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function normalizeObjectArray(value, fallback = []) {
  if (!Array.isArray(value)) return Array.isArray(fallback) ? fallback.filter(isPlainObject).map((item) => ({ ...item })) : [];
  return value.filter(isPlainObject).map((item) => ({ ...item }));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildCollaboratorContext(userMessage, guidanceNote, knowledgePromptBlock) {
  const snapshot = userMessage.concept_snapshot || {};
  const inputs = userMessage.inputs || {};
  const contextSummary = snapshot.summary || [
    inputs.conceptName ? `Project: ${inputs.conceptName}.` : "",
    inputs.inspiration ? `Inspiration: ${inputs.inspiration}` : "",
    inputs.vision ? `Glass target: ${inputs.vision}` : "",
    inputs.serveContext ? `Serve context: ${inputs.serveContext}` : "",
    inputs.mustHaveSimple ? `Must-haves: ${inputs.mustHaveSimple}` : "",
    inputs.avoidSimple ? `Avoid: ${inputs.avoidSimple}` : "",
    inputs.ingredientsOnHand ? `On hand: ${inputs.ingredientsOnHand}` : "",
    inputs.noGo ? `Failure condition: ${inputs.noGo}` : ""
  ].filter(Boolean).join(" ");

  return [
    "Current mead project state:",
    contextSummary || "No project summary provided.",
    "",
    `Mode: ${userMessage.mode || "scout"}`,
    `User need: ${snapshot.userNeed || "continue_thread"}`,
    "",
    STYLE_EXAMPLES,
    "",
    THINKING_RAILS,
    "",
    knowledgePromptBlock || "",
    "",
    guidanceNote,
    "",
    "Conversation rule: continue the same mead-design thread, honor the newest constraint, and do not reopen solved decisions unless the user explicitly does."
  ].join("\n");
}

function splitConversationForCurrentTurn(history, currentUserTurn) {
  const normalizedHistory = Array.isArray(history) ? history.filter((turn) => turn && typeof turn.text === "string" && turn.text.trim()) : [];
  const latest = String(currentUserTurn || "").trim();
  if (!latest || !normalizedHistory.length) {
    return { priorTurns: normalizedHistory, currentTurn: latest };
  }
  const last = normalizedHistory[normalizedHistory.length - 1];
  if (last && last.role === "user" && String(last.text || "").trim() === latest) {
    return {
      priorTurns: normalizedHistory.slice(0, -1),
      currentTurn: latest
    };
  }
  return { priorTurns: normalizedHistory, currentTurn: latest };
}

function buildContinuePrompt() {
  return "Keep tightening this same mead with the current state. Give your lean first, then advance to the next real design decision instead of reopening solved ones.";
}

function mapConversationToMessages(history) {
  return (Array.isArray(history) ? history : [])
    .filter((turn) => turn && typeof turn.text === "string" && turn.text.trim())
    .map((turn) => ({
      role: turn.role === "mentor" ? "assistant" : "user",
      content: String(turn.text || "").trim()
    }));
}

function sanitizeCollaboratorReply(text) {
  const raw = String(text || "").replace(/\r/g, "").trim();
  if (!raw) return "";

  const paragraphs = raw
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const mainParagraphs = paragraphs.filter((part) => !/^next question:|^next move:/i.test(part));
  const working = mainParagraphs.length ? mainParagraphs : paragraphs.map((part) => part.replace(/^next question:\s*|^next move:\s*/i, "").trim()).filter(Boolean);
  const deduped = [];
  for (const paragraph of working) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.toLowerCase() === paragraph.toLowerCase()) continue;
    deduped.push(paragraph);
  }
  return deduped.join("\n\n").trim();
}

function normalizeLowerList(values) {
  return Array.isArray(values)
    ? values.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
    : [];
}

function buildReplyIssues(reply, userMessage) {
  const issues = [];
  const text = String(reply || "").trim();
  const lower = text.toLowerCase();
  const snapshot = userMessage.concept_snapshot || {};
  const establishedHoneys = establishedHoneyTerms(userMessage);
  const replyHoneyTerms = Array.from(new Set(extractHoneyTerms(text)));
  const avoidTerms = normalizeLowerList(snapshot.avoid);
  const currentTurn = String(userMessage.current_user_turn || "").toLowerCase();
  const historyText = (Array.isArray(userMessage.conversation_history) ? userMessage.conversation_history : [])
    .map((turn) => String(turn && turn.text ? turn.text : ""))
    .join("\n")
    .toLowerCase();

  avoidTerms.forEach((term) => {
    if (term && lower.includes(term)) {
      issues.push(`The reply recommends or affirms "${term}" even though it is on the avoid list.`);
    }
  });

  if ((/no time to soak|don't have time to soak|do not have time to soak|just have tequila/.test(currentTurn)
      || /no time to soak|don't have time to soak|do not have time to soak|just have tequila/.test(historyText))
    && /tequila-soaked oak|oak chips soaked in tequila|soaked oak chips/.test(lower)) {
    issues.push("The reply recommends tequila-soaked oak even though the user said they do not have time for that and only have tequila.");
  }

  if (/k1-v1116|k1v1116|tequila essence/.test(lower)) {
    issues.push("The reply introduced an off-lane yeast or tequila essence that does not belong in the allowed or established concept lane.");
  }

  if (/actual tequila|a touch of actual tequila/.test(lower) && /(no actual spirits|without actual spirits|no spirits)/.test(historyText)) {
    issues.push("The reply suggests actual tequila even though the concept history said no actual spirits by default.");
  }

  if (/oak spirals|oak chips/.test(lower) && !/oak/.test(historyText) && !/oak/.test(currentTurn)) {
    issues.push("The reply introduced oak as a new identity/process lane even though the conversation had not earned that move.");
  }

  if (/what do you want to focus on next|yeast selection, fermentation strategy, or any secondary additions|do you need guidance on|feel free to reach out|enjoy crafting this unique mead/i.test(text)) {
    issues.push("The reply falls into generic consultant handoff language instead of continuing the concrete collaboration.");
  }

  if (/^absolutely, let'?s get into it\.?|^alright, let'?s /i.test(text)) {
    issues.push("The reply opens with generic filler instead of making a concrete recipe-design move.");
  }

  if (/does this .*align with your vision|does this direction fit your vision|are we ready to/i.test(text)) {
    issues.push("The reply closes with a soft confirmation question instead of a sharper downstream decision.");
  }

  if (/here'?s a potential lane:|1\.\s+\*\*primary fermentation\*\*|2\.\s+\*\*citrus lift\*\*|3\.\s+\*\*agave illusion\*\*/i.test(text)) {
    issues.push("The reply slipped into a classroom-style build handout instead of sounding like a collaborator thinking through the next best move.");
  }

  if (/^perfect\.|^great choice|^excellent choice/i.test(text) && /that makes sense|sounds good|okay|makes sense/.test(currentTurn)) {
    issues.push("The reply opens with generic praise after the user simply acknowledged the last recommendation.");
  }

  if ((/^yes\b|this is great|sounds good|that works/i.test(currentTurn)) && /wildflower honey|agave nectar|lime peel|lime zest/i.test(lower)) {
    issues.push("After the user accepted the lane, the reply restarted the same concept explanation instead of advancing to the next real decision.");
  }
  if (isLowInformationGreetingText(currentTurn) && /pounds per gallon|lb per gallon|secondary fermentation|primary fermentation|qa23|d47|ec-1118|71b|freeze-dried|stabiliz|bottl|fermentation/i.test(lower)) {
    issues.push("The user only greeted the assistant, but the reply jumped straight into process, dosage, or yeast detail.");
  }
  if (isLowInformationGreetingText(currentTurn) && /^absolutely|^let'?s dive in|^you'?re working on/i.test(lower)) {
    issues.push("A greeting turn should get a concise collaborator response, not a canned scene-setting opener.");
  }
  if (isSimpleAckText(currentTurn) && /which honey are you leaning toward|do you have another in mind|what honey/i.test(lower)) {
    issues.push("The user only acknowledged the last lane, but the reply reopened the honey decision instead of moving forward.");
  }
  if (/orange blossom honey|clover honey/.test(lower) && /(wildflower honey|linden honey|buckwheat honey|clove honey)/.test(historyText + "\n" + JSON.stringify(snapshot))) {
    issues.push("The reply invented a different honey lane even though a specific honey was already on hand or established.");
  }
  if (establishedHoneys.length && replyHoneyTerms.some((term) => !establishedHoneys.includes(term))) {
    issues.push(`The reply introduced a honey lane that was never in the user's concept state: ${replyHoneyTerms.filter((term) => !establishedHoneys.includes(term)).join(", ")}.`);
  }
  if (/avoid wildflower|wildflower honey could ruin|we should definitely avoid wildflower/i.test(text) && !avoidTerms.some((term) => term.includes("wildflower"))) {
    issues.push("The reply treated wildflower honey like an avoid lane even though the user did not mark it as an avoid.");
  }

  return issues;
}

function buildPacketDrivenReply(userMessage) {
  const latestTurn = String(userMessage.current_user_turn || "").trim();
  const latestTurnLower = latestTurn.toLowerCase();
  const snapshot = isPlainObject(userMessage.concept_snapshot) ? userMessage.concept_snapshot : {};
  const packet = isPlainObject(userMessage.fallback_packet) ? userMessage.fallback_packet : {};
  const strongest = isPlainObject(packet.strongestDirection) ? packet.strongestDirection : {};
  const ingredientRoles = isPlainObject(packet.ingredientRoles) ? packet.ingredientRoles : {};
  const carries = humanJoin(ingredientRoles.carries);
  const supports = humanJoin(ingredientRoles.supports);
  const dangers = humanJoin(ingredientRoles.dangerNotes || packet.ruiners);
  const nextQuestion = pickFirstString(packet.nextQuestion);
  const buildSignal = pickFirstString(strongest.buildSignal, strongest.why, packet.leadImpression);
  const strongestName = pickFirstString(strongest.name);
  const establishedHoneys = establishedHoneyTerms(userMessage);
  const hasConcept = Boolean(snapshot.summary || carries || supports || strongestName || (userMessage.inputs && (userMessage.inputs.inspiration || userMessage.inputs.vision || userMessage.inputs.mustHaveSimple)));

  if (/i didnt mention|i didn't mention|where did .* come from|i am not following|i'm not following|that is not what i said|that's not what i said/.test(latestTurnLower) && hasConcept) {
    const honeyLine = establishedHoneys.length
      ? `You are right. The live honey lane here is ${humanJoin(establishedHoneys)}, so I should not have drifted away from that.`
      : "You are right. I drifted away from the live concept instead of staying grounded in what you actually said.";
    const leanLine = strongestName
      ? `My actual lean is still ${strongestName.toLowerCase()}.`
      : packet.leadImpression
        ? packet.leadImpression
        : "";
    const supportLine = carries
      ? `${carries} should stay clearly in front${supports ? ` while ${supports} stay in support` : ""}.`
      : buildSignal;
    const questionLine = nextQuestion
      ? `The next real decision is this: ${sentenceCaseFirst(nextQuestion)}`
      : "The next real decision is what gives the glass its lift without turning the whole thing cocktail-sweet.";
    return sanitizeCollaboratorReply([honeyLine, leanLine, supportLine, dangers ? `The thing I would watch is ${dangers}.` : "", questionLine].filter(Boolean).join("\n\n"));
  }

  if (isLowInformationGreetingText(latestTurn)) {
    if (!hasConcept) {
      return "Ready. Tell me what you want in the glass, what you refuse to drink, and how risky you want the process to be, and I will help you choose the lane.";
    }
    const lean = strongestName
      ? `Ready. My first lean is ${strongestName.toLowerCase()}.`
      : packet.leadImpression
        ? `Ready. ${packet.leadImpression}`
        : "Ready. I can tighten this with you.";
    const supportLine = strongest.why
      ? strongest.why
      : carries
        ? `${carries} should stay clearly in front${supports ? ` while ${supports} stay in support` : ""}.`
        : "";
    const questionLine = nextQuestion
      ? `Before we talk process, the next real design question is this: ${sentenceCaseFirst(nextQuestion)}`
      : "Before we talk process, tell me which part of the concept still feels fuzzy and I will tighten that first.";
    return sanitizeCollaboratorReply([lean, supportLine, dangers ? `The thing I would watch is ${dangers}.` : "", questionLine].filter(Boolean).join("\n\n"));
  }

  if (isSimpleAckText(latestTurn) && hasConcept) {
    const historyJoined = (Array.isArray(userMessage.conversation_history) ? userMessage.conversation_history : []).map((turn) => turn && turn.text ? turn.text : "").join(" ").toLowerCase();
    const likelyStaleQuestion = Boolean(
      nextQuestion && (
        new RegExp(nextQuestion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 24), "i").test(historyJoined)
        || (/bench-trial|bench trial/.test(nextQuestion.toLowerCase()) && /bench-trial|bench trial/.test(historyJoined))
        || (/\btea\b/.test(nextQuestion.toLowerCase()) && /\btea\b/.test(historyJoined))
      )
    );
    const downstreamQuestion = likelyStaleQuestion ? deriveDownstreamQuestion(userMessage, packet) : nextQuestion;
    const progressionLine = likelyStaleQuestion
      ? pickFirstString(strongest.why, packet.leadImpression, buildSignal)
      : buildSignal;
    return sanitizeCollaboratorReply([
      "Good. That settles the last lane enough to move forward.",
      progressionLine,
      downstreamQuestion ? `The next real decision is this: ${sentenceCaseFirst(downstreamQuestion)}` : ""
    ].filter(Boolean).join("\n\n"));
  }

  if (String(snapshot.userNeed || "").trim() === "help_me_choose" && strongestName) {
    return sanitizeCollaboratorReply([
      `If I had to lean right now, I would build around ${strongestName.toLowerCase()}.`,
      strongest.why || buildSignal,
      dangers ? `The thing I would watch is ${dangers}.` : "",
      nextQuestion ? `The next real decision is this: ${sentenceCaseFirst(nextQuestion)}` : ""
    ].filter(Boolean).join("\n\n"));
  }

  return "";
}

async function auditCollaboratorReply({ apiKey, model, userMessage, collaboratorReply, knowledgePromptBlock }) {
  const content = await callOpenAI({
    apiKey,
    model,
    temperature: 0.1,
    responseFormat: { type: "json_object" },
    messages: [
      { role: "system", content: QUALITY_AUDIT_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Audit this mentor reply against the target conversation style.

Current concept state:
${JSON.stringify({
  mode: userMessage.mode || "scout",
  concept_snapshot: userMessage.concept_snapshot || {},
  beginner_inputs: userMessage.inputs || {},
  current_user_turn: userMessage.current_user_turn || ""
}, null, 2)}

${knowledgePromptBlock || ""}

Reply to audit:
${collaboratorReply}`
      }
    ]
  });

  return JSON.parse(content);
}

function replyNeedsRewrite(audit) {
  const scores = isPlainObject(audit && audit.scores) ? audit.scores : {};
  const contentUsefulness = Number(scores.content_usefulness || 0);
  const collaborativeFeel = Number(scores.collaborative_feel || 0);
  const recipePartnerConfidence = Number(scores.recipe_partner_confidence || 0);
  return Boolean(audit && audit.needs_rewrite)
    || contentUsefulness < 8
    || collaborativeFeel < 8
    || recipePartnerConfidence < 8;
}

async function reviseCollaboratorReply({ apiKey, model, userMessage, collaboratorReply, audit, issues, knowledgePromptBlock }) {
  const problemLines = [
    ...(Array.isArray(issues) ? issues : []),
    ...(Array.isArray(audit && audit.problems) ? audit.problems : []),
    ...(Array.isArray(audit && audit.missing_moves) ? audit.missing_moves : [])
  ];

  const content = await callOpenAI({
    apiKey,
    model,
    temperature: 0.45,
    messages: [
      { role: "system", content: REVISION_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Rewrite this mentor reply so it is much closer to the target collaborative style.

Current concept state:
${JSON.stringify({
  mode: userMessage.mode || "scout",
  concept_snapshot: userMessage.concept_snapshot || {},
  beginner_inputs: userMessage.inputs || {},
  current_user_turn: userMessage.current_user_turn || ""
}, null, 2)}

${knowledgePromptBlock || ""}

What is wrong with the current reply:
${problemLines.map((item) => `- ${item}`).join("\n") || "- The reply is too generic or too tutor-like."}

Rewrite brief:
${String(audit && audit.rewrite_brief || "Lead with a stronger opinion, compare lanes with tradeoffs, make the decision if the user asked for help, and only then ask one sharp downstream question.").trim()}

Current reply:
${collaboratorReply}`
      }
    ]
  });

  return sanitizeCollaboratorReply(content);
}

async function repairCollaboratorReply({ apiKey, model, userMessage, collaboratorReply, issues, knowledgePromptBlock }) {
  const content = await callOpenAI({
    apiKey,
    model,
    temperature: 0.35,
    messages: [
      { role: "system", content: REPAIR_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Rewrite this mentor reply so it obeys the live constraints and fixes the listed problems.

Current concept state:
${JSON.stringify({
  mode: userMessage.mode || "scout",
  concept_snapshot: userMessage.concept_snapshot || {},
  beginner_inputs: userMessage.inputs || {},
  current_user_turn: userMessage.current_user_turn || ""
}, null, 2)}

${knowledgePromptBlock || ""}

Problems to fix:
${issues.map((item) => `- ${item}`).join("\n")}

Reply to repair:
${collaboratorReply}`
      }
    ]
  });

  return sanitizeCollaboratorReply(content);
}

async function callOpenAI({ apiKey, model, temperature, responseFormat, messages }) {
  const body = {
    model,
    temperature,
    messages
  };
  if (responseFormat) body.response_format = responseFormat;

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI returned ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty message");
  }
  return content;
}

async function generateCollaboratorReply({ apiKey, model, userMessage, guidanceNote, knowledgePromptBlock }) {
  const { priorTurns, currentTurn } = splitConversationForCurrentTurn(
    userMessage.conversation_history,
    userMessage.current_user_turn
  );

  const messages = [
    { role: "system", content: COLLABORATOR_SYSTEM_PROMPT },
    { role: "user", content: buildCollaboratorContext(userMessage, guidanceNote, knowledgePromptBlock) },
    ...mapConversationToMessages(priorTurns),
    { role: "user", content: currentTurn || buildContinuePrompt() }
  ];

  const content = await callOpenAI({
    apiKey,
    model,
    temperature: 0.55,
    messages
  });
  return sanitizeCollaboratorReply(content);
}

async function extractMentorStructure({ apiKey, model, userMessage, collaboratorReply }) {
  const extractionPayload = {
    mode: userMessage.mode || "scout",
    blunt: userMessage.blunt ?? true,
    beginner_inputs: userMessage.inputs || {},
    concept_snapshot: userMessage.concept_snapshot || {},
    current_user_turn: userMessage.current_user_turn || "",
    collaborator_reply: collaboratorReply,
    fallback_packet: userMessage.fallback_packet || {}
  };

  const content = await callOpenAI({
    apiKey,
    model,
    temperature: 0.15,
    responseFormat: { type: "json_object" },
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Extract the mentor turn into the JSON schema exactly as requested.

${JSON.stringify(extractionPayload, null, 2)}`
      }
    ]
  });

  return JSON.parse(content);
}

function buildFallbackResponse(userMessage, collaboratorReply, extracted = {}) {
  const packet = isPlainObject(userMessage.fallback_packet) ? userMessage.fallback_packet : {};
  const strongestDirection = isPlainObject(packet.strongestDirection) ? packet.strongestDirection : {};
  const ingredientRoles = isPlainObject(packet.ingredientRoles) ? packet.ingredientRoles : {};
  const concept = isPlainObject(extracted.concept_outputs) ? extracted.concept_outputs : {};
  const build = isPlainObject(extracted.build_mapping) ? extracted.build_mapping : {};
  const reply = isPlainObject(extracted.mentor_reply) ? extracted.mentor_reply : {};

  const provisionalTake = pickFirstString(
    reply.provisional_take,
    reply.provisionalTake,
    strongestDirection.name && strongestDirection.why
      ? `My current lean is ${strongestDirection.name}. ${strongestDirection.why}`
      : ""
  );

  return {
    mentor_reply: {
      headline: pickFirstString(reply.headline, strongestDirection.name, packet.leadImpression, "Current direction still forming."),
      conversation_reply: collaboratorReply,
      provisional_take: provisionalTake,
      assessment: pickFirstString(reply.assessment, packet.leadImpression),
      pushback: normalizeStringList(reply.pushback, packet.pushback),
      strongest_direction: {
        name: pickFirstString(reply.strongest_direction?.name, strongestDirection.name),
        why: pickFirstString(reply.strongest_direction?.why, strongestDirection.why),
        build_signal: pickFirstString(reply.strongest_direction?.build_signal, strongestDirection.buildSignal)
      },
      alternate_directions: normalizeObjectArray(reply.alternate_directions, packet.alternateDirections),
      ingredient_roles: {
        carries: normalizeStringList(reply.ingredient_roles?.carries, ingredientRoles.carries),
        supports: normalizeStringList(reply.ingredient_roles?.supports, ingredientRoles.supports),
        lift_or_structure: normalizeStringList(reply.ingredient_roles?.lift_or_structure, ingredientRoles.liftStructure),
        danger_notes: normalizeStringList(reply.ingredient_roles?.danger_notes, ingredientRoles.dangerNotes)
      },
      next_question: pickFirstString(reply.next_question, packet.nextQuestion),
      next_step: pickFirstString(reply.next_step, packet.nextStep),
      risk_controls: normalizeStringList(reply.risk_controls, packet.riskControls),
      production_sequence: normalizeStringList(reply.production_sequence, packet.productionSequence)
    },
    concept_outputs: {
      lead_impression: pickFirstString(concept.lead_impression, packet.leadImpression),
      dominant_notes: normalizeStringList(concept.dominant_notes, packet.dominantNotes),
      support_notes: normalizeStringList(concept.support_notes, packet.supportNotes),
      tension_sources: normalizeStringList(concept.tension_sources, packet.tensionSources),
      ruiners: normalizeStringList(concept.ruiners, packet.ruiners),
      style_lane: pickFirstString(concept.style_lane, packet.styleLane),
      finish_direction: pickFirstString(concept.finish_direction, packet.finishDirection),
      decision_stage: pickFirstString(concept.decision_stage, packet.decisionStage)
    },
    build_mapping: {
      yeast: pickFirstString(build.yeast, packet.yeastLane),
      source_bill_candidates: normalizeObjectArray(build.source_bill_candidates, packet.sourceBillCandidates),
      adjunct_candidates: normalizeObjectArray(build.adjunct_candidates, packet.adjunctCandidates)
    }
  };
}

function mergeMentorResponse(extracted, userMessage, collaboratorReply) {
  const merged = buildFallbackResponse(userMessage, collaboratorReply, extracted);
  merged.mentor_reply.conversation_reply = collaboratorReply;
  return merged;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return respond(405, { error: "POST only" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return respond(500, { error: "OPENAI_API_KEY not set in Netlify environment variables." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { error: "Invalid JSON body" });
  }

  const model = payload.model || "gpt-4o-mini";
  const userMessage = {
    mode: payload.mode || "scout",
    blunt: payload.blunt ?? true,
    inputs: payload.beginner_inputs || {},
    concept_snapshot: payload.concept_snapshot || {},
    fallback_packet: payload.fallback_packet || payload.local_packet || {},
    conversation_history: Array.isArray(payload.conversation_history) ? payload.conversation_history : [],
    current_user_turn: payload.current_user_turn || ""
  };
  const guidanceNote = buildGuidanceNote(userMessage);
  const knowledgeContext = buildKnowledgePromptBlock(userMessage);
  const knowledgePromptBlock = knowledgeContext.promptBlock;

  try {
    let collaboratorReply = buildPacketDrivenReply(userMessage);
    const usedPacketReply = Boolean(collaboratorReply);
    if (!collaboratorReply) {
      collaboratorReply = buildEvidenceDrivenReply(userMessage, knowledgeContext);
    }
    const usedEvidenceReply = Boolean(collaboratorReply) && !usedPacketReply;
    if (!collaboratorReply) {
      collaboratorReply = await generateCollaboratorReply({
        apiKey,
        model,
        userMessage,
        guidanceNote,
        knowledgePromptBlock
      });
    }

    if (!usedPacketReply && !usedEvidenceReply) {
      const issues = [
        ...buildReplyIssues(collaboratorReply, userMessage),
        ...buildKnowledgeIssues(collaboratorReply, userMessage, knowledgeContext)
      ];
      let audit = null;

      try {
        audit = await auditCollaboratorReply({
          apiKey,
          model,
          userMessage,
          collaboratorReply,
          knowledgePromptBlock
        });
      } catch {
        audit = null;
      }

      try {
        collaboratorReply = await reviseCollaboratorReply({
          apiKey,
          model,
          userMessage,
          collaboratorReply,
          audit,
          issues,
          knowledgePromptBlock
        });
      } catch {
        collaboratorReply = sanitizeCollaboratorReply(collaboratorReply);
      }

      const revisedIssues = [
        ...buildReplyIssues(collaboratorReply, userMessage),
        ...buildKnowledgeIssues(collaboratorReply, userMessage, knowledgeContext)
      ];
      if (revisedIssues.length) {
        try {
          collaboratorReply = await repairCollaboratorReply({
            apiKey,
            model,
            userMessage,
            collaboratorReply,
            issues: revisedIssues,
            knowledgePromptBlock
          });
        } catch {
          collaboratorReply = sanitizeCollaboratorReply(collaboratorReply);
        }
        const repairedIssues = [
          ...buildReplyIssues(collaboratorReply, userMessage),
          ...buildKnowledgeIssues(collaboratorReply, userMessage, knowledgeContext)
        ];
        if (repairedIssues.length) {
          const evidenceReply = buildEvidenceDrivenReply(userMessage, knowledgeContext);
          if (evidenceReply) collaboratorReply = evidenceReply;
        }
      }
    }

    try {
      const extracted = await extractMentorStructure({
        apiKey,
        model,
        userMessage,
        collaboratorReply
      });
      return respond(200, mergeMentorResponse(extracted, userMessage, collaboratorReply));
    } catch {
      return respond(200, buildFallbackResponse(userMessage, collaboratorReply));
    }
  } catch (err) {
    return respond(502, { error: `Mentor function error: ${err.message || err}` });
  }
}

function respond(code, body) {
  return {
    statusCode: code,
    headers: corsHeaders(),
    body: JSON.stringify(body)
  };
}

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
