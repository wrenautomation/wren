/**
 * Surveys in the database (designs/2026-10-06-flags-experiments-surveys-heatmaps.md §4): the
 * `marketing.survey` record with its words edited in place, Go live, Pause and Remove, the live
 * site ones for the edge push, and the portal side (what a client login is due, its answer).
 * A site survey going live is on the public site, so Go live and every edit need `manage`.
 */
import type { Queryable } from "@wren/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { clientMembers } from "./clients/schema.js";
import { type EdgePush, pushEdge } from "./flag-store.js";
import { PortalRefusal } from "./portal.js";
import {
  date,
  defineRecord,
  number,
  prose,
  type RecordType,
  type State,
  status,
  text,
  type Values,
} from "./records.js";
import { type Survey, surveyAnswers, surveyDays, surveys } from "./schema.js";
import {
  answerOf,
  formatAudience,
  formatTrigger,
  parseAudience,
  parseChoices,
  parseTrigger,
  SURVEY_KINDS,
  SURVEY_SURFACES,
  type SurveyDef,
  type SurveyKind,
} from "./surveys.js";

export const SURVEY = "marketing.survey";
const KEY = /^[a-z][a-z0-9_.-]{0,59}$/;
const DAY_MS = 86_400_000;

const SurveyIn = z.object({
  key: z.string().trim().regex(KEY, "a key: lower case, a letter first, no spaces"),
  question: z.string().trim().min(1, "say the question").max(300),
  kind: z.enum(SURVEY_KINDS).default("choice"),
  choices: z.string().max(1000).default(""),
  surface: z.enum(SURVEY_SURFACES).default("site"),
});
export type SurveyInput = z.input<typeof SurveyIn>;

/** A new survey, in draft: nothing shows until Go live. */
export async function addSurvey(
  db: Queryable,
  input: SurveyInput,
  by: string,
): Promise<{ key: string }> {
  const got = SurveyIn.safeParse(input);
  if (!got.success) throw new PortalRefusal(got.error.issues[0]?.message ?? "check it", 400);
  const c = parseChoices(got.data.choices, got.data.kind);
  if ("error" in c) throw new PortalRefusal(c.error, 400);
  const [row] = await db
    .insert(surveys)
    .values({
      key: got.data.key,
      question: got.data.question,
      kind: got.data.kind,
      choices: c.choices,
      surface: got.data.surface,
      createdBy: by,
    })
    .onConflictDoNothing()
    .returning({ key: surveys.key });
  if (!row) throw new PortalRefusal(`there's already a survey ${got.data.key}`, 409);
  return row;
}

const pushIfSite = async (db: Queryable, rows: { surface: string }[], push?: EdgePush) => {
  if (rows.some((r) => r.surface === "site")) await pushEdge(db, push);
};

/** Draft or paused → live. On the site that's William's yes. */
export async function startSurveys(
  db: Queryable,
  keys: readonly string[],
  by: string,
  push?: EdgePush,
): Promise<string[]> {
  const now = new Date();
  const done = await db
    .update(surveys)
    .set({ state: "live", startedAt: now, startedBy: by, updatedAt: now })
    .where(and(inArray(surveys.key, [...keys]), inArray(surveys.state, ["draft", "paused"])))
    .returning({ key: surveys.key, surface: surveys.surface });
  await pushIfSite(db, done, push);
  return done.map((d) => d.key);
}

/** Live → paused: it stops showing; its answers stay. */
export async function pauseSurveys(
  db: Queryable,
  keys: readonly string[],
  push?: EdgePush,
): Promise<string[]> {
  const done = await db
    .update(surveys)
    .set({ state: "paused", updatedAt: new Date() })
    .where(and(inArray(surveys.key, [...keys]), eq(surveys.state, "live")))
    .returning({ key: surveys.key, surface: surveys.surface });
  await pushIfSite(db, done, push);
  return done.map((d) => d.key);
}

