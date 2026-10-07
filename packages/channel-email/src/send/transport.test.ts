/** The transport contract and its console implementation (§4). */
import { describe, expect, it } from "vitest";
import {
  buildPixelUrl,
  ConsoleTransport,
  carrierOf,
  fillPage,
  type OutgoingEmail,
  RoutedTransport,
  renderedSubject,
  TransportAmbiguous,
  TransportRefused,
  toHtml,
  visibleText,
  withLinkCode,
} from "./transport.js";

const SENDER = "will@wren-automation.com";

function mail(overrides: Partial<OutgoingEmail> = {}): OutgoingEmail {
  return {
    fromAddress: SENDER,
    fromName: "Will Jin",
    to: "jane@acme.example",
    subject: "Quick question, Jane",
    replySubject: null,
    body: "Hello there.",
    messageId: "<m1@wren-automation.com>",
    ...overrides,
  };
}

function capture(): { lines: string[]; write: (l: string) => void } {
  const lines: string[] = [];
  return { lines, write: (l) => lines.push(l) };
}

describe("ConsoleTransport", () => {
  it("records the message and returns our id", async () => {
    const out = capture();
    const transport = new ConsoleTransport({ write: out.write });
    const receipt = await transport.send(mail());
    expect(transport.name).toBe("console");
    expect(receipt.messageId).toBe("<m1@wren-automation.com>");
    expect(receipt.providerId).toBe("console-1");
    expect(receipt.threadId.startsWith("t-")).toBe(true);
    expect(receipt.internalDate).not.toBeNull();
    expect(transport.mailbox.get(SENDER)).toEqual([{ email: mail(), receipt }]);
    const printed = out.lines.join("\n");
    expect(printed).toContain("--- to jane@acme.example | Quick question, Jane");
    expect(printed).toContain("    from Will Jin <will@wren-automation.com>");
    expect(printed).toContain("Hello there.");
  });

  it("a riding step keeps the thread and says so", async () => {
    const out = capture();
    const transport = new ConsoleTransport({ write: out.write });
    const receipt = await transport.send(
      mail({
        subject: null,
        replySubject: "Quick question, Jane",
        inReplyTo: "<m1@wren-automation.com>",
        references: ["<m1@wren-automation.com>"],
        threadId: "thread-77",
        messageId: "<m2@wren-automation.com>",
      }),
    );
    expect(receipt.threadId).toBe("thread-77");
    const printed = out.lines.join("\n");
    expect(printed).toContain("--- to jane@acme.example | Re: Quick question, Jane (rides thread)");
    expect(printed).toContain("    in-reply-to <m1@wren-automation.com>");
  });

  it.each([
    ["Quick question, Jane", null, "Quick question, Jane"],
    [null, "Quick question, Jane", "Re: Quick question, Jane"],
    [null, null, "Re:"],
    ["Hi Dana\r\nBcc: x@example.com", null, "Hi Dana Bcc: x@example.com"],
    [null, "Old\nthread", "Re: Old thread"],
  ])(
    "subject rendering is one rule for every transport (%s, %s)",
    (subject, replySubject, expected) => {
      expect(renderedSubject(mail({ subject, replySubject }))).toBe(expected);
    },
  );

  it("provider ids are unique and the mailbox is keyed by sender", async () => {
    const transport = new ConsoleTransport({ write: () => {} });
    const first = await transport.send(mail());
    const second = await transport.send(mail({ messageId: "<m2@wren-automation.com>" }));
    const other = await transport.send(
      mail({ fromAddress: "sam@wren-automation.org", messageId: "<m3@wren-automation.org>" }),
    );
    expect([first.providerId, second.providerId, other.providerId]).toEqual([
      "console-1",
      "console-2",
      "console-3",
    ]);
    expect(first.threadId).not.toBe(second.threadId);
    expect(transport.mailbox.get(SENDER)).toHaveLength(2);
    expect(transport.mailbox.get("sam@wren-automation.org")).toHaveLength(1);
  });

  it("find answers the question reconcile asks", async () => {
    const transport = new ConsoleTransport({ write: () => {} });
    const receipt = await transport.send(mail());
    expect(await transport.find(SENDER, "<m1@wren-automation.com>")).toEqual(receipt);
    expect(await transport.find(SENDER, "<never-sent@wren-automation.com>")).toBeNull();
    expect(await transport.find("sam@wren-automation.org", "<m1@wren-automation.com>")).toBeNull();
  });

  it("a refusal happens before anything is recorded", async () => {
    const transport = new ConsoleTransport({
      write: () => {},
      refuse: (email) =>
        email.to.endsWith("@acme.example")
          ? new TransportRefused("mailbox suspended", { senderLevel: true })
          : null,
    });
    await expect(transport.send(mail())).rejects.toMatchObject({ senderLevel: true });
    expect(transport.mailbox.size).toBe(0);
    const delivered = await transport.send(mail({ to: "sam@other.example" }));
    expect(await transport.find(SENDER, delivered.messageId)).toEqual(delivered);
  });

  it("an ambiguous send is in the mailbox despite the exception", async () => {
    const transport = new ConsoleTransport({ write: () => {}, ambiguousAfter: () => true });
    await expect(transport.send(mail())).rejects.toBeInstanceOf(TransportAmbiguous);
    const found = await transport.find(SENDER, "<m1@wren-automation.com>");
    expect(found?.providerId).toBe("console-1");
  });

  it("find can be made to fail so reconcile never guesses", async () => {
    const transport = new ConsoleTransport({ write: () => {}, findFails: new Error("gmail down") });
    await expect(transport.find(SENDER, "<m1@wren-automation.com>")).rejects.toThrow("gmail down");
  });

  it("refusal is message-level unless the inbox itself is unusable", () => {
    expect(new TransportRefused("bad recipient").senderLevel).toBe(false);
    expect(new TransportRefused("token refused", { senderLevel: true }).senderLevel).toBe(true);
  });
});

