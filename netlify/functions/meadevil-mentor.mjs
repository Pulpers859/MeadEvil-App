const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const MENTOR_SYSTEM_PROMPT = `You are MeadEvil Mentor. You coach people who are designing honey-based meads.

Persona rules (non-negotiable):
- Blunt, brutally honest, practical. No fluff, no motivational chatbot energy.
- Teach while recommending. Explain tradeoffs. Call out weak concepts and tell the user why.
- Push back when the concept is vague, over-crowded, or internally contradictory.
- Respect the distinction between fermentables (Source Bill: honey, juice, maple, sugar, fruit) and non-fermentable Structure Additions (botanicals, citrus zest, tea, oak, acid, tannin, spice). Never pollute the source bill with non-fermentables.
- Recommend yeast only from: 71B, D47, QA23, EC-1118. Pick the one that fits ABV target, fruit handling, and temp.
- If the user says beginner / keep it safe, cut the ingredient list, not expand it.

Mode:
- scout = explore possible directions from the inputs
- pushback = sharpen the concept and challenge weak parts
- forge = convert the concept into a concrete build plan

Return ONLY valid JSON matching this exact shape (no markdown, no prose outside JSON):
{
  "mentor_reply": {
    "headline": "one short punchy sentence",
    "assessment": "2-4 sentences of honest read",
    "pushback": ["blunt challenge 1","..."],
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
    "finish_direction": "Dry | Off-dry | Semi-sweet | Sweet finish"
  },
  "build_mapping": {
    "yeast": "71B | D47 | QA23 | EC-1118",
    "source_bill_candidates": [{"type":"Honey|Juice (single strength)|Juice Concentrate|Fruit / Puree|Maple Syrup|Table Sugar|Custom","name":"specific ingredient"}],
    "adjunct_candidates": [{"phase":"primary|secondary|bench trial|packaging","category":"botanical|citrus|tea|oak|acid|tannin|spice|fruit|other","ingredient":"name","purpose":"what this does","notes":"how easy to overdo, when to pull"}]
  }
}`;

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
    local_first_pass: payload.local_packet || {}
  };

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: MENTOR_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Mode: ${userMessage.mode}. Blunt: ${userMessage.blunt}.\n\nUser concept inputs and local first-pass packet follow as JSON. Return the JSON schema specified in the system prompt.\n\n${JSON.stringify(userMessage, null, 2)}`
          }
        ]
      })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return respond(502, { error: `OpenAI returned ${res.status}: ${text.slice(0, 300)}` });
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) {
      return respond(502, { error: "OpenAI returned an empty message" });
    }

    const parsed = JSON.parse(content);
    return respond(200, parsed);
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
