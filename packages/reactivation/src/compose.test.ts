/**
 * Unit tests for the composer's pure parts: the gate, who sends, the prompt,
 * and why compose is blocked. Tests that expose a bug assert the correct
 * behavior and are marked "Was a bug".
 */
import { describe, expect, it } from "vitest";
import {
  buildComposePrompt,
  type ComposeSubject,
  composeBlocked,
  type Draft,
  gateDraft,
  pickSender,
  recruiterFor,
  saysHiring,
  unsign,
} from "./compose.js";
import { parseClientProfile } from "./profile.js";
import type { ClientProfile } from "./schema.js";
import { parseReactivationSettings, type Sender } from "./settings.js";

const brief =
  "Jane is still at Acme Staffing, where she has been since 2019. Acme has 15 open roles.";
const ctx = {
  source: [brief, "Northside Talent", "senior engineers in fintech"].join("\n"),
  private: ["Jane", "Doe", "Acme Staffing"],
  hiring: true,
};
const OPENER =
  "Hi Jane,\nI saw Acme has 15 open roles. Worth a short call? Reply with a couple of times that work and I'll book it. Thanks for reading.";
const FOLLOWUP = "Hi Jane, just a nudge on a short call. Reply with a couple of times.";
const good: Draft = { subject: "quick question", opener: OPENER, followup: FOLLOWUP };
const gate = (d: Partial<Draft>) => gateDraft({ ...good, ...d }, ctx);
const n = (k: number) => Array.from({ length: k }, () => "word").join(" ");

describe("gateDraft: a clean draft", () => {
  it("passes", () => {
    expect(gate({})).toEqual([]);
  });
  it("a number the brief holds, and a year of it, pass", () => {
    expect(gate({ opener: "Hi Jane, you have been there since 2019 with 15 roles open." })).toEqual(
      [],
    );
  });
});

describe("gateDraft: subject", () => {
  it("empty or whitespace", () => {
    expect(gate({ subject: "" })).toContain("subject: empty");
    expect(gate({ subject: "   " })).toContain("subject: empty");
  });
  it("any capital", () => {
    expect(gate({ subject: "Quick question" })).toContain("subject: not lowercase");
    expect(gate({ subject: "quick questIon" })).toContain("subject: not lowercase");
  });
  it("any digit", () => {
    expect(gate({ subject: "3 quick things" })).toContain("subject: has a number");
    expect(gate({ subject: "q4 plans" })).toContain("subject: has a number");
  });
  it("6 words pass, 7 do not", () => {
    expect(gate({ subject: "a b c d e f" })).toEqual([]);
    expect(gate({ subject: "a b c d e f g" })).toContain("subject: over 6 words");
  });
  it("names the person or the firm", () => {
    expect(gate({ subject: "for jane" }).join()).toMatch(/names "Jane"/);
    expect(gate({ subject: "mr doe" }).join()).toMatch(/names "Doe"/);
    expect(gate({ subject: "acme staffing roles" }).join()).toMatch(/names "Acme Staffing"/);
  });
  it("a name under 3 letters is not checked", () => {
    expect(gateDraft({ ...good, subject: "al says hi" }, { ...ctx, private: ["Al"] })).toEqual([]);
  });

  // Was a bug: the firm is checked as one whole string, so its distinctive word slips through.
  it("names the firm by its first word", () => {
    expect(gate({ subject: "acme and you" }).join()).toMatch(/names/);
  });

  // Was a bug: plain substring match: a first name inside an ordinary word refuses a clean subject.
  it("a first name inside another word is not a name", () => {
    expect(
      gateDraft({ ...good, subject: "annual check in" }, { ...ctx, private: ["Ann", "Lee"] }),
    ).toEqual([]);
    expect(
      gateDraft({ ...good, subject: "a planning thought" }, { ...ctx, private: ["Ann", "Lee"] }),
    ).toEqual([]);
  });

  // Was a bug: the subject gets none of the body's checks: links, placeholders, prices, addresses.
  it("a link, placeholder, price or address in the subject is refused", () => {
    expect(gate({ subject: "see acme.io" })).not.toEqual([]);
    expect(gate({ subject: "a thought for {name}" })).not.toEqual([]);
    expect(gate({ subject: "free $ inside" })).not.toEqual([]);
    expect(gate({ subject: "write me at jo@x" })).not.toEqual([]);
  });

  // Was a bug: /\d/ is ASCII only; a full-width digit passes the "no numbers" rule.
  it("a full-width digit is a number", () => {
    expect(gate({ subject: "３ quick things" })).toContain("subject: has a number");
  });
});

