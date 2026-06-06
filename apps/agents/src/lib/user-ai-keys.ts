import { getDb, userAiKeys } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { decryptSecret } from "./secretbox.js";

export type UserAiOverrides =
  | {
      provider: "openai";
      openaiApiKey: string;
      openaiBaseURL?: string;
    }
  | {
      provider: "gemini";
      geminiApiKey: string;
    };

export async function getUserAiOverrides(params: { userId: string; projectId: string }): Promise<{
  ai: UserAiOverrides | null;
  error: string | null;
}> {
  const db = getDb();

  let row:
    | { provider: string; apiKeyEnc: string; baseUrl: string | null }
    | undefined;
  try {
    [row] = await db
      .select({
        provider: userAiKeys.provider,
        apiKeyEnc: userAiKeys.apiKeyEnc,
        baseUrl: userAiKeys.baseUrl,
      })
      .from(userAiKeys)
      .where(and(eq(userAiKeys.userId, params.userId), eq(userAiKeys.projectId, params.projectId)))
      .limit(1);
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return { ai: null, error: "AI key tables are missing (db:migrate not applied)." };
    return { ai: null, error: "Failed to load user AI key." };
  }

  if (!row) return { ai: null, error: null };

  const provider = String(row.provider ?? "").trim().toLowerCase();
  try {
    const apiKey = await decryptSecret(String(row.apiKeyEnc ?? ""));
    if (!apiKey) return { ai: null, error: "Stored API key is empty." };

    if (provider === "gemini") {
      return { ai: { provider: "gemini", geminiApiKey: apiKey }, error: null };
    }

    const baseUrl = row.baseUrl ? String(row.baseUrl).trim() : "";
    return {
      ai: {
        provider: "openai",
        openaiApiKey: apiKey,
        ...(baseUrl ? { openaiBaseURL: baseUrl } : {}),
      },
      error: null,
    };
  } catch (err) {
    const msg = String((err as any)?.message ?? err ?? "");
    if (/TI_SECRETS_KEY is not set/i.test(msg)) {
      return { ai: null, error: "TI_SECRETS_KEY is not set in the agents service, so BYOK cannot be used." };
    }
    return { ai: null, error: "Failed to decrypt user AI key." };
  }
}

