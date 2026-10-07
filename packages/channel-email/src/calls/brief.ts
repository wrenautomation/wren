/**
 * The pre-call brief (designs/2026-10-07-close-brief-outcome.md): one screen on who booked, how
 * they came in, what they wrote, what the dossier and signals say, and what to ask. Code reads it
 * all from the call's own database; every line names its source and date, and a line with no date
 * is left out. The model only adds questions, and code checks each one.
 */

import type { Queryable } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { dossiers, type Fact, recentPosts } from "@wren/research/dossier";
import { eq, sql } from "drizzle-orm";
import { callBriefs } from "../schema.js";

/** One line of the brief: what it says, where it came from, and when. */
export interface Cited {
  text: string;
  /** Where: a site's host, or a named place ("Email reply", "Booking"). */
  source: string;
  href: string | null;
  /** The day it's from: YYYY-MM-DD. */
  at: string;
}

export interface Question {
  text: string;
  /** Code asks about what's missing; the model about what's there. */
  from: "code" | "model";
}

export interface CallBrief {
  call: {
    id: number;
    who: string;
    email: string | null;
    title: string | null;
    company: string | null;
    domain: string | null;
    start: string | null;
    offer: string | null;
  };
  /** The three lines worth reading if nothing else is: how they came in, their words, what's new. */
  top: Cited[];
  cameIn: Cited[];
  /** Their own words, newest first. */
  thread: Cited[];
  facts: Cited[];
  posts: Cited[];
  signals: Cited[];
  questions: Question[];
  built: string;
  /** The model that wrote questions; null when code alone did. */
  model: string | null;
}

/** How much of each part a brief keeps: one screen. */
export const BRIEF_LIMITS = { thread: 3, facts: 6, posts: 3, signals: 5, questions: 3 } as const;
const EXCERPT = 280;
const SIGNAL_DAYS = 90;

type Raw = Record<string, unknown>;
const rows = async (db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute<Raw>(q)) as unknown as Raw[];
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : v instanceof Date ? v.toISOString() : null;
const day = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const hostOf = (url: string | null): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};
const short = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

const SITES: Record<string, string> = {
  linkedin: "LinkedIn",
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  x: "X",
  reddit: "Reddit",
};
const siteName = (site: string) => SITES[site.toLowerCase()] ?? site;
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One dossier fact as a person reads it: "Hiring: 14 open roles (Recruiter, Sourcer)". */
export function factLine(f: Pick<Fact, "what" | "value">): string | null {
  const what = sentence(f.what.replaceAll("_", " "));
  const v = f.value;
  const plain = (x: unknown): string | null =>
    typeof x === "string" && x.trim()
      ? x.trim()
      : typeof x === "number" || typeof x === "boolean"
        ? String(x)
        : Array.isArray(x) && x.every((y) => typeof y === "string" || typeof y === "number")
          ? x.join(", ")
          : null;
  let text = plain(v);
  if (text === null && v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o.count === "number") {
      const roles = plain(o.roles);
      text = `${o.count} open roles${roles ? ` (${roles})` : ""}`;
    } else {
      const lead = ["title", "text", "caption", "summary", "line", "name"]
        .map((k) => plain(o[k]))
        .find(Boolean);
      text =
        lead ??
        (Object.entries(o)
          .map(([k, x]) => {
            const p = plain(x);
            return p ? `${k.replaceAll("_", " ")} ${p}` : null;
          })
          .filter(Boolean)
          .join("; ") ||
          null);
    }
  }
  return text ? `${what}: ${short(text, 200)}` : null;
}

/** A reply's own words: what's above the quoted thread and the signature dashes. */
export function ownWords(body: string): string {
  const lines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const l = line.trim();
    if (l.startsWith(">") || /^On .+wrote:$/i.test(l) || l === "--" || /^-{2,}\s*Original/i.test(l))
      break;
    lines.push(l);
  }
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

/** A cited line, or null when it has no text or no date. */
const cited = (
  text: string | null,
  source: string,
  href: string | null,
  at: unknown,
): Cited | null => {
  const d = day(at);
  return text && d ? { text, source, href, at: d } : null;
};
const kept = (xs: (Cited | null)[]) => xs.filter((x): x is Cited => x !== null);

const CHANNELS: Record<string, string> = {
  form: "a form",
  hook: "a form",
  inbound: "a text they sent",
  tel_link: "a number on their site",
  page_text: "a number on their site",
  manual: "a contact added by hand",
};

