/** Raw keys are refused wherever a ref should be; refs, ids and emails pass. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { keyProblem, keyRef, looksLikeKey, noRawKeys, rawKeyAt } from "./key-refs.js";

const REF = `ks_${"0a".repeat(16)}`;

describe("looksLikeKey", () => {
  it("knows key shapes", () => {
    for (const k of [
      "sk_live_synthetic0000000000",
      "rk_test_synthetic0000000000",
      "whsec_synthetic00000000000000",
      "AIzaSyntheticSynthetic000000000",
      "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    ])
      expect(looksLikeKey(k), k).toBe(true);
  });
  it("lets refs, uuids, emails, urls, words and short ids through", () => {
    for (const s of [
      REF,
      "6f1c1a52-3c1e-4c8e-9a51-1f0c2b3d4e5f",
      "owner@example.com",
      "https://app.example.com/pay",
      "acme_roofing_and_siding",
      "wren_test",
      "Monthly retainer for March",
      "exa",
    ])
      expect(looksLikeKey(s), s).toBe(false);
  });
});

describe("noRawKeys", () => {
  const schema = noRawKeys(
    z.looseObject({ client: z.string().optional(), keyRef: keyRef.nullish() }),
  );

  it("takes a ref", () => {
    expect(schema.safeParse({ client: "acme", keyRef: REF }).success).toBe(true);
  });

  it("refuses a raw key in the ref, in an old field, or anywhere else", () => {
    const raw = "sk_live_synthetic0000000000";
    for (const body of [
      { client: "acme", keyRef: raw },
      { client: "acme", key: raw },
      { client: "acme", secret: "whsec_synthetic00000000000000" },
      { client: raw },
      { client: "acme", note: { deep: [raw] } },
    ]) {
      const r = schema.safeParse(body);
      expect(r.success, JSON.stringify(Object.keys(body))).toBe(false);
      expect(JSON.stringify(r.error?.issues ?? [])).not.toContain(raw);
    }
    expect(rawKeyAt({ note: { deep: ["x", "sk_live_synthetic0000000000"] } })).toBe("note.deep.1");
  });
});

describe("keyProblem", () => {
  it("checks a value against its name's shape", () => {
    expect(keyProblem("STRIPE_SECRET_KEY", "sk_test_synthetic0000000000")).toBeNull();
    expect(keyProblem("STRIPE_SECRET_KEY", "pk_test_synthetic0000000000")).toContain("sk_ or rk_");
    expect(keyProblem("STRIPE_WEBHOOK_SECRET", "whsec_synthetic00000000000000")).toBeNull();
    expect(keyProblem("EXA_API_KEY", "short")).toBe("That doesn't look like a key");
    expect(keyProblem("AWS_SECRET", "anything-long-enough")).toContain("by that name");
  });
});
