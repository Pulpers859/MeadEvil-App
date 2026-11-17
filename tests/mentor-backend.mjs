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
  return { ok: true, status: 200, text: async () => "", json: async () => {
    if (next.bodyDelayMs) await new Promise((r) => setTimeout(r, next.bodyDelayMs));
    return { choices: [{ message: { content: next.content } }] };
  } };
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
const MODEL_LINE = "My instinct is to keep this lean and bright, with citrus as lift.";
let last;
for (let i = 0; i < 6; i += 1) { script = [{ content: MODEL_LINE }]; last = await ask({ current_user_turn: DESIGN_TURN }, { ip: "203.0.113.9" }); }
check("model requests under the limit succeed", last.status === 200, String(last.status));
script = [{ content: MODEL_LINE }];
last = await ask({ current_user_turn: DESIGN_TURN }, { ip: "203.0.113.9" });
check("the next model request is refused with 429", last.status === 429 && calls.length === 0, `${last.status}/${calls.length}`);
check("429 carries Retry-After", Number(last.headers["Retry-After"]) > 0);
script = [];
last = await ask({ current_user_turn: "hi" }, { ip: "203.0.113.9" });
check("a template reply costs no quota and still answers", last.status === 200, String(last.status));
script = [{ content: MODEL_LINE }];
last = await ask({ current_user_turn: DESIGN_TURN }, { ip: "203.0.113.10" });
check("a different address is unaffected", last.status === 200);
// Rotating a caller-supplied header must not mint fresh quota.
let spoofed = 0;
for (let i = 0; i < 70; i += 1) {
  script = [{ content: MODEL_LINE }];
  const res = await handler({ httpMethod: "POST", headers: { "x-forwarded-for": `198.51.100.${i}`, origin: "http://localhost" },
    body: JSON.stringify({ model: "gpt-4o-mini", beginner_inputs: { batchSize: "5" }, current_user_turn: DESIGN_TURN }) });
  if (res.statusCode === 429) spoofed += 1;
}
check("rotating X-Forwarded-For does not escape the limit", spoofed === 10, String(spoofed));

console.log("\n[6] Second-audit grounding cases");
const extract = async (reply, json, extra = {}) => {
  script = [{ content: reply }, { content: JSON.stringify(json) }];
  const res = await ask({ current_user_turn: DESIGN_TURN, mode: "forge", ...extra });
  return res.body.build_mapping;
};
const amt = (list, re) => { const hit = list.find((x) => re.test(x.name || x.ingredient)); return hit ? `${hit.amount}${hit.amount ? hit.unit : ""}` : "absent"; };
let m = await extract(FORGE_REPLY, { yeast: "71B",
  source_bill: [{ name: "orange blossom honey", type: "Honey", amount: "2.5", unit: "lb" }, { name: "wildflower honey", type: "Honey", amount: "12.5", unit: "lb" }],
  adjuncts: [{ ingredient: "lemon zest", amount: "0.5", unit: "oz", phase: "secondary" }, { ingredient: "french oak", amount: "14", unit: "oz", phase: "primary" }] });
check("swapped honey amounts are not accepted", amt(m.source_bill_candidates, /orange/) === "" && amt(m.source_bill_candidates, /wildflower/) === "", JSON.stringify(m.source_bill_candidates));
check("swapped adjunct amounts and units are not accepted", amt(m.adjunct_candidates, /zest/) === "" && amt(m.adjunct_candidates, /oak/) === "", JSON.stringify(m.adjunct_candidates));

m = await extract("Plan a 5 gallon batch with 14 lb clover honey. Ferment at 62 F. In secondary add 30 g toasted coconut.", { yeast: "",
  source_bill: [{ name: "clover honey", type: "Honey", amount: "5", unit: "lb" }],
  adjuncts: [{ ingredient: "toasted coconut", amount: "30", unit: "lb", phase: "secondary" }, { ingredient: "coconut", amount: "62", unit: "g", phase: "secondary" }] });
check("batch size is not read as honey weight", amt(m.source_bill_candidates, /clover/) === "", JSON.stringify(m.source_bill_candidates));
check("a right number with the wrong unit is rejected; temperature is not an amount", m.adjunct_candidates.every((a) => a.amount === ""), JSON.stringify(m.adjunct_candidates));
check("coconut is listed once", m.adjunct_candidates.length === 1, JSON.stringify(m.adjunct_candidates));

