import { describe, expect, it } from "vitest";
import { ingressOf } from "./index.js";

describe("ingressOf", () => {
  it("is the URL alone locally and carries the bearer for Restate Cloud", () => {
    expect(ingressOf({ restateIngressUrl: "http://127.0.0.1:8080" })).toEqual({
      url: "http://127.0.0.1:8080",
    });
    expect(
      ingressOf({
        restateIngressUrl: "https://x.env.us.restate.cloud:8080",
        restateAuthToken: "k",
      }),
    ).toEqual({
      url: "https://x.env.us.restate.cloud:8080",
      headers: { Authorization: "Bearer k" },
    });
  });
});