describe("gateDraft: bodies", () => {
  it("empty or whitespace", () => {
    expect(gate({ opener: "" })).toContain("opener: empty");
    expect(gate({ followup: " \n\t " })).toContain("followup: empty");
  });
  it("a price", () => {
    expect(gate({ opener: "Hi Jane, it is $15 a meeting." })).toContain("opener: a price");
  });
  it("links", () => {
    for (const body of [
      "see https://x.example/a",
      "see http://x",
      "at www.northside",
      "visit northside.com today",
      "visit Northside.IO",
      "our site acme.co.uk",
    ])
      expect(gate({ followup: body }), body).toContain("followup: a link");
  });

  // Was a bug: the link pattern knows ten TLDs; a shortener or any other TLD passes as plain text.
  it("links on other TLDs", () => {
    for (const body of ["book at bit.ly/northside", "see northside.dev", "cal at northside.app"])
      expect(gate({ followup: body }), body).toContain("followup: a link");
  });

  it("an address", () => {
    expect(gate({ opener: "write to jo at jo@northside" })).toContain("opener: an address");
  });
  it("em and en dashes; a hyphen in a word is fine", () => {
    expect(gate({ opener: "Hi Jane — a thought" })).toContain("opener: a dash");
    expect(gate({ opener: "Hi Jane – a thought" })).toContain("opener: a dash");
    expect(gate({ opener: "Hi Jane, a follow-up thought" })).toEqual([]);
  });
  it("braces and brackets", () => {
    expect(gate({ opener: "Hi {first_name}," })).toContain("opener: a placeholder or mark");
    expect(gate({ opener: "Hi Jane, still there. [f12]" })).toContain(
      "opener: a placeholder or mark",
    );
  });
  it("numbers the brief does not hold, digits or words", () => {
    expect(gate({ opener: "Hi Jane, you have 12 roles open." }).join()).toMatch(
      /opener: 12 not in the brief/,
    );
    expect(gate({ opener: "Hi Jane, three roles caught my eye." }).join()).toMatch(
      /opener: 3 not in the brief/,
    );
    expect(gate({ opener: "Hi Jane, since 2018." }).join()).toMatch(/2018 not in the brief/);
  });
  it("word caps: opener 120, follow-up 80", () => {
    expect(gate({ opener: n(120) })).toEqual([]);
    expect(gate({ opener: n(121) })).toContain("opener: over 120 words");
    expect(gate({ followup: n(80) })).toEqual([]);
    expect(gate({ followup: n(81) })).toContain("followup: over 80 words");
  });

  // Was a bug: only "$" is a price; euros and pounds with a number the brief holds pass.
  it("a price in another currency", () => {
    expect(gate({ opener: "Hi Jane, it is only €15 a meeting." })).toContain("opener: a price");
    expect(gate({ opener: "Hi Jane, it is only £15 a meeting." })).toContain("opener: a price");
  });
});

// ---- who sends ------------------------------------------------------------------

const profile = parseClientProfile({
  firm: "Northside Talent",
  sells: "senior engineers in fintech",
  voice: "plain and warm",
  recruiters: [
    { name: "Ann Lee", email: "Ann@Northside.example", owners: ["alee", " Ann  L. "] },
    { name: "Bob Roe", email: "bob@northside.example", owners: [] },
  ],
  defaultRecruiter: "BOB@northside.example",
  signature: "{name}\nNorthside Talent",
});
const sender = (address: string, recruiter: string | null, suspended = false): Sender => ({
  address,
  name: address.split("@")[0] as string,
  recruiter,
  suspended,
});
const ANN = sender("ann@mail.example", "ann@northside.example");
const BOB = sender("bob@mail.example", "bob@northside.example");
const ANY = sender("team@mail.example", null);

