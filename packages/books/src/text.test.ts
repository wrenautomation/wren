import { parseMessage } from "@wren/core/mail";
import { describe, expect, it } from "vitest";
import { bodyText, htmlText } from "./text.js";

describe("htmlText", () => {
  it("keeps table rows on one line and drops styles and comments", () => {
    const html = `<html><head><style>td{color:red}</style></head><body><!-- x -->
      <p>Thanks&nbsp;for your order</p>
      <table><tr><td>Pro plan</td><td>$20.00</td></tr><tr><td>Total</td><td>&#36;20.00</td></tr></table>
      <div>Questions? Reply&hellip;</div></body></html>`;
    expect(htmlText(html)).toBe(
      "Thanks for your order\n\nPro plan $20.00\nTotal $20.00\n\nQuestions? Reply…",
    );
  });

  it("turns NUL into a space, since Postgres text refuses it", () => {
    expect(htmlText("<p>Sep 6\u0000Oct 6, 2026 &#0;</p>")).toBe("Sep 6 Oct 6, 2026");
  });
});

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