/** Removes surveys that aren't live, with their tallies and answers. */
export async function removeSurveys(db: Queryable, keys: readonly string[]): Promise<string[]> {
  const gone = await db
    .delete(surveys)
    .where(and(inArray(surveys.key, [...keys]), inArray(surveys.state, ["draft", "paused"])))
    .returning({ key: surveys.key });
  return gone.map((g) => g.key);
}

const defOf = (s: Survey): SurveyDef => ({
  key: s.key,
  question: s.question,
  kind: s.kind,
  choices: s.choices,
  trigger: s.trigger,
  audience: s.audience,
});

/** The portal surveys a client login is due on one client: live, for it, not yet answered. */
export async function surveysDue(
  db: Queryable,
  client: string,
  person: string,
  now = new Date(),
): Promise<SurveyDef[]> {
  const email = person.toLowerCase();
  const [member] = await db
    .select({ at: clientMembers.invitedAt })
    .from(clientMembers)
    .where(and(eq(clientMembers.clientId, client), eq(clientMembers.email, email)))
    .limit(1);
  if (!member) return [];
  const live = await db
    .select()
    .from(surveys)
    .where(and(eq(surveys.state, "live"), eq(surveys.surface, "portal")))
    .orderBy(asc(surveys.key));
  if (!live.length) return [];
  const answered = new Set(
    (
      await db
        .select({ survey: surveyAnswers.survey })
        .from(surveyAnswers)
        .where(and(eq(surveyAnswers.client, client), eq(surveyAnswers.person, email)))
    ).map((a) => a.survey),
  );
  return live
    .filter(
      (s) =>
        !answered.has(s.key) &&
        (!s.audience.clients?.length || s.audience.clients.includes(client)) &&
        now.getTime() - member.at.getTime() >= (s.trigger.after ?? 0) * DAY_MS,
    )
    .map(defOf);
}

/** A client login's answer; a second one for the same survey changes nothing. */
export async function answerSurvey(
  db: Queryable,
  a: { survey: string; client: string; person: string; value: unknown },
): Promise<{ saved: boolean }> {
  const due = await surveysDue(db, a.client, a.person);
  const s = due.find((d) => d.key === a.survey);
  if (!s) return { saved: false };
  const value = answerOf(s.kind, s.choices, a.value);
  if (value === null) throw new PortalRefusal("that answer doesn't fit the question", 400);
  const saved = await db
    .insert(surveyAnswers)
    .values({ survey: s.key, client: a.client, person: a.person.toLowerCase(), value })
    .onConflictDoNothing()
    .returning({ id: surveyAnswers.id });
  return { saved: saved.length > 0 };
}

/** Upserts site day rows (the whole history is re-read each pass). Returns rows written. */
export async function writeSurveyDays(
  db: Queryable,
  rows: readonly Omit<typeof surveyDays.$inferInsert, "syncedAt">[],
): Promise<number> {
  // A day row for a survey removed here would break the foreign key: those are left out.
  const known = new Set((await db.select({ key: surveys.key }).from(surveys)).map((s) => s.key));
  const kept = rows.filter((r) => known.has(r.survey));
  for (let i = 0; i < kept.length; i += 1000)
    await db
      .insert(surveyDays)
      .values(kept.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: [surveyDays.survey, surveyDays.day, surveyDays.value, surveyDays.channel],
        set: { answers: sql.raw("excluded.answers"), syncedAt: sql`now()` },
      });
  return kept.length;
}

const KIND: Record<SurveyKind, State> = {
  choice: { label: "Choice", tone: "neutral" },
  scale: { label: "Scale 1-10", tone: "neutral" },
  text: { label: "Short text", tone: "neutral" },
};
const SURFACE: Record<Survey["surface"], State> = {
  site: { label: "Site", tone: "neutral" },
  portal: { label: "Portal", tone: "neutral" },
};
const STATE: Record<Survey["state"], State> = {
  draft: { label: "Draft", tone: "neutral" },
  live: { label: "Live", tone: "good" },
  paused: { label: "Paused", tone: "warn" },
};