describe("recruiterFor", () => {
  it("by alias, name or email; case and spaces do not matter", () => {
    for (const owner of [
      "alee",
      "ALEE",
      "  ann   l. ",
      "Ann Lee",
      "  ann    LEE ",
      "ann@northside.example",
      " ANN@NORTHSIDE.EXAMPLE ",
    ])
      expect(recruiterFor(owner, profile)?.email, owner).toBe("ann@northside.example");
  });
  it("no owner, a blank one, or a partial name is nobody", () => {
    expect(recruiterFor(null, profile)).toBeNull();
    expect(recruiterFor("   ", profile)).toBeNull();
    expect(recruiterFor("Ann", profile)).toBeNull();
  });
});

describe("pickSender", () => {
  it("the owner's recruiter's mailbox first", () => {
    const p = pickSender("alee", profile, [ANY, BOB, ANN]);
    expect(p?.sender).toBe(ANN);
    expect(p?.recruiter?.email).toBe("ann@northside.example");
  });
  it("a mailbox whose address is the recruiter's email counts as theirs", () => {
    const own = sender("ann@northside.example", null);
    expect(pickSender("Ann Lee", profile, [ANY, BOB, own])?.sender).toBe(own);
  });
  it("no owner: the default recruiter's mailbox", () => {
    const p = pickSender(null, profile, [ANY, ANN, BOB]);
    expect(p?.sender).toBe(BOB);
    expect(p?.recruiter?.email).toBe("bob@northside.example");
  });
  it("the owner's mailbox suspended: the default's, the owner stays the recruiter", () => {
    const p = pickSender("alee", profile, [ANY, { ...ANN, suspended: true }, BOB]);
    expect(p?.sender).toBe(BOB);
    expect(p?.recruiter?.email).toBe("ann@northside.example");
  });
  it("no default: a mailbox that writes for anyone, then the first live one", () => {
    const noDefault = { ...profile, defaultRecruiter: null };
    expect(pickSender("stranger", noDefault, [ANN, ANY, BOB])).toEqual({
      sender: ANY,
      recruiter: null,
    });
    const p = pickSender("stranger", noDefault, [{ ...ANN, suspended: true }, BOB]);
    expect(p?.sender).toBe(BOB);
    expect(p?.recruiter?.email).toBe("bob@northside.example");
  });
  it("suspended is never picked; none live is null", () => {
    const all = [ANN, BOB, ANY].map((s) => ({ ...s, suspended: true }));
    expect(pickSender("alee", profile, all)).toBeNull();
    expect(pickSender(null, profile, [])).toBeNull();
    const p = pickSender(null, profile, [
      { ...BOB, suspended: true },
      { ...ANY, suspended: true },
      ANN,
    ]);
    expect(p?.sender).toBe(ANN);
  });
});

// ---- the prompt -------------------------------------------------------------------

const subject: ComposeSubject = {
  personId: 1,
  companyId: 2,
  firstName: "Jane",
  lastName: "Doe",
  firm: "Acme Staffing",
  brief,
  briefHash: "h",
  citations: {},
  candidateId: 3,
  email: "jane@acme.example",
  owner: "alee",
};

describe("buildComposePrompt", () => {
  it("carries the sender, both firms, what they sell, the voice and the brief", () => {
    const p = buildComposePrompt(subject, profile, { name: "Ann Lee" });
    expect(p).toContain("from Ann Lee, a recruiter at Northside Talent, to Jane Doe");
    expect(p).toContain("last known at Acme Staffing");
    expect(p).toContain("What Northside Talent does: senior engineers in fintech");
    expect(p).toContain(brief);
    expect(p).toContain("plain and warm");
    expect(p).toContain('Start with "Hi Jane,"');
    expect(p).toContain("At most 120 words");
    expect(p).toContain("At most 80 words");
    expect(p).toMatch(/Return ONLY a JSON object/);
  });
  it("no name: a neutral greeting and a neutral who", () => {
    const p = buildComposePrompt({ ...subject, firstName: null, lastName: null }, profile, {
      name: "Ann Lee",
    });
    expect(p).toContain('Start with "Hi there,"');
    expect(p).toContain("to a past contact,");
    expect(p).not.toContain("null");
    expect(p).toContain("Invent nothing about Northside Talent or them.");
  });
  it("never shows the fee or the signature to the model", () => {
    const withFee = { ...profile, feeAvg: 25000 };
    const p = buildComposePrompt(subject, withFee, { name: "Ann Lee" });
    expect(p).not.toContain("25000");
    expect(p).not.toContain("{name}");
  });
});