describe("RoutedTransport", () => {
  it("each sender goes through its own carrier, the rest through the fallback", async () => {
    const quiet = { write: () => {} };
    const gmail = new ConsoleTransport(quiet);
    const own = new ConsoleTransport(quiet);
    const routed = new RoutedTransport(gmail, new Map([["ann@example.com", own]]));
    await routed.send(mail({ fromAddress: "Ann@example.com" }));
    await routed.send(mail());
    expect([...own.mailbox.keys()]).toEqual(["Ann@example.com"]);
    expect([...gmail.mailbox.keys()]).toEqual([SENDER]);
    expect(carrierOf(routed, "ANN@example.com")).toBe(own);
    expect(carrierOf(routed, SENDER)).toBe(gmail);
    expect(carrierOf(gmail, SENDER)).toBe(gmail);
    expect(await routed.find("Ann@example.com", "<m1@wren-automation.com>")).not.toBeNull();
  });
});

/** The words a reader sees: markup removed, entities back, block boundaries as newlines. */
function visible(html: string): string {
  let text = html
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/p>|<\/div>/g, "\n\n")
    .replace(/<[^>]+>/g, "");
  text = text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

const SIGNED =
  "Hi Dana,\n\nOne line, then another\nright under it.\n\nWilliam\n\n--\nWilliam Jin\nFounder, Wren Automation\nwrenautomation.com";

const AUTHORED_HTML =
  '--<br>\n<b>William Jin</b><br>\nFounder, Wren Automation<br>\n<a href="https://wrenautomation.com" style="color:#888888">wrenautomation.com</a>';

