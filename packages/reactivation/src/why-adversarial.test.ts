/**
 * Adversarial tests for "why this line": readBody (the model's paragraphs and
 * the brief lines each rests on), briefLines (a stored brief back into its
 * numbered lines) and whyOf (provenance back into the portal's why). Tests
 * that expose a bug assert the correct behavior and are marked "Bug".
 */
import { signed } from "@wren/channel-email";
import { describe, expect, it } from "vitest";
import { briefLines, gateBrief } from "./brief.js";
import { type Answer, readBody } from "./compose.js";
import { whyOf } from "./portal/outbox.js";

const SENDER = "Ann Lee";
const SIGNATURE = "Ann Lee\nNorthside Talent";
/** How the portal's Body finds a paragraph again: the stored body, split on blank lines. */
const portalParagraphs = (text: string) =>
  signed(text, SIGNATURE)
    .split(/\n{2,}/)
    .map((p) => p.trim());

/** Every why text is a paragraph the portal will find, and every line is a real brief line. */
function expectConsistent(body: Answer["opener"], lineCount: number, sender = SENDER) {
  const { text, why } = readBody(body, lineCount, sender);
  const sent = new Set(text.split(/\n{2,}/).map((p) => p.trim()));
  const shown = new Set(portalParagraphs(text));
  for (const w of why) {
    expect(sent.has(w.text), `"${w.text}" is not a paragraph of the email`).toBe(true);
    expect(shown.has(w.text), `"${w.text}" is not a paragraph the portal shows`).toBe(true);
    expect(w.lines.length).toBeGreaterThan(0);
    for (const n of w.lines) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(lineCount);
    }
    expect([...w.lines].sort((a, b) => a - b)).toEqual(w.lines);
    expect(new Set(w.lines).size).toBe(w.lines.length);
  }
  return { text, why };
}

describe("readBody: from", () => {
  it("strings, duplicates and floats that are whole read as line numbers; the rest drop", () => {
    const { why } = expectConsistent(
      [{ text: "A line.", from: ["2", 2, 2.0, " 1 ", "1", 0, -1, 1.5, 4, "x", "", "NaN"] }],
      3,
    );
    expect(why).toEqual([{ text: "A line.", lines: [0, 1] }]);
  });

  it("out of range for this brief: no why", () => {
    const { why } = expectConsistent([{ text: "A line.", from: [4, 99] }], 3);
    expect(why).toEqual([]);
  });

  it("a brief with no lines: no why, whatever from says", () => {
    const { why } = expectConsistent([{ text: "A line.", from: [1, "1", 0] }], 0);
    expect(why).toEqual([]);
  });

  it("unordered from comes back sorted", () => {
    const { why } = expectConsistent([{ text: "A line.", from: [3, 1, "2"] }], 3);
    expect(why).toEqual([{ text: "A line.", lines: [0, 1, 2] }]);
  });

  it("a bare string body has no why", () => {
    const { text, why } = expectConsistent("Hi Jane,\nA note — for you.", 3);
    expect(text).toBe("Hi Jane,\nA note, for you.");
    expect(why).toEqual([]);
  });

  it("a paragraph without from has no why", () => {
    const { why } = expectConsistent([{ text: "Hi Jane," }, { text: "A note.", from: [] }], 3);
    expect(why).toEqual([]);
  });
});

