/**
 * The compose stage (R11): an opener and one follow-up per contact, written by
 * the model as the recruiter who owns the contact, from the brief only. A gate
 * refuses anything the SOP forbids (prices, links, numbers not in the brief,
 * a subject that says too much) before a word is stored. What passes becomes an
 * enrollment and two messages, the same rows Wren's own campaigns send from.
 *
 * Who is due: a written brief, a score above zero, a verified CRM address, not
 * moved or left (their CRM address is at the old firm), never enrolled, their
 * company not in a live thread, and one per company per pass. At most
 * `compose.perDay` a day, and none while that many openers wait for approval.
 */
import { createHash } from "node:crypto";
import {
  type ApprovalSource,
  activeSuppressions,
  enrollments,
  isUniqueViolation,
  messages,
  signed,
} from "@wren/channel-email";
import type { Queryable } from "@wren/db";
import { completeAndParse, type LlmClient, LlmError } from "@wren/llm";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { briefLines, MARKS, madeUp } from "./brief.js";
import { crmHealth } from "./crm/health.js";
import { type ClientProfile, compositions, type Recruiter } from "./schema.js";
import { LATEST_CRM_ROW, whereFinding } from "./score.js";
import type { ReactivationSettings, Sender } from "./settings.js";

export const COMPOSE_VERSION = "v4";
export const COMPOSE_STAGE = "reactivation_compose";
/** Enrollments carry this as their niche, sequence and offer. */
export const REACTIVATION = "reactivation";
export const SEQUENCE = {
  name: REACTIVATION,
  arm: null,
  steps: [
    { template: "reactivation_opener", day: 0 },
    { template: "reactivation_followup", day: 4 },
  ],
} as const;
const MAX_TOKENS = 1500;
const OPENER_WORDS = 120;
const FOLLOWUP_WORDS = 80;
const SUBJECT_WORDS = 6;
/** Failed attempts at one person before we stop paying for them. */
const MAX_FAILURES = 3;
const ERROR_STREAK = 5;

/** One paragraph and the numbers of the brief lines it rests on. */
const paragraphSchema = z.object({
  text: z.string(),
  from: z.array(z.union([z.number(), z.string()])).optional(),
});
/** An email as the model writes it: its paragraphs in order. A bare string still reads, with no "why". */
const bodySchema = z.union([z.string(), z.array(paragraphSchema)]);
export const answerSchema = z.object({
  subject: z.string(),
  opener: bodySchema,
  followup: bodySchema,
});
export type Answer = z.infer<typeof answerSchema>;

/** The email as the gate reads it and the messages carry it. */
export interface Draft {
  subject: string;
  opener: string;
  followup: string;
}

/**
 * A paragraph and the brief lines it used (indexes into the brief's lines as
 * written from). Stored beside the draft for the portal's "why this line";
 * never sent.
 */
export interface WhyLine {
  text: string;
  lines: number[];
}

// ---- who writes --------------------------------------------------------------

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The profile's recruiter the CRM's owner column names: by owner alias, name or email. */
export function recruiterFor(
  owner: string | null,
  profile: Pick<ClientProfile, "recruiters">,
): Recruiter | null {
  if (!owner?.trim()) return null;
  const o = norm(owner);
  return (
    profile.recruiters.find(
      (r) => r.owners.some((a) => norm(a) === o) || norm(r.name) === o || r.email === o,
    ) ?? null
  );
}

/**
 * The mailbox a contact hears from: the owner's recruiter's, else the default
 * recruiter's, else one that writes for anyone, else the first. Suspended
 * mailboxes never. Null when there is none.
 */
export function pickSender(
  owner: string | null,
  profile: Pick<ClientProfile, "recruiters" | "defaultRecruiter">,
  senders: readonly Sender[],
): { sender: Sender; recruiter: Recruiter | null } | null {
  const live = senders.filter((s) => !s.suspended);
  if (!live.length) return null;
  const byEmail = (email: string | null) =>
    email ? (profile.recruiters.find((r) => r.email === email) ?? null) : null;
  const owned = recruiterFor(owner, profile);
  const own = owned && live.find((s) => s.recruiter === owned.email || s.address === owned.email);
  if (owned && own) return { sender: own, recruiter: owned };
  const fallback = profile.defaultRecruiter;
  const def = fallback && live.find((s) => s.recruiter === fallback || s.address === fallback);
  if (def) return { sender: def, recruiter: owned ?? byEmail(fallback) };
  const any = live.find((s) => s.recruiter === null) ?? (live[0] as Sender);
  return { sender: any, recruiter: owned ?? byEmail(any.recruiter) };
}