m = await extract("Use 12 lb orange blossom honey. Skip the buckwheat honey. Do not add lactose. Pitch 71B, not EC-1118.", { yeast: "EC-1118",
  source_bill: [{ name: "orange blossom honey", type: "Honey", amount: "12", unit: "lb" }, { name: "buckwheat honey", type: "Honey", amount: "12", unit: "lb" }],
  adjuncts: [{ ingredient: "lactose", amount: "12", unit: "oz", phase: "secondary" }] });
check("ingredients the reply says to skip are dropped", m.source_bill_candidates.length === 1 && m.adjunct_candidates.length === 0, JSON.stringify(m));
check("a yeast the reply rules out is not chosen", m.yeast !== "EC-1118", m.yeast);

m = await extract("Go with 12 to 15 lb wildflower honey and 1,200 g blueberries in secondary.", { yeast: "",
  source_bill: [{ name: "wildflower honey", type: "Honey", amount: "15", unit: "lb" }, { name: "blueberries", type: "Fruit", amount: "200", unit: "g" }], adjuncts: [] });
check("the top of a range and a comma-split number are rejected", amt(m.source_bill_candidates, /wildflower/) === "" && amt(m.source_bill_candidates, /blueberr/) === "", JSON.stringify(m.source_bill_candidates));
m = await extract("Go with 12 to 15 lb wildflower honey and 1,200 g blueberries in secondary.", { yeast: "",
  source_bill: [{ name: "wildflower honey", type: "Honey", amount: "12", unit: "lb" }, { name: "blueberries", type: "Fruit", amount: "1200", unit: "g" }], adjuncts: [] });
check("the low end of a range is accepted", amt(m.source_bill_candidates, /wildflower/) === "12lb", JSON.stringify(m.source_bill_candidates));
check("1,200 g is one number, converted for the source bill", amt(m.source_bill_candidates, /blueberr/) === "1.2kg", JSON.stringify(m.source_bill_candidates));
check("fruit is typed as the app's Fruit / Puree", m.source_bill_candidates.find((b) => /blueberr/.test(b.name))?.type === "Fruit / Puree");

m = await extract("Use 15 lb of orange blossom honey; the honey should be raw.", { yeast: "",
  source_bill: [{ name: "orange blossom honey", type: "Honey", amount: "15", unit: "lb" }, { name: "Orange Blossom", type: "Honey", amount: "15", unit: "lb" }], adjuncts: [] });
check("the same honey under two names is one row", m.source_bill_candidates.length === 1 && m.source_bill_candidates[0].amount === "15", JSON.stringify(m.source_bill_candidates));

m = await extract("Add 6 lb tart cherries and 1 gal apple juice up front, 8 oz lactose at the end, plus 1 oz medium toast oak cubes.", { yeast: "",
  source_bill: [{ name: "oak cubes", type: "Sugar", amount: "6", unit: "lb" }, { name: "tart cherries", type: "Fruit", amount: "6", unit: "lb" }, { name: "apple juice", type: "Juice", amount: "1", unit: "gal" }],
  adjuncts: [{ ingredient: "oak cubes", amount: "1", unit: "oz", phase: "secondary" }] });
check("oak never lands in the fermentable bill", !m.source_bill_candidates.some((b) => /oak/.test(b.name)), JSON.stringify(m.source_bill_candidates));
check("juice by the gallon becomes pounds the gravity math can use", amt(m.source_bill_candidates, /juice/) === "8.7lb" && m.source_bill_candidates.find((b) => /juice/.test(b.name)).type === "Juice (single strength)", JSON.stringify(m.source_bill_candidates));
check("oak keeps its own amount as an adjunct", amt(m.adjunct_candidates, /oak/) === "1oz", JSON.stringify(m.adjunct_candidates));

m = await extract("Use 12 lb orange blossom honey. Keep it clean: no zest, no spice.", { yeast: "", source_bill: [{ name: "orange blossom honey", type: "Honey", amount: "12", unit: "lb" }], adjuncts: [] });
check("an empty adjunct list from the model overrides pattern guesses", m.adjunct_candidates.length === 0, JSON.stringify(m.adjunct_candidates));
m = await extract("Use 12 lb orange blossom honey and 20 g lime zest in secondary.", { yeast: "", source_bill: [{ name: "orange blossom honey", type: "Honey", amount: "12", unit: "lb" }], adjuncts: [{ ingredient: "lime zest", amount: "20", unit: "g", phase: "secondary" }] },
  { beginner_inputs: { avoidSimple: "sublime zesty soda", batchSize: "5" } });
