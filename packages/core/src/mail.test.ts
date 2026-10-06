import { describe, expect, it } from "vitest";
import { decodeEncodedWords, getAddresses, parseAddr, parseMessage } from "./mail.js";

const withAttachments = (...headers: string[]) =>
  [
    'Content-Type: multipart/mixed; boundary="b"',
    "",
    ...headers.flatMap((h) => ["--b", h, "Content-Transfer-Encoding: base64", "", "JVBERi0=", ""]),
    "--b--",
    "",
  ].join("\r\n");

describe("MimePart.filename", () => {
  it("reads plain, RFC 2231 and Content-Type names", () => {
    const message = parseMessage(
      withAttachments(
        'Content-Type: application/pdf\r\nContent-Disposition: attachment; filename="Invoice-12.pdf"',
        "Content-Type: application/pdf\r\nContent-Disposition: attachment; filename*=UTF-8''Re%C3%A7u%20%2312.pdf",
        'Content-Type: application/octet-stream; name="receipt.pdf"',
      ),
    );
    const parts = [...message.walk()].filter((p) => p !== message);
    expect(parts.map((p) => p.filename())).toEqual([
      "Invoice-12.pdf",
      "Reçu #12.pdf",
      "receipt.pdf",
    ]);
    expect(parts.map((p) => p.isAttachment())).toEqual([true, true, false]);
    expect(Buffer.from(parts[0]?.bytes() ?? []).toString()).toBe("%PDF-");
  });
});

describe("headers", () => {
  it("reads raw UTF-8 header bytes as UTF-8 (RFC 6532)", () => {
    const raw = Buffer.from(
      "From: Jürgen Groß <jg@example.test>\r\nSubject: Grüße\r\n\r\nhi",
      "utf8",
    );
    const message = parseMessage(new Uint8Array(raw));
    expect(message.get("Subject")).toBe("Grüße");
    expect(parseAddr(message.getRaw("From") ?? "")).toEqual(["Jürgen Groß", "jg@example.test"]);
  });

  it("keeps a raw latin1 header readable when it is not UTF-8", () => {
    const raw = Buffer.from("Subject: Gr\u00fc\u00dfe\r\n\r\nhi", "latin1");
    expect(parseMessage(new Uint8Array(raw)).get("Subject")).toBe("Grüße");
  });

  it("joins a character split across adjacent encoded words", () => {
    // "é" is C3 A9; each word carries one byte.
    expect(decodeEncodedWords("=?UTF-8?Q?caf=C3?= =?UTF-8?Q?=A9?=")).toBe("café");
  });
});

describe("addresses", () => {
  it("splits the list before decoding encoded words", () => {
    const value = "=?utf-8?Q?M=C3=BCller=2C_Hans?= <hans@example.test>, ann@example.test";
    expect(getAddresses([value])).toEqual([
      ["Müller, Hans", "hans@example.test"],
      ["", "ann@example.test"],
    ]);
    const message = parseMessage(`To: ${value}\r\n\r\nhi`);
    expect(getAddresses(message.getAllRaw("To"))).toHaveLength(2);
  });
});

describe("MimePart.filename continuations", () => {
  it("joins an RFC 2231 split filename", () => {
    const message = parseMessage(
      withAttachments(
        "Content-Type: application/pdf\r\nContent-Disposition: attachment;\r\n filename*0*=UTF-8''Rechnung%20;\r\n filename*1*=Nr%C2%B012.pdf",
      ),
    );
    const part = [...message.walk()].find((p) => p !== message);
    expect(part?.filename()).toBe("Rechnung Nr°12.pdf");
  });
});

describe("nesting", () => {
  it("never overflows the stack on deeply nested parts", () => {
    const raw = `${"Content-Type: message/rfc822\r\n\r\n".repeat(50_000)}Subject: x\r\n\r\nhi`;
    const message = parseMessage(raw);
    expect([...message.walk()].length).toBeLessThan(200);
  });
});
