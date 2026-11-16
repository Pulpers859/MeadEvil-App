import { buildKnowledgePromptBlock, buildKnowledgeIssues, buildEvidenceDrivenReply } from "./mead-knowledge.mjs";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// Only these models may be requested from the browser. Anything else is coerced
// to the cheap default so a caller cannot select an expensive model on the
// account owner's dime.
//
// The expensive models used to be on this list, which defeated the entire point:
// a caller could simply ask for the priciest one. This endpoint is unauthenticated
// by nature (a static site holds no secret), so the allowlist is the ONLY spend
// control that actually binds. Keep it to the cheap model.
const ALLOWED_MODELS = new Set(["gpt-4o-mini"]);
const DEFAULT_MODEL = "gpt-4o-mini";
// Hard caps to keep a single request from running up unbounded token spend.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_HISTORY_TURNS = 40;
const MAX_TURN_CHARS = 6000;
// Without a ceiling, one request can bill for an unbounded completion.
const MAX_COMPLETION_TOKENS = 1400;
// A hung upstream would otherwise burn the whole function timeout on every call.
const UPSTREAM_TIMEOUT_MS = 45000;
// The structured-extraction pass is a second, small model call made after the
// reply exists. It must never be the reason a request dies, so it only runs if
// enough of the function's time budget is left. Netlify's default synchronous
// limit is 10s; raise MENTOR_FUNCTION_BUDGET_MS only if the site's limit is higher.
const FUNCTION_BUDGET_MS = Math.max(4000, Number(process.env.MENTOR_FUNCTION_BUDGET_MS) || 9000);
const EXTRACTION_MIN_MS = 2000;
const EXTRACTION_MAX_TOKENS = 500;

// Best-effort abuse brake. The endpoint spends the owner's API credit and a
// static site cannot authenticate callers, so cap how fast one address can call.
// This lives in the memory of one warm function instance: it stops a runaway
// loop or a casual scraper, not a distributed attacker. The origin allowlist
// and the pinned cheap model remain the real spend controls.
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX_REQUESTS = Math.max(1, Number(process.env.MENTOR_RATE_MAX) || 30);
const rateBuckets = new Map();

// Only the header the platform itself sets is trusted. X-Forwarded-For is
// caller-supplied: keying on it let anyone dodge the limit by rotating it.
function clientAddress(event) {
  const headers = event.headers || {};
  return String(headers["x-nf-client-connection-ip"] || "unknown");
}

function rateLimitRetryAfter(event, now = Date.now()) {
  const key = clientAddress(event);
  const recent = (rateBuckets.get(key) || []).filter((stamp) => now - stamp < RATE_WINDOW_MS);
  // No platform header means local dev (or a host that is not Netlify), where
  // every caller shares one bucket: keep a ceiling, but a roomier one.
  const limit = key === "unknown" ? RATE_MAX_REQUESTS * 10 : RATE_MAX_REQUESTS;
  if (recent.length >= limit) {
    rateBuckets.set(key, recent);
    return Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - recent[0])) / 1000));
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  if (rateBuckets.size > 2000) {
    for (const [bucketKey, stamps] of rateBuckets) {
      if (!stamps.length || now - stamps[stamps.length - 1] >= RATE_WINDOW_MS) rateBuckets.delete(bucketKey);
    }
  }
  return 0;
}

// What each coach mode actually asks the model to do. Previously the mode
// reached the prompt as a bare word ("Mode: scout") and the three buttons
// produced the same behaviour.
const MODE_DIRECTIVES = {
  scout: "SCOUT. Explore before committing. Lay out two or three genuinely different directions this concept could take, say plainly which one you would pick and why the others are riskier. Stay at the level of concept and ingredient roles; do not give batch quantities unless the user asks for them.",
  pushback: "PUSHBACK. Challenge the concept as it stands. Find the weakest structural decision in it and say exactly what goes wrong in the glass because of it: what is redundant, what is fighting what, what is missing (acid, tannin, lift, a finish). Do not open new directions. Fix it or cut it. Be blunt.",
  forge: "FORGE. Stop exploring and convert the concept into a brewable build. Commit to one lane and give concrete numbers scaled to the stated batch size: every fermentable with its weight, the expected OG, the yeast, and every structure addition with amount, unit and when it goes in (primary, secondary, or bench trial). State each amount as a plain number with a unit next to the ingredient name, for example \"7.5 lb orange blossom honey\", so it transfers cleanly to the Build tab. If something essential is still undecided, decide it and say you did."
};

function modeDirective(mode) {
  return MODE_DIRECTIVES[String(mode || "").toLowerCase()] || MODE_DIRECTIVES.scout;
}

function pinModel(requested) {
  return ALLOWED_MODELS.has(requested) ? requested : DEFAULT_MODEL;
}

// Best-effort origin gate. A static site cannot hold a real secret in browser
// JS, so this stops casual cross-origin abuse from other web pages; it does not
// stop a determined curl. Set MENTOR_ALLOWED_ORIGINS (comma-separated) in the
// Netlify environment to lock it down; unset means allow all (dev default).
function originAllowed(event) {
  const allowList = (process.env.MENTOR_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowList.length) {
    // Unset means "allow all", which is the right default for local dev but ships
    // an open, unmetered proxy if it reaches production. Say so in the logs.
    console.warn("MENTOR_ALLOWED_ORIGINS is not set — the mentor endpoint is open to any origin. Set it in the Netlify environment before deploying. See docs/SETUP.md.");
    return true;
  }
  const origin = event.headers?.origin || event.headers?.Origin || "";
  return allowList.includes(origin);
}

