export type AiProvider = "openai" | "gemini";

export function getAiProvider(): AiProvider {
  const forced = (process.env["AI_PROVIDER"] ?? "").toLowerCase();
  if (forced === "openai" || forced === "gemini") return forced;

  const openaiKey = process.env["OPENAI_API_KEY"];
  const geminiKey = process.env["GEMINI_API_KEY"];

  if (openaiKey) return "openai";
  if (geminiKey) return "gemini";
  return "openai";
}

export function getChatModel(): string {
  if (process.env["AI_MODEL"]) return process.env["AI_MODEL"];
  return getAiProvider() === "openai" ? "gpt-4o-mini" : "gemini-2.0-flash";
}

function normalizeGeminiModel(model: string): { model: string; pathModel: string } {
  const normalized = model.startsWith("models/") ? model : `models/${model}`;
  return { model: normalized, pathModel: normalized.replace(/^models\//, "") };
}

export async function generateText(params: {
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const provider = getAiProvider();
  const temperature = params.temperature ?? 0.2;
  const maxTokens = params.maxTokens ?? 900;

  if (provider === "openai") {
    const key = process.env["OPENAI_API_KEY"];
    if (!key) throw new Error("Set OPENAI_API_KEY to generate detections");

    const baseURL = (process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    const url = `${baseURL}/chat/completions`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: getChatModel(),
        messages: [{ role: "user", content: params.prompt }],
        temperature,
        max_tokens: maxTokens,
      }),
    });

    const bodyText = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(`AI request failed: ${res.status} ${res.statusText} ${bodyText}`);
    }

    const json = JSON.parse(bodyText) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    return json.choices?.[0]?.message?.content ?? "";
  }

  const geminiKey = process.env["GEMINI_API_KEY"];
  if (!geminiKey) throw new Error("Set GEMINI_API_KEY to generate detections");

  const { pathModel } = normalizeGeminiModel(getChatModel());
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${pathModel}:generateContent?key=${encodeURIComponent(
    geminiKey
  )}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: params.prompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    }),
  });

  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`AI request failed: ${res.status} ${res.statusText} ${bodyText}`);
  }

  const json = JSON.parse(bodyText) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
}