/** The facts code can read for one call; null when there's no such call. */
async function gather(db: Queryable, id: number) {
  const [call] = await rows(
    db,
    sql`select cb.id, cb.uid, cb.state, cb.start, cb.email, cb.name, cb.offer, cb.code,
      cb.booked_at, cb.enrollment_id, e.niche, e.sequence_name, e.created_at enrolled_at,
      coalesce(e.company_id, sc.company_id) company_id, coalesce(e.person_id, sc.person_id) person_id,
      co.name company, co.domain, p.title,
      coalesce(nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''),
        p.full_name, cb.name, cb.email) who
    from call_bookings cb
    left join enrollments e on e.id = cb.enrollment_id
    left join lateral (select s.company_id, s.person_id from sms_contacts s
      where cb.email is not null and lower(s.email) = lower(cb.email) order by s.id limit 1) sc
      on true
    left join companies co on co.id = coalesce(e.company_id, sc.company_id)
    left join people p on p.id = coalesce(e.person_id, sc.person_id)
    where cb.id = ${id}`,
  );
  if (!call) return null;
  const enrollment = call.enrollment_id == null ? null : Number(call.enrollment_id);
  const email = str(call.email);
  const uid = String(call.uid);
  const ours = /^wren-\d+$/.test(uid) ? Number(uid.slice(5)) : null;
  const [first, linked, texted, booking, replies, texts] = await Promise.all([
    enrollment === null
      ? []
      : rows(
          db,
          sql`select step, sent_at, subject from messages
            where enrollment_id = ${enrollment} and sent_at is not null order by sent_at limit 1`,
        ),
    str(call.code)
      ? rows(
          db,
          sql`select step, sent_at from messages where link_code = ${String(call.code)} limit 1`,
        )
      : [],
    email
      ? rows(
          db,
          sql`select c.source_kind, c.created_at, m.sent_at from sms_contacts c
            left join lateral (select sent_at from sms_messages m where m.contact_id = c.id
              and m.direction = 'out' and m.sent_at is not null order by m.sent_at limit 1) m on true
            where lower(c.email) = lower(${email}) order by c.id limit 1`,
        )
      : [],
    ours === null
      ? []
      : rows(db, sql`select source, created_at, zone from calendar.bookings where id = ${ours}`),
    enrollment === null
      ? []
      : rows(
          db,
          sql`select received_at, coalesce(body_text, snippet) body from thread_events
            where enrollment_id = ${enrollment} and kind = 'reply'
            order by received_at desc limit ${BRIEF_LIMITS.thread}`,
        ),
    email
      ? rows(
          db,
          sql`select m.received_at, m.body from sms_messages m join sms_contacts c on c.id = m.contact_id
            where lower(c.email) = lower(${email}) and m.direction = 'in' and m.received_at is not null
            order by m.received_at desc limit ${BRIEF_LIMITS.thread}`,
        )
      : [],
  ]);
  const companyId = call.company_id == null ? null : Number(call.company_id);
  const personId = call.person_id == null ? null : Number(call.person_id);
  const [dossier] = companyId === null ? [] : await dossiers(db, [companyId]);
  const signals =
    companyId === null && personId === null
      ? []
      : await rows(
          db,
          sql`select kind, topic, title, url, "at", via from research_signals
            where (company_id = ${companyId ?? -1} or person_id = ${personId ?? -1})
              and "at" > now() - make_interval(days => ${SIGNAL_DAYS})
            order by "at" desc limit ${BRIEF_LIMITS.signals}`,
        );
  return {
    call,
    first: first[0],
    linked: linked[0],
    texted: texted[0],
    booking: booking[0],
    replies,
    texts,
    dossier,
    signals,
  };
}

type Gathered = NonNullable<Awaited<ReturnType<typeof gather>>>;

