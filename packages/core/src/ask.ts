/**
 * Ask: Wren's team asks Claude Code about the system from the console (⌘K or the Ask app). A
 * question is a `runs` row (command "ask": who, the question, the page it came from); `Ask/answer`
 * hands it to the desk's `claude` service (autobrowse `src/claude/service.ts`), Claude Code on
 * William's Mac under his plan, read only, and writes the answer back on the row. `console.ask`
 * lists them. While the Mac is off a question waits in Restate.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { and, eq, sql } from "drizzle-orm";
import { PortalRefusal, type PortalRequest, type SignedViewer } from "./portal.js";
import { actor, date, defineRecord, number, status, text } from "./records.js";
import { finishRun, openRun } from "./runs.js";
import { runs } from "./schema.js";

export const ASK = { name: "Ask" } as const;
const CLAUDE = { name: "claude" } as const;
const COMMAND = "ask";
const MAX = 4000;

/** Read only, plain text, from the repos and prod; the desk enforces the read only part. */
const SYSTEM = `You answer questions from Wren's team about Wren: its code, designs and prod data. You are read only: you can't change, send or spend anything, so never say you did.
Folders: wren (here; the system and prod; read CLAUDE.md, then map/routing.md), ../autobrowse (browser and account automation), ../lander (the website).
Prod Postgres: node scripts/prod-sql.mjs "<one SQL statement>" (read only).
Answer in plain text: lead with the answer, short paragraphs and "- " lists, no headings, tables or bold. Cite files as path:line. Show the $ cost beside any usage figure. Never print secrets, tokens or env values.`;

/** The desk's `claude` handlers as autobrowse serves them; no import from that repo. */
type ClaudeService = {
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
type AskService = { answer: (ctx: restate.Context, req: { id: string }) => Promise<void> };

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
    },
  });
}

export const askRecord = defineRecord({
  id: "console.ask",
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
