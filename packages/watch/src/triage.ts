/**
 * The Watch's triage: show, hold or drop, with one line on why. A rule that names the sender (and
 * subject words, when it has them) and a verdict settles it in code for $0. The model reads the
 * rest with every rule in its prompt. Anything it can't settle shows: a missed email costs more
 * than a glance.
 */
import { senderMatches } from "@wren/core/mailbox";
import type { SpineEvent, Step } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { and, asc, eq, isNull } from "drizzle-orm";
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
them. Answer JSON only: {"verdict": "show" | "hold" | "drop", "why": "<one short line>", \
"summary": "<one short line on what it says>"}`;

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
export async function triage(db: Db, llm: LlmClient | null, id: number): Promise<Verdict | null> {
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
      system: SYSTEM,
      name: "watch.triage",
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
    .set({ ...got, snippet: null })
    .where(and(eq(mail.id, id), isNull(mail.verdict)));
  return got.verdict;
}

/** `watch.triage` on the spine: the email leaves by its verdict's port. Wren's own, in main. */
export const triageStep =
  (db: Db, llm: LlmClient | null): Step =>
  async (_port, e) => {
    const id = Number(e.data.mailId);
    if (!Number.isInteger(id)) throw new Error(`${e.subject} is no kept email`);
    const verdict = await triage(db, llm, id);
    return verdict ? [{ port: verdict, event: e }] : [];
  };
