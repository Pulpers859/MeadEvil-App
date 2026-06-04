import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

function loadEnv(path) {
  const raw = fs.readFileSync(path, "utf8");
  const map = {};
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx === -1) return;
    map[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  });
  return map;
}

const env = loadEnv(path.join(rootDir, ".env.local"));
const apiKey = env.OPENAI_API_KEY;
const LOCAL_URL = `http://127.0.0.1:${env.MEADEVIL_DEV_PORT || 8910}/.netlify/functions/meadevil-mentor`;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY missing from .env.local");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function callOpenAI(messages, model = "gpt-4o", temperature = 0.2, responseFormat = { type: "json_object" }) {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature,
      messages,
      response_format: responseFormat
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI judge failed ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  return JSON.parse(json.choices?.[0]?.message?.content || "{}");
}

async function postMentor(payload) {
  const res = await fetch(LOCAL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Local mentor failed ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

function pushTurn(state, role, text, mode = "scout") {
  state.conversation_history.push({ role, mode, text });
}

function hardFailureChecks(transcript, scenario) {
  const mentorOnly = transcript.filter((turn) => turn.role === "mentor").map((turn) => turn.text).join("\n").toLowerCase();
  const failures = [];

  for (const forbidden of (scenario.forbiddenPhrases || [])) {
    if (mentorOnly.includes(forbidden.toLowerCase())) failures.push(`Forbidden phrase appeared: ${forbidden}`);
  }

  if (/orange blossom honey|mesquite honey|tequila essence|wyeast 1388|k1-v1116|k1v1116/.test(mentorOnly)) {
    failures.push("Invented or off-lane ingredient/yeast appeared.");
  }
  if (/how does that sound|are you ready to proceed|does this align with your vision|feel free to reach out/.test(mentorOnly)) {
    failures.push("Soft tutor-style closing language appeared.");
  }
  if (/(use|add|put|toss|go with)[^.!\n]*(lime zest|lime peel|citrus zest|toasted coconut)[^.!\n]*(primary fermentation|in primary|during primary)|primary fermentation[^.!\n]*(lime zest|lime peel|citrus zest|toasted coconut)/.test(mentorOnly)) {
    failures.push("Primary-fermentation advice was given for aroma-first citrus/coconut moves.");
  }
  return failures;
}

async function judgeConversation(scenario, transcript) {
  return callOpenAI([
    {
      role: "system",
      content: `You are grading a collaborative mead-design conversation.

Score these from 1 to 10:
- content_usefulness
- collaborative_feel
- recipe_partner_confidence
- groundedness

Hard fail conditions:
- inventing ingredients or contradicting the user's concept state
- drifting into generic brewing tutor language
- reopening solved decisions without reason
- process detail too early

Return JSON:
{
  "scores": {
    "content_usefulness": 0,
    "collaborative_feel": 0,
    "recipe_partner_confidence": 0,
    "groundedness": 0
  },
  "pass": true,
  "hard_failures": ["..."],
  "notes": ["..."],
  "overall_read": "short summary"
}`
    },
    {
      role: "user",
      content: `Scenario:
${JSON.stringify({
  name: scenario.name,
  beginner_inputs: scenario.payload.beginner_inputs,
  concept_snapshot: scenario.payload.concept_snapshot
}, null, 2)}

Transcript:
${transcript.map((turn) => `${turn.role.toUpperCase()}: ${turn.text}`).join("\n\n")}`
    }
  ], "gpt-4o", 0);
}

async function runScenario(scenario) {
  const state = clone(scenario.payload);
  const transcript = [...(state.conversation_history || [])];

  for (const userTurn of scenario.turns) {
    state.current_user_turn = userTurn;
    const response = await postMentor(state);
    pushTurn(state, "user", userTurn);
    const mentorText = response.mentor_reply?.conversation_reply || "";
    pushTurn(state, "mentor", mentorText);
    transcript.push({ role: "user", text: userTurn });
    transcript.push({ role: "mentor", text: mentorText });
  }

  const hardFailures = hardFailureChecks(transcript, scenario);
  const judge = await judgeConversation(scenario, transcript);
  const scores = judge.scores || {};
  const pass = !hardFailures.length
    && Number(scores.content_usefulness || 0) >= 9
    && Number(scores.collaborative_feel || 0) >= 9
    && Number(scores.recipe_partner_confidence || 0) >= 9
    && Number(scores.groundedness || 0) >= 9
    && !(Array.isArray(judge.hard_failures) && judge.hard_failures.length);

  return {
    name: scenario.name,
    transcript,
    hardFailures,
    judge,
    pass
  };
}

const scenarios = [
  {
    name: "El Coco Loco",
    forbiddenPhrases: ["orange blossom honey", "mesquite honey", "how does that sound"],
    payload: {
      model: "gpt-4o",
      mode: "scout",
      blunt: true,
      beginner_inputs: {
        conceptName: "The Blood of El Coco Loco",
        style: "Open lane",
        inspiration: "Tequila-inspired coconut mead with agave-like lift and no actual spirits.",
        vision: "Toasted coconut nose, citrus lift, agave illusion in the mid-palate, and a clean non-syrupy finish.",
        serveContext: "Beach in the summer with a refreshing tequila twist.",
        mustHaveSimple: "toasted coconut flakes, agave/tequila",
        avoidSimple: "",
        ingredientsOnHand: "wildflower honey",
        noGo: "cocktail-sweet and muddy",
        skillLevel: "comfortable",
        riskTolerance: "balanced risk",
        processComfort: "secondary additions are fine",
        timePatience: "a few months is fine",
        budget: "normal",
        batchSize: "3",
        targetAbv: "12.5",
        sweetness: "Semi-sweet",
        carbonation: "Still"
      },
      concept_snapshot: {
        summary: "Project: The Blood of El Coco Loco. Inspiration: Tequila-inspired coconut mead with agave-like lift and no actual spirits. Glass target: Toasted coconut nose, citrus lift, agave illusion in the mid-palate, and a clean non-syrupy finish. Serve context: Beach in the summer with a refreshing tequila twist. Must-haves: toasted coconut flakes, agave/tequila. On hand: wildflower honey. Failure condition: cocktail-sweet and muddy. Batch guardrails: 3 gal, 12.5% ABV, Semi-sweet, Still. Process comfort: comfortable, balanced risk, secondary additions are fine, a few months is fine.",
        mustHave: ["toasted coconut", "agave character", "tequila-style lift"],
        avoid: [],
        onHand: ["wildflower honey"],
        honeyMentions: ["wildflower honey"],
        unresolved: { honey: false, serveContext: false, mustHave: false, failureMode: false, structure: false },
        userNeed: "continue_thread"
      },
      fallback_packet: {
        leadImpression: "Build around toasted coconut first with agave tucked underneath.",
        strongestDirection: {
          name: "Toasted coconut leading with agave tucked underneath",
          why: "This keeps the beach/drink illusion cleaner than a sweeter, muddier lane.",
          buildSignal: "Keep the coconut in front and let the honey stay background support."
        },
        ingredientRoles: {
          carries: ["toasted coconut"],
          supports: ["wildflower honey", "agave side"],
          liftStructure: ["lime zest"],
          dangerNotes: ["cocktail sweetness", "muddy finish"]
        },
        nextQuestion: "Do you want the tequila illusion to read brighter through lime, or rounder through the agave side itself?",
        nextStep: "Choose whether the tequila illusion is lime-driven or agave-driven before process planning.",
        pushback: ["Do not let ingredient availability overrule the lane you already said you want."],
        dominantNotes: ["toasted coconut"],
        supportNotes: ["wildflower honey", "agave side"],
        tensionSources: ["lime zest"],
        ruiners: ["cocktail sweetness", "muddy finish"]
      },
      conversation_history: [
        {
          role: "user",
          mode: "concept",
          text: "Project: The Blood of El Coco Loco. Inspiration: Tequila-inspired coconut mead with agave-like lift and no actual spirits. Glass target: Toasted coconut nose, citrus lift, agave illusion in the mid-palate, and a clean non-syrupy finish. Serve context: Beach in the summer with a refreshing tequila twist. Must-haves: toasted coconut flakes, agave/tequila. On hand: wildflower honey. Failure condition: cocktail-sweet and muddy. Batch guardrails: 3 gal, 12.5% ABV, Semi-sweet, Still. Process comfort: comfortable, balanced risk, secondary additions are fine, a few months is fine."
        }
      ]
    },
    turns: [
      "lets get started",
      "brighter through lime",
      "i dont know how to use the lime though, you tell me",
      "i want the agave side visible but not sweet",
      "okay now give me the cleanest fermentation game plan without turning this into a generic beginner handout",
      "good, now pick the yeast for me and tell me why"
    ]
  },
  {
    name: "Strawberry Linden Pet-Nat",
    forbiddenPhrases: ["orange blossom honey", "how does that sound"],
    payload: {
      model: "gpt-4o",
      mode: "scout",
      blunt: true,
      beginner_inputs: {
        conceptName: "Night Shift Blush",
        style: "Hydromel",
        inspiration: "A crisp floral strawberry mead that drinks like bright sparkling rose, not dessert.",
        vision: "Fresh strawberry skin, floral lift, crisp bubbles, and a dry clean finish.",
        serveContext: "Cold after a brutal shift when you want something refreshing, not jammy.",
        mustHaveSimple: "strawberry, linden honey",
        avoidSimple: "jammy, wine cooler, candy sweetness",
        ingredientsOnHand: "linden honey",
        noGo: "fake strawberry and candy sweetness",
        skillLevel: "comfortable",
        riskTolerance: "balanced risk",
        processComfort: "bench trials are fine",
        timePatience: "drink young",
        budget: "normal",
        batchSize: "3",
        targetAbv: "8.5",
        sweetness: "Off-dry",
        carbonation: "Petillant"
      },
      concept_snapshot: {
        summary: "Project: Night Shift Blush. Inspiration: A crisp floral strawberry mead that drinks like bright sparkling rose, not dessert. Glass target: Fresh strawberry skin, floral lift, crisp bubbles, and a dry clean finish. Serve context: Cold after a brutal shift when you want something refreshing, not jammy. Must-haves: strawberry, linden honey. Avoid: jammy, wine cooler, candy sweetness. On hand: linden honey. Failure condition: fake strawberry and candy sweetness. Batch guardrails: 3 gal, 8.5% ABV, Off-dry, Petillant. Process comfort: comfortable, balanced risk, bench trials are fine, drink young.",
        mustHave: ["strawberry", "linden honey"],
        avoid: ["jammy", "wine cooler", "candy sweetness"],
        onHand: ["linden honey"],
        honeyMentions: ["linden honey"],
        unresolved: { honey: false, serveContext: false, mustHave: false, failureMode: false, structure: false },
        userNeed: "continue_thread"
      },
      fallback_packet: {
        leadImpression: "This only works if strawberry stays fresh and the finish stays crisp.",
        strongestDirection: {
          name: "Fresh strawberry carrying the glass while linden stays in support",
          why: "That is the cleanest path to pét-nat energy instead of jammy dessert mead.",
          buildSignal: "Keep floral honey underneath and make every process choice protect freshness."
        },
        ingredientRoles: {
          carries: ["strawberry"],
          supports: ["linden honey"],
          liftStructure: ["petillant sparkle", "clean acid line"],
          dangerNotes: ["jamminess", "wine cooler sweetness"]
        },
        nextQuestion: "Do you want the strawberry reading more like fresh skin and seeds, or a little fuller and rosier?",
        nextStep: "Choose the strawberry expression before process detail.",
        pushback: ["If this gets too sweet or too cooked, the whole concept falls apart."],
        dominantNotes: ["strawberry"],
        supportNotes: ["linden honey"],
        tensionSources: ["petillant sparkle", "clean acid line"],
        ruiners: ["jamminess", "wine cooler sweetness"]
      },
      conversation_history: [
        {
          role: "user",
          mode: "concept",
          text: "Project: Night Shift Blush. Inspiration: A crisp floral strawberry mead that drinks like bright sparkling rose, not dessert. Glass target: Fresh strawberry skin, floral lift, crisp bubbles, and a dry clean finish. Serve context: Cold after a brutal shift when you want something refreshing, not jammy. Must-haves: strawberry, linden honey. Avoid: jammy, wine cooler, candy sweetness. On hand: linden honey. Failure condition: fake strawberry and candy sweetness. Batch guardrails: 3 gal, 8.5% ABV, Off-dry, Petillant. Process comfort: comfortable, balanced risk, bench trials are fine, drink young."
        }
      ]
    },
    turns: [
      "hello, ready?",
      "fresh skin and seeds, not fuller",
      "i dont know whether fruit belongs in primary or secondary, you tell me",
      "petillant and youthful for sure",
      "okay now give me the cleanest process lane without making it taste like wine cooler",
      "good, now pick the yeast for me and keep the sparkle lane clean"
    ]
  },
  {
    name: "Blueberry Juniper Shift Mead",
    forbiddenPhrases: ["orange blossom honey", "how does that sound"],
    payload: {
      model: "gpt-4o",
      mode: "scout",
      blunt: true,
      beginner_inputs: {
        conceptName: "Code Blue Ember",
        style: "Melomel",
        inspiration: "Blueberry and juniper with an electric after-shift edge instead of Christmas candle energy.",
        vision: "Dark berry core, dry snap, lifted aromatics, and a controlled finish.",
        serveContext: "Late-night after a hard shift when you want something dark but still alert.",
        mustHaveSimple: "blueberry, juniper",
        avoidSimple: "christmas candle, syrupy fruit, perfumey florals",
        ingredientsOnHand: "wildflower honey, black tea",
        noGo: "christmas candle and sleepy jam",
        skillLevel: "comfortable",
        riskTolerance: "balanced risk",
        processComfort: "bench trials are fine",
        timePatience: "a few months is fine",
        budget: "normal",
        batchSize: "3",
        targetAbv: "11",
        sweetness: "Off-dry",
        carbonation: "Still"
      },
      concept_snapshot: {
        summary: "Project: Code Blue Ember. Inspiration: Blueberry and juniper with an electric after-shift edge instead of Christmas candle energy. Glass target: Dark berry core, dry snap, lifted aromatics, and a controlled finish. Serve context: Late-night after a hard shift when you want something dark but still alert. Must-haves: blueberry, juniper. Avoid: christmas candle, syrupy fruit, perfumey florals. On hand: wildflower honey, black tea. Failure condition: christmas candle and sleepy jam. Batch guardrails: 3 gal, 11% ABV, Off-dry, Still. Process comfort: comfortable, balanced risk, bench trials are fine, a few months is fine.",
        mustHave: ["blueberry", "juniper"],
        avoid: ["christmas candle", "syrupy fruit", "perfumey florals"],
        onHand: ["wildflower honey", "black tea"],
        honeyMentions: ["wildflower honey"],
        unresolved: { honey: false, serveContext: false, mustHave: false, failureMode: false, structure: false },
        userNeed: "continue_thread"
      },
      fallback_packet: {
        leadImpression: "This only works if blueberry stays dark and focused while juniper stays like a cold accent, not a gin bomb.",
        strongestDirection: {
          name: "Blueberry in front with juniper used like a cold structural accent",
          why: "That gives you dark-fruit identity without tipping into holiday candle territory.",
          buildSignal: "Protect the berry core and treat juniper like structure, not the star."
        },
        ingredientRoles: {
          carries: ["blueberry"],
          supports: ["wildflower honey"],
          liftStructure: ["juniper", "black tea"],
          dangerNotes: ["christmas candle", "sleepy jam"]
        },
        nextQuestion: "Do you want the finish sharpened more by juniper, or by tea and dryness discipline?",
        nextStep: "Choose the sharper edge before committing to process.",
        pushback: ["If juniper gets loud, this stops feeling moody and starts feeling gimmicky."],
        dominantNotes: ["blueberry"],
        supportNotes: ["wildflower honey"],
        tensionSources: ["juniper", "black tea"],
        ruiners: ["christmas candle", "sleepy jam"]
      },
      conversation_history: [
        {
          role: "user",
          mode: "concept",
          text: "Project: Code Blue Ember. Inspiration: Blueberry and juniper with an electric after-shift edge instead of Christmas candle energy. Glass target: Dark berry core, dry snap, lifted aromatics, and a controlled finish. Serve context: Late-night after a hard shift when you want something dark but still alert. Must-haves: blueberry, juniper. Avoid: christmas candle, syrupy fruit, perfumey florals. On hand: wildflower honey, black tea. Failure condition: christmas candle and sleepy jam. Batch guardrails: 3 gal, 11% ABV, Off-dry, Still. Process comfort: comfortable, balanced risk, bench trials are fine, a few months is fine."
        }
      ]
    },
    turns: [
      "lets get started",
      "sharpen it more with tea and dryness discipline",
      "i dont know if tea belongs here though, you tell me",
      "bench trial only sounds right",
      "okay then what yeast lane actually fits this without flattening it",
      "good, now tell me whether blueberry should be fully primary or split with some late-fruit energy"
    ]
  }
];

let consecutivePasses = 0;
for (const scenario of scenarios) {
  const result = await runScenario(scenario);
  console.log(`\n=== ${result.name} ===`);
  console.log(JSON.stringify({
    pass: result.pass,
    hardFailures: result.hardFailures,
    judge: result.judge
  }, null, 2));
  console.log("\nTranscript:");
  result.transcript.forEach((turn) => console.log(`\n${turn.role.toUpperCase()}: ${turn.text}`));
  if (result.pass) {
    consecutivePasses += 1;
  } else {
    consecutivePasses = 0;
  }
}

console.log(`\nConsecutive passing conversations: ${consecutivePasses}`);
