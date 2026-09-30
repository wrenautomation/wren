import { describe, expect, it } from "vitest";
import { parseMessage } from "./mail.js";

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