// ---- the gate ------------------------------------------------------------------

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** A scheme, `www.`, or any `name.tld` (bit.ly, northside.dev): a link, whatever the TLD. */
const URL = /https?:\/\/|www\.|\b[a-z0-9-]+\.[a-z]{2,}\b/i;
/** Firm words that name no one: "Acme Staffing" is named by "acme", never by "staffing". */
const GENERIC = new Set(
  "and the inc llc ltd co group partners partner talent staffing recruiting recruitment search solutions services consulting associates company agency global international".split(
    " ",
  ),
);

export interface GateContext {
  /** What the numbers in an email may come from: the brief and the profile. */
  source: string;
  /** Words the subject must not carry: the contact's names and their firm. */
  private: string[];
  /** The brief names open roles; without them an email can't say the team is hiring or growing. */
  hiring: boolean;
}

/** Growth talk: true only when the brief found open roles. */
const GROWTH = /\b(?:grow(?:s|ing|th)?|hiring|expand(?:s|ing)?|scal(?:es|ing))\b/i;
/** The brief's open-roles fact ("Acme has 4 open roles"). */
export const saysHiring = (brief: string) => /\bopen roles?\b/i.test(brief);

/** What no part of an email may carry: prices, links, addresses, dashes, placeholders. */
function marks(part: string, text: string): string[] {
  const why: string[] = [];
  if (/[$€£¥]/.test(text)) why.push(`${part}: a price`);
  if (URL.test(text)) why.push(`${part}: a link`);
  if (text.includes("@")) why.push(`${part}: an address`);
  if (/[—–]/.test(text)) why.push(`${part}: a dash`);
  if (/[{}[\]]/.test(text)) why.push(`${part}: a placeholder or mark`);
  return why;
}

/** The whole words of `text`, lowercase, any script. */
const wordsOf = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []);

/** Why a draft can't go out; empty when it can. */
export function gateDraft(d: Draft, ctx: GateContext): string[] {
  const why: string[] = [];
  const subject = d.subject.trim();
  if (!subject) why.push("subject: empty");
  if (subject !== subject.toLowerCase()) why.push("subject: not lowercase");
  if (/\p{Nd}/u.test(subject)) why.push("subject: has a number");
  if (words(subject) > SUBJECT_WORDS) why.push(`subject: over ${SUBJECT_WORDS} words`);
  why.push(...marks("subject", subject));
  const said = wordsOf(subject);
  for (const name of ctx.private) {
    const hit = [...wordsOf(name)].find((w) => w.length >= 3 && !GENERIC.has(w) && said.has(w));
    if (hit) why.push(`subject: names "${name}"`);
  }
  for (const [part, text, cap] of [
    ["opener", d.opener, OPENER_WORDS],
    ["followup", d.followup, FOLLOWUP_WORDS],
  ] as const) {
    const body = text.trim();
    if (!body) {
      why.push(`${part}: empty`);
      continue;
    }
    if (words(body) > cap) why.push(`${part}: over ${cap} words`);
    why.push(...marks(part, body));
    const made = madeUp(body, ctx.source);
    if (made.length) why.push(`${part}: ${made.join(", ")} not in the brief`);
    if (!ctx.hiring && GROWTH.test(body))
      why.push(`${part}: says they're hiring or growing; the brief found no open roles`);
  }
  return why;
}

/** Models write dashes whatever they're told; a comma says the same. */
const tidy = (s: string) =>
  s
    .replace(/\s*[—–]\s*/g, ", ")
    .trim()
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const VALEDICTIONS =
  "best|thanks|thank you|cheers|regards|best regards|kind regards|warmly|talk soon";
const VALEDICTION = new RegExp(`(?:^|\\n)\\s*(?:${VALEDICTIONS})[,!.]?\\s*$`, "i");
/** "Best,\nAnn Lee\nNorthside Talent": a sign-off line and a few short lines under it, at the end. */
const SIGN_OFF_BLOCK = new RegExp(
  `(?:^|\\n)[ \\t]*(?:${VALEDICTIONS})[,!.]?[ \\t]*(?:\\n[^\\n]{1,60}){1,4}\\s*$`,
  "i",
);