/** Each value's count, most first: `yes 12 · no 4`. */
const tally = (counts: ReadonlyMap<string, number>) =>
  [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([v, n]) => `${v} ${n}`)
    .join(" · ");

/** A survey's answers, all time and by week (Mondays), newest week first. */
async function talliesOf(db: Queryable, s: Survey): Promise<{ total: number; prose: string }> {
  const rows =
    s.surface === "site"
      ? await db
          .select({
            week: sql<string>`to_char(date_trunc('week', ${surveyDays.day}), 'YYYY-MM-DD')`,
            value: surveyDays.value,
            n: sql<number>`sum(${surveyDays.answers})::int`,
          })
          .from(surveyDays)
          .where(eq(surveyDays.survey, s.key))
          .groupBy(sql`1`, surveyDays.value)
      : await db
          .select({
            week: sql<string>`to_char(date_trunc('week', ${surveyAnswers.at}), 'YYYY-MM-DD')`,
            value: surveyAnswers.value,
            n: sql<number>`count(*)::int`,
          })
          .from(surveyAnswers)
          .where(eq(surveyAnswers.survey, s.key))
          .groupBy(sql`1`, surveyAnswers.value);
  // Short text answers differ every time: the portal's count as one value, like the site's.
  const shown = (v: string) => (s.kind === "text" ? "text" : v);
  const all = new Map<string, number>();
  const weeks = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const v = shown(r.value);
    all.set(v, (all.get(v) ?? 0) + r.n);
    const w = weeks.get(r.week) ?? new Map<string, number>();
    w.set(v, (w.get(v) ?? 0) + r.n);
    weeks.set(r.week, w);
  }
  const total = [...all.values()].reduce((t, n) => t + n, 0);
  if (!total) return { total, prose: "" };
  const lines = [...weeks]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 12)
    .map(([w, m]) => `Week of ${w}: ${tally(m)}`);
  return { total, prose: [`All: ${tally(all)}`, ...lines].join("\n") };
}

/** The newest portal answers, words and all; the site's are read live (`marketing.survey_answer`). */
async function newestOf(db: Queryable, s: Survey): Promise<string> {
  if (s.surface !== "portal") return "";
  const rows = await db
    .select()
    .from(surveyAnswers)
    .where(eq(surveyAnswers.survey, s.key))
    .orderBy(desc(surveyAnswers.at))
    .limit(10);
  return rows
    .map((a) => `${a.at.toISOString().slice(0, 10)} ${a.client} ${a.person}: ${a.value}`)
    .join("\n");
}

const SurveyPatch = z
  .object({
    question: z.string().max(300),
    choices: z.string().max(1000),
    when: z.string().max(200),
    who: z.string().max(1000),
  })
  .partial()
  .strict();

const one = async (db: Queryable, key: string) =>
  (await db.select().from(surveys).where(eq(surveys.key, key)).limit(1))[0] ?? null;

/** What a patch would set, or what's wrong with it. */
function setOf(
  s: Survey,
  patch: Values,
): { set: Partial<typeof surveys.$inferInsert> } | { error: string } {
  const set: Partial<typeof surveys.$inferInsert> = {};
  if (typeof patch.question === "string") {
    const q = patch.question.trim();
    if (!q) return { error: "say the question" };
    set.question = q;
  }
  if (typeof patch.choices === "string") {
    const c = parseChoices(patch.choices, s.kind);
    if ("error" in c) return c;
    // Answers already counted under the old choices would read wrong.
    if (s.state !== "draft" && c.choices.join("\n") !== s.choices.join("\n"))
      return { error: "choices change only in draft: add a new survey" };
    set.choices = c.choices;
  }
  if (typeof patch.when === "string") {
    const t = parseTrigger(patch.when, s.surface);
    if ("error" in t) return t;
    set.trigger = t.trigger;
  }
  if (typeof patch.who === "string") {
    const a = parseAudience(patch.who, s.surface);
    if ("error" in a) return a;
    set.audience = a.audience;
  }
  return { set };
}