function cameInOf(g: Gathered): Cited[] {
  const { call, first, linked, texted, booking } = g;
  const campaign = str(call.niche);
  const out: (Cited | null)[] = [];
  if (first)
    out.push(
      cited(
        `First email${campaign ? ` in the ${campaign.replaceAll("_", " ")} campaign` : ""}, step ${first.step}${str(first.subject) ? `: "${short(String(first.subject), 80)}"` : ""}`,
        "Email sent",
        null,
        first.sent_at,
      ),
    );
  if (linked)
    out.push(
      cited(
        `Booked from the link in email step ${linked.step}`,
        "Email link",
        null,
        linked.sent_at,
      ),
    );
  if (texted)
    out.push(
      cited(
        `Came in through ${CHANNELS[String(texted.source_kind)] ?? "texts"}${texted.sent_at ? ", texted first" : ""}`,
        "Texts",
        null,
        texted.sent_at ?? texted.created_at,
      ),
    );
  if (booking) {
    const s = (booking.source ?? {}) as Record<string, string | undefined>;
    const tags = [s.utm_source, s.utm_medium, s.utm_campaign].filter(Boolean).join(" / ");
    out.push(
      cited(
        `Booked on our page${s.page ? ` (${s.page})` : ""}${tags ? ` from ${tags}` : s.ref ? ` from ${s.ref}` : ""}`,
        "Booking",
        null,
        booking.created_at,
      ),
    );
  } else out.push(cited("Booked on cal.com", "Booking", null, call.booked_at));
  return kept(out);
}

function threadOf(g: Gathered): Cited[] {
  const lines = [
    ...g.replies.map((r) =>
      cited(
        short(ownWords(String(r.body ?? "")), EXCERPT) || null,
        "Email reply",
        null,
        r.received_at,
      ),
    ),
    ...g.texts.map((r) =>
      cited(short(String(r.body ?? ""), EXCERPT) || null, "Text", null, r.received_at),
    ),
  ];
  return kept(lines)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, BRIEF_LIMITS.thread);
}

/** What's missing, as questions: code's, so a brief always has something to ask. */
export function gapQuestions(
  b: Omit<CallBrief, "questions" | "built" | "model" | "top">,
): Question[] {
  const q: string[] = [];
  if (!b.call.company) q.push("What company are they with, and what does it do?");
  if (!b.thread.length) q.push("What made them book now?");
  if (!b.signals.length && !b.posts.length) q.push("What changed for them lately?");
  q.push("What are they trying to fix, and by when?");
  return q.slice(0, BRIEF_LIMITS.questions).map((text) => ({ text, from: "code" as const }));
}

/** The facts as the model reads them, and as code checks its questions against. */
export const factsText = (b: Omit<CallBrief, "questions" | "built" | "model" | "top">) =>
  [
    `Who: ${b.call.who}${b.call.title ? `, ${b.call.title}` : ""}${b.call.company ? ` at ${b.call.company}` : ""}`,
    ...b.cameIn.map((c) => `Came in: ${c.text} (${c.at})`),
    ...b.thread.map((c) => `They wrote: ${c.text} (${c.at})`),
    ...b.facts.map((c) => `Fact: ${c.text} (${c.at})`),
    ...b.posts.map((c) => `Post: ${c.text} (${c.at})`),
    ...b.signals.map((c) => `Signal: ${c.text} (${c.at})`),
  ].join("\n");

/**
 * The model's lines that pass: a question under 160 characters, no link, no number the facts
 * don't hold, not one already asked. At most `max`.
 */