describe("readBody: paragraphs", () => {
  it("a model paragraph holding a blank line becomes two paragraphs, both with its lines", () => {
    const { text, why } = expectConsistent(
      [
        { text: "Hi Jane," },
        { text: "You moved to Initech.\n\nCongrats on the new role.", from: [1] },
      ],
      2,
    );
    expect(text).toBe("Hi Jane,\n\nYou moved to Initech.\n\nCongrats on the new role.");
    expect(why).toEqual([
      { text: "You moved to Initech.", lines: [0] },
      { text: "Congrats on the new role.", lines: [0] },
    ]);
  });

  it("three or more newlines, or blank lines with spaces, still split once", () => {
    const { text, why } = expectConsistent(
      [{ text: "One.\n\n\n\nTwo.\n  \t\nThree.", from: [2] }],
      2,
    );
    expect(text).toBe("One.\n\nTwo.\n\nThree.");
    expect(why.map((w) => w.text)).toEqual(["One.", "Two.", "Three."]);
  });

  it("an empty or blank paragraph is dropped, leaving no blank gap", () => {
    const { text, why } = expectConsistent(
      [
        { text: "Hi Jane,", from: [1] },
        { text: "", from: [1] },
        { text: "   \n\n  ", from: [1] },
        { text: "A note.", from: [1] },
      ],
      1,
    );
    expect(text).toBe("Hi Jane,\n\nA note.");
    expect(why.map((w) => w.text)).toEqual(["Hi Jane,", "A note."]);
  });

  it("an all-empty body is empty, with no why", () => {
    expect(readBody([{ text: "", from: [1] }], 1, SENDER)).toEqual({ text: "", why: [] });
    expect(readBody([], 1, SENDER)).toEqual({ text: "", why: [] });
  });

  it("a paragraph tidy rewrites keeps its why under the rewritten text", () => {
    const { why } = expectConsistent(
      [
        { text: "Hi Jane,\r\nI saw the news — congrats.   \r\nWorth a call?", from: [1] },
        { text: "Acme has 12 open roles – busy year.", from: [2] },
      ],
      2,
    );
    expect(why).toEqual([
      { text: "Hi Jane,\nI saw the news, congrats.\nWorth a call?", lines: [0] },
      { text: "Acme has 12 open roles, busy year.", lines: [1] },
    ]);
  });

  it("the model's sign-off paragraph is dropped, and so is its why", () => {
    const { text, why } = expectConsistent(
      [{ text: "A call?", from: [1] }, { text: "Best,", from: [1] }, { text: "Ann" }],
      1,
    );
    expect(text).toBe("A call?");
    expect(why).toEqual([{ text: "A call?", lines: [0] }]);
  });

  it("a last paragraph unsign rewrites loses its why rather than pointing at nothing", () => {
    const { text, why } = expectConsistent(
      [
        { text: "You moved to Initech.", from: [1] },
        { text: "Worth a call? Thanks for reading, Ann", from: [1] },
      ],
      1,
    );
    expect(text).toBe("You moved to Initech.\n\nWorth a call? Thanks for reading.");
    expect(why).toEqual([{ text: "You moved to Initech.", lines: [0] }]);
  });

  // Bug: unsign (compose.ts:215-221) strips the sender's first name wherever it ends the
  // email, even as an ordinary word. Sender "Will Park" and a last line ending "I will."
  it("Bug: a sender whose first name is a word keeps the email's last word", () => {
    const body = [
      { text: "You moved to Initech.", from: [1] },
      { text: "If a call makes sense, reply and I will.", from: [1] },
    ];
    const { text } = expectConsistent(body, 1, "Will Park");
    expect(text).toBe("You moved to Initech.\n\nIf a call makes sense, reply and I will.");
  });

  // Bug: readBody (compose.ts:245) only strips a trailing name, so a model that signs with the
  // whole signature ("Best,\nAnn Lee\nNorthside Talent") gets the signature again from signed().
  it("Bug: a paragraph holding the whole signature is not signed twice", () => {
    const { text } = expectConsistent(
      [{ text: "Hi Jane," }, { text: "A call?", from: [1] }, { text: `Best,\n${SIGNATURE}` }],
      1,
    );
    const email = signed(text, SIGNATURE);
    expect(email.match(/Northside Talent/g)).toHaveLength(1);
  });

  it("many adversarial bodies stay consistent with what the portal shows", () => {
    const bodies: Answer["opener"][] = [
      [{ text: "Hi Jane,\n\n— a thought", from: [1] }],
      [
        { text: "—", from: [1] },
        { text: "A.", from: [2] },
      ],
      [{ text: "A.\r\rB.", from: [1] }],
      [
        { text: "Same.", from: [1] },
        { text: "Same.", from: [2] },
      ],
      [{ text: "Hi Jane, \n \nA.", from: [1] }],
      [
        { text: "A.", from: [1] },
        { text: "Thanks,\nAnn Lee", from: [1] },
      ],
      [
        { text: "A.", from: [1] },
        { text: "Cheers! Ann.", from: [2] },
      ],
      [{ text: "Ann", from: [1] }],
      [
        { text: "\n\n\n", from: [1] },
        { text: "A.", from: [1] },
      ],
    ];
    for (const b of bodies) expectConsistent(b, 2);
  });
});

