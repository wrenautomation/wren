/**
 * `DraftAsk`: Ask Claude on any draft (designs/2026-10-06-content-desk.md, 3). `ask` opens the
 * `draft-ask` row (who, which draft, what he said) and hands it to `answer`, which calls the
 * desk's `claude.ask` (Claude Code on William's Mac, read only, $0) with the draft, its context,
 * the cap and the SOP. Claude answers `{reply, draft}`; Wren writes the draft, never Claude.
 * `undo` puts back what the last change replaced. Nothing sends. While the Mac is off an ask
 * waits in Restate.
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import { byOf, CLAUDE, type ClaudeService, type DraftTurn, draftAnswerOf } from "@wren/core/ask";
import { PortalRefusal, terminalOf } from "@wren/core/portal";
import type { AccountPick } from "@wren/core/record-accounts";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { runs } from "@wren/core/schema";
import { livePrompt } from "@wren/core/templates/defaults";
import type { Db } from "@wren/db";
import { pickAccount } from "@wren/outreach";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  ASK_MESSAGE_MAX,
  askPrompt,
  DRAFT_ASK_REF,
  readDraft,
  undoDraft,
  writeDraft,
} from "../draft-ask.js";

export const DRAFT_ASK = { name: "DraftAsk" } as const;
const COMMAND = "draft-ask";

const ITEM = {
  record: z.string().describe("Its kind, as the Inbox ids say it: draft, comment, thread"),
  id: z.string(),
  viewer: PORTAL_FIELDS.viewer,
};
const ASK_INPUT = z.looseObject({
  ...ITEM,
  message: z.string().describe("What to change, or ask"),
});

const SET_INPUT = z.looseObject({
  ...ITEM,
  text: z.string().optional().describe("The whole draft; empty clears it; absent keeps it"),
  expect: z.string().nullish().describe("The draft his box started from; null = none"),
  account: z
    .string()
    .max(120)
    .nullish()
    .describe("The login it goes out as (`reddit@alt`); empty = its default; absent keeps it"),
});

type Item = { record: string; id: string; viewer?: unknown };
type Asked = { record: string; id: string; by: string; message: string };
type DraftAskService = { answer: (ctx: restate.Context, req: { id: string }) => Promise<void> };

const whoOf = byOf;
/** A refusal is the person's to fix: it fails the call instead of retrying. */
const refuse = (err: unknown, code = 409) =>
  err instanceof PortalRefusal
    ? // A save over words that moved carries code conflict: the page shows Keep mine / Use theirs.
      terminalOf(err)
    : new restate.TerminalError((err as Error).message, { errorCode: code });