describe("toHtml", () => {
  it("the html part says exactly what the plain part says", () => {
    const seen = visible(toHtml(SIGNED))
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l);
    expect(seen).toEqual(SIGNED.split("\n").filter((l) => l.trim()));
  });
  it("the signature is styled and the body is not", () => {
    const html = toHtml(SIGNED);
    expect(html).toContain('<span style="font-weight:bold">William Jin</span>');
    expect(
      html.includes("Founder, Wren Automation<br>") ||
        html.includes("Founder, Wren Automation</p>"),
    ).toBe(true);
    expect(html).toContain('<a href="https://wrenautomation.com"');
    expect(html).toContain("text-decoration:underline");
    expect(html.split("<a ").length - 1).toBe(1);
    expect(html.split("font-weight:bold").length - 1).toBe(1);
  });
  it("a body with no signature is just paragraphs", () => {
    const html = toHtml("Hi Dana,\n\nWorth a reply?");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("font-weight:bold");
    expect(visible(html)).toBe("Hi Dana,\n\nWorth a reply?");
  });
  it("prose that mentions a domain mid-sentence never becomes a link", () => {
    const html = toHtml("We looked at acme.com and liked it.\n\n--\nWilliam Jin\nwren.com");
    expect(html).not.toContain('<a href="https://acme.com"');
    expect(html).toContain('<a href="https://wren.com"');
  });
  it("a template's markup is escaped like any other words", () => {
    const html = toHtml('Hi <img src=x onerror="alert(1)"> {first_name}\n\n<script>x()</script>');
    expect(html).not.toMatch(/<img|<script/);
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
  it("html in the body is escaped, never emitted", () => {
    const html = toHtml('Costs <$1,000 & "worth it"\n\n--\nWilliam Jin');
    expect(html).toContain("&lt;$1,000 &amp; &quot;worth it&quot;");
    expect(html).not.toContain("<$1,000");
  });
  it("a script a prospect could never have asked for cannot appear", () => {
    const html = toHtml("<script>alert(1)</script><img src=x>\n\n--\nWilliam Jin").toLowerCase();
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });
  it("an authored signature is used verbatim when it matches the body", () => {
    const html = toHtml(SIGNED, AUTHORED_HTML);
    expect(html).toContain("<b>William Jin</b>");
    expect(html).not.toContain("font-weight:bold");
    expect(visible(html).endsWith("wrenautomation.com")).toBe(true);
  });
  it("an authored signature that no longer matches the body is ignored", () => {
    const stale = "--<br>\n<b>Someone Else</b><br>\nCEO, Other Co";
    const html = toHtml(SIGNED, stale);
    expect(html).not.toContain("Someone Else");
    expect(html).toContain("William Jin");
    expect(visible(html)).toBe(visible(toHtml(SIGNED)));
  });
  it("visible text is what decides whether two forms agree", () => {
    expect(visibleText(AUTHORED_HTML)).toBe(
      "--\nWilliam Jin\nFounder, Wren Automation\nwrenautomation.com",
    );
    expect(visibleText("<p>a &amp; b</p>")).toBe("a & b");
  });
});

describe("withLinkCode", () => {
  const signOff = "--\nWilliam Jin\nwrenautomation.com/recruiting";
  it("tags the sign-off's own site link and leaves its text bare", () => {
    const html = toHtml(`Hi.\n\n${signOff}`, null, null, "abcDEF123_-x");
    expect(html).toContain('href="https://wrenautomation.com/recruiting?r=abcDEF123_-x"');
    expect(html).toContain(">wrenautomation.com/recruiting</a>");
    expect(visibleText(html)).not.toContain("?r=");
  });
  it("never tags a link whose text is not its own address", () => {
    const other =
      '<a href="https://linkedin.com/in/x">LinkedIn</a> <a href="https://evil.com">wrenautomation.com</a>';
    expect(withLinkCode(other, "abcDEF123456")).toBe(other);
  });
  it("is off without a code and refuses a code of another shape", () => {
    const html = toHtml(`Hi.\n\n${signOff}`);
    expect(html).not.toContain("?r=");
    expect(() => withLinkCode(html, 'a b"c')).toThrow("link code");
  });
});

describe("fillPage", () => {
  it("puts the lander path in the slot", () => {
    expect(fillPage("wrenautomation.com{page}", "/agencies")).toBe("wrenautomation.com/agencies");
    expect(fillPage("wrenautomation.com{page}", "")).toBe("wrenautomation.com");
    expect(fillPage("wrenautomation.com{page}", "/")).toBe("wrenautomation.com");
    expect(fillPage("wrenautomation.com", "/ria")).toBe("wrenautomation.com");
    expect(fillPage("wrenautomation.com{page}", "/recruiting/lead-reactivation")).toBe(
      "wrenautomation.com/recruiting/lead-reactivation",
    );
  });
  it("refuses anything but a plain path", () => {
    for (const bad of ["agencies", "/agencies?x=1", "https://x.com/a", "/a b", "/a/", "/a_b"]) {
      expect(() => fillPage("wrenautomation.com{page}", bad)).toThrow("plain path");
    }
  });
  it("a domain with a path is linked in the derived signature", () => {
    const body = SIGNED.replace("wrenautomation.com", "wrenautomation.com/agencies");
    const html = toHtml(body);
    expect(html).toContain('href="https://wrenautomation.com/agencies"');
    expect(visible(html).endsWith("wrenautomation.com/agencies")).toBe(true);
    const nested = toHtml(
      SIGNED.replace("wrenautomation.com", "wrenautomation.com/recruiting/lead-reactivation"),
    );
    expect(nested).toContain('href="https://wrenautomation.com/recruiting/lead-reactivation"');
    expect(toHtml(SIGNED.replace("wrenautomation.com", "wrenautomation.com/a?b=1"))).not.toContain(
      "href=",
    );
  });
  it("a filled authored signature matches a filled body", () => {
    const body = SIGNED.replace("wrenautomation.com", "wrenautomation.com/ria");
    const authored = fillPage(
      AUTHORED_HTML.replaceAll("wrenautomation.com", "wrenautomation.com{page}"),
      "/ria",
    );
    const html = toHtml(body, authored);
    expect(html).toContain("<b>William Jin</b>");
    expect(html).toContain('href="https://wrenautomation.com/ria"');
  });
});

describe("the pixel", () => {
  const TOKEN = "PxJb3nQ7RtY2kLmW9dF4vAeH";
  const URL = `https://t.wrenautomation.com/p/${TOKEN}.gif`;
  it("no pixel is the default and the html fetches nothing", () => {
    const html = toHtml("Hi there.\n\n--\nWilliam Jin\nwrenautomation.com");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("src=");
  });
  it("a pixel is the last thing in the part and adds no words", () => {
    const body = "Hi there.\n\n--\nWilliam Jin\nwrenautomation.com";
    const html = toHtml(body, null, URL);
    expect(html.split("<img").length - 1).toBe(1);
    expect(html.trimEnd().endsWith(">")).toBe(true);
    expect(html).toContain(URL);
    expect(visible(html)).toBe(visible(toHtml(body)));
  });
  it("a pixel url is built only when both halves exist", () => {
    expect(buildPixelUrl("https://t.wrenautomation.com", TOKEN)).toBe(URL);
    expect(buildPixelUrl("https://t.wrenautomation.com/", TOKEN)).toBe(URL);
    expect(buildPixelUrl(null, TOKEN)).toBeNull();
    expect(buildPixelUrl("https://t.wrenautomation.com", null)).toBeNull();
    expect(buildPixelUrl(null, null)).toBeNull();
  });
  it.each([
    ["http://t.wrenautomation.com", TOKEN],
    ["https://t.wrenautomation.com", "short"],
    ["https://t.wrenautomation.com", "has spaces in it aaaaaaaaaaa"],
    ["https://evil.example/a?x=", TOKEN],
    ["javascript:alert(1)//", TOKEN],
  ])("a url that is not our pixel shape is refused (%s, %s)", (base, token) => {
    expect(() => buildPixelUrl(base, token)).toThrow();
  });
  it("the pixel is not display:none", () => {
    expect(toHtml("Hi.", null, URL)).not.toContain("display:none");
  });
});

describe("visibleText entities", () => {
  it("reads an out-of-range reference as U+FFFD and knows the full named table", () => {
    expect(visibleText("<p>a &#99999999; &eacute;&hearts;&nbsp;b</p>")).toBe("a � é♥ b");
  });
});
