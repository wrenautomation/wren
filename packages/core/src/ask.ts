/**
 * Ask: Wren's team asks Claude Code about the system from the console (⌘K or the Ask app). A
 * question is a `runs` row (command "ask": who, the question, the page it came from); `Ask/answer`
 * hands it to the desk's `claude` service (autobrowse `src/claude/service.ts`), Claude Code on
 * William's Mac under his plan, read only, and writes the answer back on the row. `console.ask`
 * lists them. While the Mac is off a question waits in Restate.
 *
 * Ask Claude on a draft (designs/2026-10-06-content-desk.md, 3) is the same row and the same
 * desk call, per draft: `draftTurns` reads one draft's turns; `@wren/content`'s `DraftAsk`
 * writes them.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Db, Queryable } from "@wren/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ASK_COMMAND, askAnswerOf } from "./edits.js";
import { PortalRefusal, type PortalRequest, type SignedViewer } from "./portal.js";
import { actor, date, defineRecord, number, status, text } from "./records.js";
import { finishRun, openRun } from "./runs.js";
import { runs } from "./schema.js";

export const ASK = { name: "Ask" } as const;
export const CLAUDE = { name: "claude" } as const;
const COMMAND = "ask";
const MAX = 4000;

/** Read only, plain text, from the repos and prod; the desk enforces the read only part. */
const SYSTEM = `You answer questions from Wren's team about Wren: its code, designs and prod data. You are read only: you can't change, send or spend anything, so never say you did.
Folders: wren (here; the system and prod; read CLAUDE.md, then map/routing.md), ../autobrowse (browser and account automation), ../lander (the website).
Prod Postgres: node scripts/prod-sql.mjs "<one SQL statement>" (read only).
Answer in plain text: lead with the answer, short paragraphs and "- " lists, no headings, tables or bold. Cite files as path:line. Show the $ cost beside any usage figure. Never print secrets, tokens or env values.`;

/** The desk's `claude` handlers as autobrowse serves them; no import from that repo. */
export type ClaudeService = {
  ask: (
    ctx: restate.Context,
    req: {
      question: string;
      system: string;
      dir: string;
      also: string[];
      commands: string[];
    },
  ) => Promise<{ answer: string; ms: number; turns: number; model: string; denied: number }>;
};
export type AskService = {
  answer: (ctx: restate.Context, req: { id: string }) => Promise<void>;
  edit: (ctx: restate.Context, req: { id: string }) => Promise<void>;
};

export interface QuestionRequest extends PortalRequest {
  question?: unknown;
  /** The console page it was asked from: "/inbox/waiting?view=all". */
  page?: unknown;
}

/** Who asks what from where, checked; refused with a 400 otherwise. */
export function questionOf(req: QuestionRequest) {
  const question = typeof req.question === "string" ? req.question.trim() : "";
  if (!question) throw new PortalRefusal("ask something", 400);
  if (question.length > MAX) throw new PortalRefusal(`keep it under ${MAX} characters`, 400);
  const page =
    typeof req.page === "string" && req.page.startsWith("/") ? req.page.slice(0, 500) : null;
  return { by: (req.viewer as SignedViewer).email, question, page };
}

/** Open the question's row and hand it to `Ask/answer`; the console polls `console.ask`. */
export async function ask(ctx: restate.Context, main: Db, req: QuestionRequest) {
  const q = questionOf(req);
  const id = await ctx.run("open run", () =>
    openRun(main, { command: COMMAND, argv: q, model: "claude-code:sonnet" }).then((r) => r.id),
  );
  ctx.serviceSendClient<AskService>(ASK).answer({ id });
  return { id };
}

