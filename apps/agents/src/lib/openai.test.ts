import { describe, expect, it, afterEach } from "vitest";

import { getAiProvider, getChatModel, getEmbeddingModel, normalizeEmbedding1536 } from "./openai";

const savedEnv = {
  AI_PROVIDER: process.env["AI_PROVIDER"],
  GEMINI_API_KEY: process.env["GEMINI_API_KEY"],
  OPENAI_API_KEY: process.env["OPENAI_API_KEY"],
  AI_MODEL: process.env["AI_MODEL"],
  EMBEDDING_MODEL: process.env["EMBEDDING_MODEL"],
};

function restoreEnvKey(key: keyof typeof savedEnv) {
  const v = savedEnv[key];
  if (v === undefined) delete process.env[key];
  else process.env[key] = v;
}

afterEach(() => {
  restoreEnvKey("AI_PROVIDER");
  restoreEnvKey("GEMINI_API_KEY");
  restoreEnvKey("OPENAI_API_KEY");
  restoreEnvKey("AI_MODEL");
  restoreEnvKey("EMBEDDING_MODEL");
});

describe("getAiProvider()", () => {
  it("respects explicit AI_PROVIDER=openai", () => {
    process.env["AI_PROVIDER"] = "openai";
    process.env["GEMINI_API_KEY"] = "dummy";
    expect(getAiProvider()).toBe("openai");
  });

  it("respects explicit AI_PROVIDER=gemini", () => {
    process.env["AI_PROVIDER"] = "gemini";
    delete process.env["GEMINI_API_KEY"];
    expect(getAiProvider()).toBe("gemini");
  });

  it("defaults to gemini when GEMINI_API_KEY is set", () => {
    delete process.env["AI_PROVIDER"];
    process.env["GEMINI_API_KEY"] = "dummy";
    delete process.env["OPENAI_API_KEY"];
    expect(getAiProvider()).toBe("gemini");
  });

  it("defaults to openai when GEMINI_API_KEY is not set", () => {
    delete process.env["AI_PROVIDER"];
    delete process.env["GEMINI_API_KEY"];
    expect(getAiProvider()).toBe("openai");
  });
});

describe("model selection", () => {
  it("uses AI_MODEL override for chat", () => {
    process.env["AI_MODEL"] = "my-model";
    expect(getChatModel()).toBe("my-model");
  });

  it("uses EMBEDDING_MODEL override for embeddings", () => {
    process.env["EMBEDDING_MODEL"] = "my-embed-model";
    expect(getEmbeddingModel()).toBe("my-embed-model");
  });
});

describe("normalizeEmbedding1536()", () => {
  it("pads short vectors with zeros", () => {
    const out = normalizeEmbedding1536([1, 2, 3]);
    expect(out).toHaveLength(1536);
    expect(out[0]).toBe(1);
    expect(out[2]).toBe(3);
    expect(out[1535]).toBe(0);
  });

  it("truncates long vectors", () => {
    const out = normalizeEmbedding1536(new Array(1600).fill(1));
    expect(out).toHaveLength(1536);
    expect(out[1535]).toBe(1);
  });

  it("keeps 1536-dim vectors as-is", () => {
    const input = new Array(1536).fill(0.5);
    const out = normalizeEmbedding1536(input);
    expect(out).toHaveLength(1536);
    expect(out[0]).toBe(0.5);
  });
});
