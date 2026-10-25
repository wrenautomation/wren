/**
 * "Research this person" on a profile, the writes the portal and the CLI make
 * (designs/2026-10-17-people-depth.md): queue a run, and decide what a run found.
 *
 * The run itself is the research package's `ProfileResearch` object; core sends to it by name
 * through a local interface and never imports research. A finding is kept or dropped by a
 * person. Keeping a handle adds its `handle:<platform>` key to the profile, so a key another
 * profile holds merges the two the way every key write does.
 */
import type * as restate from "@restatedev/restate-sdk";
import { atomic, type Queryable } from "@wren/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { resolveProfile } from "./profiles.js";
import {
  type ProfileFinding,
  type ProfileLookupState,
  profileFindings,
  profileLookups,
} from "./profiles-schema.js";
import { PortalRefusal } from "./refusal.js";
import { normalizeHandle, resolveHandle } from "./touches.js";

/** The Restate object that carries a run out; its key is the profile id. */
export const PROFILE_RESEARCH = { name: "ProfileResearch" } as const;
/** What a sender needs of it: `run` with the queued row's id. Typed locally; core imports no research. */
export interface ProfileResearchObject {
  run: (ctx: restate.ObjectContext, input: { lookupId: number }) => Promise<unknown>;
}

/** A run that has not finished by now is lost (a crashed send): a new one may start. */
const STALE_RUN_MS = 30 * 60_000;