export function makeAsk(main: Db) {
  return restate.service({
    name: ASK.name,
    handlers: {
      // Only `ConsolePortal/question` sends it.
      answer: restate.handlers.handler(
        { ingressPrivate: true },
        async (ctx: restate.Context, req: { id: string }) => {
          const q = await ctx.run("read", async () => {
            const [row] = await main
              .select({ argv: runs.argv, finishedAt: runs.finishedAt })
              .from(runs)
              .where(and(eq(runs.id, req.id), eq(runs.command, COMMAND)));
            return row && !row.finishedAt ? (row.argv as ReturnType<typeof questionOf>) : null;
          });
          if (!q) return;
          try {
            const out = await ctx.serviceClient<ClaudeService>(CLAUDE).ask({
              question: `${q.by} asks, from the console page ${q.page ?? "home"}:\n\n${q.question}`,
              system: SYSTEM,
              dir: "wren",
              also: ["autobrowse", "lander"],
              commands: ["Bash(node scripts/prod-sql.mjs *)"],
            });
            await ctx.run("save", () => finishRun(main, req.id, out));
          } catch (err) {
            if (!(err instanceof restate.TerminalError)) throw err;
            await ctx.run("save", () =>
              finishRun(main, req.id, { error: err.message.slice(0, 500) }),
            );
          }
        },
      ),
      /**
       * Ask Claude on a record (`./edits.ts`): the row holds the prompt `ConsolePortal/recordsAsk`
       * built; the answer keeps Claude's reply and patch. Nothing is written until Accept.
       */
      edit: restate.handlers.handler(
        { ingressPrivate: true },
        async (ctx: restate.Context, req: { id: string }) => {
          const q = await ctx.run("read", async () => {
            const [row] = await main
              .select({ argv: runs.argv, finishedAt: runs.finishedAt })
              .from(runs)
              .where(and(eq(runs.id, req.id), eq(runs.command, ASK_COMMAND)));
            return row && !row.finishedAt
              ? (row.argv as { question: string; system: string })
              : null;
          });
          if (!q) return;
          try {
            const out = await ctx.serviceClient<ClaudeService>(CLAUDE).ask({
              question: q.question,
              system: q.system,
              dir: "wren",
              also: [],
              commands: [],
            });
            const { reply, patch } = askAnswerOf(out.answer);
            await ctx.run("save", () =>
              finishRun(main, req.id, { reply, patch, ms: out.ms, model: out.model }),
            );
          } catch (err) {
            if (!(err instanceof restate.TerminalError)) throw err;
            await ctx.run("save", () =>
              finishRun(main, req.id, { error: err.message.slice(0, 500) }),
            );
          }
        },
      ),
    },
  });
}

export const askRecord = defineRecord({
  id: "console.ask",
  app: "ask",
  channel: null,
  name: { one: "question", many: "questions" },
  rows: async (db) =>
    (await db.execute(sql`
      SELECT id::text, argv->>'by' AS by, argv->>'question' AS question, argv->>'page' AS page,
        started_at AS asked,
        CASE WHEN finished_at IS NULL THEN 'thinking' WHEN stats ? 'error' THEN 'failed'
          ELSE 'answered' END AS state,
        coalesce(stats->>'answer', stats->>'error') AS answer,
        round((stats->>'ms')::numeric / 1000) AS took
      FROM runs WHERE command = ${COMMAND} ORDER BY started_at DESC LIMIT 200`)) as never,
  key: "id",
  title: "question",
  subtitle: "answer",
  fields: {
    by: actor("Asked by"),
    question: text(),
    page: text("Asked from"),
    asked: date("Asked"),
    state: status({
      thinking: { label: "Thinking", tone: "warn" },
      answered: { label: "Answered", tone: "good" },
      failed: { label: "Failed", tone: "bad" },
    }),
    answer: text(),
    took: number("Seconds"),
  },
  views: [{ id: "all", label: "All", sort: "-asked", at: "asked" }],
});

/** A draft's turns: Claude asked (`draft-ask`), a terminal set it, an undo put one back. */
export type DraftCommand = "draft-ask" | "draft-set" | "draft-undo";

/** One turn on a draft, oldest first. `draft` is what it wrote (null: nothing), `before` what that replaced. */
export interface DraftTurn {
  id: string;
  command: DraftCommand;
  by: string | null;
  message: string | null;
  at: string;
  state: "thinking" | "done" | "failed";
  reply: string | null;
  draft: string | null;
  before: string | null;
  error: string | null;
}

/**
 * Every turn on one draft (`record` is its kind, as the Inbox ids say it: "comment"), oldest first.
 * ponytail: runs has no index past its key; a scan by command, as `console.ask` reads it.
 */