describe("briefLines", () => {
  it("title and company abbreviations don't end a line", () => {
    expect(
      briefLines("Jane joined Acme Inc. in 2019. [f1] She reports to Dr. Lee in St. Louis. [f2]"),
    ).toEqual(["Jane joined Acme Inc. in 2019. [f1]", "She reports to Dr. Lee in St. Louis. [f2]"]);
  });

  it("decimals and versions don't end a line", () => {
    expect(
      briefLines("Acme raised $2.5M in 2024. [f1] It grew 3.5x since v2.0 shipped. [f2]"),
    ).toEqual(["Acme raised $2.5M in 2024. [f1]", "It grew 3.5x since v2.0 shipped. [f2]"]);
  });

  it("marks after the period stay with their line, however many", () => {
    expect(
      briefLines("Jane moved. [f1] [c2] She is VP now. [f3, c4]  Acme is hiring! [f5]"),
    ).toEqual(["Jane moved. [f1] [c2]", "She is VP now. [f3, c4]", "Acme is hiring! [f5]"]);
  });

  it("quotes and brackets after the period stay with their line", () => {
    expect(
      briefLines('She said "we are hiring." [f1] (Acme has roles.) [f2] "Busy year," she wrote.'),
    ).toEqual([
      'She said "we are hiring." [f1]',
      "(Acme has roles.) [f2]",
      '"Busy year," she wrote.',
    ]);
  });

  it("a question or exclamation ends a line", () => {
    expect(briefLines("Still there? [c1] Yes! [f2] Good.")).toEqual([
      "Still there? [c1]",
      "Yes! [f2]",
      "Good.",
    ]);
  });

  it("blank and whitespace-only briefs have no lines", () => {
    expect(briefLines("")).toEqual([]);
    expect(briefLines("  \n\t ")).toEqual([]);
  });

  it("newlines between sentences split like spaces", () => {
    expect(briefLines("Jane moved. [f1]\n\nShe is VP. [f2]\n")).toEqual([
      "Jane moved. [f1]",
      "She is VP. [f2]",
    ]);
  });

  // Bug: SENTENCE_END (brief.ts:84-85) ends a sentence at any capital after a period, so a
  // dotted company name splits the line: "J.P." and "Morgan in 2021. [f1]".
  it("Bug: a dotted company name doesn't end a line", () => {
    expect(briefLines("Jane joined J.P. Morgan in 2021. [f1] She leads hiring. [f2]")).toEqual([
      "Jane joined J.P. Morgan in 2021. [f1]",
      "She leads hiring. [f2]",
    ]);
  });

  // Same bug, one step earlier: gateBrief splits with the same pattern, finds no mark on
  // "Jane joined J.P." and drops it, so the brief says "Morgan in 2021. [f1]".
  it("Bug: gateBrief keeps a sentence naming a dotted company whole", () => {
    const gated = gateBrief(
      ["Jane joined J.P. Morgan in 2021. [f1]"],
      [{ mark: "f1", text: "moved to J.P. Morgan in 2021" }],
    );
    expect(gated.kept).toEqual(["Jane joined J.P. Morgan in 2021. [f1]"]);
  });

  // Bug: the brief is stored as gateBrief's kept sentences joined by spaces (brief.ts:397) and
  // read back with briefLines (brief.ts:87), which needs a capital to start a line. A kept
  // sentence starting with a digit merges into the one before, so the composer and the portal
  // number one line where the gate kept two.
  it("Bug: the gate's kept sentences read back as the same lines", () => {
    const gated = gateBrief(
      ["Jane joined Acme in 2019. [f1]", "12 open roles are listed on their site. [f2]"],
      [
        { mark: "f1", text: "still at Acme since 2019" },
        { mark: "f2", text: "Acme has 12 open roles" },
      ],
    );
    expect(gated.kept).toHaveLength(2);
    expect(briefLines(gated.kept.join(" "))).toEqual(gated.kept);
  });
});

describe("whyOf: malformed provenance", () => {
  const lines = ["Jane moved. [f1]", "She is VP. [f2]"];
  const good = { text: "You moved.", lines: [0] };

  it("no provenance, or none that carries brief lines: null", () => {
    for (const p of [
      undefined,
      null,
      "text",
      42,
      [],
      {},
      { brief: null },
      { brief: "lines" },
      { brief: { lines: "Jane moved." } },
      { brief: { lines: null } },
      { brief: { lines: ["ok", 1] } },
      { brief: { lines: [null] } },
      { brief: { lines: { 0: "a", length: 1 } } },
    ])
      expect(whyOf(p, { why: [good] }), JSON.stringify(p)).toBeNull();
  });

  it("an empty brief is still a why, with nothing to point at", () => {
    expect(whyOf({ brief: { lines: [] }, why: [good] }, undefined)).toEqual({
      brief: [],
      opener: [],
      followup: [],
    });
  });

  it("why that isn't a list reads as none", () => {
    for (const why of [undefined, null, "x", 1, { 0: good }, good])
      expect(whyOf({ brief: { lines }, why }, { why })).toEqual({
        brief: lines,
        opener: [],
        followup: [],
      });
  });

  it("only well-formed entries inside the brief survive", () => {
    const why = [
      good,
      null,
      "You moved.",
      42,
      [],
      { text: 5, lines: [0] },
      { text: null, lines: [0] },
      { text: "no lines" },
      { text: "lines not a list", lines: 0 },
      { text: "out of range", lines: [2] },
      { text: "one out of range", lines: [0, 2] },
      { text: "negative", lines: [-1] },
      { text: "fraction", lines: [0.5] },
      { text: "string index", lines: ["0"] },
      { text: "NaN", lines: [Number.NaN] },
      { text: "huge", lines: [1e21] },
      { text: "null index", lines: [null] },
      { text: "Both.", lines: [0, 1] },
    ];
    const got = whyOf({ brief: { lines }, why }, { why });
    const texts = ["You moved.", "Both."];
    expect(got?.opener.map((w) => w.text)).toEqual(texts);
    expect(got?.followup.map((w) => w.text)).toEqual(texts);
  });

  it("the followup is read against the opener's brief, whatever its own says", () => {
    const got = whyOf(
      { brief: { lines }, why: [] },
      { brief: { lines: ["a", "b", "c", "d"] }, why: [{ text: "Later.", lines: [3] }, good] },
    );
    expect(got?.followup).toEqual([good]);
  });

  it("a followup that is missing or not an object reads as no why", () => {
    for (const f of [undefined, null, "x", 3, [], { why: null }])
      expect(whyOf({ brief: { lines }, why: [good] }, f)?.followup).toEqual([]);
  });
});