/**
 * The signature is added, so a model's own sign-off would print the name
 * twice: "Thanks for reading, Sam" keeps its thanks, a bare "Best,\nSam" goes,
 * and so does a whole sign-off block that names the sender. The name only
 * counts as a sign-off after a comma or on its own line: "and I will." stays.
 */
export function unsign(body: string, sender: string): string {
  const first = sender.split(/\s+/)[0] ?? sender;
  const names = [sender, first].filter(Boolean).map(literal).join("|");
  const block = body.match(SIGN_OFF_BLOCK);
  if (block && new RegExp(`\\b(?:${names})\\b`, "i").test(block[0]))
    return body.slice(0, block.index).trimEnd();
  const name = new RegExp(`(?:^|[,\\n])\\s*(?:${names})[.!]?\\s*$`, "i");
  if (!name.test(body)) return body;
  const left = body.replace(name, "").replace(VALEDICTION, "").trimEnd();
  return /[.!?]$/.test(left) ? left : `${left}.`;
}

const PARAGRAPH = /\n{2,}/;

/**
 * One email of the answer as sent text and its "why". Paragraphs are tidied
 * and joined by blank lines, the model's sign-off comes off the end, and a
 * paragraph keeps its brief lines only while its text is still a paragraph of
 * what gets sent: that text is how the portal finds it again.
 */
export function readBody(
  body: Answer["opener"],
  lineCount: number,
  sender: string,
): { text: string; why: WhyLine[] } {
  const parts = (typeof body === "string" ? [{ text: body, from: [] }] : body).flatMap((p) => {
    const lines = [...new Set((p.from ?? []).map(Number))]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= lineCount)
      .sort((a, b) => a - b)
      .map((n) => n - 1);
    return tidy(p.text)
      .split(PARAGRAPH)
      .map((t) => ({ text: t.trim(), lines }))
      .filter((t) => t.text);
  });
  const text = unsign(tidy(parts.map((p) => p.text).join("\n\n")), sender);
  const sent = new Set(text.split(PARAGRAPH).map((t) => t.trim()));
  return { text, why: parts.filter((p) => p.lines.length && sent.has(p.text)) };
}

// ---- the prompt ------------------------------------------------------------------

export interface ComposeSubject {
  personId: number;
  companyId: number;
  firstName: string | null;
  lastName: string | null;
  firm: string;
  /** The brief, marks taken out. */
  brief: string;
  /** The brief's sentences with their marks, numbered for the model from 1. */
  lines: string[];
  briefHash: string;
  citations: unknown;
  candidateId: number;
  email: string;
  owner: string | null;
}

export function buildComposePrompt(
  s: ComposeSubject,
  profile: Pick<ClientProfile, "firm" | "sells" | "voice">,
  sender: Pick<Sender, "name">,
): string {
  const hi = s.firstName ? `Hi ${s.firstName},` : "Hi there,";
  const who = [s.firstName, s.lastName].filter(Boolean).join(" ") || "a past contact";
  const lines = s.lines.length ? s.lines.map(stripMarks) : [s.brief];
  return `You write a short email from ${sender.name}, a recruiter at ${profile.firm}, to ${who}, someone the firm has worked with before, last known at ${s.firm}.

What ${profile.firm} does: ${profile.sells}

Why write now (true, from our research), one numbered line each:
${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}

How ${profile.firm} writes:
${profile.voice}

Write two emails.
1. The opener.
- Start with "${hi}" as its own paragraph.
- Say why you're writing now with one or two facts from "Why write now", plainly, as the recruiter who noticed.
- Only what they could see themselves: their role, a move, their company's open roles if listed. Never say the team is growing or hiring unless "Why write now" names open roles. Never the CRM, a record, a status, a placement, or the date you last spoke; "it's been a while" is enough.
- One ask: a short call. Close with: reply with a couple of times that work and I'll book it.
- Thank them for reading, in a few words, without your name.
- At most ${OPENER_WORDS} words.
2. The follow-up, sent in the same thread 4 business days later if they don't reply.
- Start with "${hi}".
- A short nudge: the same ask, or one new angle from the facts. No guilt.
- At most ${FOLLOWUP_WORDS} words.

Both: plain text. No links, no prices, no guarantees, no dashes, no brackets, no sign-off or signature (it is added). Use only the facts given; copy names and numbers exactly, and add no numbers of your own (not even "10 minutes"). Invent nothing about ${profile.firm} or ${s.firstName ?? "them"}.

Subject: lowercase, 2 to ${SUBJECT_WORDS} words, no numbers, no names, no facts. Like "quick question" or "a thought".

Return ONLY a JSON object. Each email is its paragraphs in order, the greeting first. "from" is the numbers of the "Why write now" lines a paragraph uses, [] when none:
{"subject": "...", "opener": [{"text": "${hi}", "from": []}, {"text": "...", "from": [1]}], "followup": [{"text": "...", "from": []}]}
`;
}