check("the avoid list matches whole phrases, not substrings", amt(m.adjunct_candidates, /lime zest/) === "20g", JSON.stringify(m.adjunct_candidates));

console.log("\n[7] Time budget");
script = [{ content: "Keep it lean and bright; honey forward, nothing sweet." }];
r = await ask({ current_user_turn: DESIGN_TURN, mode: "forge" });
check("Forge with nothing to extract makes one call, not two", r.status === 200 && calls.length === 1, `${calls.length} calls`);
script = [{ content: FORGE_REPLY, delayMs: 5000 }, { content: "{}", bodyDelayMs: 9000 }];
let t0 = Date.now();
r = await ask({ current_user_turn: DESIGN_TURN, mode: "forge" });
check("a stalled extraction body cannot run past the budget", r.status === 200 && Date.now() - t0 < 9500, `${Date.now() - t0} ms`);
check("...and the reply still goes out", r.body.mentor_reply.conversation_reply.includes("12.5 lb"));

console.log("\n[8] Third-audit grounding cases");
const two = (a, b) => ({ yeast: "", source_bill: [{ name: "orange blossom honey", type: "Honey", amount: a, unit: "lb" }, { name: "wildflower honey", type: "Honey", amount: b, unit: "lb" }], adjuncts: [] });
for (const joiner of ["over", "+", "&", "as well as", "or"]) {
  m = await extract(`Use 12.5 lb orange blossom honey ${joiner} 2.5 lb wildflower honey.`, two("2.5", "12.5"));
  check(`swapped amounts rejected across "${joiner}"`, amt(m.source_bill_candidates, /orange/) === "" && amt(m.source_bill_candidates, /wildflower/) === "", JSON.stringify(m.source_bill_candidates));
}
m = await extract("Use 12.5 lb orange blossom honey over 2.5 lb wildflower honey.", two("12.5", "2.5"));
check("...and the right amounts are still accepted", amt(m.source_bill_candidates, /orange/) === "12.5lb" && amt(m.source_bill_candidates, /wildflower/) === "2.5lb", JSON.stringify(m.source_bill_candidates));
m = await extract("Add 14 g lemon zest to 12 lb wildflower honey.", { yeast: "", source_bill: [{ name: "wildflower honey", type: "Honey", amount: "14", unit: "g" }], adjuncts: [{ ingredient: "lemon zest", amount: "12", unit: "lb", phase: "secondary" }] });
check("amounts do not cross between an adjunct and a honey", amt(m.source_bill_candidates, /wildflower/) === "" && amt(m.adjunct_candidates, /zest/) === "", JSON.stringify(m));
for (const text of ["Use 12 lb wildflower honey instead of 15 lb buckwheat honey.", "Use 12 lb wildflower honey rather than 15 lb buckwheat honey.", "Use 12 lb wildflower honey. You shouldn't use 15 lb buckwheat honey.", "Use 12 lb wildflower honey. Don’t add 15 lb buckwheat honey.", "Use 12 lb wildflower honey. Ditch the 15 lb buckwheat honey.", "Use 12 lb wildflower honey. 15 lb buckwheat honey is too much; skip it."]) {
  m = await extract(text, { yeast: "", source_bill: [{ name: "wildflower honey", type: "Honey", amount: "12", unit: "lb" }, { name: "buckwheat honey", type: "Honey", amount: "15", unit: "lb" }], adjuncts: [] });
  check(`ruled out: "${text.slice(27, 60)}…"`, m.source_bill_candidates.length === 1 && amt(m.source_bill_candidates, /wildflower/) === "12lb", JSON.stringify(m.source_bill_candidates));
}
m = await extract("Instead of 15 lb clover honey use 12 lb wildflower honey.", { yeast: "", source_bill: [{ name: "wildflower honey", type: "Honey", amount: "12", unit: "lb" }, { name: "clover honey", type: "Honey", amount: "15", unit: "lb" }], adjuncts: [] });
check("the replacement survives an 'instead of X use Y' sentence", m.source_bill_candidates.length === 1 && amt(m.source_bill_candidates, /wildflower/) === "12lb", JSON.stringify(m.source_bill_candidates));
script = [{ content: "I would skip 71B for this gravity; pitch EC-1118 and use 15 lb clover honey." }, { content: JSON.stringify({ yeast: "", source_bill: [], adjuncts: [] }) }];
r = await ask({ current_user_turn: DESIGN_TURN, mode: "forge" });
check("a ruled-out yeast is not picked up by the pattern fallback", r.body.build_mapping.yeast !== "71B", String(r.body.build_mapping.yeast));
for (const [text, wrong] of [["Add 1/2 oz oak cubes in secondary.", "2"], ["Add 1 1/2 oz oak cubes in secondary.", "2"], ["Add 10-12 oz oak cubes in secondary.", "12"], ["Add 12 or 15 oz oak cubes in secondary.", "15"]]) {
  m = await extract(text, { yeast: "", source_bill: [], adjuncts: [{ ingredient: "oak cubes", amount: wrong, unit: "oz", phase: "secondary" }] });
  check(`"${text.slice(4, 12)}" does not ground ${wrong}`, amt(m.adjunct_candidates, /oak/) === "", JSON.stringify(m.adjunct_candidates));
}
m = await extract("Use 1,5 kg raspberries.", { yeast: "", source_bill: [{ name: "raspberries", type: "Fruit", amount: "5", unit: "kg" }], adjuncts: [] });
check("a decimal comma does not ground the digits after it", amt(m.source_bill_candidates, /rasp/) === "", JSON.stringify(m.source_bill_candidates));
m = await extract("The bill:\n- Wildflower honey: 12 lb\n- Orange blossom honey (2.5 lb)\n- 3 lbs. of tart cherry puree\n- 12 lb (5.4 kg) clover honey", { yeast: "",
  source_bill: [{ name: "wildflower honey", type: "Honey", amount: "12", unit: "lb" }, { name: "orange blossom honey", type: "Honey", amount: "2.5", unit: "lb" }, { name: "tart cherry puree", type: "Fruit", amount: "3", unit: "lb" }, { name: "clover honey", type: "Honey", amount: "12", unit: "lb" }], adjuncts: [] });
