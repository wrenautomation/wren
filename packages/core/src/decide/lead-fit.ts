/**
 * Lead check (designs/2026-10-17-people-depth.md): is this person a viable lead for what Wren
 * sells? `leadFitState` is all Jev sees about one profile, with every name, handle, address and
 * link taken out. `leadFitSource` finds the profiles that did something new since the last
 * check. `leadWhy` builds the one line under the chip from the state Jev saw: Jev answers
 * labels and chances only.
 *
 * Core takes the offers as an argument and imports no channel; the caller passes Wren's live
 * offers from `@wren/offers`.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { warmthOf } from "../people-map.js";
import { reachOf } from "../profile-reach.js";
import { newestCall } from "./calls.js";
import { KINDS, PICK, type Tone } from "./kinds.js";
import type { DecideSource, DecideSubject } from "./loop.js";

/** What Wren sells, in the words Jev reads: a name and who it is for. */
interface LeadOffer {
  name: string;
  audience: string;
}

export const LEAD_KIND = "lead_fit" as const;
/** The newest touches shown; counts cover all of them. */
const LEAD_TOUCH_LIMIT = 10;
/** The longest their words run in the state. */
export const LEAD_TEXT_MAX = 280;

export const leadSubject = (profileId: number) => `profile:${profileId}`;

/** The profile id in a `profile:<id>` subject, or null. */
export function leadProfileOf(subject: string): number | null {
  const m = /^profile:(\d{1,9})$/.exec(subject);
  return m ? Number(m[1]) : null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Words of a name worth hiding: 3 letters or more. */
function nameParts(name: string | null | undefined): string[] {
  const full = (name ?? "").trim();
  if (full.length < 3) return [];
  return [full, ...full.split(/[\s,.]+/).filter((p) => p.length >= 3)];
}

/** What to take out of free text: names (whole and in parts) and handles. Longest first. */
export function scrubList(o: {
  names?: readonly (string | null | undefined)[];
  handles?: readonly (string | null | undefined)[];
}): { names: string[]; handles: string[] } {
  const by = (a: string, b: string) => b.length - a.length;
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase()))].sort(by);
  return {
    names: uniq((o.names ?? []).flatMap(nameParts)),
    handles: uniq(
      (o.handles ?? []).map((h) => (h ?? "").replace(/^@/, "").trim()).filter((h) => h.length >= 3),
    ),
  };
}

/**
 * Free text with every link, address, phone number and @mention replaced, plus the given names
 * and handles. What is left is words only. `max` trims the end on a word.
 */
