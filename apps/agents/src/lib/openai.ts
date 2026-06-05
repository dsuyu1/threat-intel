import OpenAI from "openai";

let _openaiClient: OpenAI | null = null;

export type AiProvider = "openai" | "gemini";

export function getAiProvider(): AiProvider {
  const forced = (process.env["AI_PROVIDER"] ?? "").toLowerCase();
  if (forced === "openai" || forced === "gemini") return forced;

  const openaiKey = process.env["OPENAI_API_KEY"];
  const openaiBaseUrl = process.env["OPENAI_BASE_URL"];
  const geminiKey = process.env["GEMINI_API_KEY"];

  // Prefer OpenAI when explicitly configured (key + base URL), otherwise default to Gemini
  // if it's available, because many dev environments set OPENAI_API_KEY for other tools.
  if (openaiKey && (openaiBaseUrl || !geminiKey)) return "openai";
  return geminiKey ? "gemini" : "openai";
}

function normalizeGeminiModel(model: string): { model: string; pathModel: string } {
  const normalized = model.startsWith("models/") ? model : `models/${model}`;
  return { model: normalized, pathModel: normalized.replace(/^models\//, "") };
}

export function getOpenAIClient(): OpenAI {
  if (_openaiClient) return _openaiClient;

  const openaiKey = process.env["OPENAI_API_KEY"];
  const baseURL = process.env["OPENAI_BASE_URL"];

  const provider = getAiProvider();

  if (provider === "openai") {
    if (!openaiKey) throw new Error("Set OPENAI_API_KEY in your environment or repo .env");
    _openaiClient = new OpenAI({ apiKey: openaiKey, ...(baseURL ? { baseURL } : {}) });
  } else {
    // We intentionally do not use the OpenAI compatibility endpoint for Gemini in v1.
    // It's optional/preview and can behave differently across keys/tiers.
    throw new Error(
      "OpenAI client requested, but AI provider is Gemini. Use `generateText()` / `embedTexts()` instead."
    );
  }
  return _openaiClient;
}

export function getChatModel(): string {
  if (process.env["AI_MODEL"]) return process.env["AI_MODEL"];
  return getAiProvider() === "openai" ? "gpt-4o-mini" : "gemini-2.0-flash";
}

export function getEmbeddingModel(): string {
  if (process.env["EMBEDDING_MODEL"]) return process.env["EMBEDDING_MODEL"];
  return getAiProvider() === "openai" ? "text-embedding-3-small" : "models/gemini-embedding-001";
}

export function normalizeEmbedding1536(embedding: number[]): number[] {
  if (embedding.length === 1536) return embedding;
  if (embedding.length > 1536) return embedding.slice(0, 1536);
  const out = embedding.slice();
  while (out.length < 1536) out.push(0);
  return out;
}

function parseRetryAfterMs(params: { res: Response; bodyText: string }): number | null {
  const header = params.res.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);
  }

  const m = params.bodyText.match(/retry in ([0-9.]+)s/i);
  if (m?.[1]) {
    const seconds = Number(m[1]);
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);
  }

  return null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function shouldRetry429(params: { retryAfterMs: number | null; bodyText: string }): boolean {
  if (!params.retryAfterMs) return false;
  // Don't sleep for long "quota exceeded" responses (often day-level quota).
  if (params.retryAfterMs > 10_000) return false;
  if (/quota exceeded|free_tier_requests|resource_exhausted/i.test(params.bodyText)) return false;
  return true;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const provider = getAiProvider();
  if (provider === "openai") {
    const client = getOpenAIClient();
    const res = await client.embeddings.create({
      model: getEmbeddingModel(),
      input: texts,
    });
    return res.data.map((d) => normalizeEmbedding1536(d.embedding));
  }

  const geminiKey = process.env["GEMINI_API_KEY"];
  if (!geminiKey) throw new Error("Set GEMINI_API_KEY to generate embeddings");

  const { model, pathModel } = normalizeGeminiModel(getEmbeddingModel());

  const batchUrl = `https://generativelanguage.googleapis.com/v1beta/models/${pathModel}:batchEmbedContents?key=${encodeURIComponent(
    geminiKey
  )}`;

  const embedUrl = `https://generativelanguage.googleapis.com/v1beta/models/${pathModel}:embedContent?key=${encodeURIComponent(
    geminiKey
  )}`;

  const maxBatchSize = Math.max(1, Number(process.env["GEMINI_EMBED_BATCH_SIZE"] ?? "64") || 64);

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += maxBatchSize) {
    const batch = texts.slice(i, i + maxBatchSize);

    // Prefer the batch endpoint to avoid free-tier request limits (one request per text is expensive).
    try {
      let attempt = 0;
      while (true) {
        attempt++;
        const res = await fetch(batchUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: batch.map((text) => ({
              model,
              content: { parts: [{ text }] },
            })),
          }),
        });

        if (res.ok) {
          const json = (await res.json()) as {
            embeddings?: Array<{ values?: number[] }>;
          };
          const embeddings = json.embeddings ?? [];
          if (embeddings.length !== batch.length) {
            throw new Error(
              `Gemini batchEmbedContents returned ${embeddings.length} embeddings for ${batch.length} inputs`
            );
          }
          out.push(...embeddings.map((e) => normalizeEmbedding1536(e.values ?? [])));
          break;
        }

        const bodyText = await res.text().catch(() => "");
        const retryAfterMs = parseRetryAfterMs({ res, bodyText });
        if (res.status === 429 && retryAfterMs && shouldRetry429({ retryAfterMs, bodyText }) && attempt < 4) {
          await sleep(retryAfterMs);
          continue;
        }

        // Some tiers/keys might not have the batch endpoint enabled.
        if (res.status === 404 || res.status === 400) {
          throw new Error("BATCH_UNSUPPORTED");
        }

        throw new Error(`Gemini batchEmbedContents failed: ${res.status} ${res.statusText} ${bodyText}`);
      }
      continue;
    } catch (err) {
      if (String(err).includes("BATCH_UNSUPPORTED")) {
        // Fall back to single-item embedding (slower, more rate-limit prone).
      } else {
        throw err;
      }
    }

    // Fallback: embed one by one (sequential to be kind to rate limits).
    for (const text of batch) {
      let attempt = 0;
      while (true) {
        attempt++;
        const res = await fetch(embedUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            content: { parts: [{ text }] },
          }),
        });
        if (res.ok) {
          const json = (await res.json()) as {
            embedding?: { values?: number[] };
          };
          const values = json.embedding?.values ?? [];
          out.push(normalizeEmbedding1536(values));
          break;
        }

        const bodyText = await res.text().catch(() => "");
        const retryAfterMs = parseRetryAfterMs({ res, bodyText });
        if (res.status === 429 && retryAfterMs && shouldRetry429({ retryAfterMs, bodyText }) && attempt < 4) {
          await sleep(retryAfterMs);
          continue;
        }

        throw new Error(`Gemini embedContent failed: ${res.status} ${res.statusText} ${bodyText}`);
      }
    }
  }

  return out;
}