export function makeDraftAsk(db: Db) {
  return restate.service({
    name: DRAFT_ASK.name,
    handlers: {
      /** Open the ask's row and hand it to `answer`; the item's detail polls its thread. */
      ask: serviceHandler(
        { input: ASK_INPUT },
        async (ctx: restate.Context, req: Item & { message: string }) => {
          const message = typeof req.message === "string" ? req.message.trim() : "";
          if (!message) throw new restate.TerminalError("say what to change", { errorCode: 400 });
          if (message.length > ASK_MESSAGE_MAX)
            throw new restate.TerminalError(`keep it under ${ASK_MESSAGE_MAX} characters`, {
              errorCode: 400,
            });
          const item = `${req.record}:${req.id}`;
          const id = await ctx.run("open run", async () => {
            const d = await readDraft(db, item).catch((err) => {
              throw refuse(err, 404);
            });
            if (!d.open)
              throw refuse(
                new Error("This draft is sent or closed already, so Claude can't change it."),
              );
            const argv: Asked = { record: req.record, id: req.id, by: whoOf(req), message };
            return (await openRun(db, { command: COMMAND, argv, model: "claude-code:sonnet" })).id;
          });
          ctx.serviceSendClient<DraftAskService>(DRAFT_ASK).answer({ id });
          return { id };
        },
      ),

      /**
       * His words over the draft, typed in place (content desk, 6): a `draft-set` turn that keeps
       * the before, so his edits teach later drafts. `expect` is the text his box started from;
       * a change made meanwhile (Claude's) is never written over.
       */
      set: serviceHandler(
        { input: SET_INPUT },
        async (
          ctx: restate.Context,
          req: Item & { text?: string; expect?: string | null; account?: string | null },
        ): Promise<{
          run?: string;
          turn?: DraftTurn | null;
          version?: string | null;
          accounts?: AccountPick | null;
        }> => {
          const item = `${req.record}:${req.id}`;
          // The account it goes out as: kept with the draft, the send reads it.
          const accounts =
            req.account === undefined
              ? undefined
              : await ctx.run("account", () =>
                  pickAccount(db, { item, account: req.account ?? null, by: whoOf(req) }).catch(
                    (err) => {
                      throw refuse(err, 400);
                    },
                  ),
                );
          if (req.text === undefined) {
            if (accounts === undefined)
              throw new restate.TerminalError("say the text or the account", { errorCode: 400 });
            return { accounts };
          }
          const text = req.text.trim();
          const saved = await ctx.run("set", () =>
            writeDraft(db, item, text || null, {
              command: "draft-set",
              by: whoOf(req),
              ...(req.expect !== undefined ? { expect: req.expect } : {}),
            })
              .then(({ run, turn, version }) => ({ run, turn, version }))
              .catch((err) => {
                // Over the cap, or gone: words to fix, never a conflict.
                throw refuse(err, 400);
              }),
          );
          return accounts === undefined ? saved : { ...saved, accounts };
        },
      ),

      /** Put back the draft from before the last change. */
      undo: serviceHandler(
        { input: z.looseObject(ITEM) },
        async (ctx: restate.Context, req: Item) =>
          ctx.run("undo", () =>
            undoDraft(db, `${req.record}:${req.id}`, whoOf(req)).catch((err) => {
              throw refuse(err);
            }),
          ),
      ),

      // Only `ask` sends it.
      answer: restate.handlers.handler(
        { ingressPrivate: true },
        async (ctx: restate.Context, req: { id: string }) => {
          const asked = await ctx.run("read", async () => {
            const [row] = await db
              .select({ argv: runs.argv, finishedAt: runs.finishedAt })
              .from(runs)
              .where(and(eq(runs.id, req.id), eq(runs.command, COMMAND)));
            if (!row || row.finishedAt) return null;
            const a = row.argv as Asked;
            const item = `${a.record}:${a.id}`;
            const d = await readDraft(db, item).catch(() => null);
            const live = await livePrompt(db, DRAFT_ASK_REF);
            const prompt = d ? askPrompt(d, a, live) : { error: "the draft is gone" };
            return {
              item,
              by: a.by,
              message: a.message,
              before: d?.draft ?? null,
              prompt,
              version: live.version,
            };
          });
          if (!asked) return;
          const fail = (error: string) =>
            ctx.run("save", () => finishRun(db, req.id, { error: error.slice(0, 500) }));
          if ("error" in asked.prompt) return void (await fail(asked.prompt.error));
          const given = asked.prompt;
          let out: Awaited<ReturnType<ClaudeService["ask"]>>;
          try {
            out = await ctx.serviceClient<ClaudeService>(CLAUDE).ask({
              ...asked.prompt,
              dir: "wren",
              also: [],
              commands: [],
            });
          } catch (err) {
            if (!(err instanceof restate.TerminalError)) throw err;
            return void (await fail(err.message));
          }
          const { reply, draft } = draftAnswerOf(out.answer);
          const meta = { reply, ms: out.ms, model: out.model, prompt: asked.version };
          await ctx.run("save", async () => {
            if (draft === null || draft === asked.before)
              return finishRun(db, req.id, { ...meta, draft: null });
            await writeDraft(db, asked.item, draft, {
              command: COMMAND,
              by: asked.by,
              expect: asked.before,
              run: req.id,
              stats: meta,
              ask: asked.message,
              llm: {
                stage: COMMAND,
                model: out.model,
                system: given.system,
                prompt: given.question,
                version: asked.version,
              },
            }).catch((err: Error) =>
              finishRun(db, req.id, { ...meta, error: `Not written: ${err.message}` }),
            );
          });
        },
      ),
    },
  });
}