// ---- who is due ------------------------------------------------------------------

interface Row extends Record<string, unknown> {
  person_id: number;
  company_id: number;
  firm: string;
  first_name: string | null;
  last_name: string | null;
  brief: string;
  brief_hash: string;
  citations: unknown;
  candidate_id: number;
  email: string;
  owner: string | null;
}

function subjectsSql(opts: { limit?: number; count?: boolean; catchAll: boolean }) {
  return sql`
    with latest as (${LATEST_CRM_ROW}),
    addr as (
      select distinct on (cc.person_id) cc.person_id, cc.id candidate_id, lower(cc.email) email
      from contact_candidates cc where cc.evidence = 'crm' and (cc.state = 'verified'
        or (${opts.catchAll} and cc.state = 'candidate' and exists (select 1 from verifications v
          where v.contact_candidate_id = cc.id and v.result = 'catch_all'
            and (v.raw->>'authoritative')::boolean)))
      order by cc.person_id, cc.state = 'verified' desc, cc.rank, cc.id),
    owner as (
      select distinct on (c.person_id) c.person_id, c.owner from crm_contacts c
      where nullif(btrim(c.owner), '') is not null order by c.person_id, c.id desc),
    due as (
      select l.person_id, l.company_id, coalesce(co.name, co.domain, 'their firm') firm,
        pe.first_name, pe.last_name, b.text brief, b.inputs_hash brief_hash, b.citations,
        a.candidate_id, a.email, o.owner, s.score
      from latest l
      join companies co on co.id = l.company_id
      join people pe on pe.id = l.person_id
      join contact_scores s on s.person_id = l.person_id and s.score > 0
      join briefs b on b.person_id = l.person_id and b.state = 'written'
      join addr a on a.person_id = l.person_id
      left join owner o on o.person_id = l.person_id
      where coalesce((select w.kind from findings w
          where w.id = ${whereFinding(sql`l.person_id`)}), '') not in ('job_change', 'left')
        and not exists (select 1 from enrollments e where e.person_id = l.person_id)
        and not exists (select 1 from enrollments e
          where e.state = 'active' and (e.company_id = l.company_id or lower(e.to_email) = a.email))
        and not exists (select 1 from suppressions sp where sp.revoked_at is null
          and ((sp.kind = 'email' and sp.value = a.email)
            or (sp.kind = 'domain' and sp.value = split_part(a.email, '@', 2))))
        and not exists (select 1 from compositions c where c.person_id = l.person_id
          and c.state = 'failed' and c.created_at > now() - interval '1 day')
        and (select count(*) from compositions c
          where c.person_id = l.person_id and c.state = 'failed') < ${MAX_FAILURES})
    ${
      opts.count
        ? sql`select count(distinct company_id)::int n from due`
        : sql`select * from due order by score desc, person_id limit ${opts.limit ?? 1_000_000}`
    }`;
}

const stripMarks = (text: string) =>
  text
    .replace(MARKS, "")
    .replace(/\s+([.,;!?])/g, "$1")
    .trim();

