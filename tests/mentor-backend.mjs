/**
 * MeadEvil mentor backend tests — no browser, no network, no API key.
 *
 * The Netlify handler is imported directly and global fetch is replaced with a
 * scripted OpenAI, so these pin the function's own behaviour:
 *   1. Replies that never touch the model say so (provenance)
 *   2. Coach modes send genuinely different instructions
 *   3. Structured extraction: used when grounded in the reply, and anything the
 *      reply does not literally state is dropped
 *   4. Extraction failure, junk JSON or an exhausted time budget never costs the reply
 *   5. Per-address rate limiting
 *
 * Run:  node tests/mentor-backend.mjs
 */
process.env.OPENAI_API_KEY = "test-key";
process.env.MENTOR_RATE_MAX = "6";
delete process.env.MENTOR_ALLOWED_ORIGINS;
const quiet = console.warn; console.warn = () => {};

const { handler } = await import("../netlify/functions/meadevil-mentor.mjs");

const failures = [];
function check(name, ok, detail = "") {
  if (ok) console.log(`  ✅ ${name}`);
  else { console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); failures.push(name); }
}

let calls = [];
let script = [];
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  calls.push(body);
  const next = script.shift();
  if (!next) throw new Error("unscripted OpenAI call");
  if (next.delayMs) await new Promise((r) => setTimeout(r, next.delayMs));
  if (next.fail) return { ok: false, status: 500, text: async () => "boom", json: async () => ({}) };
  return { ok: true, status: 200, text: async () => "", json: async () => ({ choices: [{ message: { content: next.content } }] }) };
};

let ipCounter = 0;
async function ask(payload, { ip } = {}) {
  calls = [];
  const res = await handler({
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": ip || `10.0.0.${++ipCounter}`, origin: "http://localhost" },
    body: JSON.stringify({ model: "gpt-4o-mini", beginner_inputs: { batchSize: "5" }, ...payload })
  });
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) };
}

const DESIGN_TURN = "I want a dry, bright orange blossom traditional with real citrus lift and a clean finish, five gallons, nothing sweet.";
const FORGE_REPLY = "Here is the build. Use 12.5 lb orange blossom honey and 2.5 lb wildflower honey for five gallons, which should land near OG 1.108. Pitch 71B. In secondary add 14 g lemon zest and 0.5 oz medium toast french oak, then bench trial acid.";

console.log("\n[1] Provenance");
script = [];
let r = await ask({ current_user_turn: "hi" });
check("greeting is answered without a model call", calls.length === 0, `${calls.length} calls`);
check("greeting is labelled as a template, not the model", r.body.provenance?.source === "template", JSON.stringify(r.body.provenance));
check("template reply names no model", r.body.provenance?.model === "");
script = [{ content: "My instinct is to keep this lean: orange blossom up front, citrus as lift, and nothing that reads as dessert." }];
r = await ask({ current_user_turn: DESIGN_TURN });
check("a real design turn calls the model once", calls.length === 1, `${calls.length} calls`);
check("...and is labelled as the model", r.body.provenance?.source === "model" && r.body.provenance?.model === "gpt-4o-mini", JSON.stringify(r.body.provenance));
check("a reply with no quantities triggers no extraction call", r.body.provenance?.extraction === "pattern");

console.log("\n[2] Coach modes");
const contextFor = async (mode, extra = {}) => {
  script = [{ content: "Plain reply with no numbers in it at all." }, { content: "{}" }];
  await ask({ current_user_turn: DESIGN_TURN, mode, ...extra });
  return calls[0].messages.map((m) => m.content).join("\n");
};
const scout = await contextFor("scout");
const pushback = await contextFor("pushback");
const forge = await contextFor("forge");
check("scout asks for multiple directions", /SCOUT\./.test(scout) && /two or three genuinely different directions/.test(scout));
check("pushback asks for the weakest decision", /PUSHBACK\./.test(pushback) && /weakest structural decision/.test(pushback));
check("forge asks for concrete numbers", /FORGE\./.test(forge) && /concrete numbers/.test(forge));
check("the three modes send different instructions", new Set([scout, pushback, forge]).size === 3);
check("an unknown mode falls back to scout", /SCOUT\./.test(await contextFor("nonsense")));
check("blunt off reaches the prompt", /gentler delivery/.test(await contextFor("scout", { blunt: false })));
check("blunt on is the default", /Tone: blunt/.test(scout));

console.log("\n[3] Structured extraction is grounded in the reply");
script = [
  { content: FORGE_REPLY },
  { content: JSON.stringify({
      yeast: "71B",
      source_bill: [
        { name: "orange blossom honey", type: "Honey", amount: "12.5", unit: "lb" },
        { name: "wildflower honey", type: "Honey", amount: "2.5", unit: "lb" },
        { name: "buckwheat honey", type: "Honey", amount: "3", unit: "lb" },          // not in the reply
        { name: "wildflower honey", type: "Honey", amount: "15", unit: "lb" }          // duplicate + invented total
      ],
      adjuncts: [
        { ingredient: "lemon zest", amount: "14", unit: "g", phase: "secondary" },
        { ingredient: "french oak", amount: "0.5", unit: "oz", phase: "secondary" },
        { ingredient: "vanilla bean", amount: "2", unit: "each", phase: "secondary" }, // not in the reply
        { ingredient: "acid", amount: "9", unit: "g", phase: "bench trial" }           // named, amount invented
      ]
    }) }
];
r = await ask({ current_user_turn: DESIGN_TURN, mode: "forge" });
const bill = r.body.build_mapping.source_bill_candidates;
const adj = r.body.build_mapping.adjunct_candidates;
check("second call used JSON mode at temperature 0", calls.length === 2 && calls[1].response_format?.type === "json_object" && calls[1].temperature === 0);
check("extraction call is token-capped", calls[1].max_tokens <= 500, String(calls[1].max_tokens));
check("provenance reports model extraction", r.body.provenance?.extraction === "model");
check("both real honeys carried with their own amounts",
  bill.length === 2 && bill[0].amount === "12.5" && bill[1].amount === "2.5", JSON.stringify(bill));