export function checkQuestions(
  answer: string,
  facts: string,
  have: readonly string[],
  max: number = BRIEF_LIMITS.questions,
): string[] {
  const seen = new Set(have.map((h) => h.toLowerCase()));
  const out: string[] = [];
  for (const raw of answer.split(/\r?\n/)) {
    const q = raw
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
      .replace(/^["']|["']$/g, "")
      .trim();
    if (q.length < 10 || q.length > 160 || !q.endsWith("?")) continue;
    if (/https?:|www\.|@/i.test(q)) continue;
    if ((q.match(/\d+/g) ?? []).some((n) => !facts.includes(n))) continue;
    if (seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    out.push(q);
    if (out.length >= max) break;
  }
  return out;
}

const SYSTEM =
  "You prepare a sales rep for a booked call. Write up to 3 short open questions to ask, one per " +
  "line, each ending with a question mark. Use only the facts given; add no names, numbers or " +
  "claims of your own. No links, no preamble.";

/** The model's questions, checked; none when it fails or says nothing usable. */
async function modelQuestions(
  llm: LlmClient,
  facts: string,
  have: readonly string[],
): Promise<string[]> {
  try {
    const r = await llm.complete(facts.slice(0, 6000), { system: SYSTEM, maxTokens: 300 });
    return checkQuestions(r.text, facts, have);
  } catch {
    return [];
  }
}

export interface BuildOptions {
  now: Date;
  /** The worker's model, for questions; null or off, code's alone. */
  llm?: LlmClient | null;
}

/** Build one call's brief from its database; null when there's no such call. Writes nothing. */
export async function buildBrief(
  db: Queryable,
  id: number,
  o: BuildOptions,
): Promise<CallBrief | null> {
  const g = await gather(db, id);
  if (!g) return null;
  const { call, dossier } = g;
  const known = kept(
    (dossier?.facts ?? [])
      .filter((f) => f.what !== "post")
      .map((f) => cited(factLine(f), hostOf(f.source) ?? f.via, f.source, f.seenAt)),
  );
  const posts = kept(
    (dossier ? recentPosts(dossier) : []).map((p) =>
      cited(
        p.text ? `${siteName(p.site)}: ${short(p.text, EXCERPT)}` : null,
        hostOf(p.url) ?? p.site,
        p.url,
        p.publishedAt,
      ),
    ),
  ).slice(0, BRIEF_LIMITS.posts);
  // A post is a signal too; it shows once, under Recent posts.
  const postLinks = new Set(posts.map((p) => p.href).filter(Boolean));
  // A dated finding is a signal; it shows once, under Signals, in the dossier's fuller words.
  const factBy = new Map(known.filter((f) => f.href).map((f) => [f.href, f]));
  const signals = kept(
    g.signals
      .filter((s) => !postLinks.has(str(s.url)))
      .map((s) =>
        cited(
          factBy.get(str(s.url))?.text ??
            ([str(s.topic) && sentence(siteName(String(s.topic))), str(s.title)]
              .filter(Boolean)
              .join(": ") ||
              null),
          hostOf(str(s.url)) ?? String(s.via),
          str(s.url),
          s.at,
        ),
      ),
  );
  const signalLinks = new Set(signals.map((x) => x.href).filter(Boolean));
  const facts = known
    .filter((f) => !f.href || !signalLinks.has(f.href))
    .slice(0, BRIEF_LIMITS.facts);
  const base = {
    call: {
      id,
      who: String(call.who ?? "Someone"),
      email: str(call.email),
      title: str(call.title),
      company: str(call.company),
      domain: str(call.domain),
      start: call.start == null ? null : new Date(String(call.start)).toISOString(),
      offer: str(call.offer),
    },
    cameIn: cameInOf(g),
    thread: threadOf(g),
    facts,
    posts,
    signals,
  };
  const code = gapQuestions(base);
  const text = factsText(base);
  const asked = o.llm
    ? await modelQuestions(
        o.llm,
        text,
        code.map((q) => q.text),
      )
    : [];
  const model = asked.length && o.llm ? o.llm.name.slice(0, 64) : null;
  // The model's go first: they're about this lead; code's fill what's left.
  const questions = [...asked.map((q) => ({ text: q, from: "model" as const })), ...code].slice(
    0,
    BRIEF_LIMITS.questions + 1,
  );
  const fresh = [...signals, ...posts].sort((a, b) => b.at.localeCompare(a.at))[0];
  const top = kept([base.cameIn[0] ?? null, base.thread[0] ?? null, fresh ?? facts[0] ?? null]);
  return { ...base, top, questions, built: o.now.toISOString(), model };
}

/** Keep a call's brief: one row per call, the newest build wins. */
export async function saveBrief(db: Queryable, brief: CallBrief): Promise<void> {
  const row = {
    callBookingId: brief.call.id,
    start: brief.call.start ? new Date(brief.call.start) : null,
    brief,
    model: brief.model,
    builtAt: new Date(brief.built),
  };
  await db
    .insert(callBriefs)
    .values(row)
    .onConflictDoUpdate({
      target: callBriefs.callBookingId,
      set: { start: row.start, brief: row.brief, model: row.model, builtAt: row.builtAt },
    });
}

/** Note the rep was pinged with it. */
export async function markSent(db: Queryable, id: number, at: Date): Promise<void> {
  await db.update(callBriefs).set({ sentAt: at }).where(eq(callBriefs.callBookingId, id));
}

export interface StoredBrief {
  brief: CallBrief;
  /** Saved, or built just now by code for the page and not kept. */
  saved: boolean;
  sentAt: string | null;
}

/** What a call's page shows: its saved brief, else one code builds now and doesn't keep. */
export async function briefOf(
  db: Queryable,
  id: string,
  now = new Date(),
): Promise<StoredBrief | null> {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  const [have] = await db.select().from(callBriefs).where(eq(callBriefs.callBookingId, n));
  if (have)
    return {
      brief: have.brief as CallBrief,
      saved: true,
      sentAt: have.sentAt?.toISOString() ?? null,
    };
  const built = await buildBrief(db, n, { now });
  return built ? { brief: built, saved: false, sentAt: null } : null;
}
