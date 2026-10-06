/**
 * Inbound classification: real .eml shapes -> one deterministic verdict.
 * Every fixture in test/fixtures/inbound/ is a message shape the pipeline will
 * actually meet in a sending inbox.
 */
import { readFileSync } from "node:fs";
import { getAddresses, parseAddr, parseDate, parseMessage } from "@wren/core/mail";
import { describe, expect, it } from "vitest";
import { classify, type Inbound, normalizeMessageId, ownText } from "./inbound.js";

const FIXTURES = new URL("../../test/fixtures/inbound/", import.meta.url);
// The Message-ID of the outreach message these fixtures answer.
const OURS = ["<abc@wren-automation.com>"];

function bytes(name: string): Buffer {
  return readFileSync(new URL(`${name}.eml`, FIXTURES));
}

function read(name: string, ours: readonly string[] = OURS): Inbound {
  return classify(bytes(name), { ourMessageIds: ours });
}

function raw(headers: string, body = ""): Buffer {
  return Buffer.from(`${headers.trim()}\n\n${body}`, "utf-8");
}

function must(value: string | null): string {
  if (value === null) throw new Error("expected a value");
  return value;
}

describe("bounces", () => {
  it("gmail dsn hard", () => {
    const inbound = read("gmail_dsn_hard");
    expect(inbound.kind).toBe("bounce");
    expect(inbound.bounceClass).toBe("hard");
    expect(inbound.bouncedAddress).toBe("nobody@example.com");
    expect(inbound.bounceStatus).toBe("5.1.1");
    expect(must(inbound.diagnostic)).toContain("550-5.1.1");
    expect(must(inbound.diagnostic)).toContain("does not exist");
    // Our Message-ID rides in the embedded original, not in In-Reply-To.
    expect(inbound.inReplyTo).toBeNull();
    expect(inbound.originalMessageId).toBe("<abc@wren-automation.com>");
    expect(inbound.matchedMessageId).toBe("<abc@wren-automation.com>");
    expect(inbound.matchedBy).toBe("embedded_original");
    expect(inbound.fromAddress).toBe("mailer-daemon@googlemail.com");
    expect(inbound.fromName).toBe("Mail Delivery Subsystem");
    expect(inbound.isAuto).toBe(true);
    expect(inbound.date).not.toBeNull();
    expect(inbound.date?.toISOString()).toBe("2026-09-07T16:14:02.000Z");
  });

  it("gmail dsn delayed is a soft bounce", () => {
    const inbound = read("gmail_dsn_delayed");
    expect(inbound.kind).toBe("bounce");
    expect(inbound.bounceClass).toBe("soft");
    expect(inbound.bouncedAddress).toBe("slow@example.net");
    expect(inbound.bounceStatus).toBe("4.4.1");
    expect(must(inbound.diagnostic)).toContain("421 4.4.1");
    // text/rfc822-headers carries the original instead of a message/rfc822 part.
    expect(inbound.matchedMessageId).toBe("<abc@wren-automation.com>");
    expect(inbound.matchedBy).toBe("embedded_original");
  });

  it("gmail dsn that gave up on a 4.x.x is still soft (dead MX, not a bad address)", () => {
    const inbound = read("gmail_dsn_failed_4xx");
    expect(inbound.kind).toBe("bounce");
    expect(inbound.bounceClass).toBe("soft");
    expect(inbound.bounceStatus).toBe("4.4.1");
  });

  it("microsoft ndr without a report part", () => {
    const inbound = read("microsoft_ndr");
    expect(inbound.kind).toBe("bounce");
    expect(inbound.bounceClass).toBe("hard");
    expect(inbound.bouncedAddress).toBe("nobody@example.com"); // X-Failed-Recipients
    expect(inbound.bounceStatus).toBe("5.1.10");
    expect(must(inbound.diagnostic)).toContain("RESOLVER.ADR.RecipientNotFound");
    expect(must(inbound.diagnostic)).toContain("not found by SMTP address lookup");
    expect(inbound.matchedMessageId).toBe("<abc@wren-automation.com>");
    expect(inbound.matchedBy).toBe("references");
    expect(inbound.fromAddress).toBe("postmaster@example.com");
  });

  it("bounce with no parsable address is still a bounce", () => {
    const inbound = classify(
      raw(
        `
From: MAILER-DAEMON@example.net
To: will@wren-automation.com
Subject: Returned mail: see transcript for details
Date: Mon, 7 Sep 2026 12:00:00 +0000
Message-ID: <daemon-99@example.net>
Content-Type: text/plain; charset="utf-8"
`,
        "The original message was received but could not be delivered.\nThe transcript is unavailable.\n",
      ),
    );
    expect(inbound.kind).toBe("bounce");
    // The subject announces a failure and nothing states permanence: SOFT.
    expect(inbound.bounceClass).toBe("soft");
    expect(inbound.bouncedAddress).toBeNull();
    expect(inbound.bounceStatus).toBeNull();
  });

  it("exchange ndr without any status code is soft", () => {
    const inbound = read("exchange_ndr_no_status_code");
    expect(inbound.kind).toBe("bounce");
    expect(inbound.bounceClass).toBe("soft");
    expect(inbound.bounceStatus).toBeNull();
    expect(inbound.bouncedAddress).toBe("dana@example.com");
    expect(must(inbound.diagnostic)).toContain("Delivery has failed");
    expect(inbound.matchedMessageId).toBe("<abc@wren-automation.com>");
    expect(inbound.matchedBy).toBe("references");
  });

  it("the same ndr carrying a status code is hard", () => {
    const inbound = classify(
      raw(
        `
From: postmaster@example.com
To: will@wren-automation.com
Subject: Undeliverable: Quick question about your agency
Date: Mon, 7 Sep 2026 17:05:19 +0000
Message-ID: <ndr-coded@example.com>
References: <abc@wren-automation.com>
Content-Type: text/plain; charset="utf-8"
`,
        "Delivery has failed to these recipients or groups:\n\ndana@example.com\n\nRemote Server returned '550 5.1.1 RESOLVER.ADR.RecipientNotFound'\n",
      ),
      { ourMessageIds: OURS },
    );
    expect(inbound.kind).toBe("bounce");
    expect(inbound.bounceClass).toBe("hard");
    expect(inbound.bounceStatus).toBe("5.1.1");
    expect(inbound.bouncedAddress).toBe("dana@example.com");
  });

  it("daemon mail with no verdict at all stays soft", () => {
    const inbound = classify(
      raw(
        `
From: Mail Delivery Subsystem <mailer-daemon@example.net>
To: will@wren-automation.com
Subject: Message status
Date: Mon, 7 Sep 2026 12:00:00 +0000
Message-ID: <daemon-100@example.net>
Content-Type: text/plain; charset="utf-8"
`,
        "Your message is still being processed by the remote host.\n",
      ),
    );
    expect(inbound.kind).toBe("bounce");
    expect(inbound.bounceClass).toBe("soft");
  });

  it("original-message-id header matches and body names the address", () => {
    const inbound = classify(
      raw(
        `
From: Mail Delivery Subsystem <mailer-daemon@example.net>
To: will@wren-automation.com
Subject: Undeliverable: Quick question about your agency
Date: Mon, 7 Sep 2026 12:00:00 +0000
Message-ID: <daemon-101@example.net>
Original-Message-ID: <abc@wren-automation.com>
Content-Type: text/plain; charset="utf-8"
`,
        "The following address failed:\n\n550 5.1.1 unknown user gone@example.org\n",
      ),
      { ourMessageIds: OURS },
    );
    expect(inbound.kind).toBe("bounce");
    expect(inbound.bounceClass).toBe("hard");
    expect(inbound.bounceStatus).toBe("5.1.1");
    expect(inbound.bouncedAddress).toBe("gone@example.org");
    expect(inbound.originalMessageId).toBe("<abc@wren-automation.com>");
    expect(inbound.matchedBy).toBe("embedded_original");
  });
});

