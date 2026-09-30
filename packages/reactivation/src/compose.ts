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
import { completeAndParse, type Envelope, type LlmClient, LlmError } from "@wren/llm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { MARKS, madeUp } from "./brief.js";
import { crmHealth } from "./crm/health.js";
import { type ClientProfile, compositions, type Recruiter } from "./schema.js";
import { LATEST_CRM_ROW, whereFinding } from "./score.js";
import type { ReactivationSettings, Sender } from "./settings.js";

export const COMPOSE_VERSION = "v1";
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

export const draftSchema = z.object({
  subject: z.string(),
  opener: z.string(),
  followup: z.string(),
});
export type Draft = z.infer<typeof draftSchema>;

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
}

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
  }
  return why;
}

const tidy = (s: string) =>
  s
    .trim()
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

// ---- the prompt ------------------------------------------------------------------

export interface ComposeSubject {
  personId: number;
  companyId: number;
  firstName: string | null;
  lastName: string | null;
  firm: string;
  /** The brief, marks taken out. */
  brief: string;
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
  return `You write a short email from ${sender.name}, a recruiter at ${profile.firm}, to ${who}, someone the firm has worked with before, last known at ${s.firm}.

What ${profile.firm} does: ${profile.sells}

Why write now (true, from our research):
${s.brief}

How ${profile.firm} writes:
${profile.voice}

Write two emails.
1. The opener.
- Start with "${hi}" on its own line.
- Say why you're writing now with one or two facts from "Why write now", plainly, as the recruiter who noticed.
- One ask: a short call. Close with: reply with a couple of times that work and I'll book it.
- Thank them for reading, in a few words.
- At most ${OPENER_WORDS} words.
2. The follow-up, sent in the same thread 4 business days later if they don't reply.
- Start with "${hi}".
- A short nudge: the same ask, or one new angle from the facts. No guilt.
- At most ${FOLLOWUP_WORDS} words.

Both: plain text. No links, no prices, no guarantees, no dashes, no brackets, no sign-off or signature (it is added). Use only the facts given; copy names and numbers exactly. Invent nothing about ${profile.firm} or ${s.firstName ?? "them"}.

Subject: lowercase, 2 to ${SUBJECT_WORDS} words, no numbers, no names, no facts. Like "quick question" or "a thought".

Return ONLY a JSON object: {"subject": "...", "opener": "...", "followup": "..."}
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
      (select count(*) from compositions
        where state = 'drafted' and created_at > now() - interval '1 day')::int drafted,
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
  if (!gate.ok) return `the list is not ready to send: ${gate.reason}`;
  return null;
}

/** What compose would do now: contacts it would write to, or why none. */
export async function composeDue(
  db: Queryable,
  settings: ReactivationSettings,
  profile: ClientProfile | null,
): Promise<{ due: number; blocked: string | null }> {
  const blocked = composeBlocked(settings, profile, (await crmHealth(db)).gate);
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
  const blocked = composeBlocked(settings, profile, (await crmHealth(db)).gate);
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
    const inputsHash = createHash("md5")
      .update(
        [
          COMPOSE_VERSION,
          s.briefHash,
          s.brief,
          picked.sender.address,
          picked.sender.name,
          profile.updatedAt.toISOString(),
        ].join("\0"),
      )
      .digest("hex");
    let envelope: Envelope;
    let draft: Draft | null = null;
    let why: string[];
    try {
      const outcome = await completeAndParse(
        llm,
        buildComposePrompt(s, profile, picked.sender),
        draftSchema,
        {
          maxTokens: MAX_TOKENS,
          runId: opts.runId ?? null,
          name: COMPOSE_STAGE,
          metadata: { person_id: s.personId },
        },
      );
      envelope = outcome.envelope();
      if (outcome.parsed) {
        draft = {
          subject: tidy(outcome.parsed.subject),
          opener: tidy(outcome.parsed.opener),
          followup: tidy(outcome.parsed.followup),
        };
        why = gateDraft(draft, {
          source: [s.brief, s.firm, profile.firm, profile.sells].join("\n"),
          private: [s.firstName, s.lastName, s.firm].filter((w): w is string => !!w),
        });
      } else why = [`did not parse: ${outcome.parseError ?? outcome.providerRejected ?? "?"}`];
    } catch (err) {
      if (err instanceof LlmError) {
        stats.aborted = err.message;
        break;
      }
      throw err;
    }
    const record = {
      personId: s.personId,
      inputsHash,
      model: llm.name,
      promptVersion: COMPOSE_VERSION,
      llm: envelope,
      runId: opts.runId ?? null,
    };
    try {
      if (!draft || why.length) {
        await db
          .insert(compositions)
          .values({ ...record, state: "failed", detail: why.join("; ") });
        stats.failed += 1;
      } else {
        const ok = await enroll(db, s, draft, picked, profile, record, autoApprove);
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
  draft: Draft,
  picked: { sender: Sender; recruiter: Recruiter | null },
  profile: ClientProfile,
  record: Omit<typeof compositions.$inferInsert, "state">,
  autoApprove: boolean,
): Promise<boolean> {
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
          runId: record.runId ?? null,
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
      const provenance = {
        composer: COMPOSE_VERSION,
        brief: { inputs_hash: s.briefHash, citations: s.citations },
        address: { candidate_id: s.candidateId, email: s.email, evidence: "crm" },
        owner: s.owner,
        recruiter: picked.recruiter?.email ?? null,
        version: COMPOSE_VERSION,
      };
      await tx.insert(messages).values(
        SEQUENCE.steps.map((step, i) => ({
          enrollmentId,
          step: i,
          template: step.template,
          templateVersion: COMPOSE_VERSION,
          toEmail: s.email,
          subject: i === 0 ? draft.subject : null,
          body: signed(i === 0 ? draft.opener : draft.followup, signature),
          provenance,
          ...approval,
          runId: record.runId ?? null,
          openToken: null,
          // sent as the client, to the client's site: nothing of ours to count
          linkCode: null,
        })),
      );
      await tx.insert(compositions).values({ ...record, state: "drafted", enrollmentId });
    });
    return true;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    await db
      .insert(compositions)
      .values({ ...record, state: "raced", detail: "already enrolled when it was written" });
    return false;
  }
}