check("colon lists, brackets, 'lbs. of' and a metric aside all ground", ["wildflower:12lb", "orange:2.5lb", "cherry:3lb", "clover:12lb"].every((pair) => { const [k, v] = pair.split(":"); return amt(m.source_bill_candidates, new RegExp(k)) === v; }), JSON.stringify(m.source_bill_candidates));
m = await extract("Use 15 lb wildflower honey for 5 gal, plus 2 lb maple syrup, 1 lb apple juice concentrate, 1 gal apple juice and 4 gal spring water. Add 6 lb lavender honey.", { yeast: "",
  source_bill: [{ name: "wildflower honey", type: "Honey", amount: "5", unit: "gal" }, { name: "maple syrup", type: "Sugar", amount: "2", unit: "lb" }, { name: "apple juice concentrate", type: "Juice", amount: "1", unit: "lb" }, { name: "spring water", type: "Other", amount: "4", unit: "gal" }, { name: "lavender honey", type: "Honey", amount: "6", unit: "lb" }], adjuncts: [] });
const typeOf = (re) => m.source_bill_candidates.find((b) => re.test(b.name))?.type;
check("batch size is not bound to the honey", amt(m.source_bill_candidates, /wildflower/) === "", JSON.stringify(m.source_bill_candidates));
check("maple and concentrate get their own source types", typeOf(/maple/) === "Maple Syrup" && typeOf(/concentrate/) === "Juice Concentrate", `${typeOf(/maple/)}/${typeOf(/concentrate/)}`);
check("water is not a fermentable; a honey named after a flower is", !m.source_bill_candidates.some((b) => /water/.test(b.name)) && amt(m.source_bill_candidates, /lavender/) === "6lb", JSON.stringify(m.source_bill_candidates));
m = await extract("Use 12 lb orange blossom honey, 2 oz french oak cubes, 10 g orange zest and 2 lb raspberries.", { yeast: "",
  source_bill: [{ name: "orange blossom honey", type: "Honey", amount: "12", unit: "lb" }, { name: "raspberries", type: "Fruit", amount: "2", unit: "lb" }],
  adjuncts: [{ ingredient: "french oak cubes", amount: "2", unit: "oz", phase: "secondary" }, { ingredient: "orange zest", amount: "10", unit: "g", phase: "secondary" }] },
  { beginner_inputs: { avoidSimple: "oak, no orange, raspberry", batchSize: "5" } });
