/**
 * Ready-made studies. A recipe is words only: a question, its angles, the
 * drafts. Nothing here knows a niche; the vertical and the thing we sell are
 * arguments.
 */
import type { StudyDraftSpec } from "../schema.js";

export interface StudyInput {
  question: string;
  angles: string[];
  drafts: StudyDraftSpec[];
}

/** One question, one angle, no drafts: a plain cited answer. */
export function questionStudy(question: string, angles: readonly string[] = []): StudyInput {
  return { question, angles: angles.length ? [...angles] : [question], drafts: [] };
}

/**
 * When a caller gives no copy rules for the emails draft: William's cold email
 * rules as of 2026-09-30, minus who the sender is. `--rules <file>` replaces them.
 */
export const DEFAULT_EMAIL_RULES = `- Order: a subject they must open, the opener, why they're reading this, the pain, the usual fix and why it falls short, who is writing, one easy ask, thanks.
- Subject: lowercase, a few words, specific enough to be wrong.
- The pain: name the whole family of it first, then one concrete example from the claims, with its number when the claim has one.
- Handle the objection to the offer before they raise it.
- Who is writing: one line, a placeholder "[who I am]" the sender fills in. Never invent credentials.
- One ask: reply with a few times that work and I'll book it. No calendar link, no "15 minutes".
- Short read. Thank them at the end for reading this far.
- No price, scope, tools or guarantees. No sign-off; the sender's signature is added.`;

export interface VerticalBrief {
  /** Who we'd sell to, as specific as we know it: "recruiting firms of 10 to 50 people in the US and Canada". */
  vertical: string;
  /** What we sell, in a phrase: "automation that wins back past clients". */
  sells: string;
  /** Cold email rules in full; default DEFAULT_EMAIL_RULES. */
  emailRules?: string | null;
}

/**
 * Should we sell this to this vertical, and how: five angles a founder would
 * ask before writing a single email, then offer candidates and first emails
 * drawn only from what the pages said.
 */
export function verticalStudy(b: VerticalBrief): StudyInput {
  const v = b.vertical.trim();
  const sells = b.sells.trim();
  return {
    question: `Should we sell ${sells} to ${v}, and how?`,
    angles: [
      `What problems cost ${v} the most money or growth right now, in the owners' own words?`,
      `Benchmarks for ${v}: revenue per employee, fees, margins, client churn, sales cycle.`,
      `How do ${v} win new clients today, and what does winning one cost them?`,
      `When in the year do ${v} hire, buy and set budgets?`,
      `Who already sells ${sells} to ${v}, how is it priced, and what do buyers complain about?`,
    ],
    drafts: [
      {
        key: "offers",
        ask: `Write 5 offer candidates for selling ${sells} to ${v}.
Each item: title = the offer's name in 2 to 5 words. body = five lines, each starting with its label:
For: who exactly, and the moment they need it.
Promise: the result they get, with a number only when a cited claim has it.
How: what we do for them.
Risk: what makes saying yes safe for them.
Price shape: how it is charged (per result, flat, setup plus usage), no amounts.
The 5 must differ in the result promised or the risk taken, not just wording.`,
      },
      {
        key: "emails",
        ask: `Write 3 first-touch cold emails to owners of ${v}, each on a different pain or offer from the claims.
Each item: title = the subject line. body = the email.
Follow these rules:
${(b.emailRules ?? "").trim() || DEFAULT_EMAIL_RULES}`,
      },
    ],
  };
}
