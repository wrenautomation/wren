import { describe, expect, it } from "vitest";
import { decryptSpikes, principalOf } from "./decrypts.js";

describe("KMS decrypt spikes", () => {
  it("names the role, the user, root, or the service", () => {
    expect(
      principalOf({ type: "AssumedRole", sessionContext: { sessionIssuer: { userName: "app" } } }),
    ).toBe("role/app");
    expect(principalOf({ type: "IAMUser", userName: "ops" })).toBe("user/ops");
    expect(principalOf({ type: "Root" })).toBe("root");
    expect(principalOf({ type: "AWSService", invokedBy: "ssm.amazonaws.com" })).toBe(
      "ssm.amazonaws.com",
    );
  });

  it("flags a new principal past the floor and a 3x jump, nothing else", () => {
    const day = new Map([
      ["role/steady", 1500],
      ["role/jumped", 900],
      ["user/new", 60],
      ["user/quiet", 10],
    ]);
    const before = new Map([
      ["role/steady", 1400],
      ["role/jumped", 200],
    ]);
    expect(decryptSpikes(day, before)).toEqual([
      { principal: "role/jumped", count: 900, before: 200 },
      { principal: "user/new", count: 60, before: 0 },
    ]);
  });
});