/** Who is due an email, best score first, one per company and one per address. */
export async function composeSubjects(
  db: Queryable,
  opts: { limit?: number; catchAll?: boolean } = {},
): Promise<ComposeSubject[]> {
  const rows = await db.execute<Row>(subjectsSql({ catchAll: opts.catchAll ?? false }));
  const firms = new Set<number>();
  const addresses = new Set<string>();
  const out: ComposeSubject[] = [];
  for (const r of rows) {
    if (firms.has(r.company_id) || addresses.has(r.email)) continue;
    firms.add(r.company_id);
    addresses.add(r.email);
    out.push({
      personId: r.person_id,
      companyId: r.company_id,
      firstName: r.first_name?.trim() || null,
      lastName: r.last_name?.trim() || null,
      firm: r.firm,
      brief: stripMarks(r.brief),
      lines: briefLines(r.brief),
      briefHash: r.brief_hash,
      citations: r.citations,
      candidateId: r.candidate_id,
      email: r.email,
      owner: r.owner,
    });
    if (opts.limit !== undefined && out.length >= opts.limit) break;
  }
  return out;
}

/** Contacts that could be written to now, before the day's budget. */
export async function composeEligible(db: Queryable, catchAll = false): Promise<number> {
  const [r] = await db.execute<{ n: number }>(subjectsSql({ count: true, catchAll }));
  return r?.n ?? 0;
}

/** How many more today: `perDay` minus today's drafts, and never past `perDay` awaiting approval. */
export async function composeRoom(db: Queryable, perDay: number): Promise<number> {
  const [r] = await db.execute<{ drafted: number; waiting: number }>(sql`
    select
      (select count(*) from enrollments
        where offer = ${REACTIVATION} and created_at > now() - interval '1 day')::int drafted,
      (select count(*) from messages m join enrollments e on e.id = m.enrollment_id
        where e.offer = ${REACTIVATION} and e.state = 'active'
          and m.step = 0 and m.state = 'draft')::int waiting`);
  return Math.max(0, perDay - Math.max(r?.drafted ?? 0, r?.waiting ?? 0));
}

/** Why compose can't run for this client, or null when it can. */
export function composeBlocked(
  settings: ReactivationSettings,
  profile: ClientProfile | null,
  gate: { ok: boolean; reason: string },
  demo = false,
): string | null {
  if (!settings.stages.compose) return "compose is off (stages.compose)";
  if (!profile) return "no firm profile: `wren --client <id> crm profile set <file.json>`";
  if (!settings.senders.some((s) => !s.suspended))
    return "no senders: `wren clients set <id> --set 'reactivation.senders=[…]'`";
  const unknown = settings.senders.find(
    (s) => s.recruiter && !profile.recruiters.some((r) => r.email === s.recruiter),
  );
  if (unknown)
    return `sender ${unknown.address} writes as ${unknown.recruiter}, who is not in the firm profile`;
  if (!settings.compose.perDay) return "compose.perDay is 0";
  if (!gate.ok && !demo) return `the list is not ready to send: ${gate.reason}`;
  return null;
}

/** What compose would do now: contacts it would write to, or why none. */
export async function composeDue(
  db: Queryable,
  settings: ReactivationSettings,
  profile: ClientProfile | null,
  demo = false,
): Promise<{ due: number; blocked: string | null }> {
  const blocked = composeBlocked(settings, profile, (await crmHealth(db)).gate, demo);
  if (blocked) return { due: 0, blocked };
  const room = await composeRoom(db, settings.compose.perDay);
  if (!room)
    return {
      due: 0,
      blocked: `today's ${settings.compose.perDay} are written or waiting for approval`,
    };
  return {
    due: Math.min(room, await composeEligible(db, settings.compose.catchAll)),
    blocked: null,
  };
}

// ---- the stage -------------------------------------------------------------------

export interface CrmComposeStats {
  selected: number;
  drafted: number;
  /** Of those drafted, approved without a person (approval `first`, after the first batch). */
  approved: number;
  /** The model's answer didn't parse or the gate refused it. */
  failed: number;
  suppressed: number;
  /** Someone else enrolled the person, company or address first. */
  raced: number;
  errors: number;
  aborted: string | null;
}

export interface ComposeOptions {
  settings: ReactivationSettings;
  profile: ClientProfile | null;
  limit?: number;
  runId?: string | null;
  /** The demo never sends, so the send gate doesn't hold its drafts. */
  demo?: boolean;
}