// ---- blocked -------------------------------------------------------------------

describe("composeBlocked", () => {
  const ok = { ok: true, reason: "ok" };
  const live = { senders: [{ address: "a@x.example", name: "A" }] };
  const p = profile as unknown as ClientProfile;
  it("in order: stage off, no profile, no live sender, list not ready", () => {
    expect(
      composeBlocked(parseReactivationSettings({ ...live, stages: { compose: false } }), p, ok),
    ).toMatch(/stages.compose/);
    expect(composeBlocked(parseReactivationSettings(live), null, ok)).toMatch(/no firm profile/);
    expect(composeBlocked(parseReactivationSettings({}), p, ok)).toMatch(/no senders/);
    expect(
      composeBlocked(
        parseReactivationSettings({
          senders: [{ address: "a@x.example", name: "A", suspended: true }],
        }),
        p,
        ok,
      ),
    ).toMatch(/no senders/);
    expect(
      composeBlocked(parseReactivationSettings(live), p, { ok: false, reason: "dirty" }),
    ).toMatch(/not ready to send: dirty/);
    expect(composeBlocked(parseReactivationSettings(live), p, ok)).toBeNull();
  });
  it("the demo writes past a dirty list, since it never sends; nothing else is waived", () => {
    const dirty = { ok: false, reason: "dirty" };
    expect(composeBlocked(parseReactivationSettings(live), p, dirty, true)).toBeNull();
    expect(composeBlocked(parseReactivationSettings({}), p, dirty, true)).toMatch(/no senders/);
  });
});

describe("profile and settings edges", () => {
  it("defaultRecruiter is matched after both sides are normalized", () => {
    expect(profile.defaultRecruiter).toBe("bob@northside.example");
    expect(profile.recruiters[0]?.email).toBe("ann@northside.example");
  });
  it("the same recruiter twice, differing only in case, is refused", () => {
    expect(() =>
      parseClientProfile({
        firm: "f",
        sells: "s",
        voice: "v",
        signature: "x",
        recruiters: [
          { name: "A", email: "a@x.example" },
          { name: "B", email: "A@X.example" },
        ],
      }),
    ).toThrow(/listed twice/);
  });
  it("a default recruiter who is not a recruiter is refused", () => {
    expect(() =>
      parseClientProfile({
        firm: "f",
        sells: "s",
        voice: "v",
        signature: "x",
        defaultRecruiter: "z@x.example",
      }),
    ).toThrow(/defaultRecruiter/);
  });
  it("the same sender twice, differing only in case and space, is refused", () => {
    expect(() =>
      parseReactivationSettings({
        senders: [
          { address: "a@x.example", name: "A" },
          { address: " A@X.example ", name: "B" },
        ],
      }),
    ).toThrow(/listed twice/);
  });
});

describe("growth talk needs open roles", () => {
  // Was a bug: with no hiring found, drafts said "the team keeps growing".
  it("no open roles in the brief: growing or hiring is held", () => {
    const d = { ...good, opener: "Hi Jane,\nI see the team keeps growing. Worth a call?" };
    expect(gateDraft(d, { ...ctx, hiring: false })).toEqual([
      "opener: says they're hiring or growing; the brief found no open roles",
    ]);
  });
  it("the brief's open roles allow it", () => {
    expect(saysHiring(brief)).toBe(true);
    expect(saysHiring("Jane is still at Acme.")).toBe(false);
  });
});

describe("unsign", () => {
  // Was a bug: the model signed "Sam" and the added signature printed the name again.
  it("keeps the thanks, drops the name", () => {
    expect(unsign("Hi Meg,\nA call?\n\nThanks for reading, Sam", "Sam Rivera")).toBe(
      "Hi Meg,\nA call?\n\nThanks for reading.",
    );
  });
  it("a bare valediction and full name go", () => {
    expect(unsign("Hi Meg,\nA call?\n\nBest,\nSam Rivera", "Sam Rivera")).toBe("Hi Meg,\nA call?");
  });
  it("an unsigned body is untouched", () => {
    expect(unsign("Hi Meg,\nThanks for reading.", "Sam Rivera")).toBe(
      "Hi Meg,\nThanks for reading.",
    );
  });
});