check("avoid terms block by word, plural or not", m.adjunct_candidates.length === 0 && !m.source_bill_candidates.some((b) => /rasp/.test(b.name)), JSON.stringify(m));
check("...but 'orange' does not veto orange blossom honey", amt(m.source_bill_candidates, /orange blossom/) === "12lb", JSON.stringify(m.source_bill_candidates));
script = [{ content: MODEL_LINE, delayMs: 12000 }];
t0 = Date.now();
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => Promise.race([realFetch(url, init), new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))]);
r = await ask({ current_user_turn: DESIGN_TURN });
globalThis.fetch = realFetch;
check("a hung main call fails inside the function budget", Date.now() - t0 < 9500 && r.status === 504, `${Date.now() - t0} ms / ${r.status}`);
check("...and says it was a timeout", /too long/.test(r.body.error || ""), r.body.error);

console.log("\n[9] Fourth-audit grounding cases");
const honeyCherry = { yeast: "71B", source_bill: [{ name: "wildflower honey", type: "Honey", amount: "12", unit: "lb" }, { name: "tart cherry puree", type: "Fruit", amount: "3", unit: "lb" }], adjuncts: [] };
for (const text of ["No need to heat the 12 lb wildflower honey. Add 3 lb tart cherry puree in secondary and pitch 71B.",
  "You can't go wrong with 12 lb wildflower honey. Add 3 lb tart cherry puree in secondary.",
  "Don't forget the 12 lb wildflower honey. Add 3 lb tart cherry puree in secondary.",
  "There is no substitute for 12 lb wildflower honey here. Add 3 lb tart cherry puree in secondary."]) {
  m = await extract(text, honeyCherry);
  check(`not a negation: "${text.slice(0, 28)}…"`, amt(m.source_bill_candidates, /wildflower/) === "12lb", JSON.stringify(m.source_bill_candidates));
}
m = await extract("Use 3 lb wildflower honey per gallon (15 lb total).", { yeast: "", source_bill: [{ name: "wildflower honey", type: "Honey", amount: "3", unit: "lb" }], adjuncts: [] });
check("a per-gallon rate is not taken as the bill", amt(m.source_bill_candidates, /wildflower/) === "", JSON.stringify(m.source_bill_candidates));
m = await extract("Use 12 lb total of orange blossom and wildflower honey.", two("12", ""));
check("a shared total is not one honey's amount", amt(m.source_bill_candidates, /orange/) === "", JSON.stringify(m.source_bill_candidates));
m = await extract("Build it on wildflower honey, 2 lb tart cherry puree in secondary.", { yeast: "", source_bill: [{ name: "wildflower honey", type: "Honey", amount: "2", unit: "lb" }, { name: "tart cherry puree", type: "Fruit", amount: "2", unit: "lb" }], adjuncts: [] });
check("the next item's amount is not borrowed", amt(m.source_bill_candidates, /wildflower/) === "" && amt(m.source_bill_candidates, /cherry/) === "2lb", JSON.stringify(m.source_bill_candidates));
for (const text of ["Replace the 3 lb buckwheat honey with 3 lb orange blossom honey.", "Use 3 lb orange blossom honey; 3 lb buckwheat honey would bury the citrus.",
  "Use 3 lb orange blossom honey. The buckwheat honey you planned is too strong.", "Use 3 lb orange blossom honey and leave the buckwheat honey out.",
  "Use 3 lb orange blossom honey. Swap the buckwheat honey for something lighter.", "Use 3 lb orange blossom honey. Buckwheat honey is a bad idea here."]) {
  m = await extract(text, { yeast: "", source_bill: [{ name: "orange blossom honey", type: "Honey", amount: "3", unit: "lb" }, { name: "buckwheat honey", type: "Honey", amount: "3", unit: "lb" }], adjuncts: [] });
  check(`ruled out: "${text.slice(0, 40)}…"`, !m.source_bill_candidates.some((b) => /buckwheat/.test(b.name)) && amt(m.source_bill_candidates, /orange/) === "3lb", JSON.stringify(m.source_bill_candidates));
}
for (const text of ["EC-1118 is too aggressive here, so 71B is the better pick.", "EC-1118 would strip the aromatics; go with 71B.", "EC-1118 is overkill here. Pitch 71B.", "Unlike EC-1118, 71B keeps the fruit.", "Pick 71B over EC-1118."]) {
  m = await extract(text, { yeast: "EC-1118", source_bill: [], adjuncts: [] });
  check(`ruled-out yeast rejected: "${text.slice(0, 30)}…"`, m.yeast !== "EC-1118", m.yeast);
  m = await extract(text, { yeast: "", source_bill: [], adjuncts: [] });
  check(`...and the fallback picks 71B`, m.yeast === "71B", m.yeast);
}
m = await extract("QA23 is cleaner than D47 at warm temps; use QA23.", { yeast: "", source_bill: [], adjuncts: [] });
check("fallback yeast follows the reply, not list order", m.yeast === "QA23", m.yeast);

