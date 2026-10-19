import { parseMessage } from "@wren/core/mail";
import { describe, expect, it } from "vitest";
import { primaryLink, senderDomains } from "./links.js";

const mail = (from: string, html: string, plain = "") =>
  parseMessage(
    [
      `From: ${from}`,
      "Subject: test",
      'Content-Type: multipart/alternative; boundary="b"',
      "",
      "--b",
      "Content-Type: text/plain; charset=utf-8",
      "",
      plain,
      "--b",
      "Content-Type: text/html; charset=utf-8",
      "",
      html,
      "--b--",
      "",
    ].join("\r\n"),
  );

describe("senderDomains", () => {
  it("drops the mail subdomain, keeps country second levels, adds the site behind a mail domain", () => {
    expect(senderDomains("messages-noreply@linkedin.com")).toEqual(["linkedin.com"]);
    expect(senderDomains("no-reply@mail.example.com")).toEqual(["example.com"]);
    expect(senderDomains("x@news.example.co.uk")).toEqual(["example.co.uk"]);
    expect(senderDomains("notification@facebookmail.com")).toEqual([
      "facebookmail.com",
      "facebook.com",
    ]);
    expect(senderDomains("nobody")).toEqual([]);
  });
});

describe("primaryLink", () => {
  it("picks the button that names the thing over the logo and the settings links", () => {
    const html = `
      <a href="https://www.linkedin.com/comm/feed/?trk=logo"><img src="https://static.licdn.com/logo.png"></a>
      <p>Pat Example sent you a message.</p>
      <a href="https://www.linkedin.com/comm/messaging/thread/2-abc==?lipi=x&amp;trk=eml">Reply</a>
      <a href="https://www.linkedin.com/comm/psettings/email?trk=eml">Unsubscribe</a>
      <a href="https://www.linkedin.com/help/linkedin">Help</a>`;
    expect(
      primaryLink(mail("messages-noreply@linkedin.com", html), "messages-noreply@linkedin.com"),
    ).toBe("https://www.linkedin.com/comm/messaging/thread/2-abc==?lipi=x&trk=eml");
  });

  it("falls back to the first page link when no text names the thing", () => {
    const html = `<a href="https://www.reddit.com/"><img src="x.png"></a>
      <a href="https://www.reddit.com/r/test/comments/abc/_/def/?ref=mail">u/someone</a>`;
    expect(primaryLink(mail("noreply@redditmail.com", html), "noreply@redditmail.com")).toBe(
      "https://www.reddit.com/r/test/comments/abc/_/def/?ref=mail",
    );
  });

  it("ignores links on other domains", () => {
    const html = `<a href="https://tracker.example.net/click?u=1">View message</a>`;
    expect(primaryLink(mail("a@linkedin.com", html), "a@linkedin.com")).toBeNull();
  });

  it("reads a plain-text mail's bare URLs", () => {
    const msg = parseMessage(
      "From: notifications@github.com\r\nContent-Type: text/plain\r\n\r\nSee https://github.com/org/repo/issues/12#issuecomment-1.\r\n",
    );
    expect(primaryLink(msg, "notifications@github.com")).toBe(
      "https://github.com/org/repo/issues/12#issuecomment-1",
    );
  });

  it("is null for a person's hand-written mail", () => {
    expect(
      primaryLink(mail("pat@example.com", "<p>hi, call me</p>", "hi"), "pat@example.com"),
    ).toBeNull();
  });
});
