/**
 * The reactivation prompt moved from code into the template store must reach the model byte for
 * byte as the code built it. `legacyPrompt` is that code, kept here verbatim. Synthetic people.
 */
import { describe, expect, it } from "vitest";
import { buildComposePrompt, type ComposeSubject, composeDefault, stripMarks } from "./compose.js";
import type { ClientProfile } from "./schema.js";
import type { Sender } from "./settings.js";

function legacyPrompt(
  s: ComposeSubject,
  profile: Pick<ClientProfile, "firm" | "sells" | "voice">,
  sender: Pick<Sender, "name">,
): string {
  const hi = s.firstName ? `Hi ${s.firstName},` : "Hi there,";
  const who = [s.firstName, s.lastName].filter(Boolean).join(" ") || "a past contact";
  const lines = s.lines.length ? s.lines.map(stripMarks) : [s.brief];
  const where = s.movedTo ? `who moved from ${s.firm} to ${s.movedTo}` : `last known at ${s.firm}`;
  return `You write a short email from ${sender.name}, a recruiter at ${profile.firm}, to ${who}, someone the firm has worked with before, ${where}.

What ${profile.firm} does: ${profile.sells}

Why write now (true, from our research), one numbered line each:
${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}

How ${profile.firm} writes:
${profile.voice}

Write two emails.
1. The opener.
- Start with "${hi}" as its own paragraph.
- Open with line 1 of "Why write now"${s.movedTo ? `, their move to ${s.movedTo}` : ""}: the reason you're writing now, plainly, as the recruiter who noticed. One more fact at most.
- Only what they could see themselves: their role, a move, their company's open roles if listed. Never say the team is growing or hiring unless "Why write now" names open roles. Never the CRM, a record, a status, a placement, or the date you last spoke; "it's been a while" is enough.
- One ask: a short call. Close with: reply with a couple of times that work and I'll book it.
- Thank them for reading, in a few words, without your name.
- At most 120 words.
2. The follow-up, sent in the same thread 4 business days later if they don't reply.
- Start with "${hi}".
- A short nudge: the same ask, or one new angle from the facts. No guilt.
- At most 80 words.

Both: plain text. No links, no prices, no guarantees, no dashes, no brackets, no sign-off or signature (it is added). Use only the facts given; copy names and numbers exactly, and add no numbers of your own (not even "10 minutes"). Invent nothing about ${profile.firm} or ${s.firstName ?? "them"}.

Subject: lowercase, 2 to 6 words, no numbers, no names, no facts. Like "quick question" or "a thought".

Return ONLY a JSON object. Each email is its paragraphs in order, the greeting first. "from" is the numbers of the "Why write now" lines a paragraph uses, [] when none:
{"subject": "...", "opener": [{"text": "${hi}", "from": []}, {"text": "...", "from": [1]}], "followup": [{"text": "...", "from": []}]}
`;
}

const base: ComposeSubject = {
  personId: 1,
  companyId: 2,
  firstName: "Dana",
  lastName: "Reyes",
  firm: "Example Staffing",
  movedTo: null,
  brief: "Dana leads platform hiring.",
  lines: ["Dana leads platform hiring [f1].", "Example Staffing lists 3 open roles [c2]."],
  briefHash: "h",
  citations: {},
  candidateId: 3,
  email: "dana@example.test",
  evidence: "crm",
  owner: null,
};
const profiles: Pick<ClientProfile, "firm" | "sells" | "voice">[] = [
  { firm: "Northwind Talent", sells: "senior engineers in fintech", voice: "plain and warm" },
  { firm: "A & B {Search}", sells: "  roles {with braces}\n", voice: "" },
];
const subjects: ComposeSubject[] = [
  base,
  { ...base, firstName: null, lastName: null },
  { ...base, firstName: "", lastName: "Reyes" },
  { ...base, movedTo: "Beta Labs" },
  { ...base, movedTo: "" },
  { ...base, lines: [] },
  { ...base, lines: ["  spaced line  ", "((not a group))"] },
];

describe("the compose prompt as a template", () => {
  it("renders what the code built, for every subject and profile", () => {
    let n = 0;
    for (const s of subjects)
      for (const p of profiles)
        for (const sender of [{ name: "Ann Lee" }, { name: "" }] as Pick<Sender, "name">[]) {
          expect(buildComposePrompt(s, p, sender)).toBe(legacyPrompt(s, p, sender));
          n++;
        }
    expect(n).toBe(subjects.length * profiles.length * 2);
  });
  it("parses as a prompt and keeps its trailing newline", () => {
    expect(composeDefault().version).toMatch(/^[0-9a-f]{12}$/);
    expect(buildComposePrompt(base, profiles[0] as ClientProfile, { name: "Ann Lee" })).toMatch(
      /\}\n$/,
    );
  });
});