console.log("\n[10] Fifth-audit grounding cases");
const ob = { yeast: "", source_bill: [{ name: "orange blossom honey", type: "Honey", amount: "12", unit: "lb" }], adjuncts: [] };
for (const text of ["Replace the clover honey with 12 lb orange blossom honey.", "Swap in 12 lb orange blossom honey.", "Swap to 12 lb orange blossom honey.", "I'd swap the clover for 12 lb orange blossom honey."]) {
  m = await extract(text, { ...ob, source_bill: ob.source_bill.concat([{ name: "clover honey", type: "Honey", amount: "", unit: "lb" }]) });
  check(`the replacement is kept: "${text.slice(0, 34)}…"`, amt(m.source_bill_candidates, /orange/) === "12lb" && !m.source_bill_candidates.some((b) => /clover/.test(b.name)), JSON.stringify(m.source_bill_candidates));
}
for (const text of ["With a gravity over 1.100 pitch EC-1118.", "Ferment cooler than 65F with EC-1118.", "Step-feed nutrients over the first week for EC-1118."]) {
  m = await extract(text, { yeast: "EC-1118", source_bill: [], adjuncts: [] });
  check(`ordinary over/than does not rule out a yeast: "${text.slice(0, 28)}…"`, m.yeast === "EC-1118", m.yeast);
}
for (const [text, re, want] of [
  ["12 lb orange blossom honey is too good to bury under spice.", /orange/, "12lb"],
  ["The 3 lb tart cherry puree is too early to judge, but add it in secondary.", /cherry/, "3lb"],
  ["If the 12 lb wildflower honey seems too thin, add a pound.", /wildflower/, "12lb"],
  ["Use 12 lb wildflower honey out of the jar.", /wildflower/, "12lb"]]) {
  const name = re.source === "orange" ? "orange blossom honey" : re.source === "cherry" ? "tart cherry puree" : "wildflower honey";
  m = await extract(text, { yeast: "", source_bill: [{ name, type: re.source === "cherry" ? "Fruit" : "Honey", amount: want.replace("lb", ""), unit: "lb" }], adjuncts: [] });
  check(`kept: "${text.slice(0, 36)}…"`, amt(m.source_bill_candidates, re) === want, JSON.stringify(m.source_bill_candidates));
}
m = await extract("Use 12 lb wildflower honey. 2 oz oak cubes will dominate early but fade; keep them.", { yeast: "", source_bill: [], adjuncts: [{ ingredient: "oak cubes", amount: "2", unit: "oz", phase: "secondary" }] });
check("'will dominate early but ... keep them' keeps the oak", amt(m.adjunct_candidates, /oak/) === "2oz", JSON.stringify(m.adjunct_candidates));
m = await extract("71B is too forgiving to pass up here.", { yeast: "71B", source_bill: [], adjuncts: [] });
check("'too forgiving to pass up' keeps the yeast", m.yeast === "71B", m.yeast);

console.warn = quiet;
console.log("\n" + "=".repeat(50));
if (failures.length) { console.log(`MENTOR BACKEND: ${failures.length} FAILURE(S)`); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
console.log("ALL MENTOR BACKEND CHECKS PASSED");