describe("receipts", () => {
  it("receipt mdn", () => {
    const inbound = read("receipt_mdn");
    expect(inbound.kind).toBe("receipt");
    expect(inbound.bounceClass).toBeNull();
    expect(inbound.bouncedAddress).toBeNull();
    expect(inbound.originalMessageId).toBe("<abc@wren-automation.com>");
    expect(inbound.matchedBy).toBe("embedded_original");
    expect(inbound.isAuto).toBe(true);
  });

  it("delivery report saying delivered is a receipt not a bounce", () => {
    const inbound = classify(
      raw(
        `
From: Mail Delivery Subsystem <mailer-daemon@example.net>
To: will@wren-automation.com
Subject: Delivery Status Notification (Success)
Date: Mon, 7 Sep 2026 12:00:00 +0000
Message-ID: <dsn-ok@example.net>
MIME-Version: 1.0
Content-Type: multipart/report; report-type=delivery-status; boundary="b1"
`,
        `--b1
Content-Type: text/plain; charset="utf-8"

Your message was successfully delivered.

--b1
Content-Type: message/delivery-status

Reporting-MTA: dns; example.net

Final-Recipient: rfc822; ok@example.com
Action: delivered
Status: 2.0.0

--b1--
`,
      ),
    );
    expect(inbound.kind).toBe("receipt");
    expect(inbound.bounceClass).toBeNull();
  });
});