export async function composeCrmEmails(
  db: Queryable,
  llm: LlmClient,
  opts: ComposeOptions,
): Promise<CrmComposeStats> {
  const stats: CrmComposeStats = {
    selected: 0,
    drafted: 0,
    approved: 0,
    failed: 0,
    suppressed: 0,
    raced: 0,
    errors: 0,
    aborted: null,
  };
  const { settings, profile } = opts;
  const blocked = composeBlocked(settings, profile, (await crmHealth(db)).gate, opts.demo);
  if (blocked || !profile) {
    stats.aborted = blocked;
    return stats;
  }
  const room = await composeRoom(db, settings.compose.perDay);
  const limit = Math.min(room, opts.limit ?? room);
  if (!limit) return stats;
  const subjects = await composeSubjects(db, { limit, catchAll: settings.compose.catchAll });
  stats.selected = subjects.length;
  const suppressed = await activeSuppressions(
    db,
    subjects.map((s) => s.email),
  );
  const autoApprove = settings.approval === "first" && (await firstBatchApproved(db));
  let streak = 0;
  for (const s of subjects) {
    if (suppressed(s.email)) {
      stats.suppressed += 1;
      continue;
    }
    const picked = pickSender(s.owner, profile, settings.senders) as NonNullable<
      ReturnType<typeof pickSender>
    >;
    let w: Written;
    try {
      w = await writeDraft(llm, s, profile, picked.sender, opts.runId ?? null);
    } catch (err) {
      if (err instanceof LlmError) {
        stats.aborted = err.message;
        break;
      }
      throw err;
    }
    try {
      if (!w.draft || w.refused.length) {
        await db
          .insert(compositions)
          .values({ ...w.record, state: "failed", detail: w.refused.join("; ") });
        stats.failed += 1;
      } else {
        const ok = await enroll(db, s, w, picked, profile, autoApprove);
        if (ok) {
          stats.drafted += 1;
          if (autoApprove) stats.approved += 1;
        } else stats.raced += 1;
      }
    } catch (err) {
      stats.errors += 1;
      streak += 1;
      if (streak >= ERROR_STREAK) {
        stats.aborted = `${ERROR_STREAK} errors in a row, last: ${err instanceof Error ? err.message : String(err)}`;
        break;
      }
      continue;
    }
    streak = 0;
  }
  return stats;
}

/** One model call at one contact: the draft, its "why", and what the gate says. */
interface Written {
  draft: Draft | null;
  why: { opener: WhyLine[]; followup: WhyLine[] };
  /** Why it can't go out; empty when it can. */
  refused: string[];
  /** The compositions row, less its state. */
  record: Omit<typeof compositions.$inferInsert, "state">;
}

/** Ask the model for the pair and gate it. An `LlmError` means the provider is down: callers stop. */
async function writeDraft(
  llm: LlmClient,
  s: ComposeSubject,
  profile: ClientProfile,
  sender: Sender,
  runId: string | null,
): Promise<Written> {
  const inputsHash = createHash("md5")
    .update(
      [
        COMPOSE_VERSION,
        s.briefHash,
        s.brief,
        sender.address,
        sender.name,
        profile.updatedAt.toISOString(),
      ].join("\0"),
    )
    .digest("hex");
  const outcome = await completeAndParse(
    llm,
    buildComposePrompt(s, profile, sender),
    answerSchema,
    {
      maxTokens: MAX_TOKENS,
      runId,
      name: COMPOSE_STAGE,
      metadata: { person_id: s.personId },
    },
  );
  const record = {
    personId: s.personId,
    inputsHash,
    model: llm.name,
    promptVersion: COMPOSE_VERSION,
    llm: outcome.envelope(),
    runId,
  };
  const why = { opener: [] as WhyLine[], followup: [] as WhyLine[] };
  if (!outcome.parsed)
    return {
      draft: null,
      why,
      refused: [`did not parse: ${outcome.parseError ?? outcome.providerRejected ?? "?"}`],
      record,
    };
  const opener = readBody(outcome.parsed.opener, s.lines.length, sender.name);
  const followup = readBody(outcome.parsed.followup, s.lines.length, sender.name);
  const draft = {
    subject: tidy(outcome.parsed.subject),
    opener: opener.text,
    followup: followup.text,
  };
  const refused = gateDraft(draft, {
    source: [s.brief, s.firm, profile.firm, profile.sells].join("\n"),
    private: [s.firstName, s.lastName, s.firm].filter((w): w is string => !!w),
    hiring: saysHiring(s.brief),
  });
  return { draft, why: { opener: opener.why, followup: followup.why }, refused, record };
}

