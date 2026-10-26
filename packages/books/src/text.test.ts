import { parseMessage } from "@wren/core/mail";
import { describe, expect, it } from "vitest";
import { bodyText } from "./text.js";

describe("bodyText", () => {
  it("takes the HTML part when the plain part is a stub", () => {
    const raw = [
      "From: Acme <billing@acme.example>",
      "Subject: Receipt",
      'Content-Type: multipart/alternative; boundary="b"',
      "",
      "--b",
      "Content-Type: text/plain",
      "",
      "View in a browser.",
      "--b",
      "Content-Type: text/html",
      "",
      "<p>Receipt INV-1</p><table><tr><td>Total</td><td>$20.00</td></tr></table><p>Paid with your card on file.</p>",
      "--b--",
      "",
    ].join("\r\n");
    expect(bodyText(parseMessage(Buffer.from(raw)))).toBe(
      "Receipt INV-1\nTotal $20.00\n\nPaid with your card on file.",
    );
  });
});