// Echo the caller's origin only when it is on the allowlist. A blanket
// `Access-Control-Allow-Origin: *` let any web page in any visitor's browser
// spend the owner's API credit; the app itself is same-origin and needs none of it.
function resolveAllowedOrigin(event) {
  const allowList = (process.env.MENTOR_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = event?.headers?.origin || event?.headers?.Origin || "";
  if (!allowList.length) return origin || "*";
  return allowList.includes(origin) ? origin : allowList[0];
}

function clampTurnText(value) {
  return String(value || "").slice(0, MAX_TURN_CHARS);
}

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

Practical recipe knowledge:
- Honey sizing: use approximately 1.5 lb honey per gallon of total must volume for a hydromel (~7% ABV, OG ~1.053-1.055). Quick batch references for a ~7% hydromel: 1 gal batch → ~1.5 lb honey; 2 gal batch → ~3.0 lb honey; 3 gal batch → ~4.5 lb honey; 5 gal batch → ~7.5 lb honey. For a standard mead (~12-14% ABV, OG ~1.090-1.110), use approximately 2.5-3 lb per gallon.
- Honey displaces volume: ~1 lb honey ≈ 0.085 gal. For a 2 gal batch with 3 lb honey, the honey takes up ~0.25 gal, so start with ~1.75 gal water, dissolve honey, then top up to target total must volume. Never add the full water volume plus honey on top.
- Always give the user an OG checkpoint when recommending honey amounts so they can verify with a hydrometer.
- Account for racking and fruit losses: build 10-15% extra must volume beyond the target final volume. For a 2 gal final package, build ~2.25 gal of starting must. Adjust honey proportionally to the actual must volume.
- Cool fermentation (60-66°F) preserves delicate floral and fruit aromas. Warm fermentation risks fusel alcohols and hot/solventy character.
- Staggered nutrient additions (SNA): split Fermaid O into three equal doses at 24h, 48h, and 72h (or the 1/3 sugar break, whichever comes first). Do not add Fermaid O at pitch — the first 24 hours use Go-Ferm nutrients from yeast rehydration. This is standard practice, not a single upfront dump.
- Pectic enzyme in primary helps clarity, especially when fruit comes later in secondary.
- For sparkling mead, force carbonation in a keg is the safest method. Standard wine bottles cannot handle carbonation pressure. Only use champagne bottles, Belgian bottles, thick beer bottles, or pressure-rated swing-tops.
- Carbonation sharpens perceived acidity. Do not add acid upfront in sparkling meads — save it for bench trials after carbonation.
- Fruit in secondary: for a restrained but visible supporting role (blush, light aroma, color tint), use roughly 1.5 lb per gallon of batch size (e.g., 2 gal batch = 3 lb fruit, 3 gal batch = 4.5 lb fruit, 5 gal batch = 7.5 lb fruit). For a prominent fruit-forward character, use 2-3 lb per gallon. Freeze fruit first if fresh, thaw, slice or lightly crush — do not puree. Contact time 5-7 days is typical; start tasting around day 4-5 and rack off when the aroma/color is right. Avoid extended contact (>10 days) without a clear reason.
- For sparkling meads, target 2.7-2.8 volumes CO2 for a champagne-like sparkle. At 34-38°F keg temp this typically requires 18-25 PSI. Use a carbonation chart for exact PSI at your serving temp.

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
- Do not open with generic scene-setting filler like "Absolutely, let's get into it" or "Alright, let's map this out".
- Do not open with soft validation like "You're right", "Great choice", or "That makes sense" unless it genuinely adds value.
- Do not close with "Does this align with your vision?", "How does that sound?", or similar soft confirmation questions.
- Do not end with broad menus like "what do you want to focus on next?" or "yeast, fermentation, or secondary additions?" Choose the next real downstream design decision yourself.
- Usually end with one natural, focused question only if the concept truly needs one more decision.
- If the user already gave enough to make the next decision, make it and move downstream instead of re-asking.
- If the user already accepted the previous recommendation, do not re-sell the same concept from scratch. Move the thread forward.
- If the concept is already coherent enough, start acting like a collaborator building a mead, not a gatekeeper asking permission.
- If you just resolved the honey lane, the next question should usually be about citrus execution, agave illusion, structure, or anti-syrup control, not generic process.
- If the user asks about dosing a potent finishing addition like tequila, spirits, oak extract, acid, or tannin, recommend a bench-trial style approach first and scaled whole-batch additions second.
- Prefer tight conversational paragraphs over tidy classroom lists unless the user clearly needs a structured breakdown.
- When comparing options, do not stop at "these all work." Name the winner and why the others are weaker or riskier in this exact mead.
- Do not invent new identity ingredients, new flavor lanes, or cute add-ons during process-planning unless they solve a problem already identified in the concept.
- Stay inside the established ingredient lane during process planning. Do not suddenly add random oak, off-list yeasts, or ingredients that the conversation never earned.
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



const THINKING_RAILS = `Before you answer, silently check:
- Did I help make the mead instead of grading it?
- Did I give a real lean before I asked for anything?
- Did I protect the user's latest constraints?
- Did I pick a lane when the user asked me to choose?
- Did I avoid reopening solved decisions? If the conversation already settled honey, yeast, fruit timing, or any other lane, I must not re-ask about it.
- Did I avoid labels like "Next question" and "Next move"?
- If the user asked about amounts or sizing, did I give actual numbers grounded in honey-to-gravity math instead of vague ranges?
- If I mentioned sparkling or carbonation, did I address bottle safety?
- If the user asked for a process plan or recipe, did I give actual pounds, gallons, grams, temperatures, and timelines instead of staying abstract?`;

// Kept in sync with assets/js/meadevil-mentor.js
function isLowInformationGreetingText(text) {
  const lower = String(text || "").trim().toLowerCase();
  if (!lower) return false;
  if (/^(so\s+)?(let'?s|let us)\s+(get started|begin|do this|do it|go|start)/i.test(lower)) return true;
  if (/get started on this|new mead idea|start.*this.*mead|begin.*this.*mead/i.test(lower)) return true;
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

// Kept in sync with assets/js/meadevil-mentor.js
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
    rules.push("The user wants real build help with specific numbers. Give honey amount in pounds with OG checkpoint, yeast choice with brief rationale, fruit amount and timing, fermentation temperature, nutrient schedule, and packaging plan. Do not stay abstract or philosophical — give the actual recipe.");
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
  if (/how much honey|how many pounds|what yeast|how to handle|how to carbonate|plan the whole|the whole thing|full process|walk me through|everything i need|start to finish/i.test(latestTurn)) {
    rules.push("The user is asking for specific process details. Answer with actual numbers: honey in pounds with must volume, OG target, yeast name, fruit pounds per gallon with timing, fermentation temperature range, nutrient grams and staggered schedule, pectic enzyme if fruit is involved, carbonation volumes and PSI, and bottle safety. Also mention acid and structure additions as bench-trial-only if relevant. Do not give a philosophical overview — give the buildable recipe.");
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
    bannedQuestions.push("Do not mention bottle-conditioning or priming sugar unless the user explicitly asks about it. Default to force carbonation in a keg as the recommended method.");
    rules.push("This is a sparkling concept. Recommend force carbonation in a keg as the safest and most controllable method. If discussing bottling for gifts, remind the user to bottle cold from the keg into pressure-safe bottles (champagne, Belgian, thick beer, or rated swing-tops). Standard wine bottles are unsafe for carbonation.");
    rules.push("For sparkling meads, do not add acid upfront — carbonation sharpens perceived acidity. Save acid and structure additions (like white tea or tannin) for bench trials after the mead is carbonated.");
  }

  const batchSizeVal = String(inputs.batchSize || "").trim();
  if (batchSizeVal) {
    rules.push(`The user's batch size is ${batchSizeVal} gallons final volume. Build about 10-15% extra must to account for racking and fruit losses. Use the actual must volume for honey calculations.`);
  }
  const targetAbvVal = String(inputs.targetAbv || "").trim();
  if (targetAbvVal) {
    rules.push(`The user's target ABV is ~${targetAbvVal}%. Size the honey bill to hit this target using ~35 gravity points per pound per gallon. Give an OG checkpoint.`);
  }
  if (batchSizeVal && targetAbvVal) {
    const batchGal = parseFloat(batchSizeVal);
    const abv = parseFloat(targetAbvVal);
    if (batchGal > 0 && abv > 0) {
      const ogDry = (1 + abv / 131.25).toFixed(3);
      const mustVol = (batchGal * 1.125).toFixed(2);
      const honeyLb = ((abv / 131.25 * 1000) * parseFloat(mustVol) / 35).toFixed(1);
      rules.push(`Computed targets: build ~${mustVol} gal of must, use ~${honeyLb} lb honey, expect OG ~${ogDry}, ferment at 60-66°F. Do not cite a significantly different OG — that would miss the ${abv}% ABV target.`);
    }
  }

  const isLightConcept = /\blight\b|session|refreshing|easy.?drinking|champagne|hydromel|low.?abv/.test(textParts);
  if (isLightConcept && !targetAbvVal) {
    rules.push("This concept reads like a hydromel or session mead (light, refreshing, easy-drinking). Target approximately 6-8% ABV (OG ~1.045-1.060) unless the user says otherwise. Do not default to 12-14% standard mead territory.");
  }

  if (/linden/.test(textParts) && hasHoney) {
    rules.push("Linden honey has a distinctive herbaceous and slightly minty character with delicate floral notes. It is lighter-bodied than wildflower or buckwheat and pairs well with bright, fresh concepts.");
  }

  const yeastPreferenceMatch = String(inputs.ingredientsOnHand || "").match(/\b(71B|D47|QA23|EC-1118)\b/i);
  if (yeastPreferenceMatch) {
    const preferredYeast = yeastPreferenceMatch[1].toUpperCase().replace("EC-1118", "EC-1118");
    rules.push(`The user has ${preferredYeast} on hand or preferred. Use ${preferredYeast} as the yeast recommendation unless there is a strong technical reason not to (e.g., ABV exceeds tolerance). Briefly explain why it fits this concept.`);
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
    `Coach mode — ${modeDirective(userMessage.mode)}`,
    userMessage.blunt === false
      ? "Tone: the user asked for a gentler delivery. Keep every criticism, but frame it constructively and skip the bluntness."
      : "Tone: blunt. Say what is weak without cushioning it.",
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

function checkHardViolations(reply, userMessage) {
  const issues = [];
  const lower = String(reply || "").toLowerCase();
  const snapshot = userMessage.concept_snapshot || {};
  const avoidTerms = normalizeLowerList(snapshot.avoid);
  const currentTurn = String(userMessage.current_user_turn || "").toLowerCase();
  const historyText = (Array.isArray(userMessage.conversation_history) ? userMessage.conversation_history : [])
    .map((turn) => String(turn && turn.text ? turn.text : ""))
    .join("\n")
    .toLowerCase();

  avoidTerms.forEach((term) => {
    if (term && lower.includes(term)) {
      issues.push(`Reply recommends "${term}" which is on the avoid list.`);
    }
  });

  if (/k1-v1116|k1v1116|tequila essence/.test(lower)) {
    issues.push("Reply introduced an off-lane yeast or ingredient.");
  }

  if (/actual tequila|a touch of actual tequila/.test(lower) && /(no actual spirits|without actual spirits|no spirits)/.test(historyText)) {
    issues.push("Reply suggests actual tequila despite no-spirits constraint.");
  }

  const establishedHoneys = establishedHoneyTerms(userMessage);
  if (establishedHoneys.length) {
    const replyHoneyTerms = Array.from(new Set(extractHoneyTerms(reply)));
    if (replyHoneyTerms.some((term) => !establishedHoneys.includes(term))) {
      issues.push("Reply introduced a honey not in the concept state.");
    }
  }

  if (isLowInformationGreetingText(currentTurn) && /pounds per gallon|lb per gallon|secondary fermentation|primary fermentation|stabiliz|bottl|fermentation/i.test(lower)) {
    issues.push("Reply jumped into process detail on a greeting turn.");
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

  return "";
}


async function callOpenAI({ apiKey, model, temperature, responseFormat, messages, maxTokens, timeoutMs }) {
  const body = {
    model,
    temperature,
    messages,
    max_tokens: Math.min(MAX_COMPLETION_TOKENS, maxTokens || MAX_COMPLETION_TOKENS)
  };
  if (responseFormat) body.response_format = responseFormat;

  const upstreamTimeout = Math.min(UPSTREAM_TIMEOUT_MS, timeoutMs || UPSTREAM_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), upstreamTimeout);
  let res;
  let json;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    // The timer stays armed through the body read: headers can arrive
    // promptly and the body still stall past the function's time limit.
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI returned ${res.status}: ${text.slice(0, 300)}`);
    }
    json = await res.json();
  } catch (error) {
    if (error?.name === "AbortError" || controller.signal.aborted) throw new Error(`OpenAI request timed out after ${upstreamTimeout}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }

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

const KNOWN_YEAST_NAMES = ["71B", "D47", "QA23", "EC-1118"];
const KNOWN_ADJUNCT_TERMS = [
  "toasted coconut", "coconut", "lime zest", "lime", "orange peel", "orange zest",
  "vanilla bean", "vanilla", "oak", "american oak", "french oak", "agave",
  "sea salt", "cinnamon", "star anise", "clove", "ginger", "nutmeg",
  "blackberry", "blueberry", "raspberry", "cherry", "tart cherry",
  "peach", "mango", "pineapple", "passion fruit", "fig", "plum",
  "sage", "rosemary", "lavender", "hibiscus", "rose", "chamomile",
  "black tea", "green tea", "earl grey", "rooibos",
  "cacao", "cocoa nibs", "coffee", "espresso",
  "juniper", "cardamom", "peppercorn", "chili", "habanero", "jalapeno"
];

function extractAmountNear(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const weightPatterns = [
    // NOTE: deliberately exclude gallon/gallons — those are batch/volume figures,
    // not fermentable weights. Including them mislabeled "3 gallon batch" as 3 lb.
    new RegExp(`(\\d+\\.?\\d*)\\s*(?:to\\s*\\d+\\.?\\d*\\s*)?(lb|lbs|pound|pounds|oz|ounces|kg|g)\\b[^.]{0,80}${escaped}`, "i"),
    new RegExp(`${escaped}[^.]{0,80}?(\\d+\\.?\\d*)\\s*(?:to\\s*\\d+\\.?\\d*\\s*)?(lb|lbs|pound|pounds|oz|ounces|kg|g)\\b`, "i"),
    new RegExp(`(\\d+\\.?\\d*)\\s*(lb|lbs|pound|pounds|oz|ounces|kg|g)\\b[\\s\\S]{0,120}${escaped}`, "i"),
    new RegExp(`${escaped}[\\s\\S]{0,120}?(?:around|total|about|approximately|roughly|use)?\\s*(\\d+\\.?\\d*)\\s*(?:to\\s*\\d+\\.?\\d*\\s*)?(lb|lbs|pound|pounds|oz|ounces|kg|g)\\b(?!\\s*per\\b)`, "i"),
    new RegExp(`(\\d+\\.?\\d*)\\s*(lb|lbs|pound|pounds|oz|ounces|kg|g)\\b[^.]{0,20}honey`, "i")
  ];
  for (const pattern of weightPatterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = match[1];
      const rawUnit = (match[2] || "lb").toLowerCase();
      const unit = /^(lb|lbs|pound|pounds)$/.test(rawUnit) ? "lb" : /^(oz|ounces)$/.test(rawUnit) ? "oz" : /^(kg)$/.test(rawUnit) ? "kg" : /^(g)$/.test(rawUnit) ? "g" : "lb";
      return { amount, unit };
    }
  }

  const baseTerm = term.replace(/\s*(zest|peel|juice|slices?|chunks?)$/i, "").trim();
  const baseEscaped = baseTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const countPatterns = [
    new RegExp(`(\\d+\\.?\\d*)\\s*(?:to|-)\\s*(\\d+\\.?\\d*)\\s+(?:whole\\s+)?${baseEscaped}s?\\b`, "i"),
    new RegExp(`${escaped}[^.]{0,60}?(\\d+\\.?\\d*)\\s*(?:to|-)\\s*(\\d+\\.?\\d*)\\s+${baseEscaped}s?\\b`, "i"),
    new RegExp(`(\\d+\\.?\\d*)\\s+(?:whole\\s+)?${baseEscaped}s?\\b(?!\\s*(?:lb|lbs|oz|g|kg|pound|gallon))`, "i")
  ];
  for (const pattern of countPatterns) {
    const match = text.match(pattern);
    if (match) {
      if (match[2]) {
        const mid = (parseFloat(match[1]) + parseFloat(match[2])) / 2;
        return { amount: String(Math.round(mid * 10) / 10), unit: "each" };
      }
      return { amount: match[1], unit: "each" };
    }
  }
  return null;
}

function extractStructuredFromProse(prose, userMessage) {
  const lower = String(prose || "").toLowerCase();
  const allContext = [
    lower,
    String((userMessage.inputs || {}).inspiration || "").toLowerCase(),
    String((userMessage.inputs || {}).vision || "").toLowerCase(),
    String((userMessage.inputs || {}).mustHaveSimple || "").toLowerCase(),
    String((userMessage.inputs || {}).conceptName || "").toLowerCase()
  ].join(" ");

  const avoidText = String((userMessage.inputs || {}).avoidSimple || "").toLowerCase()
    + " " + (Array.isArray(((userMessage || {}).concept_snapshot || {}).avoid) ? userMessage.concept_snapshot.avoid.join(" ") : "").toLowerCase();
  const honeys = Array.from(new Set(extractHoneyTerms(allContext)))
    .filter((term, _, list) => !list.some((other) => other !== term && other.includes(term)))
    .filter((term) => !avoidText.includes(term));
  const yeast = KNOWN_YEAST_NAMES.find((y) => lower.includes(y.toLowerCase())) || "";

  const adjuncts = KNOWN_ADJUNCT_TERMS
    .filter((term) => allContext.includes(term))
    .filter((term, _, list) => !list.some((other) => other !== term && other.includes(term)));

  const sourceBill = honeys.map((h) => {
    const extracted = extractAmountNear(lower, h);
    return { name: h, type: "Honey", amount: extracted ? extracted.amount : "", unit: extracted ? extracted.unit : "lb" };
  });

  const adjunctCandidates = adjuncts.map((name) => {
    const extracted = extractAmountNear(lower, name);
    return {
      ingredient: name,
      amount: extracted ? extracted.amount : "",
      unit: extracted ? extracted.unit : "g",
      phase: /bench.?trial|backsweeten/i.test(lower) ? "bench trial" : "secondary",
      category: /oak|tannin|tea/.test(name) ? "structure" : /honey|sugar|agave|maple/.test(name) ? "fermentable" : "botanical",
      purpose: "",
      notes: ""
    };
  });

  const styleLane = (() => {
    if (/metheglin/i.test(allContext)) return "Metheglin";
    if (/melomel/i.test(allContext)) return "Melomel";
    if (/cyser/i.test(allContext)) return "Cyser";
    if (/pyment/i.test(allContext)) return "Pyment";
    if (/bochet/i.test(allContext)) return "Bochet";
    if (/hydromel/i.test(allContext)) return "Hydromel";
    if (/braggot/i.test(allContext)) return "Braggot";
    if (/traditional/i.test(allContext)) return "Traditional";
    if (adjuncts.some((a) => /berry|cherry|peach|mango|plum|fig|fruit/.test(a))) return "Melomel";
    if (adjuncts.some((a) => /sage|rosemary|lavender|cinnamon|ginger|clove|cardamom/.test(a))) return "Metheglin";
    return "";
  })();

  return {
    concept_outputs: {
      lead_impression: "",
      dominant_notes: adjuncts.slice(0, 3),
      support_notes: adjuncts.slice(3, 6),
      tension_sources: [],
      ruiners: [],
      style_lane: styleLane,
      finish_direction: "",
      decision_stage: ""
    },
    build_mapping: {
      yeast: yeast,
      source_bill_candidates: sourceBill,
      adjunct_candidates: adjunctCandidates
    },
    mentor_reply: {}
  };
}

// ---- Structured extraction -------------------------------------------------
// The reply is prose by design. Everything that reaches the Build tab used to be
// scraped out of that prose with regexes against a fixed ingredient whitelist,
// which is where the wrong-amount / missing-ingredient / doubled-honey bugs came
// from. This asks the model to read its own reply back as JSON instead.
//
// The model's JSON is NOT trusted. Every item is checked against the reply text
// (groundExtraction) and anything the reply does not literally say is dropped,
// so the worst case is "extracted less", never "invented a quantity". If the
// call fails, times out or returns junk, the regex result is used unchanged.
const EXTRACTION_SYSTEM_PROMPT = `You extract recipe data from a meadmaking mentor's reply. Return ONLY a JSON object of this exact shape:
{"yeast":"","source_bill":[{"name":"","type":"Honey","amount":"","unit":"lb"}],"adjuncts":[{"ingredient":"","amount":"","unit":"g","phase":"secondary"}]}

Rules:
- Copy only what the reply itself states. Never add, estimate or round anything.
- source_bill is for fermentables, things yeast consume: honey, fruit, juice, sugar, syrup. "type" is one of Honey, Fruit, Juice, Sugar, Other.
- adjuncts is for non-fermentable flavour and structure additions: spice, herb, zest, peel, oak, tea, acid, tannin, extract, salt. "phase" is one of primary, secondary, bench trial.
- "unit" is one of lb, oz, kg, g, gal, L, mL, tsp, tbsp, each. "amount" is a plain number as a string.
- If the reply gives one total weight and splits it across several honeys, give each honey its own share. Never assign the total to more than one item.
- If an amount is a range, use the lower number.
- If the reply names an ingredient without an amount, include it with "amount":"".
- Ignore per-gallon rates unless the reply also states the total for the batch.
- If the reply presents several alternative directions, extract only the one it recommends.
- "yeast" is one of 71B, D47, QA23, EC-1118, or "" if the reply does not choose one.`;

const EXTRACTION_UNITS = new Set(["lb", "oz", "kg", "g", "gal", "l", "ml", "tsp", "tbsp", "each"]);
const EXTRACTION_TYPES = ["Honey", "Fruit", "Juice", "Sugar", "Other"];
const EXTRACTION_PHASES = ["primary", "secondary", "bench trial"];

function replyHasBuildDetail(reply) {
  return /\d\s*(?:lb|lbs|pounds?|oz|ounces?|kg|g|grams?|tsp|tbsp|ml)\b/i.test(String(reply || ""));
}

function nameIsGrounded(name, replyLower) {
  const clean = String(name || "").toLowerCase().trim();
  if (!clean || clean.length > 60) return false;
  if (replyLower.includes(clean)) return true;
  // Allow harmless re-ordering ("honey, orange blossom"), but every meaningful
  // word must still be in the reply.
  const words = clean.split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  return words.length > 0 && words.every((word) => new RegExp(`\\b${escapeRegExp(word)}`).test(replyLower));
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const UNIT_ALIASES = {
  lb: "lbs?|pounds?", oz: "oz|ounces?", kg: "kg|kilograms?|kilos?", g: "g|grams?",
  gal: "gal|gallons?", l: "l|liters?|litres?", ml: "ml|milliliters?|millilitres?",
  tsp: "tsp|teaspoons?", tbsp: "tbsp|tablespoons?", each: "each|whole|sticks?|pods?|beans?|cubes?|spirals?"
};
const NEGATION = /\b(?:skip|avoid|omit|without|not|no|never|don't|dont|do not|instead of|rather than|leave out|hold off on|drop)\b/;

// "1,200 g" is one number, and a clause is the unit of grounding: an amount,
// its unit and the ingredient have to be stated together, in one clause, for
// the amount to count. Checking them independently let "12.5 lb orange blossom,
// 2.5 lb wildflower" come back with the two amounts swapped and still "grounded".
function replyClauses(reply) {
  const text = String(reply || "").toLowerCase().replace(/(\d),(?=\d{3}\b)/g, "$1");
  return text
    .split(/(?<=[.!?;:])\s+|\n+|,\s+|\s+(?:and|plus|with|but|then)\s+|\s+[-–—]\s+|[()]/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function nameInClause(name, clause) {
  if (!nameIsGrounded(name, clause)) return false;
  // "skip the buckwheat honey", "do not add lactose", "not EC-1118".
  const words = String(name).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const first = Math.min(...words.map((word) => clause.search(new RegExp(`\\b${escapeRegExp(word)}`))).filter((index) => index >= 0));
  return !NEGATION.test(clause.slice(0, Number.isFinite(first) ? first : 0));
}

function amountInClause(value, unit, clause) {
  const text = String(value ?? "").trim();
  if (!text || !/^\d+(?:\.\d+)?$/.test(text)) return "";
  const number = Number(text);
  if (!Number.isFinite(number) || number <= 0 || number > 5000) return "";
  const alias = UNIT_ALIASES[String(unit || "").toLowerCase()];
  if (!alias) return "";
  const variants = new Set([text, String(number), number.toFixed(1), number.toFixed(2)]);
  if (number < 1) variants.add(String(number).replace(/^0/, ""));
  for (const variant of variants) {
    // The figure, optionally the low end of a range ("12 to 15 lb"), then the unit.
    const pattern = new RegExp(`(?<!\\d\\s*(?:to|-|–)\\s*)(^|[^\\d.])${escapeRegExp(variant)}(?:\\s*(?:to|-|–)\\s*\\d+(?:\\.\\d+)?)?\\s*-?\\s*(?:${alias})\\b`);
    if (pattern.test(clause)) return String(number);
  }
  return "";
}

// A flavour or structure addition that the model filed under fermentables.
const NOT_FERMENTABLE = /\b(?:oak|zest|peel|tea|tannin|vanilla|cinnamon|clove|ginger|spice|herb|hops?|pepper|nibs?|coffee|acid|lactose|salt|extract|flowers?|hibiscus|lavender)\b/;
// The Build tab's source types (assets/js/app.js SOURCE_PRESETS).
const APP_SOURCE_TYPES = { honey: "Honey", fruit: "Fruit / Puree", juice: "Juice (single strength)", sugar: "Table Sugar", other: "Custom" };

// The source bill works in lb or kg only; anything else is converted, or the
// amount is dropped rather than seeded in a unit the gravity math ignores.
function toSourceBillUnit(amount, unit) {
  const value = Number(amount);
  if (!amount || !Number.isFinite(value)) return { amount: "", unit: "lb" };
  const round = (n) => String(Math.round(n * 100) / 100);
  switch (String(unit).toLowerCase()) {
    case "lb": return { amount: round(value), unit: "lb" };
    case "kg": return { amount: round(value), unit: "kg" };
    case "oz": return { amount: round(value / 16), unit: "lb" };
    case "g": return { amount: round(value / 1000), unit: "kg" };
    // Juice by volume: about 8.7 lb per US gallon at single strength.
    case "gal": return { amount: round(value * 8.7), unit: "lb" };
    case "l": return { amount: round(value * 1.04), unit: "kg" };
    default: return { amount: "", unit: "lb" };
  }
}

function avoidMentions(name, avoidLower) {
  const clean = String(name || "").toLowerCase().trim();
  return Boolean(clean) && new RegExp(`\\b${escapeRegExp(clean)}\\b`).test(avoidLower);
}

function nameTokens(name) {
  return String(name || "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
}

function groundExtraction(parsed, reply, avoidText = "") {
  const clauses = replyClauses(reply);
  const avoid = String(avoidText || "").toLowerCase();
  const out = { yeast: "", source_bill_candidates: [], adjunct_candidates: [] };
  if (!isPlainObject(parsed)) return out;

  const yeast = KNOWN_YEAST_NAMES.find((name) => name.toLowerCase() === String(parsed.yeast || "").toLowerCase().trim());
  if (yeast) {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(yeast.toLowerCase())}(?![a-z0-9])`);
    const chosen = clauses.some((clause) => {
      const match = pattern.exec(clause);
      return match && !NEGATION.test(clause.slice(0, match.index));
    });
    if (chosen) out.yeast = yeast;
  }

  const kept = [];
  const isDuplicate = (name) => {
    const tokens = nameTokens(name);
    return kept.some((other) => tokens.every((token) => other.includes(token)) || other.every((token) => tokens.includes(token)));
  };
  const unitOf = (value) => {
    const unit = String(value || "").trim().toLowerCase();
    return EXTRACTION_UNITS.has(unit) ? unit : "";
  };
  // Ground one item: the clause that names it (un-negated) and, if the model
  // gave an amount, states that amount with that unit.
  const ground = (name, amount, unit) => {
    const named = clauses.filter((clause) => nameInClause(name, clause));
    if (!named.length) return null;
    for (const clause of named) {
      const found = amountInClause(amount, unit, clause);
      if (found) return { amount: found, unit };
    }
    return { amount: "", unit: "" };
  };

  // Longest names first, so "orange blossom honey" is kept over "orange blossom".
  const byNameLength = (a, b) => String(b.name || b.ingredient || "").length - String(a.name || a.ingredient || "").length;

  (Array.isArray(parsed.source_bill) ? parsed.source_bill.filter(isPlainObject) : []).slice(0, 8).sort(byNameLength).forEach((item) => {
    const name = String(item.name || "").trim();
    if (!name || NOT_FERMENTABLE.test(name.toLowerCase()) || avoidMentions(name, avoid) || isDuplicate(name)) return;
    const grounded = ground(name, item.amount, unitOf(item.unit));
    if (!grounded) return;
    kept.push(nameTokens(name));
    const converted = toSourceBillUnit(grounded.amount, grounded.unit);
    out.source_bill_candidates.push({
      name,
      type: APP_SOURCE_TYPES[String(item.type || "").toLowerCase()] || "Custom",
      amount: converted.amount,
      unit: converted.unit
    });
  });

  (Array.isArray(parsed.adjuncts) ? parsed.adjuncts.filter(isPlainObject) : []).slice(0, 10).sort(byNameLength).forEach((item) => {
    const name = String(item.ingredient || item.name || "").trim();
    const key = name.toLowerCase();
    if (!name || avoidMentions(name, avoid) || isDuplicate(name)) return;
    const unit = unitOf(item.unit);
    const grounded = ground(name, item.amount, unit);
    if (!grounded) return;
    kept.push(nameTokens(name));
    const phase = String(item.phase || "").toLowerCase().trim();
    out.adjunct_candidates.push({
      ingredient: name,
      amount: grounded.amount,
      unit: grounded.amount ? (unit === "l" ? "L" : unit === "ml" ? "mL" : unit) : "g",
      phase: EXTRACTION_PHASES.includes(phase) ? phase : "secondary",
      category: /oak|tannin|tea/.test(key) ? "structure" : /honey|sugar|agave|maple/.test(key) ? "fermentable" : "botanical",
      purpose: "",
      notes: ""
    });
  });

  return out;
}

async function extractStructuredWithModel({ apiKey, model, reply, userMessage, timeoutMs }) {
  const inputs = userMessage.inputs || {};
  const snapshot = userMessage.concept_snapshot || {};
  const content = await callOpenAI({
    apiKey,
    model,
    temperature: 0,
    responseFormat: { type: "json_object" },
    maxTokens: EXTRACTION_MAX_TOKENS,
    timeoutMs,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: `Mentor reply to extract from:\n\n${String(reply).slice(0, MAX_TURN_CHARS)}` }
    ]
  });
  let parsed;
  try { parsed = JSON.parse(content); } catch { return null; }
  // Only a well-formed answer may overrule the pattern extraction.
  if (!isPlainObject(parsed) || !Array.isArray(parsed.source_bill) || !Array.isArray(parsed.adjuncts)) return null;
  const avoidText = `${inputs.avoidSimple || ""} ${Array.isArray(snapshot.avoid) ? snapshot.avoid.join(" ") : ""}`;
  return groundExtraction(parsed, reply, avoidText);
}

// Model-read fields replace the regex result only where the model produced
// something that survived grounding; everything else stays as the regex left it.
function mergeExtraction(regexExtracted, modelExtracted) {
  if (!modelExtracted) return { extracted: regexExtracted, method: "pattern" };
  const build = { ...(regexExtracted.build_mapping || {}) };
  // The model read the whole reply, so an EMPTY list is an answer too ("no
  // adjuncts were recommended"): it replaces whatever the patterns scraped.
  if (modelExtracted.yeast) build.yeast = modelExtracted.yeast;
  build.source_bill_candidates = modelExtracted.source_bill_candidates;
  build.adjunct_candidates = modelExtracted.adjunct_candidates;
  return { extracted: { ...regexExtracted, build_mapping: build }, method: "model" };
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

export async function handler(event) {
  const startedAt = Date.now();
  activeRequestOrigin = resolveAllowedOrigin(event);
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return respond(405, { error: "POST only" });
  }
  if (!originAllowed(event)) {
    return respond(403, { error: "Origin not allowed" });
  }

  const rawBody = event.body || "{}";
  const bodyBytes = event.isBase64Encoded
    ? Math.floor((rawBody.length * 3) / 4)
    : Buffer.byteLength(rawBody, "utf8");
  if (bodyBytes > MAX_BODY_BYTES) {
    return respond(413, { error: "Request too large" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return respond(500, { error: "Mentor backend is not configured." });
  }

  let payload;
  try {
    payload = JSON.parse(event.isBase64Encoded ? Buffer.from(rawBody, "base64").toString("utf8") : rawBody);
  } catch {
    return respond(400, { error: "Invalid JSON body" });
  }

  const model = pinModel(payload.model);
  const history = Array.isArray(payload.conversation_history)
    ? payload.conversation_history.slice(-MAX_HISTORY_TURNS).map((turn) => {
        if (turn && typeof turn === "object") {
          return { ...turn, text: clampTurnText(turn.text ?? turn.content ?? "") };
        }
        return { role: "user", text: clampTurnText(turn) };
      })
    : [];
  const userMessage = {
    mode: payload.mode || "scout",
    blunt: payload.blunt ?? true,
    inputs: payload.beginner_inputs || {},
    concept_snapshot: payload.concept_snapshot || {},
    fallback_packet: payload.fallback_packet || payload.local_packet || {},
    conversation_history: history,
    current_user_turn: clampTurnText(payload.current_user_turn)
  };
  const guidanceNote = buildGuidanceNote(userMessage);
  const knowledgeContext = buildKnowledgePromptBlock(userMessage);
  const knowledgePromptBlock = knowledgeContext.promptBlock;

  try {
    // Where the words came from. The UI used to announce "GPT response received"
    // for every reply, including the ones below that never touch the model.
    let source = "template";
    let collaboratorReply = buildPacketDrivenReply(userMessage);
    if (!collaboratorReply) {
      collaboratorReply = buildEvidenceDrivenReply(userMessage, knowledgeContext);
      if (collaboratorReply) source = "knowledge";
    }
    if (!collaboratorReply) {
      // The limit protects the paid model call, so only requests that reach it
      // count: malformed, template and knowledge-base replies are free.
      const retryAfter = rateLimitRetryAfter(event);
      if (retryAfter) {
        const limited = respond(429, { error: `Too many mentor requests. Try again in about ${Math.ceil(retryAfter / 60)} minute(s).` });
        limited.headers = { ...limited.headers, "Retry-After": String(retryAfter) };
        return limited;
      }
      source = "model";
      collaboratorReply = await generateCollaboratorReply({
        apiKey,
        model,
        userMessage,
        guidanceNote,
        knowledgePromptBlock
      });
      const violations = [
        ...checkHardViolations(collaboratorReply, userMessage),
        ...buildKnowledgeIssues(collaboratorReply, userMessage, knowledgeContext)
      ];
      if (violations.length) {
        const evidenceReply = buildEvidenceDrivenReply(userMessage, knowledgeContext);
        if (evidenceReply) { collaboratorReply = evidenceReply; source = "knowledge"; }
      }
    }

    let extracted = extractStructuredFromProse(collaboratorReply, userMessage);
    let extraction = "pattern";
    const remainingMs = FUNCTION_BUDGET_MS - (Date.now() - startedAt) - 500;
    const wantsExtraction = process.env.MENTOR_STRUCTURED_EXTRACT !== "off"
      && source === "model"
      && replyHasBuildDetail(collaboratorReply);
    if (wantsExtraction && remainingMs >= EXTRACTION_MIN_MS) {
      try {
        // Belt and braces: even if the upstream ignores the abort, the reply
        // already in hand goes out before the function's own deadline.
        let budgetTimer;
        const modelExtracted = await Promise.race([
          extractStructuredWithModel({ apiKey, model, reply: collaboratorReply, userMessage, timeoutMs: remainingMs }),
          new Promise((_, reject) => { budgetTimer = setTimeout(() => reject(new Error("extraction exceeded the time budget")), remainingMs + 100); })
        ]).finally(() => clearTimeout(budgetTimer));
        const merged = mergeExtraction(extracted, modelExtracted);
        extracted = merged.extracted;
        extraction = merged.method;
      } catch (error) {
        // The reply is already in hand; a failed extraction only costs precision.
        console.warn("Structured extraction failed, using pattern extraction:", error?.message || error);
      }
    }

    const body = buildFallbackResponse(userMessage, collaboratorReply, extracted);
    body.provenance = { source, model: source === "model" ? model : "", extraction, mode: String(userMessage.mode || "scout") };
    return respond(200, body);
  } catch (err) {
    console.error("Mentor function error:", err);
    return respond(502, { error: "Mentor backend error. Try again." });
  }
}

// The origin of the request currently being handled, so responses can echo an
// allowlisted origin instead of a blanket wildcard. Set once per invocation;
// Netlify functions handle one request per invocation.
let activeRequestOrigin = "*";

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
    "Access-Control-Allow-Origin": activeRequestOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