/** What each message keeps about how it was written; `why` is its own email's. Never sent. */
function provenanceOf(
  s: ComposeSubject,
  recruiter: Recruiter | null,
  why: WhyLine[],
): Record<string, unknown> {
  return {
    composer: COMPOSE_VERSION,
    // The lines as written from: a brief redone later can't move the "why".
    brief: { inputs_hash: s.briefHash, citations: s.citations, lines: s.lines },
    address: { candidate_id: s.candidateId, email: s.email, evidence: "crm" },
    owner: s.owner,
    recruiter: recruiter?.email ?? null,
    why,
    version: COMPOSE_VERSION,
  };
}

/** Approval `first`: once a person approved any reactivation email, the rest flow. */
async function firstBatchApproved(db: Queryable): Promise<boolean> {
  const [r] = await db.execute<{ yes: boolean }>(sql`
    select exists (select 1 from messages m join enrollments e on e.id = m.enrollment_id
      where e.offer = ${REACTIVATION} and m.approved_by in ('client', 'operator')) yes`);
  return r?.yes ?? false;
}

/** One transaction: the enrollment, both messages, the composition. False when it lost a race. */
async function enroll(
  db: Queryable,
  s: ComposeSubject,
  w: Written,
  picked: { sender: Sender; recruiter: Recruiter | null },
  profile: ClientProfile,
  autoApprove: boolean,
): Promise<boolean> {
  const draft = w.draft as Draft;
  const signature = profile.signature.replaceAll("{name}", picked.sender.name);
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(enrollments)
        .values({
          personId: s.personId,
          companyId: s.companyId,
          kind: "person",
          toEmail: s.email,
          sender: picked.sender.address,
          niche: REACTIVATION,
          sequenceName: SEQUENCE.name,
          sequenceSnapshot: SEQUENCE,
          offer: REACTIVATION,
          state: "active",
          runId: w.record.runId ?? null,
        })
        .returning({ id: enrollments.id });
      const enrollmentId = (row as { id: number }).id;
      const now = new Date();
      const approval: {
        state: "draft" | "approved";
        approvedAt: Date | null;
        approvedBy: ApprovalSource | null;
      } = autoApprove
        ? { state: "approved", approvedAt: now, approvedBy: "auto" }
        : { state: "draft", approvedAt: null, approvedBy: null };
      await tx.insert(messages).values(
        SEQUENCE.steps.map((step, i) => ({
          enrollmentId,
          step: i,
          template: step.template,
          templateVersion: COMPOSE_VERSION,
          toEmail: s.email,
          subject: i === 0 ? draft.subject : null,
          body: signed(i === 0 ? draft.opener : draft.followup, signature),
          provenance: provenanceOf(s, picked.recruiter, i === 0 ? w.why.opener : w.why.followup),
          ...approval,
          runId: w.record.runId ?? null,
          openToken: null,
          // sent as the client, to the client's site: nothing of ours to count
          linkCode: null,
        })),
      );
      await tx.insert(compositions).values({ ...w.record, state: "drafted", enrollmentId });
    });
    return true;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    await db
      .insert(compositions)
      .values({ ...w.record, state: "raced", detail: "already enrolled when it was written" });
    return false;
  }
}

// ---- redraft ---------------------------------------------------------------------

export interface RedraftStats {
  selected: number;
  redrafted: number;
  /** The model's answer didn't parse or the gate refused it: the old draft stays. */
  failed: number;
  /** Its mailbox is gone, or someone approved or edited it while it was being written. */
  skipped: number;
  aborted: string | null;
}

/**
 * Write drafts that still wait for approval again with today's composer and
 * brief, in place: same enrollment, address and mailbox. Only pairs nobody
 * approved or sent, and without ids only pairs nobody edited. A refused
 * rewrite leaves the old draft as it was.
 */