/** Surveys as records: when and who in words, edited in place; tallies by week. */
export function surveyRecord(push?: EdgePush): RecordType {
  return defineRecord({
    id: SURVEY,
    app: "marketing",
    channel: null,
    name: { one: "survey", many: "surveys" },
    rows: async (db) => {
      const all = await db.select().from(surveys).orderBy(asc(surveys.key));
      return Promise.all(
        all.map(async (s) => {
          const t = await talliesOf(db, s);
          return {
            id: s.key,
            key: s.key,
            question: s.question,
            kind: s.kind,
            surface: s.surface,
            state: s.state,
            choices: s.choices.join("\n"),
            when: formatTrigger(s.trigger, s.surface),
            who: formatAudience(s.audience) || "everyone",
            answers: t.total,
            tallies: t.prose,
            newest: await newestOf(db, s),
            started_at: s.startedAt?.toISOString() ?? null,
            updated_at: s.updatedAt.toISOString(),
          };
        }),
      );
    },
    key: "id",
    title: "question",
    subtitle: "key",
    fields: {
      key: text("Key"),
      question: text("Question"),
      kind: status(KIND, "Kind"),
      surface: status(SURFACE, "Shows on"),
      state: status(STATE, "State"),
      choices: prose("Choices"),
      when: text("When"),
      who: prose("Who"),
      answers: number("Answers"),
      tallies: prose("Tallies"),
      newest: prose("Newest answers"),
      startedAt: date("Live since"),
      updatedAt: date("Changed"),
    },
    views: [
      { id: "all", label: "All", sort: "key", at: "updatedAt" },
      { id: "live", label: "Live", where: { state: "live" }, sort: "key" },
    ],
    actions: [
      "marketing.surveyAdd",
      "marketing.surveyStart",
      "marketing.surveyPause",
      "marketing.surveyRemove",
    ],
    edits: {
      fields: ["question", "choices", "when", "who"],
      patch: SurveyPatch as unknown as z.ZodType<Values>,
      about:
        "a survey: one question. When: `view [on /path] [after 20s]`, `exit`, `form`, `book` or " +
        "`booked` on the site; `view [after 30d]` in the portal. Who, one per line: " +
        "`channels email, search` and `flag <key> <variant>` on the site, `clients <ids>` in the " +
        "portal; empty is everyone. Choices one per line, 2 to 8, only for a choice question",
      read: async (db, id) => {
        const s = await one(db, id);
        if (!s) return null;
        return {
          question: s.question,
          choices: s.choices.join("\n"),
          when: formatTrigger(s.trigger, s.surface),
          who: formatAudience(s.audience),
        };
      },
      check: async (patch, _now, db, id) => {
        const s = await one(db, id);
        if (!s) return "no such survey";
        const got = setOf(s, patch);
        return "error" in got ? got.error : null;
      },
      write: async (db, id, patch) => {
        const s = await one(db, id);
        if (!s) throw new PortalRefusal("no such survey", 404);
        const got = setOf(s, patch);
        if ("error" in got) throw new PortalRefusal(got.error, 400);
        await db
          .update(surveys)
          .set({ ...got.set, updatedAt: new Date() })
          .where(eq(surveys.key, s.key));
        if (s.surface === "site" && s.state === "live") await pushEdge(db, push);
      },
      needs: "manage",
    },
  });
}

/** Each survey's kind, for the site rollup (a text answer counts as `text`). */
export const surveyKinds = async (db: Queryable): Promise<Map<string, SurveyKind>> =>
  new Map(
    (await db.select({ key: surveys.key, kind: surveys.kind }).from(surveys)).map((s) => [
      s.key,
      s.kind,
    ]),
  );
