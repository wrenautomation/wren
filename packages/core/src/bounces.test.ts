import { describe, expect, it } from "vitest";
import { keptMessageId, mintMessageId } from "./bounces.js";

describe("Message-IDs", () => {
  it("keeps one form: in angle brackets, lowercased", () => {
    expect(keptMessageId("ABC@Example.TEST")).toBe("<abc@example.test>");
    expect(keptMessageId(" <Abc@example.test> ")).toBe("<abc@example.test>");
  });

  it("mints a fresh one on the sender's domain, already in that form", () => {
    const a = mintMessageId("Mail.Example.test");
    expect(a).toMatch(/^<[0-9a-f-]{36}@mail\.example\.test>$/);
    expect(keptMessageId(a)).toBe(a);
    expect(mintMessageId("mail.example.test")).not.toBe(a);
  });
});
