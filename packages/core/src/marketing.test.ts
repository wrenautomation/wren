import { describe, expect, it } from "vitest";
import { marketingEnvelope, readLink, signLink } from "./marketing.js";

const KEY = "test-key";
const ana = { channel: "email" as const, address: "ana@firm.example", topic: "weekly-breakdown" };

describe("preference links", () => {
  it("read back only with the key they were signed with", () => {
    const t = signLink(KEY, ana);
    expect(readLink(KEY, t)).toEqual(ana);
    expect(readLink("other", t)).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify(["email", "bob@firm.example", null])).toString(
      "base64url",
    );
    expect(readLink(KEY, `${forged}.${sig}`)).toBeNull();
    expect(readLink(KEY, `${body}`)).toBeNull();
    expect(readLink(KEY, "garbage.garbage")).toBeNull();
  });

  it("every marketing email gets one-click unsubscribe and a postal footer", () => {
    const e = marketingEnvelope({
      key: KEY,
      site: "https://site.example",
      address: ana.address,
      topic: ana.topic,
      postal: "1 Main St, Town",
      why: "You signed up at site.example.",
    });
    expect(e.headers[1]).toEqual(["List-Unsubscribe-Post", "List-Unsubscribe=One-Click"]);
    const off = e.headers[0]?.[1].match(/^<https:\/\/site\.example\/prefs\/([^?]+)\?off=1>$/);
    expect(readLink(KEY, off?.[1] ?? "")).toEqual(ana);
    expect(e.footer).toContain("1 Main St, Town");
    expect(() => marketingEnvelope({ ...ana, key: KEY, site: "x", postal: " ", why: "" })).toThrow(
      /postal/,
    );
  });
});
