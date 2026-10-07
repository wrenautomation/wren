/** Header bytes against RFC 2047 (encoded words) and RFC 5322 (line length). */
import { parseMessage } from "@wren/core/mail";
import { describe, expect, it } from "vitest";
import { buildMime } from "./mime.js";
import type { OutgoingEmail } from "./transport.js";

const mail = (overrides: Partial<OutgoingEmail> = {}): OutgoingEmail => ({
  fromAddress: "will@wren-automation.test",
  fromName: "Will Jin",
  to: "jane@acme.example",
  subject: "Quick question, Jane",
  replySubject: null,
  body: "Hello there.",
  messageId: "<m1@wren-automation.test>",
  ...overrides,
});

const headLines = (raw: Buffer) => raw.toString("utf8").split("\r\n\r\n")[0]?.split("\r\n") ?? [];
const words = (raw: Buffer) => raw.toString("utf8").match(/=\?[^?]+\?[bBqQ]\?[^?]*\?=/g) ?? [];

describe("buildMime headers", () => {
  const subject = `Grüße aus Köln, ${"é".repeat(60)} — ${"😀".repeat(5)}`;
  const references = Array.from(
    { length: 40 },
    (_, i) => `<thread-${i}-abcdef@wren-automation.test>`,
  );
  const raw = buildMime(
    mail({
      subject,
      fromName: "Jürgen Müller, Sales",
      inReplyTo: references.at(-1) ?? null,
      references,
    }),
    { now: new Date(Date.UTC(2026, 9, 6)), boundary: "b" },
  );

  it("keeps every encoded word to 75 characters, each holding whole characters", () => {
    expect(words(raw).length).toBeGreaterThan(1);
    for (const word of words(raw)) {
      expect(word.length).toBeLessThanOrEqual(75);
      expect(parseMessage(`Subject: ${word}\r\n\r\n`).get("Subject")).not.toContain("�");
    }
  });

  it("folds every header line to 78 characters", () => {
    for (const line of headLines(raw)) expect(line.length).toBeLessThanOrEqual(78);
  });

  it("reads back the same subject, sender and references", () => {
    const message = parseMessage(raw);
    expect(message.get("Subject")).toBe(subject);
    expect(message.get("From")).toBe("Jürgen Müller, Sales <will@wren-automation.test>");
    expect(message.get("References")?.split(/\s+/)).toEqual(references);
  });
});
