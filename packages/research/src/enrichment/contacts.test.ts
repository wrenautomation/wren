import { describe, expect, it } from "vitest";
import { contactsInPage, socialProfile } from "./contacts.js";

const values = (
  html: string | null,
  text = "",
  people: { id: number; first: string; last: string }[] = [],
) => contactsInPage(html, text, { people }).map((p) => [p.kind, p.value, p.source, p.personId]);

describe("contactsInPage", () => {
  it("reads phones, the company page, socials and a team member's profile from one page", () => {
    const html = `
      <footer>
        <a href="tel:+1-212-555-0187">call</a>
        <a href="https://www.linkedin.com/company/Acme-Studio/">in</a>
        <a href="//twitter.com/AcmeStudio">x</a>
        <a href="https://www.instagram.com/acme.studio/?hl=en">ig</a>
        <a href="https://www.facebook.com/sharer/sharer.php?u=https://acme.test">share</a>
        <a href="https://fb.com/acmestudio">fb</a>
      </footer>
      <div class="card"><h3>Jane Roe</h3><a href="https://www.linkedin.com/in/JaneRoe">in</a></div>
      <div class="card"><h3>Sam Poe</h3></div>
      <a href="https://www.linkedin.com/in/someone-else-123">in</a>`;
    expect(
      values(html, "Or call (718) 555-0142.", [
        { id: 7, first: "Jane", last: "Roe" },
        { id: 8, first: "Sam", last: "Poe" },
      ]),
    ).toEqual([
      ["phone", "+12125550187", "link", null],
      ["phone", "+17185550142", "text", null],
      ["linkedin_company", "https://www.linkedin.com/company/acme-studio/", "link", null],
      ["x", "https://x.com/acmestudio", "link", null],
      ["instagram", "https://www.instagram.com/acme.studio/", "link", null],
      ["facebook", "https://www.facebook.com/acmestudio", "link", null],
      ["linkedin_person", "https://www.linkedin.com/in/janeroe/", "link", 7],
      ["linkedin_person", "https://www.linkedin.com/in/someone-else-123/", "link", null],
    ]);
  });

  it("reads JSON-LD sameAs with escaped slashes", () => {
    const html = `<script type="application/ld+json">{"sameAs":["https:\\/\\/www.youtube.com\\/@AcmeStudio","https:\\/\\/www.tiktok.com\\/@acme.studio"]}</script>`;
    expect(values(html)).toEqual([
      ["youtube", "https://www.youtube.com/@acmestudio", "link", null],
      ["tiktok", "https://www.tiktok.com/@acme.studio", "link", null],
    ]);
  });

  it("an archived page out of reach still gives its kept tel targets", () => {
    expect(contactsInPage(null, "", { tels: ["+12125550187"] })).toEqual([
      { kind: "phone", value: "+12125550187", source: "link", personId: null },
    ]);
  });

  it("a company link with an overlong name is a broken link, not a page", () => {
    const html = `<a href="https://www.linkedin.com/company/${"a%20".repeat(200)}">in</a>`;
    expect(values(html)).toEqual([]);
  });

  it("a profile by two held people's names is nobody's", () => {
    const html = `<p>Jane Roe and Jane Roe</p><a href="https://www.linkedin.com/in/ACoAAB12345678">in</a>`;
    const twins = [
      { id: 1, first: "Jane", last: "Roe" },
      { id: 2, first: "Jane", last: "Roe" },
    ];
    expect(values(html, "", twins)).toEqual([
      ["linkedin_person", "https://www.linkedin.com/in/ACoAAB12345678/", "link", null],
    ]);
  });
});

describe("socialProfile", () => {
  it("skips share buttons, pixels, embeds, widget hosts and template defaults", () => {
    for (const url of [
      "https://twitter.com/intent/tweet?text=hi",
      "https://www.facebook.com/tr?id=123",
      "https://www.youtube.com/embed/abc123",
      "https://www.youtube.com/watch?v=abc123",
      "https://platform.twitter.com/widgets.js",
      "https://www.instagram.com/p/Cx123/",
      "https://www.facebook.com/wix",
      "http://www.facebook.com/2008/fbml",
      "https://www.box.com/acme",
    ]) {
      expect(socialProfile(url), url).toBeNull();
    }
  });
  it("keeps one spelling per profile", () => {
    expect(socialProfile("https://m.facebook.com/profile.php?id=1000123&ref=x")).toEqual({
      kind: "facebook",
      url: "https://www.facebook.com/profile.php?id=1000123",
    });
    expect(socialProfile("https://www.youtube.com/channel/UCabcDEF123")?.url).toBe(
      "https://www.youtube.com/channel/UCabcDEF123",
    );
    expect(socialProfile("https://x.com/AcmeStudio/status/1")?.url).toBe(
      "https://x.com/acmestudio",
    );
  });
});