export async function generateText(params: {
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}): Promise<string> {
  const provider = getAiProvider();
  const temperature = params.temperature ?? 0.1;
  const maxTokens = params.maxTokens ?? 800;

  if (provider === "openai") {
    const client = getOpenAIClient();
    const res = await client.chat.completions.create({
      model: getChatModel(),
      messages: [{ role: "user", content: params.prompt }],
      ...(params.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      temperature,
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message?.content ?? "";
  }

  const geminiKey = process.env["GEMINI_API_KEY"];
  if (!geminiKey) throw new Error("Set GEMINI_API_KEY to generate content");

  const { pathModel } = normalizeGeminiModel(getChatModel());
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${pathModel}:generateContent?key=${encodeURIComponent(
    geminiKey
  )}`;

  let attempt = 0;
  while (true) {
    attempt++;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: params.prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      }),
    });

    if (res.ok) {
      const json = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      return parts.map((p) => p.text ?? "").join("");
    }

    const bodyText = await res.text().catch(() => "");
    const retryAfterMs = parseRetryAfterMs({ res, bodyText });
    if (res.status === 429 && retryAfterMs && shouldRetry429({ retryAfterMs, bodyText }) && attempt < 4) {
      await sleep(retryAfterMs);
      continue;
    }

    throw new Error(`Gemini generateContent failed: ${res.status} ${res.statusText} ${bodyText}`);
  }
}