describe("auto-replies", () => {
  it("ooo auto-submitted", () => {
    const inbound = read("ooo_auto_submitted");
    expect(inbound.kind).toBe("auto_reply");
    expect(inbound.isAuto).toBe(true);
    expect(inbound.autoSubmitted).toBe("auto-replied");
    expect(inbound.fromAddress).toBe("dana@example.com");
    expect(inbound.fromName).toBe("Dana Reyes");
    expect(inbound.matchedMessageId).toBe("<abc@wren-automation.com>");
    expect(inbound.matchedBy).toBe("in_reply_to");
    expect(inbound.bounceClass).toBeNull();
  });

  it("ooo subject only: no auto headers at all, the subject is the whole signal", () => {
    const inbound = read("ooo_subject_only");
    expect(inbound.kind).toBe("auto_reply");
    expect(inbound.autoSubmitted).toBeNull();
    expect(inbound.isAuto).toBe(true);
    expect(inbound.fromAddress).toBe("sam@example.net"); // lowercased addr-spec
    expect(inbound.matchedBy).toBe("in_reply_to");
  });

  it("ooo x-auto-response-suppress: an ordinary Re: subject, only the header says autoresponder", () => {
    const inbound = read("ooo_x_auto_response_suppress");
    expect(inbound.kind).toBe("auto_reply");
    expect(inbound.isAuto).toBe(true);
    expect(inbound.matchedBy).toBe("in_reply_to");
  });

  it("auto-reply beats unsubscribe: machines do not opt out", () => {
    const inbound = classify(
      raw(
        `
From: Dana Reyes <dana@example.com>
To: will@wren-automation.com
Subject: Automatic reply: Quick question about your agency
Date: Mon, 7 Sep 2026 12:00:00 +0000
Message-ID: <ooo-unsub@example.com>
In-Reply-To: <abc@wren-automation.com>
Content-Type: text/plain; charset="utf-8"
`,
        "Please remove me from your list.\n",
      ),
      { ourMessageIds: OURS },
    );
    expect(inbound.kind).toBe("auto_reply");
    expect(inbound.isAuto).toBe(true);
  });
});

