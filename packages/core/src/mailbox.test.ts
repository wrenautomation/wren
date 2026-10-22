import { describe, expect, it } from "vitest";
import { isWarmupMail } from "./mailbox.js";

describe("isWarmupMail", () => {
  it("reads Instantly's tag, either order, words or codes", () => {
    expect(isWarmupMail("Quick question about the roof? | DAVM9XE 4Z2DV6H")).toBe(true);
    expect(isWarmupMail("Following up | 4Z2DV6H Y0PKTM7")).toBe(true);
    expect(isWarmupMail("Plans for the week | crown-solar 4Z2DV6H")).toBe(true);
    expect(isWarmupMail("Hello |  available_social  4Z2DV6H ")).toBe(true);
  });

  it("leaves real subjects alone", () => {
    expect(isWarmupMail("Startups | AWS credits")).toBe(false);
    expect(isWarmupMail("Invoice INV2024 is due")).toBe(false);
    expect(isWarmupMail("Order | ABCDEFG")).toBe(false);
    expect(isWarmupMail("Re: your quote")).toBe(false);
  });
});
