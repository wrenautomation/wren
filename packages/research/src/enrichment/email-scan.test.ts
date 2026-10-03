import { describe, expect, it } from "vitest";
import { readPage } from "../fetch/htmltext.js";
import { type EmailSignal, scanPage } from "./email-scan.js";

const scan = (html: string, domain: string | null = "acme.com") =>
  scanPage(html, readPage(html).text, {
    pageUrl: "https://acme.com/contact",
    companyDomain: domain,
  });
const byEmail = (signals: EmailSignal[]) => new Map(signals.map((s) => [s.email, s]));

describe("scanPage", () => {
  it("mailto beats text for the same address; context comes from visible text", () => {
    const s = byEmail(
      scan('<a href="mailto:jane@acme.com">Email Jane</a><p>Write to jane@acme.com today.</p>'),
    );
    expect(s.get("jane@acme.com")?.source).toBe("mailto");
    expect(s.get("jane@acme.com")?.context).toContain("Write to");
  });

  it("finds markup-only addresses with empty context", () => {
    const s = byEmail(
      scan('<script type="application/ld+json">{"email": "office@acme.com"}</script><p>Hi.</p>'),
    );
    expect(s.get("office@acme.com")?.source).toBe("markup");
    expect(s.get("office@acme.com")?.context).toBe("");
  });

  it("conservative deobfuscation needs both markers", () => {
    const s = scan(
      "<p>jane [at] acme [dot] com</p><p>bob at acme com</p><p>sue(at)acme(dot)net</p>",
    );
    expect(new Set(s.map((x) => x.email))).toEqual(new Set(["jane@acme.com", "sue@acme.net"]));
  });

  it("bare-word prose never fabricates addresses", () => {
    expect(
      scan(
        "<p>Learn more at wearekyra dot com — we excel at design dot com too.</p>",
        "wearekyra.com",
      ),
    ).toEqual([]);
  });

  it("mailto display names yield the bare address", () => {
    const s = byEmail(scan('<a href="mailto:Jane%20Doe%20%3Cjane@acme.com%3E">write Jane</a>'));
    expect([...s.keys()]).toEqual(["jane@acme.com"]);
    expect(s.get("jane@acme.com")?.source).toBe("mailto");
  });

  it("rejects guaranteed noise", () => {
    const html = `<p>
    logo@2x.png header@3x.webp react@18.2.0
    you@example.com someone@yourdomain.com test@test.com
    a1b2c3d4e5f6a7b8c9d0e1f2@acme.com admin@sentry.io
    real.person@acme.com
    </p>`;
    expect(scan(html).map((s) => s.email)).toEqual(["real.person@acme.com"]);
  });

  it("on_domain is www- and subdomain-blind", () => {
    const s = byEmail(scan("<p>a@acme.com b@www.acme.com c@mail.acme.com d@other.com</p>"));
    expect(s.get("a@acme.com")?.on_domain).toBe(true);
    expect(s.get("b@www.acme.com")?.on_domain).toBe(true);
    expect(s.get("c@mail.acme.com")?.on_domain).toBe(true);
    expect(s.get("d@other.com")?.on_domain).toBe(false);
  });

  it("no company domain means off-domain", () => {
    const s = scan("<p>a@acme.com</p>", null);
    expect(s).toHaveLength(1);
    expect(s[0]?.on_domain).toBe(false);
  });

  it("case folding dedupes", () => {
    expect(scan("<p>Jane@Acme.com and jane@acme.com</p>")).toHaveLength(1);
  });

  it("scans text only without html", () => {
    const s = scanPage(null, "reach us: info@acme.com", {
      pageUrl: "u",
      companyDomain: "acme.com",
    });
    expect(s.map((x) => x.email)).toEqual(["info@acme.com"]);
    expect(s[0]?.source).toBe("text");
  });

  it("digit-led real domains survive", () => {
    const s = byEmail(scan("<p>hello@10up.com and react@18.2.0</p>", "10up.com"));
    expect([...s.keys()]).toEqual(["hello@10up.com"]);
    expect(s.get("hello@10up.com")?.on_domain).toBe(true);
  });

  it("never cuts an emoji in half at the context edge", () => {
    // The 120-char window ends inside the 👤 after, or starts inside the one before.
    const opts = { pageUrl: "https://acme.com", companyDomain: "acme.com" };
    const after = scanPage(null, `jane@acme.com ${"x".repeat(118)}👤`, opts)[0];
    const before = scanPage(null, `👤${"y".repeat(118)} jane@acme.com`, opts)[0];
    expect(after?.context).toBe(`jane@acme.com ${"x".repeat(118)}`);
    expect(before?.context).toBe(`${"y".repeat(118)} jane@acme.com`);
  });
});