describe("unsubscribes", () => {
  it("unsubscribe short", () => {
    const inbound = read("unsubscribe_short");
    expect(inbound.kind).toBe("unsubscribe");
    expect(inbound.fromAddress).toBe("pat@example.net");
    expect(inbound.matchedMessageId).toBe("<abc@wren-automation.com>");
    expect(inbound.matchedBy).toBe("in_reply_to");
    expect(inbound.snippet).toBe("Please remove me from your list.");
    expect(must(inbound.snippet)).not.toContain("wrote:");
    expect(must(inbound.snippet)).not.toContain("Shopify");
  });

  it("unsubscribe mailto subject with empty body", () => {
    const inbound = read("unsubscribe_mailto");
    expect(inbound.kind).toBe("unsubscribe");
    expect(inbound.snippet).toBeNull();
    expect(inbound.matchedMessageId).toBeNull();
    expect(inbound.matchedBy).toBeNull();
    expect(inbound.references).toEqual([]);
  });

  it("long reply mentioning unsubscribe is a reply (the 25-word rule)", () => {
    const body =
      "Thanks for the note, but I should be straight with you about how we " +
      "work here: we unsubscribe from vendors who cold email us twice in the " +
      "same week, and we already have two agency partners covering overflow " +
      "for the rest of this year, so there is nothing useful for us to talk " +
      "about right now.\n";
    expect(body.split(/\s+/).filter(Boolean).length).toBeGreaterThan(40);
    const inbound = classify(
      raw(
        `
From: Alex Kim <alex@example.com>
To: will@wren-automation.com
Subject: Re: Quick question about your agency
Date: Mon, 7 Sep 2026 12:00:00 +0000
Message-ID: <long-reply@example.com>
In-Reply-To: <abc@wren-automation.com>
Content-Type: text/plain; charset="utf-8"
`,
        body,
      ),
      { ourMessageIds: OURS },
    );
    expect(inbound.kind).toBe("reply");
    expect(inbound.matchedBy).toBe("in_reply_to");
  });
});

describe("replies", () => {
  it("human reply", () => {
    const inbound = read("human_reply");
    expect(inbound.kind).toBe("reply");
    expect(inbound.bounceClass).toBeNull();
    expect(inbound.isAuto).toBe(false);
    expect(inbound.fromAddress).toBe("jordan.blake@example.com");
    expect(inbound.references).toEqual(["<abc@wren-automation.com>"]);
    expect(inbound.inReplyTo).toBeNull();
    expect(inbound.matchedMessageId).toBe("<abc@wren-automation.com>");
    expect(inbound.matchedBy).toBe("references");
    const snippet = must(inbound.snippet);
    expect(snippet.startsWith("Thanks for reaching out")).toBe(true);
    expect(snippet).toContain("Tuesday or Wednesday afternoon");
    // The quoted original, its attribution line and the signature are gone.
    expect(snippet).not.toContain("wrote:");
    expect(snippet).not.toContain("Worth a quick chat");
    expect(snippet).not.toContain("Head of Delivery");
    expect(snippet.length).toBeLessThanOrEqual(300);
  });

  it("human reply html only", () => {
    const inbound = read("human_reply_html_only");
    expect(inbound.kind).toBe("reply");
    const snippet = must(inbound.snippet);
    expect(snippet.startsWith("Interesting timing")).toBe(true);
    expect(snippet).toContain("Send over what a pilot would look like.");
    expect(snippet).not.toContain("wrote:");
    expect(snippet).not.toContain("Hi there");
    expect(snippet).not.toContain("<div");
    expect(inbound.matchedBy).toBe("in_reply_to");
  });

  it("warmup-like mail is an unmatched reply", () => {
    const inbound = read("warmup_like");
    expect(inbound.kind).toBe("reply");
    expect(inbound.matchedMessageId).toBeNull();
    expect(inbound.matchedBy).toBeNull();
    expect(inbound.inReplyTo).toBeNull();
    expect(inbound.references).toEqual([]);
    // It says "unsubscribe" — the 25-word rule is what keeps it a reply.
    const text = ownText(parseMessage(bytes("warmup_like")));
    expect(text.toLowerCase()).toContain("unsubscribe");
    expect(text.split(/\s+/).length).toBeGreaterThan(25);
    expect(must(inbound.snippet).length).toBeLessThanOrEqual(300);
  });

  it("snippet is capped at 300 characters", () => {
    const inbound = classify(
      raw(
        `
From: Alex Kim <alex@example.com>
To: will@wren-automation.com
Subject: Re: Quick question about your agency
Date: Mon, 7 Sep 2026 12:00:00 +0000
Message-ID: <long@example.com>
Content-Type: text/plain; charset="utf-8"
`,
        "word ".repeat(400),
      ),
    );
    expect(must(inbound.snippet).length).toBeLessThanOrEqual(300);
  });

  it("unparsable date is null", () => {
    const inbound = classify(
      raw(
        `
From: Alex Kim <alex@example.com>
To: will@wren-automation.com
Subject: Re: Quick question about your agency
Date: whenever I get around to it
Message-ID: <baddate@example.com>
Content-Type: text/plain; charset="utf-8"
`,
        "Sounds good.\n",
      ),
    );
    expect(inbound.date).toBeNull();
    expect(inbound.kind).toBe("reply");
  });
});

