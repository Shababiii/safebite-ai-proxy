// SafeBite AI proxy (Vercel serverless function).
// The iPhone app sends label text here. This function adds the OpenAI key
// (stored as a Vercel environment variable, never in the app or on GitHub),
// asks OpenAI for structured nutrition fields, and returns OpenAI's reply.

const MODEL = "gpt-4o-mini";
const MAX_TEXT_LENGTH = 8000;

const SYSTEM_PROMPT = `You read the OCR text of ONE food Nutrition Facts label and return its values.

Rules:
- Use only numbers that are written in the text. Never estimate, calculate or guess.
- If a value is not clearly in the text, return null. Never return 0 for "missing".
- Labels can be bilingual (for example "Calories / Calorias 160" or the same line repeated in Spanish or French). That is ONE value; return it once.
- Use the amount per serving. Ignore "% Daily Value" numbers and "per container" numbers. Set basis to "per_serving", "per_100g" or "per_container" for the column you used, or null if unclear.
- Claims such as "No Added Sugar" or "Low Fat" are not values.
- Units: calories in kcal; fats, carbohydrate, fiber, sugars, protein in g; cholesterol and sodium in mg. Do not convert units; if the label uses a different unit for a field, return null for it.
- The text may be out of order, cut off or contain OCR mistakes. When unsure, null.`;

const NUMERIC_FIELDS = [
  "calories", "totalFat", "saturatedFat", "transFat", "cholesterol",
  "sodium", "totalCarbohydrate", "dietaryFiber", "totalSugars",
  "addedSugars", "protein",
];

function buildSchema() {
  const properties = {
    basis: { type: ["string", "null"] },
    servingSize: { type: ["string", "null"] },
  };
  for (const name of NUMERIC_FIELDS) properties[name] = { type: ["number", "null"] };
  return {
    type: "object",
    properties,
    required: Object.keys(properties).sort(),
    additionalProperties: false,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  // Simple shared token so random people on the internet cannot spend our credits.
  const expectedToken = process.env.APP_TOKEN;
  if (expectedToken && req.headers["x-app-token"] !== expectedToken) {
    return res.status(401).json({ error: "bad app token" });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "OPENAI_API_KEY is not set on the server" });
  }

  const text = req.body && req.body.text;
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: "send {\"text\": \"...\"} (1 to 8000 characters)" });
  }

  try {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: "OCR text:\n" + text },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "nutrition_label", strict: true, schema: buildSchema() },
        },
      }),
    });

    const body = await upstream.text();
    if (!upstream.ok) {
      // Pass OpenAI's error message through (it never contains our key) so problems like
      // "insufficient_quota" or "invalid_api_key" are easy to diagnose.
      return res.status(502).json({ error: "openai_error", status: upstream.status, detail: body.slice(0, 500) });
    }
    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(body);
  } catch (e) {
    return res.status(502).json({ error: "could_not_reach_openai" });
  }
};

module.exports._test = { buildSchema, NUMERIC_FIELDS };