check("a honey the reply never mentioned is dropped", !bill.some((b) => /buckwheat/.test(b.name)));
check("the total is not assigned twice", !bill.some((b) => b.amount === "15"));
check("adjuncts carried with amount, unit and phase",
  adj.some((a) => a.ingredient === "lemon zest" && a.amount === "14" && a.unit === "g")
  && adj.some((a) => a.ingredient === "french oak" && a.amount === "0.5" && a.unit === "oz"), JSON.stringify(adj));
check("an adjunct the reply never mentioned is dropped", !adj.some((a) => /vanilla/.test(a.ingredient)));
check("an invented amount is blanked, the ingredient kept", adj.some((a) => a.ingredient === "acid" && a.amount === ""), JSON.stringify(adj.find((a) => a.ingredient === "acid")));
check("yeast carried", r.body.build_mapping.yeast === "71B");

script = [
  { content: "Use 7.5 lb clover honey and avoid anything smoky. Pitch D47." },
  { content: JSON.stringify({ yeast: "EC-1118", source_bill: [{ name: "clover honey", type: "Honey", amount: "75", unit: "lb" }], adjuncts: [] }) }
];
r = await ask({ current_user_turn: DESIGN_TURN });
check("a number that only resembles one in the reply (75 vs 7.5) is rejected", r.body.build_mapping.source_bill_candidates.every((b) => b.amount !== "75"), JSON.stringify(r.body.build_mapping.source_bill_candidates));
check("a yeast the reply did not choose is rejected", r.body.build_mapping.yeast !== "EC-1118", r.body.build_mapping.yeast);

script = [
  { content: "Use 10 lb orange blossom honey. Skip the mesquite honey entirely. Pitch 71B." },
  { content: JSON.stringify({ yeast: "71B", source_bill: [{ name: "orange blossom honey", type: "Honey", amount: "10", unit: "lb" }, { name: "mesquite honey", type: "Honey", amount: "", unit: "lb" }], adjuncts: [] }) }
];
r = await ask({ current_user_turn: DESIGN_TURN, beginner_inputs: { avoidSimple: "mesquite honey", batchSize: "5" } });
check("an ingredient on the user's avoid list is not sent to Build", !r.body.build_mapping.source_bill_candidates.some((b) => /mesquite/.test(b.name)), JSON.stringify(r.body.build_mapping.source_bill_candidates));

console.log("\n[4] Extraction can never cost the reply");
script = [{ content: FORGE_REPLY }, { fail: true }];
r = await ask({ current_user_turn: DESIGN_TURN, mode: "forge" });
check("upstream error on extraction still returns the reply", r.status === 200 && r.body.mentor_reply.conversation_reply.includes("12.5 lb"));
check("...and falls back to pattern extraction", r.body.provenance?.extraction === "pattern");
script = [{ content: FORGE_REPLY }, { content: "not json at all" }];
r = await ask({ current_user_turn: DESIGN_TURN, mode: "forge" });
check("junk JSON still returns the reply", r.status === 200 && r.body.provenance?.extraction === "pattern");
script = [{ content: FORGE_REPLY }, { content: JSON.stringify({ source_bill: "nope", adjuncts: [null, 4, {}], yeast: 12 }) }];
r = await ask({ current_user_turn: DESIGN_TURN, mode: "forge" });
check("wrong-shaped JSON does not crash", r.status === 200 && r.body.provenance?.extraction === "pattern", JSON.stringify(r.body.provenance));
script = [{ content: FORGE_REPLY, delayMs: 7800 }];
r = await ask({ current_user_turn: DESIGN_TURN, mode: "forge" });
check("a slow first call skips extraction instead of risking the timeout", r.status === 200 && calls.length === 1, `${calls.length} calls`);

console.log("\n[5] Rate limiting");
script = [];
let last;
for (let i = 0; i < 6; i += 1) last = await ask({ current_user_turn: "hi" }, { ip: "203.0.113.9" });
check("requests under the limit succeed", last.status === 200, String(last.status));
last = await ask({ current_user_turn: "hi" }, { ip: "203.0.113.9" });
check("the next one is refused with 429", last.status === 429, String(last.status));
check("429 carries Retry-After", Number(last.headers["Retry-After"]) > 0);
last = await ask({ current_user_turn: "hi" }, { ip: "203.0.113.10" });
check("a different address is unaffected", last.status === 200);

console.warn = quiet;
console.log("\n" + "=".repeat(50));
if (failures.length) { console.log(`MENTOR BACKEND: ${failures.length} FAILURE(S)`); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
console.log("ALL MENTOR BACKEND CHECKS PASSED");