export async function redraftAwaiting(
  db: Queryable,
  llm: LlmClient,
  opts: {
    profile: ClientProfile | null;
    senders: readonly Sender[];
    enrollmentIds?: number[];
    runId?: string | null;
  },
): Promise<RedraftStats> {
  const stats: RedraftStats = { selected: 0, redrafted: 0, failed: 0, skipped: 0, aborted: null };
  const { profile } = opts;
  if (!profile) {
    stats.aborted = "no firm profile: `wren --client <id> crm profile set <file.json>`";
    return stats;
  }
  if (opts.enrollmentIds && !opts.enrollmentIds.length) return stats;
  const rows = await db.execute<
    Row & { enrollment_id: number; sender: string; recruiter: string | null }
  >(sql`
    select e.id enrollment_id, e.person_id, e.company_id,
      coalesce(co.name, co.domain, 'their firm') firm, pe.first_name, pe.last_name,
      b.text brief, b.inputs_hash brief_hash, b.citations,
      (m.provenance->'address'->>'candidate_id')::int candidate_id, e.to_email email,
      m.provenance->>'owner' owner, m.provenance->>'recruiter' recruiter, e.sender
    from enrollments e
    join people pe on pe.id = e.person_id
    join companies co on co.id = e.company_id
    join briefs b on b.person_id = e.person_id and b.state = 'written'
    join messages m on m.enrollment_id = e.id and m.step = 0
    where e.offer = ${REACTIVATION} and e.state = 'active'
      and not exists (select 1 from messages x where x.enrollment_id = e.id and x.state <> 'draft')
      and not exists (select 1 from suppressions sp where sp.revoked_at is null
        and ((sp.kind = 'email' and sp.value = lower(e.to_email))
          or (sp.kind = 'domain' and sp.value = split_part(lower(e.to_email), '@', 2))))
      ${
        opts.enrollmentIds
          ? sql`and e.id in (${sql.join(
              opts.enrollmentIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
          : // A draft someone edited keeps their words unless it's named.
            sql`and not exists (select 1 from messages x
              where x.enrollment_id = e.id and x.edited_at is not null)`
      }
    order by e.id`);
  stats.selected = rows.length;
  for (const r of rows) {
    const sender = opts.senders.find((x) => x.address === r.sender && !x.suspended);
    if (!sender) {
      stats.skipped += 1;
      continue;
    }
    const s: ComposeSubject = {
      personId: r.person_id,
      companyId: r.company_id,
      firstName: r.first_name?.trim() || null,
      lastName: r.last_name?.trim() || null,
      firm: r.firm,
      brief: stripMarks(r.brief),
      lines: briefLines(r.brief),
      briefHash: r.brief_hash,
      citations: r.citations,
      candidateId: r.candidate_id,
      email: r.email,
      owner: r.owner,
    };
    const recruiter = profile.recruiters.find((x) => x.email === r.recruiter) ?? null;
    let w: Written;
    try {
      w = await writeDraft(llm, s, profile, sender, opts.runId ?? null);
    } catch (err) {
      if (err instanceof LlmError) {
        stats.aborted = err.message;
        break;
      }
      throw err;
    }
    const draft = w.draft;
    if (!draft || w.refused.length) {
      await db.insert(compositions).values({
        ...w.record,
        state: "failed",
        detail: `redraft of #${r.enrollment_id}: ${w.refused.join("; ")}`,
      });
      stats.failed += 1;
      continue;
    }
    const signature = profile.signature.replaceAll("{name}", sender.name);
    const done = await db.transaction(async (tx) => {
      const held = await tx.execute<{ state: string; edited: boolean }>(
        sql`select state, edited_at is not null edited from messages
          where enrollment_id = ${r.enrollment_id} for update`,
      );
      if (held.some((m) => m.state !== "draft" || (!opts.enrollmentIds && m.edited))) return false;
      for (const [i] of SEQUENCE.steps.entries())
        await tx
          .update(messages)
          .set({
            subject: i === 0 ? draft.subject : null,
            body: signed(i === 0 ? draft.opener : draft.followup, signature),
            provenance: provenanceOf(s, recruiter, i === 0 ? w.why.opener : w.why.followup),
            templateVersion: COMPOSE_VERSION,
            editedAt: null,
          })
          .where(and(eq(messages.enrollmentId, r.enrollment_id), eq(messages.step, i)));
      await tx
        .insert(compositions)
        .values({ ...w.record, state: "drafted", enrollmentId: r.enrollment_id });
      return true;
    });
    if (done) stats.redrafted += 1;
    else stats.skipped += 1;
  }
  return stats;
}
