import { describe, expect, it } from "vitest";
import { type Issue, issueMail, testAllowed } from "./newsletter.js";

const issue: Issue = {
  topic: "newsletter",
  slug: "first-post",
  subject: "What I built",
  text: "The post.",
  url: "https://example.test/blog/first-post",
};

describe("issueMail", () => {
  it("is the post, a line to the page, then the footer, with the unsubscribe headers", () => {
    const headers: [string, string][] = [["List-Unsubscribe", "<https://example.test/off>"]];
    const m = issueMail({ issue, to: "a@b.example", footer: "\n\n--\nfooter", headers });
    expect(m.subject).toBe("What I built");
    expect(m.text).toBe(
      "The post.\n\nOn the site, with the pictures: https://example.test/blog/first-post\n\n--\nfooter",
    );
    expect(m.headers).toBe(headers);
  });

  it("tags the post's links with where they came from, but not the footer's", () => {
    const m = issueMail({
      issue: { ...issue, text: "Read https://other.example/guide today." },
      to: "a@b.example",
      footer: "\n\n--\nhttps://example.test/prefs/abc?off=1",
      headers: [],
      tags: { source: "wren", medium: "email", campaign: "first-post" },
    });
    const tag = "utm_source=wren&utm_medium=email&utm_campaign=first-post";
    expect(m.text).toBe(
      `Read https://other.example/guide?${tag} today.\n\nOn the site, with the pictures: https://example.test/blog/first-post?${tag}\n\n--\nhttps://example.test/prefs/abc?off=1`,
    );
  });

  it("marks a test", () => {
    expect(
      issueMail({ issue, to: "a@b.example", footer: "", headers: [], test: true }).subject,
    ).toBe("[test] What I built");
  });
});

describe("testAllowed", () => {
  it("lets a test go to the sending domain only", () => {
    expect(testAllowed("Me@Example.test", "portal@example.test")).toBe(true);
    expect(testAllowed("me@other.test", "portal@example.test")).toBe(false);
    expect(testAllowed("me@sub.example.test", "portal@example.test")).toBe(false);
  });
});
