/**
 * Sealing: the public key seals, only the ring opens, a value only opens as the client's key of
 * that name, and a rotated ring still opens the old key's values and rewraps them.
 */
import { describe, expect, it } from "vitest";
import { keyRing, keySealer, newKeyPair, publicSpecOf } from "./keys.js";

const VALUE = "sk_test_synthetic000000000000";
const AAD = "wren-key|acme|STRIPE_SECRET_KEY";

describe("key ring", () => {
  it("seals with the public key alone; the ring opens it", () => {
    const pair = newKeyPair("k1");
    const box = keySealer(pair.publicSpec).seal(AAD, VALUE);
    expect(box.kid).toBe("k1");
    expect(Buffer.from(box.sealed).includes(Buffer.from(VALUE))).toBe(false);
    expect(keyRing(pair.privateSpec).open(AAD, box)).toBe(VALUE);
    expect(publicSpecOf(pair.privateSpec)).toBe(pair.publicSpec);
  });

  it("opens only as the same client and name", () => {
    const ring = keyRing(newKeyPair("k1").privateSpec);
    const box = ring.seal(AAD, VALUE);
    expect(() => ring.open("wren-key|beta|STRIPE_SECRET_KEY", box)).toThrow();
    expect(() => ring.open("wren-key|acme|EXA_API_KEY", box)).toThrow();
  });

  it("refuses another ring's value and a tampered one", () => {
    const a = keyRing(newKeyPair("k1").privateSpec);
    const b = keyRing(newKeyPair("k1").privateSpec);
    const box = a.seal(AAD, VALUE);
    expect(() => b.open(AAD, box)).toThrow();
    const sealed = Buffer.from(box.sealed);
    sealed[20] = (sealed[20] ?? 0) ^ 1;
    expect(() => a.open(AAD, { ...box, sealed })).toThrow();
  });

  it("each value its own data key", () => {
    const ring = keyRing(newKeyPair("k1").privateSpec);
    const x = ring.seal(AAD, VALUE);
    const y = ring.seal(AAD, VALUE);
    expect(Buffer.from(x.wrapped).equals(Buffer.from(y.wrapped))).toBe(false);
    expect(Buffer.from(x.sealed).equals(Buffer.from(y.sealed))).toBe(false);
  });

  it("a new key first: old values still open, and rewrap moves them to it", () => {
    const old = newKeyPair("k1");
    const box = keyRing(old.privateSpec).seal(AAD, VALUE);
    const next = newKeyPair("k2");
    const ring = keyRing(`${next.privateSpec},${old.privateSpec}`);
    expect(ring.kid).toBe("k2");
    expect(ring.open(AAD, box)).toBe(VALUE);
    const wrapped = ring.rewrap(AAD, box);
    expect(keyRing(next.privateSpec).open(AAD, { kid: "k2", wrapped, sealed: box.sealed })).toBe(
      VALUE,
    );
    expect(() => keyRing(next.privateSpec).open(AAD, box)).toThrow("no private key k1");
  });

  it("refuses a malformed spec without saying it", () => {
    expect(() => keyRing("nokid")).toThrow("kid:base64url");
    expect(() => keyRing("k1:AAAA")).toThrow("32 bytes");
    try {
      keyRing("k1:c2VjcmV0LXRoYXQtaXMtbm90LTMyLWJ5dGVz");
    } catch (e) {
      expect(String(e)).not.toContain("c2VjcmV0");
    }
  });
});
