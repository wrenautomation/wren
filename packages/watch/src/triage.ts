/**
 * The Monitor's triage: show, hold or drop, with one line on why. A rule that names the sender (and
 * subject words, when it has them) and a verdict settles it in code for $0. The model reads the
 * rest with every rule in its prompt. Anything it can't settle shows: a missed email costs more
 * than a glance.
 */
import { senderMatches } from "@wren/core/mailbox";
import type { SpineEvent, Step } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { mail, rules, VERDICTS, type Verdict } from "./schema.js";

export type Rule = typeof rules.$inferSelect;
type Mail = typeof mail.$inferSelect;

/** One kept email on the spine. */
export const mailEvent = (id: number): SpineEvent => ({
  subject: `mail:${id}`,
  kind: "mail",
  data: { mailId: id },
});

/** The rule code settles it by, or null. Subject words beat a bare sender; newer beats older. */
export function settle(
  all: readonly Rule[],
  m: Pick<Mail, "fromAddress" | "subject">,
): Rule | null {
  const subject = m.subject.toLowerCase();
  const fits = all.filter(
    (r) =>
      r.sender &&
      r.verdict &&
      senderMatches(m.fromAddress, r.sender) &&
      (!r.subject || subject.includes(r.subject.toLowerCase())),
  );
  fits.sort((a, b) => Number(!!b.subject) - Number(!!a.subject) || b.id - a.id);
  return fits[0] ?? null;
}

const SYSTEM = `You sort William's email. Answer "show" when it needs him: a person writing to him, \
money owed or at risk, an account or security problem, a deadline. "hold" when it's worth keeping \
but not now: receipts, paid invoices, notices. "drop" when it's noise. His rules come first; follow \
them. A rule that names a sender covers only that sender's mail. Wren's own agents sign up, buy and \
log in for him, so sign-in codes, "verify your email", welcomes, order received or finished, and \
published notices are hold, unless a step is still his to take. An order confirmation is a receipt; \
shipped, delayed or cancelled is a status change. Answer JSON only: {"verdict": "show" | "hold" | "drop", "why": "<one short line>", \
"summary": "<one short line on what it says>"}`;

/**
 * A client's mailbox (designs/2026-10-07-mail-access.md): the same verdicts, said for a business.
 * Its rules are its own, in its own database.
 */
export const clientSystem = (business: string) =>
  `You sort email that came to ${business.replace(/\s+/g, " ").slice(0, 80)}, a business. Answer \
"show" when a person needs an answer: a lead, a customer, a partner, a question, a complaint, money \
owed or at risk, an account or security problem, a deadline. "hold" when it's worth keeping but not \
now: receipts, paid invoices, notices, newsletters they chose. "drop" when it's noise. Their rules \
come first; follow them. A rule that names a sender covers only that sender's mail. Answer JSON \
only: {"verdict": "show" | "hold" | "drop", "why": "<one short line>", "summary": "<one short line \
on what it says>"}`;

export function promptFor(all: readonly Rule[], m: Mail): string {
  const said = all.map((r) => `- ${r.words}`).join("\n") || "None yet.";
  return `Rules:\n${said}\n\nEmail:\nFrom: ${m.fromName} <${m.fromAddress}>\nSubject: ${m.subject}\nPreview: ${m.snippet ?? ""}`;
}

const ANSWER = z.object({
  verdict: z.enum(VERDICTS),
  why: z.string().min(1),
  summary: z.string(),
});

const line = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 300);

/**
 * Settle one kept email and forget its preview. Null when there's no such row. A second call
 * answers the first's verdict. A provider failure throws, so the step tries again.
 */
export async function triage(
  db: Db,
  llm: LlmClient | null,
  id: number,
  system: string = SYSTEM,
): Promise<Verdict | null> {
  const [m] = await db.select().from(mail).where(eq(mail.id, id));
  if (!m) return null;
  if (m.verdict) return m.verdict;
  const all = await db.select().from(rules).orderBy(asc(rules.id));
  const rule = settle(all, m);
  let got: { verdict: Verdict; why: string; summary: string | null; ruleId: number | null };
  if (rule?.verdict)
    got = { verdict: rule.verdict, why: line(rule.words), summary: null, ruleId: rule.id };
  else if (!llm)
    got = { verdict: "show", why: "No model is set, so it shows.", summary: null, ruleId: null };
  else {
    const out = await completeAndParse(llm, promptFor(all, m), ANSWER, {
      maxTokens: 200,
      system,
      name: system === SYSTEM ? "watch.triage" : "mail.triage",
    });
    got = out.parsed
      ? {
          verdict: out.parsed.verdict,
          why: line(out.parsed.why),
          summary: line(out.parsed.summary) || null,
          ruleId: null,
        }
      : {
          verdict: "show",
          why: "The model's answer didn't read, so it shows.",
          summary: null,
          ruleId: null,
        };
  }
  await db
    .update(mail)
    .set({ ...got, summary: got.summary ?? m.summary, snippet: null })
    .where(and(eq(mail.id, id), isNull(mail.verdict)));
  return got.verdict;
}

/**
 * Sort waiting mail again under today's rules and prompt; done mail is left alone. The preview is
 * gone by now, so the model reads sender and subject. A row whose model call fails waits as unread.
 */
export async function sortAgain(
  db: Db,
  llm: LlmClient | null,
  ids: readonly number[],
): Promise<Partial<Record<Verdict, number>>> {
  const back = await db
    .update(mail)
    .set({ verdict: null, why: null, ruleId: null })
    .where(and(inArray(mail.id, [...ids]), isNull(mail.doneAt)))
    .returning({ id: mail.id });
  const tally: Partial<Record<Verdict, number>> = {};
  for (const { id } of back) {
    const v = await triage(db, llm, id);
    if (v) tally[v] = (tally[v] ?? 0) + 1;
  }
  return tally;
}

/**
 * `mail.triage` on the spine: a client's email, in its own database, by its own rules. `of` says
 * the client's database, its name, and the model when its gate is open (null: rules, else it shows).
 */
export const clientTriageStep =
  (of: (client: string) => Promise<{ db: Db; name: string; llm: LlmClient | null }>): Step =>
  async (_port, e, at) => {
    if (!at.client) return [];
    const id = Number(e.data.mailId);
    if (!Number.isInteger(id)) throw new Error(`${e.subject} is no kept email`);
    const c = await of(at.client);
    const verdict = await triage(c.db, c.llm, id, clientSystem(c.name));
    return verdict ? [{ port: verdict, event: e }] : [];
  };

/** `watch.triage` on the spine: the email leaves by its verdict's port. Wren's own, in main. */
export const triageStep =
  (db: Db, llm: LlmClient | null): Step =>
  async (_port, e) => {
    const id = Number(e.data.mailId);
    if (!Number.isInteger(id)) throw new Error(`${e.subject} is no kept email`);
    const verdict = await triage(db, llm, id);
    return verdict ? [{ port: verdict, event: e }] : [];
  };