export function scrubText(
  text: string | null | undefined,
  list: { names: readonly string[]; handles: readonly string[] },
  max = LEAD_TEXT_MAX,
): string {
  let t = (text ?? "")
    .replace(/(?:https?:\/\/|www\.)\S+/gi, "[link]")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, "[email]")
    .replace(/(?<![\w])\+?\d[\d\s().-]{6,}\d(?![\w])/g, "[phone]")
    .replace(/(?<![\w])@[\w.]{2,}/g, "[handle]");
  for (const h of list.handles)
    t = t.replace(new RegExp(`(?<![\\w])${escapeRe(h)}(?![\\w])`, "gi"), "[handle]");
  for (const n of list.names)
    t = t.replace(new RegExp(`(?<![\\w])${escapeRe(n)}(?![\\w])`, "gi"), "[name]");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20))}...`;
}

export interface FoundFact {
  kind: string;
  platform: string | null;
  /** Employer text only; a handle or a page says its platform and nothing else. */
  employer?: string;
  confidence: number;
}

/**
 * What research kept or found about a profile (`profile_findings`, written by the lookup): the
 * one place this check reads that table. Dropped findings never show. Empty before any lookup.
 */
async function foundFor(
  db: Queryable,
  profileId: number,
  list: { names: readonly string[]; handles: readonly string[] },
): Promise<FoundFact[]> {
  const rows = (await db.execute(sql`
    select kind, platform, value, confidence from profile_findings
    where profile_id = ${profileId} and state in ('kept', 'found')
    order by (state = 'kept') desc, confidence desc, id
    limit 12`)) as unknown as {
    kind: string;
    platform: string | null;
    value: string;
    confidence: number;
  }[];
  return rows.map((r) => ({
    kind: r.kind,
    platform: r.platform,
    ...(r.kind === "employer" ? { employer: scrubText(r.value, list, 120) } : {}),
    confidence: Math.round(Number(r.confidence) * 100) / 100,
  }));
}

interface TouchFact {
  kind: string;
  direction: string;
  platform: string;
  /** The day, `YYYY-MM-DD`. */
  on: string;
  /** Their words (or ours), scrubbed and trimmed. */
  text: string | null;
}

/** The profile's touches' SQL source: its handle keys, their handles, their touches. */
const touchesOf = (profileId: number) => sql`
  from profile_keys k
  join social_handles h on k.kind = 'handle:' || h.platform and k.value = h.handle
  join touches t on t.handle_id = h.id
  where k.profile_id = ${profileId}`;

/** What Jev sees about one profile. Never a name, handle, address, phone or link. */
export async function leadFitState(
  db: Queryable,
  profileId: number,
  offers: readonly LeadOffer[],
): Promise<Record<string, unknown>> {
  const [reach, [warm]] = await Promise.all([reachOf(db, profileId), warmthOf(db, [profileId])]);
  const [profile] = (await db.execute(
    sql`select name from profiles where id = ${profileId}`,
  )) as unknown as { name: string | null }[];
  const list = scrubList({
    names: [profile?.name, reach.person?.name, ...reach.handles.map((h) => h.name)],
    handles: [...reach.handles.map((h) => h.handle), ...reach.emails.map((e) => e.split("@")[0])],
  });
  const recent = (await db.execute(sql`
    select t.kind, t.direction, h.platform, t.at, t.text ${touchesOf(profileId)}
    order by t.at desc, t.id desc limit ${LEAD_TOUCH_LIMIT}`)) as unknown as {
    kind: string;
    direction: string;
    platform: string;
    at: Date | string;
    text: string | null;
  }[];
  const counts = (await db.execute(sql`
    select t.kind, t.direction, count(*)::int n ${touchesOf(profileId)}
    group by t.kind, t.direction order by t.direction, t.kind`)) as unknown as {
    kind: string;
    direction: string;
    n: number;
  }[];
  const found = await foundFor(db, profileId, list);
  const day = (v: Date | string) => new Date(v).toISOString().slice(0, 10);
  return {
    person: {
      role: warm?.personaRole ?? "unknown",
      title: reach.person?.title ? scrubText(reach.person.title, list, 120) : null,
      companySize: warm?.personaSize ?? "unknown",
      niche: warm?.personaNiche ?? "unknown",
      persona: warm?.persona ?? "unknown",
      stage: warm?.stage ?? "stranger",
      warmth: warm?.warmth ?? "cold",
    },
    touches: {
      counts: counts.map((c) => ({ kind: c.kind, direction: c.direction, n: Number(c.n) })),
      recent: recent.map(
        (r): TouchFact => ({
          kind: r.kind,
          direction: r.direction,
          platform: r.platform,
          on: day(r.at),
          text: r.text ? scrubText(r.text, list) : null,
        }),
      ),
    },
    found,
    offers: offers.map((o) => ({ name: o.name, forWhom: o.audience })),
  };
}

/** Profiles with a touch of theirs after the newest `lead_fit` decision on them, oldest first. */
export async function leadFitDue(
  db: Queryable,
  limit: number,
): Promise<{ id: number; since: string }[]> {
  const rows = (await db.execute(sql`
    select p.id, min(t.at) since
    from profiles p
    join profile_keys k on k.profile_id = p.id
    join social_handles h on k.kind = 'handle:' || h.platform and k.value = h.handle
    join touches t on t.handle_id = h.id and t.direction = 'theirs'
    where p.merged_into is null
      and t.at > coalesce(
        (select max(d.at) from decisions d where d.kind = ${LEAD_KIND} and d.subject = 'profile:' || p.id),
        '-infinity'::timestamptz)
    group by p.id
    order by min(t.at), p.id
    limit ${limit}`)) as unknown as { id: number; since: Date | string }[];
  return rows.map((r) => ({ id: Number(r.id), since: new Date(r.since).toISOString() }));
}

/** The lead check as a Decide source: `offers` are what Wren sells, passed in by the caller. */
export function leadFitSource(offers: readonly LeadOffer[]): DecideSource {
  const one = async (db: Queryable, id: number): Promise<DecideSubject> => ({
    subject: leadSubject(id),
    state: await leadFitState(db, id, offers),
  });
  return {
    kind: LEAD_KIND,
    async due(db, _now, limit) {
      const ids = await leadFitDue(db, limit);
      return Promise.all(ids.map((r) => one(db, r.id)));
    },
    async one(db, subject) {
      const id = leadProfileOf(subject);
      if (id === null) return null;
      const [p] = (await db.execute(
        sql`select 1 from profiles where id = ${id} and merged_into is null`,
      )) as unknown[];
      return p ? one(db, id) : null;
    },
  };
}

const ROLE_WORDS: Record<string, string> = {
  owner: "Owner",
  executive: "Executive",
  manager: "Manager",
  staff: "Staff",
};
const SIZE_WORDS: Record<string, string> = {
  solo: "a one person firm",
  small: "a 2 to 9 person firm",
  mid: "a 10 to 49 person firm",
  large: "a 50 or more person firm",
};
const TIMES = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

interface StateShape {
  person?: { role?: string; companySize?: string; niche?: string; warmth?: string; stage?: string };
  touches?: { counts?: { kind: string; direction: string; n: number }[] };
  found?: FoundFact[];
}

/**
 * The line under the chip: the picked label's criterion in short words, then the two strongest
 * facts in the state Jev saw ("Owner at a 2 to 9 person firm; replied twice"). Facts that are
 * not known are left out; with none, the criterion stands alone.
 */
export function leadWhy(label: string, state: unknown): string {
  const s = (state ?? {}) as StateShape;
  const p = s.person ?? {};
  const theirs = (s.touches?.counts ?? []).filter((c) => c.direction === "theirs");
  const n = theirs.reduce((a, c) => a + Number(c.n), 0);
  const facts: string[] = [];
  const role = ROLE_WORDS[p.role ?? ""];
  const size = SIZE_WORDS[p.companySize ?? ""];
  if (role && size) facts.push(`${role} at ${size}`);
  else if (role) facts.push(role);
  else if (size) facts.push(`At ${size}`);
  if (p.niche && p.niche !== "unknown") facts.push(`works in ${p.niche}`);
  if (n > 0) facts.push(`replied ${TIMES(n)}`);
  const employer = (s.found ?? []).find((f) => f.kind === "employer" && f.employer);
  if (employer) facts.push("research found a job");
  // Two strongest: role and size, then what they did, then niche, then research.
  const rank = (f: string) =>
    f.startsWith("Owner") ||
    f.startsWith("Executive") ||
    f.startsWith("Manager") ||
    f.startsWith("Staff") ||
    f.startsWith("At ")
      ? 0
      : f.startsWith("replied")
        ? 1
        : f.startsWith("works")
          ? 2
          : 3;
  const top = [...facts].sort((a, b) => rank(a) - rank(b)).slice(0, 2);
  const lead =
    label === "fit"
      ? "Could buy"
      : label === "not"
        ? "Likes the content, would not buy"
        : "Too little to say";
  return top.length ? `${lead}. ${top.join("; ")}.` : `${lead}.`;
}

/** The lead chip on a profile page: Jev's newest answer, his call beside it, and whether one is asked. */
export interface LeadFitView {
  /** Jev's newest answer, when the kind shows its picks. */
  pick: {
    label: string;
    name: string;
    tone: Tone;
    /** Chance of the picked label, 0 to 100. */
    percent: number | null;
    why: string;
    at: string;
  } | null;
  /** His own call, newest. `overrode`: it went against the pick shown. */
  call: { label: string; name: string; at: string; overrode: boolean } | null;
  /** When the newest decision of any kind of outcome was kept, ISO: a "Checking" ends past it. */
  lastAt: string | null;
  /** Why the newest ask got no label, in words. */
  failed: string | null;
}

/** The chance Jev gave the label it picked: its probability, else its confidence. */
export function pickPercent(answers: unknown, label: string, confidence: number | null) {
  const a = (answers as Record<string, { probabilities?: Record<string, number> }> | null)?.[PICK];
  const p = a?.probabilities?.[label] ?? confidence;
  return typeof p === "number" && Number.isFinite(p) ? Math.round(p * 100) : null;
}

/** What the chip shows for one profile; null parts when nothing was asked. */
export async function leadFitView(db: Queryable, profileId: number): Promise<LeadFitView> {
  const subject = leadSubject(profileId);
  const [row] = (await db.execute(sql`
    select id, at, mode, label, answers, confidence, state, error from decisions
    where kind = ${LEAD_KIND} and subject = ${subject}
    order by at desc, id desc limit 1`)) as unknown as {
    id: number;
    at: Date | string;
    mode: string;
    label: string | null;
    answers: unknown;
    confidence: number | null;
    state: unknown;
    error: string | null;
  }[];
  const call = await newestCall(db, LEAD_KIND, subject);
  const labels = KINDS[LEAD_KIND].labels;
  const shown = row?.label && (row.mode === "recommend" || row.mode === "gate") ? row : null;
  const spec = shown?.label ? labels[shown.label] : undefined;
  return {
    pick:
      shown?.label && spec
        ? {
            label: shown.label,
            name: spec.name,
            tone: spec.tone,
            percent: pickPercent(shown.answers, shown.label, shown.confidence),
            why: leadWhy(shown.label, shown.state),
            at: new Date(shown.at).toISOString(),
          }
        : null,
    call:
      call && labels[call.label]
        ? {
            label: call.label,
            name: labels[call.label]?.name ?? call.label,
            at: call.at.toISOString(),
            overrode: call.override && !!shown && call.decisionId === shown.id,
          }
        : null,
    lastAt: row ? new Date(row.at).toISOString() : null,
    failed: row && !row.label ? (row.error?.replace(/^\w*Error: /, "") ?? "No answer") : null,
  };
}
