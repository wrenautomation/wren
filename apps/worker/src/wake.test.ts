import { describe, expect, it } from "vitest";
import { wakeTarget } from "./wake.js";

describe("wakeTarget", () => {
  it("keys a notice to its database's owner", () => {
    expect(wakeTarget("SmsSender/fleet", null)).toEqual({ service: "SmsSender", key: "fleet" });
    expect(wakeTarget("ReachSender/fleet", "acme")).toEqual({
      service: "ReachSender",
      key: "acme/fleet",
    });
  });

  it("refuses anything else", () => {
    for (const p of ["", "SmsSender", "SmsSender/", "/fleet", "Sms Sender/fleet", "A/b/c", "A/b?x"])
      expect(wakeTarget(p, null)).toBeNull();
  });
});
