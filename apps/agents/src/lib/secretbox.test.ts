import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "./secretbox";

describe("secretbox (agents)", () => {
  const original = process.env["TI_SECRETS_KEY"];

  beforeEach(() => {
    process.env["TI_SECRETS_KEY"] = "test-key";
  });

  afterEach(() => {
    if (original === undefined) delete process.env["TI_SECRETS_KEY"];
    else process.env["TI_SECRETS_KEY"] = original;
  });

  it("round-trips secrets", async () => {
    const payload = await encryptSecret("hello");
    expect(payload.startsWith("v1:")).toBe(true);
    await expect(decryptSecret(payload)).resolves.toBe("hello");
  });

  it("supports key rotation by trying multiple keys during decrypt", async () => {
    process.env["TI_SECRETS_KEY"] = "old-key";
    const payload = await encryptSecret("rotate-me");

    process.env["TI_SECRETS_KEY"] = "new-key,old-key";
    await expect(decryptSecret(payload)).resolves.toBe("rotate-me");
  });

  it("fails to decrypt when no configured key matches", async () => {
    process.env["TI_SECRETS_KEY"] = "old-key";
    const payload = await encryptSecret("nope");

    process.env["TI_SECRETS_KEY"] = "new-key";
    await expect(decryptSecret(payload)).rejects.toThrow(/Unable to decrypt secret payload/i);
  });

  it("rejects invalid payloads", async () => {
    await expect(decryptSecret("bogus")).rejects.toThrow(/Invalid secret payload/i);
  });
});