export const draftTurns = async (db: Queryable, record: string, id: string) =>
  (await db.execute(sql`
    SELECT id::text, command, argv->>'by' AS by, argv->>'message' AS message, started_at AS at,
      CASE WHEN finished_at IS NULL THEN 'thinking' WHEN stats ? 'error' THEN 'failed'
        ELSE 'done' END AS state,
      stats->>'reply' AS reply, stats->>'draft' AS draft,
      stats->>'before' AS before, stats->>'error' AS error
    FROM runs WHERE command IN ('draft-ask', 'draft-set', 'draft-undo')
      AND argv->>'record' = ${record} AND argv->>'id' = ${id}
    ORDER BY started_at, id`)) as unknown as DraftTurn[];

/** One human change to a draft: what it said, what he made it (designs/2026-10-06-content-desk.md, 6). */
export interface DraftEdit {
  record: string;
  id: string;
  by: string | null;
  at: string;
  before: string;
  after: string;
}

/**
 * His newest changes to drafts of these kinds (`record` as the Inbox ids say it), newest first:
 * every `draft-set` that replaced one text with another. Claude's own writes and undos aren't his.
 */
export const draftEdits = async (
  db: Queryable,
  o: { records?: readonly string[]; limit?: number } = {},
) =>
  (await db.execute(sql`
    SELECT argv->>'record' AS record, argv->>'id' AS id, argv->>'by' AS by, started_at AS at,
      stats->>'before' AS before, stats->>'draft' AS after
    FROM runs WHERE command = 'draft-set' AND finished_at IS NOT NULL
      AND stats->>'before' IS NOT NULL AND stats->>'draft' IS NOT NULL
      AND stats->>'before' <> stats->>'draft'
      ${
        o.records?.length
          ? sql`AND argv->>'record' IN (${sql.join(
              o.records.map((r) => sql`${r}`),
              sql`, `,
            )})`
          : sql``
      }
    ORDER BY started_at DESC, id DESC LIMIT ${Math.min(Math.max(o.limit ?? 5, 1), 200)}`)) as unknown as DraftEdit[];

/** One side of an edit in a prompt: a few hundred characters is enough to show the move. */
const EDIT_CHARS = 400;
const cut = (s: string) => (s.length > EDIT_CHARS ? `${s.slice(0, EDIT_CHARS)}…` : s);

/** The edits as a prompt block, oldest first; "" with none. */
export function editsBlock(edits: readonly DraftEdit[]): string {
  if (!edits.length) return "";
  const pairs = [...edits]
    .reverse()
    .map(
      (e, i) =>
        `${i + 1}. Draft:\n"""\n${cut(e.before)}\n"""\nHe made it:\n"""\n${cut(e.after)}\n"""`,
    );
  return `How he edited earlier drafts (write the way he edits):\n${pairs.join("\n")}`;
}

/** His last 5 edits of these kinds as a prompt block; "" with none. */
export const editsFor = async (db: Queryable, records: readonly string[]) =>
  editsBlock(await draftEdits(db, { records, limit: 5 }));

/** Who a console call came from: the signed-in person's email, else "console". */
export const byOf = (req: unknown) =>
  (req as { viewer?: { email?: string } } | null)?.viewer?.email ?? "console";

/**
 * Sent words that differ from the draft held are his edit: kept as a `draft-set` turn on the item,
 * so later drafts learn from it. Nothing when there was no draft or he sent it as it was.
 */
export async function keepSentEdit(
  db: Queryable,
  o: { record: string; id: string; by: string; before: string | null; after: string },
) {
  if (!o.before?.trim() || o.before.trim() === o.after.trim()) return;
  const run = await openRun(db, {
    command: "draft-set",
    argv: { record: o.record, id: o.id, by: o.by, sent: true },
  });
  await finishRun(db, run.id, { draft: o.after.trim(), before: o.before });
}

const DRAFT_ANSWER = z.object({ reply: z.string(), draft: z.string().nullable() });

/**
 * Claude's answer as `{reply, draft}`: the first JSON object in it, fenced or not. An answer that
 * isn't one is all reply and writes nothing.
 */
export function draftAnswerOf(text: string): z.infer<typeof DRAFT_ANSWER> {
  const from = text.indexOf("{");
  const to = text.lastIndexOf("}");
  try {
    const got = DRAFT_ANSWER.safeParse(JSON.parse(text.slice(from, to + 1)));
    if (from >= 0 && got.success)
      return { reply: got.data.reply.trim(), draft: got.data.draft?.trim() || null };
  } catch {
    // Not JSON: said in words.
  }
  return { reply: text.trim(), draft: null };
}
