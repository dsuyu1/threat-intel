import OpenAI from "openai";

let _openaiClient: OpenAI | null = null;
const _openaiClientsByKey = new Map<string, OpenAI>();

export type AiProvider = "openai" | "gemini";

export type AiOverrides = {
  provider?: AiProvider;
  openaiApiKey?: string;
  openaiBaseURL?: string;
  geminiApiKey?: string;
  chatModel?: string;
  embeddingModel?: string;
};

export function getAiProvider(ai?: AiOverrides): AiProvider {
  if (ai?.provider === "openai" || ai?.provider === "gemini") return ai.provider;

  const forced = (process.env["AI_PROVIDER"] ?? "").toLowerCase();
  if (forced === "openai" || forced === "gemini") return forced;

  const openaiKey = ai?.openaiApiKey ?? process.env["OPENAI_API_KEY"];
  const geminiKey = ai?.geminiApiKey ?? process.env["GEMINI_API_KEY"];

  // If an OpenAI key is present, prefer OpenAI by default (unless explicitly forced to Gemini).
  // This avoids surprising "Gemini by default" behavior in environments where both keys exist.
  if (openaiKey) return "openai";

  // Otherwise, fall back to Gemini when configured.
  if (geminiKey) return "gemini";

  // Default provider when nothing is configured.
  return "openai";
}

function normalizeGeminiModel(model: string): { model: string; pathModel: string } {
  const normalized = model.startsWith("models/") ? model : `models/${model}`;
  return { model: normalized, pathModel: normalized.replace(/^models\//, "") };
}

function openAiCacheKey(params: { apiKey: string; baseURL?: string | undefined }) {
  const head = params.apiKey.slice(0, 12);
  return `${params.baseURL ?? ""}|${head}`;
}

export function getOpenAIClient(ai?: AiOverrides): OpenAI {
  const openaiKey = ai?.openaiApiKey ?? process.env["OPENAI_API_KEY"];
  const baseURL = ai?.openaiBaseURL ?? process.env["OPENAI_BASE_URL"];

  const provider = getAiProvider(ai);

  if (provider === "openai") {
    if (!openaiKey) throw new Error("Set OPENAI_API_KEY in your environment or repo .env");
    // When a per-user key is provided, cache by key+baseURL so multiple calls within a single
    // lambda invocation don't recreate clients.
    if (ai?.openaiApiKey) {
      const k = openAiCacheKey({ apiKey: openaiKey, baseURL });
      const existing = _openaiClientsByKey.get(k);
      if (existing) return existing;
      const client = new OpenAI({ apiKey: openaiKey, ...(baseURL ? { baseURL } : {}) });
      _openaiClientsByKey.set(k, client);
      return client;
    }

    _openaiClient = new OpenAI({ apiKey: openaiKey, ...(baseURL ? { baseURL } : {}) });
    return _openaiClient;
  } else {
    // We intentionally do not use the OpenAI compatibility endpoint for Gemini in v1.
    // It's optional/preview and can behave differently across keys/tiers.
    throw new Error(
      "OpenAI client requested, but AI provider is Gemini. Use `generateText()` / `embedTexts()` instead."
    );
  }
}

export function getChatModel(ai?: AiOverrides): string {
  if (ai?.chatModel) return ai.chatModel;
  if (process.env["AI_MODEL"]) return process.env["AI_MODEL"];
  return getAiProvider(ai) === "openai" ? "gpt-4o-mini" : "gemini-2.0-flash";
}

export function getEmbeddingModel(ai?: AiOverrides): string {
  if (ai?.embeddingModel) return ai.embeddingModel;
  if (process.env["EMBEDDING_MODEL"]) return process.env["EMBEDDING_MODEL"];
  return getAiProvider(ai) === "openai" ? "text-embedding-3-small" : "models/gemini-embedding-001";
}

export function normalizeEmbedding1536(embedding: number[]): number[] {
  if (embedding.length === 1536) return embedding;
  if (embedding.length > 1536) return embedding.slice(0, 1536);
  const out = embedding.slice();
  while (out.length < 1536) out.push(0);
  return out;
}

function fnv1a32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function localHashEmbedding(text: string): number[] {
  const dim = 1536;
  const vec = new Array<number>(dim).fill(0);

  const tokens = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).slice(0, 8000);
  for (const t of tokens) {
    const idx = fnv1a32(t) % dim;
    vec[idx] = (vec[idx] ?? 0) + 1;
  }

  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i] ?? 0;
    vec[i] = v / norm;
  }
  return vec;
}

function shouldFallbackToLocalEmbeddings(err: unknown): boolean {
  const anyErr = err as any;
  const status = Number(anyErr?.status ?? anyErr?.response?.status ?? NaN);
  const msg = String(anyErr?.message ?? err ?? "");
  const body = String(anyErr?.error?.message ?? anyErr?.body ?? "");

  // Common "OpenAI-compatible" gaps: embeddings not supported, or embedding model ids differ.
  if (status === 404 || status === 501) return true;
  if (status === 400 && /embeddings|invalid model|model name/i.test(msg + " " + body)) return true;
  if (/\/embeddings/i.test(msg)) return true;
  return false;
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

export async function embedTexts(texts: string[], ai?: AiOverrides): Promise<number[][]> {
  const provider = getAiProvider(ai);
  if (provider === "openai") {
    const client = getOpenAIClient(ai);
    try {
      const res = await client.embeddings.create({
        model: getEmbeddingModel(ai),
        input: texts,
      });
      return res.data.map((d) => normalizeEmbedding1536(d.embedding));
    } catch (err) {
      const allowLocal = (process.env["ALLOW_LOCAL_EMBEDDINGS"] ?? "1") !== "0";
      if (allowLocal && shouldFallbackToLocalEmbeddings(err)) {
        console.warn(
          "[AI] Embeddings API failed; falling back to local hash embeddings. " +
            "Set EMBEDDING_MODEL to a supported embeddings model for your OPENAI_BASE_URL, or set ALLOW_LOCAL_EMBEDDINGS=0 to fail fast."
        );
        return texts.map((t) => localHashEmbedding(t));
      }
      throw err;
    }
  }

  const geminiKey = ai?.geminiApiKey ?? process.env["GEMINI_API_KEY"];
  if (!geminiKey) throw new Error("Set GEMINI_API_KEY to generate embeddings");

  const { model, pathModel } = normalizeGeminiModel(getEmbeddingModel(ai));

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
  ai?: AiOverrides;
}): Promise<string> {
  const provider = getAiProvider(params.ai);
  const temperature = params.temperature ?? 0.1;
  const maxTokens = params.maxTokens ?? 800;

  if (provider === "openai") {
    const client = getOpenAIClient(params.ai);
    const res = await client.chat.completions.create({
      model: getChatModel(params.ai),
      messages: [{ role: "user", content: params.prompt }],
      ...(params.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      temperature,
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message?.content ?? "";
  }

  const geminiKey = params.ai?.geminiApiKey ?? process.env["GEMINI_API_KEY"];
  if (!geminiKey) throw new Error("Set GEMINI_API_KEY to generate content");

  const { pathModel } = normalizeGeminiModel(getChatModel(params.ai));
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
