import { describe, expect, it } from "vitest";
import { telHrefs } from "./pages.js";
import { phonesOf } from "./phones.js";

const phonesInPage = (html: string | null, text: string) => phonesOf(telHrefs(html ?? ""), text);

describe("phonesOf", () => {
  it("reads tel links first, then text, deduped", () => {
    const html = "<a href=\"tel:+1-212-555-0187\">call</a><a href='tel:(646)%20555-0100'>x</a>";
    const text = "Call us at 212.555.0187 or (718) 555-0142. Fax 1-800-555-0199.";
    expect(phonesInPage(html, text)).toEqual([
      { e164: "+12125550187", kind: "tel_link" },
      { e164: "+16465550100", kind: "tel_link" },
      { e164: "+17185550142", kind: "page_text" },
      { e164: "+18005550199", kind: "page_text" },
    ]);
  });
  it("skips digit runs that are not phones", () => {
    expect(
      phonesInPage(null, "Order 12125550187999 · zip 10001 · ©2024 · +44 20 7946 0958"),
    ).toEqual([]);
  });
});