/** The profile's run in flight, if any. */
async function runInFlight(db: Queryable, profileId: number) {
  const [row] = await db
    .select({ id: profileLookups.id, state: profileLookups.state })
    .from(profileLookups)
    .where(
      and(
        eq(profileLookups.profileId, profileId),
        inArray(profileLookups.state, ["queued", "running"]),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Queue one run for a profile. Refused while one is queued or running ("Already running"), and
 * for a profile that was merged into another (research that one). Starting it is the caller's.
 */
export async function queueProfileResearch(
  db: Queryable,
  profileId: number,
  by: string,
): Promise<{ lookupId: number; profileId: number }> {
  return atomic(db, async (tx) => {
    // One writer per profile: two presses at once queue one run.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`profile_research:${profileId}`}))`,
    );
    const [p] = (await tx.execute(
      sql`select id, merged_into from profiles where id = ${profileId}`,
    )) as unknown as { id: number; merged_into: number | null }[];
    if (!p) throw new PortalRefusal("No such person", 404);
    if (p.merged_into !== null)
      throw new PortalRefusal("This person was merged into another profile", 409);
    await tx
      .update(profileLookups)
      .set({
        state: "failed",
        error: "The run did not finish.",
        finishedAt: sql`now()`,
      })
      .where(
        and(
          eq(profileLookups.profileId, profileId),
          inArray(profileLookups.state, ["queued", "running"]),
          sql`${profileLookups.createdAt} < now() - ${STALE_RUN_MS / 1000} * interval '1 second'`,
        ),
      );
    if (await runInFlight(tx, profileId)) throw new PortalRefusal("Already running", 409);
    const [row] = await tx
      .insert(profileLookups)
      .values({ profileId, state: "queued", by: by.slice(0, 320) })
      .returning({ id: profileLookups.id });
    return { lookupId: (row as { id: number }).id, profileId };
  });
}

/** Mark a queued run failed, when it could not be started (the send itself failed). */
export async function abandonProfileResearch(
  db: Queryable,
  lookupId: number,
  why: string,
): Promise<void> {
  await db
    .update(profileLookups)
    .set({ state: "failed", error: why.slice(0, 10_000), finishedAt: sql`now()` })
    .where(and(eq(profileLookups.id, lookupId), eq(profileLookups.state, "queued")));
}

/** A finding's handle as a ref, from what the lookup stored. */
function handleOf(f: Pick<ProfileFinding, "platform" | "value" | "url">) {
  if (!f.platform) return null;
  const ref = normalizeHandle(f.platform, f.value) ?? normalizeHandle(f.platform, f.url);
  return ref ? { ...ref, url: f.url ?? ref.url } : null;
}

/**
 * Keep a handle: the profile holds `handle:<platform>` and the handle's row has its page. A key
 * another profile holds merges the two (the older wins); the findings move with the merge.
 */
async function holdHandle(
  db: Queryable,
  f: ProfileFinding,
  at: Date,
): Promise<{ added: boolean; profileId: number }> {
  const ref = handleOf(f);
  if (!ref) return { added: false, profileId: f.profileId };
  const [own] = (await db.execute(sql`
    select kind, value from profile_keys where profile_id = ${f.profileId}
    order by first_seen, id limit 1`)) as unknown as { kind: string; value: string }[];
  if (!own) throw new PortalRefusal("This profile holds no address yet", 409);
  const [names] = (await db.execute(
    sql`select name from profiles where id = ${f.profileId}`,
  )) as unknown as { name: string | null }[];
  const [personKey] = (await db.execute(sql`
    select value from profile_keys where profile_id = ${f.profileId} and kind = 'person'
    limit 1`)) as unknown as { value: string }[];
  const got = await resolveProfile(
    db,
    [own, { kind: `handle:${ref.platform}`, value: ref.handle }],
    "research",
    { at },
  );
  if (!got) return { added: false, profileId: f.profileId };
  // The key first: a new handle row joins the profile that holds its key.
  await resolveHandle(db, ref, {
    name: names?.name ?? null,
    personId: personKey ? Number(personKey.value) : null,
  });
  return { added: got.added > 0, profileId: got.id };
}

type FindingDecision = "kept" | "dropped";

/**
 * Keep or drop findings, by id. Ones already in that state are done without a change; a kept
 * handle joins the profile as a key. Returns the ids decided and the keys added.
 */
export async function decideFindings(
  db: Queryable,
  ids: readonly number[],
  decision: FindingDecision,
  by: string,
  at: Date = new Date(),
): Promise<{ done: number[]; keys: number }> {
  return atomic(db, async (tx) => {
    const rows = await tx
      .select()
      .from(profileFindings)
      .where(inArray(profileFindings.id, [...ids]))
      .orderBy(profileFindings.id);
    const done: number[] = [];
    let keys = 0;
    for (const f of rows) {
      if (decision === "kept" && f.kind === "handle") {
        const held = await holdHandle(tx, f, at);
        if (held.added) keys += 1;
      }
      await tx
        .update(profileFindings)
        .set({ state: decision, decidedBy: by.slice(0, 320), decidedAt: at })
        .where(eq(profileFindings.id, f.id));
      done.push(f.id);
    }
    return { done, keys };
  });
}

/** What a step is called on the page. */
const STEP_WORDS: Record<string, string> = {
  email: "Email",
  cache: "Held search",
  google: "Google",
  search: "Search",
  profile: "LinkedIn page",
  "linkedin search": "LinkedIn search",
  elsewhere: "Elsewhere",
  capped: "Stopped",
};
const LINE_MAX = 160;

/** One step tried, in one short line: "Search Jane Doe Acme: 1 people via exa". */
function triedLine(t: { step?: unknown; what?: unknown; outcome?: unknown }): string {
  const step = String(t.step ?? "");
  const what = String(t.what ?? "").trim();
  const line = `${STEP_WORDS[step] ?? step}${what && what !== "-" ? ` ${what}` : ""}: ${String(t.outcome ?? "").trim()}`;
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 1)}…` : line;
}

/** The newest run of a profile, as the person page draws it. */
interface ResearchRun {
  id: number;
  state: ProfileLookupState;
  /** ISO. */
  at: string;
  startedAt: string | null;
  finishedAt: string | null;
  by: string | null;
  /** Each step tried, one line each. */
  steps: string[];
  /** "matched", "unresolved", "capped", or null while it runs. */
  outcome: string | null;
  error: string | null;
  /** When a capped run may try again. */
  retryAt: string | null;
}

/** One thing a run found. */
export interface ResearchFinding {
  id: string;
  kind: string;
  platform: string | null;
  value: string;
  url: string | null;
  source: string;
  /** 0 to 1. */
  confidence: number;
  state: string;
  /** ISO. */
  at: string;
}

/** A profile's Research section: the newest run, and what every run found, newest first. */
export interface ResearchDetail {
  run: ResearchRun | null;
  findings: ResearchFinding[];
}

/** The findings a page lists at most; the Findings tab has them all. */
const FINDINGS_MAX = 60;

const iso = (d: Date | string | null | undefined) =>
  d === null || d === undefined ? null : d instanceof Date ? d.toISOString() : String(d);

export async function researchDetail(db: Queryable, profileId: number): Promise<ResearchDetail> {
  const run = await newestResearch(db, profileId);
  const found = await db
    .select()
    .from(profileFindings)
    .where(eq(profileFindings.profileId, profileId))
    .orderBy(desc(profileFindings.confidence), desc(profileFindings.at), profileFindings.id)
    .limit(FINDINGS_MAX);
  return {
    run: run
      ? {
          id: run.id,
          state: run.state,
          at: iso(run.createdAt) as string,
          startedAt: iso(run.startedAt),
          finishedAt: iso(run.finishedAt),
          by: run.by,
          steps: (Array.isArray(run.tried) ? run.tried : []).map((t) =>
            triedLine((t ?? {}) as Record<string, unknown>),
          ),
          outcome: run.outcome,
          error: run.error,
          retryAt: iso(run.retryAt),
        }
      : null,
    findings: found.map((f) => ({
      id: String(f.id),
      kind: f.kind,
      platform: f.platform,
      value: f.value,
      url: f.url,
      source: f.source,
      confidence: f.confidence,
      state: f.state,
      at: iso(f.at) as string,
    })),
  };
}

/** Every finding as a record row (`people.finding`), with whose it is. A few hundred, not thousands. */
export async function findingRows(db: Queryable): Promise<Record<string, unknown>[]> {
  const rows = (await db.execute(sql`
    select f.id, f.profile_id, coalesce(p.name, '#' || p.id) who,
      '/people/people/' || f.profile_id profile_link, f.kind, f.platform, f.value, f.url,
      f.source, f.confidence, f.state, f.decided_by, f.decided_at, f.at
    from profile_findings f join profiles p on p.id = f.profile_id
    order by f.at desc, f.id desc limit 2000`)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    ...r,
    decided_at: iso(r.decided_at as Date | string | null),
    at: iso(r.at as Date | string | null),
  }));
}

/** The newest run of a profile, for its page and the CLI. */
async function newestResearch(db: Queryable, profileId: number) {
  const [row] = await db
    .select()
    .from(profileLookups)
    .where(eq(profileLookups.profileId, profileId))
    .orderBy(desc(profileLookups.createdAt), desc(profileLookups.id))
    .limit(1);
  return row ?? null;
}

export type { ProfileLookupState };
