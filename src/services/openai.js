const MODEL = "gpt-5.4-mini";
const MODEL_FALLBACK = "gpt-4o-mini";

async function chatCompletion({ messages, responseFormat, model = MODEL }) {
  const body = {
    model,
    messages,
    temperature: 0.2
  };
  if (responseFormat) {
    body.response_format = responseFormat;
  }

  let response = await fetch("/api/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok && model !== MODEL_FALLBACK) {
    body.model = MODEL_FALLBACK;
    response = await fetch("/api/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || `OpenAI request failed (${response.status})`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from OpenAI");
  }
  return content;
}

export function makePairKey(manufacturer, model) {
  const mfg = (manufacturer ?? "").toString().trim() || "Unknown";
  const mdl = (model ?? "").toString().trim() || "Unknown";
  return `${mfg} | ${mdl}`;
}

export function extractUniquePairs(rows) {
  const seen = new Set();
  const pairs = [];
  for (const row of rows) {
    const manufacturer = row.manufacturer?.trim() || "";
    const model = row.model?.trim() || "";
    const key = makePairKey(manufacturer, model);
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push({ manufacturer, model, key });
    }
  }
  return pairs;
}

export async function fetchDeviceTypesBatch(pairsToFetch) {
  if (!pairsToFetch.length) return {};

  const pairList = pairsToFetch.map((p) => p.key);

  const systemPrompt = `You are a medical equipment taxonomy expert. You will receive a JSON array of unique manufacturer-model keys formatted as "Manufacturer | Model".

Classify each pair into a concise medical device type (e.g. "Patient Monitor", "Infusion Pump", "Defibrillator", "Ventilator", "Surgical Light", "Exam Table").

You MUST return a single raw JSON object only (no markdown, no prose). Each key must exactly match the input string "Manufacturer | Model" and each value must be the device type string.`;

  const content = await chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({ pairs: pairList })
      }
    ],
    responseFormat: { type: "json_object" }
  });

  const parsed = JSON.parse(content);
  const mapping = parsed.classifications || parsed.device_types || parsed;

  if (typeof mapping !== "object" || mapping === null) {
    throw new Error("Invalid JSON shape from device type batch");
  }

  return mapping;
}

export async function askDataAssistant(question, dataContext) {
  const systemPrompt = `You are a helpful analyst for a medical equipment inventory dataset. Answer questions using ONLY the provided data summary. Be concise and cite numbers when possible. If the data does not contain the answer, say so.`;

  return chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Data summary:\n${dataContext}\n\nUser question: ${question}`
      }
    ]
  });
}
