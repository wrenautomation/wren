import { describe, expect, it } from "vitest";
import { INGRESS_JSON, ingressOf } from "./index.js";

describe("ingressOf", () => {
  it("is the URL alone locally and carries the bearer for Restate Cloud", () => {
    expect(ingressOf({ restateIngressUrl: "http://127.0.0.1:8080" })).toEqual({
      url: "http://127.0.0.1:8080",
      serde: INGRESS_JSON,
    });
    expect(
      ingressOf({
        restateIngressUrl: "https://x.env.us.restate.cloud:8080",
        restateAuthToken: "k",
      }),
    ).toEqual({
      url: "https://x.env.us.restate.cloud:8080",
      headers: { Authorization: "Bearer k" },
      serde: INGRESS_JSON,
    });
  });

  it("sends no body and no content type for no input, JSON otherwise", () => {
    expect(INGRESS_JSON.serialize(undefined)).toEqual(new Uint8Array());
    expect(INGRESS_JSON.contentType).toBeUndefined();
    expect(new TextDecoder().decode(INGRESS_JSON.serialize({ a: 1 }))).toBe('{"a":1}');
    expect(INGRESS_JSON.contentType).toBe("application/json");
    expect(INGRESS_JSON.serialize(null)).toEqual(new TextEncoder().encode("null"));
    expect(INGRESS_JSON.contentType).toBe("application/json");
    expect(INGRESS_JSON.deserialize(new Uint8Array())).toBeUndefined();
    expect(INGRESS_JSON.deserialize(new TextEncoder().encode('{"a":1}'))).toEqual({ a: 1 });
  });
});