describe("helpers the sync reuses", () => {
  it("normalizeMessageId", () => {
    expect(normalizeMessageId(" <ABC@Wren-Automation.com> ")).toBe("abc@wren-automation.com");
    expect(normalizeMessageId("abc@wren-automation.com")).toBe("abc@wren-automation.com");
    expect(normalizeMessageId("<<abc@x.com>>")).toBe("abc@x.com");
    expect(normalizeMessageId("")).toBe("");
  });

  it("ownText drops quotes and collapses whitespace", () => {
    const text = ownText(parseMessage(bytes("human_reply")));
    expect(text.startsWith("Thanks for reaching out")).toBe(true);
    expect(text).not.toContain("\n");
    expect(text).not.toContain(">");
    expect(text).not.toContain("wrote:");
  });
});

describe("the MIME reader", () => {
  it("decodes encoded words, quoted-printable and base64", () => {
    const msg = parseMessage(
      raw(
        `
From: =?utf-8?B?RMOhbmEgUsOpeWVz?= <dana@example.com>
Subject: =?utf-8?Q?Re=3A_caf=C3=A9?=
Content-Type: text/plain; charset="utf-8"
Content-Transfer-Encoding: quoted-printable
`,
        "caf=C3=A9 on the corner=\nof the street\n",
      ),
    );
    expect(parseAddr(msg.get("From") ?? "")).toEqual(["Dána Réyes", "dana@example.com"]);
    expect(msg.get("Subject")).toBe("Re: café");
    expect(msg.text()).toBe("café on the cornerof the street\n");
    const b64 = parseMessage(
      raw(
        `
Content-Type: text/plain; charset="iso-8859-1"
Content-Transfer-Encoding: base64
`,
        Buffer.from("na\xefve", "latin1").toString("base64"),
      ),
    );
    expect(b64.text()).toBe("naïve");
  });

  it("reads address lists and dates the way the stdlib does", () => {
    expect(getAddresses(['"Doe, Jane" <jane@example.com>, bob@example.org (Bob)'])).toEqual([
      ["Doe, Jane", "jane@example.com"],
      ["Bob", "bob@example.org"],
    ]);
    expect(parseAddr("dana@example.com")).toEqual(["", "dana@example.com"]);
    expect(parseDate("Mon, 07 Sep 2026 09:14:02 -0700 (PDT)")?.toISOString()).toBe(
      "2026-09-07T16:14:02.000Z",
    );
    expect(parseDate("7 Sep 26 23:30 EST")?.toISOString()).toBe("2026-09-08T04:30:00.000Z");
    expect(parseDate("Mon, 7 Sep 2026 12:00:00 -0000")?.toISOString()).toBe(
      "2026-09-07T12:00:00.000Z",
    );
    expect(parseDate("31 Feb 2026 10:00:00 +0000")).toBeNull();
    expect(parseDate("")).toBeNull();
  });

  it("a multipart with no boundary and a header block with no colon degrade, never throw", () => {
    const broken = parseMessage("Content-Type: multipart/mixed\nthis is not a header\n\nbody");
    expect(broken.parts).toEqual([]);
    expect(broken.get("Content-Type")).toBe("multipart/mixed");
    expect(parseMessage(Buffer.alloc(0)).text()).toBe("");
  });
});
