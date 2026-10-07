/**
 * InboxDesk (designs/2026-10-07-inbox-reply.md): reply from the Inbox on the thread's own
 * channel, ask for a yes when the gate says so, keep notes, assign, close and snooze. A send goes
 * through each channel's own desk, so its checks (opt-outs, caps, the text window, the live gates)
 * still run.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Who } from "@wren/core/access";
import { type Client, findClient } from "@wren/core/clients";
import { isDemo, type Viewer, whoIs } from "@wren/core/portal";
import { clientKey, errorText, PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { addInboxNote, teamEmails } from "@wren/notes/inbox";
import { z } from "zod";
import { partyOf } from "../inbox/conversation.js";
import {
  askReply,
  failReply,
  pickOption,
  type ReplySender,
  replyGate,
  replyWords,
  sendOn,
  settleReply,
  waitingReply,
} from "../inbox/send.js";
import { suggestReply } from "../inbox/suggest.js";
import { setThread } from "../inbox/threads.js";
import { INBOX_CHANNELS, INBOX_STATUSES, type InboxChannel, type InboxStatus } from "../schema.js";

/** Where Disposition keeps Wren's replies (`DISPOSITION_KEY` in channel-email). */
const FLEET = "fleet";

export interface InboxDeskDeps {
  /** Wren's database: the team, the clients, Wren's own threads. */
  db: Db;
  /** A client's own database, for a client's threads. */
  clientDb?: (client: string) => Db;
  /** The model Suggest drafts with; absent, Suggest refuses. */
  llm?: LlmClient | null;
  /** Who signs a suggestion: his name. */
  senderName: string;
  /** What is true about him, for a suggestion's claims (`wrenFacts`). */
  facts?: () => Promise<readonly string[]>;
  /** Each channel's send path; absent, the channels' own desks over Restate. Tests pass a fake. */
  channels?: (ctx: restate.Context, client: string | null, viewer: Viewer) => ReplySender;
}

type Fn<I, O> = (ctx: unknown, req: I) => Promise<O>;
type ReachDesk = {
  reply: Fn<{ contactId: number; body: string; viewer: Viewer }, unknown>;
  answerComment: Fn<{ id: number; body: string; viewer: Viewer }, unknown>;
};
type SmsDesk = { reply: Fn<{ contactId: number; body: string; client?: string }, unknown> };
type Outcome = { ok: boolean; reason?: string | null };
type Disposition = {
  approve: Fn<{ id: number; body: string }, Outcome>;
  reply: Fn<{ threadEventId: number; body: string }, Outcome>;
};

/** The channels' own desks, called as this viewer. DMs and comments are Wren's only. */
function restateChannels(ctx: restate.Context, client: string | null, viewer: Viewer): ReplySender {
  const wrenOnly = () => {
    if (client) throw new restate.TerminalError("DMs and comments answer from Wren's Inbox only");
  };
  const reach = () => ctx.serviceClient<ReachDesk>({ name: "ReachDesk" });
  const disposition = () =>
    ctx.objectClient<Disposition>(
      { name: "Disposition" },
      client ? clientKey(client, FLEET) : FLEET,
    );
  const ok = (o: Outcome) => {
    if (!o.ok) throw new restate.TerminalError(o.reason ?? "not sent");
  };
  return {
    dm: async (contactId, body) => {
      wrenOnly();
      await reach().reply({ contactId, body, viewer });
    },
    comment: async (id, body) => {
      wrenOnly();
      await reach().answerComment({ id, body, viewer });
    },
    text: async (contactId, body) => {
      await ctx
        .serviceClient<SmsDesk>({ name: "SmsDesk" })
        .reply({ contactId, body, ...(client ? { client } : {}) });
    },
    invite: async (id, body) => ok(await disposition().approve({ id, body })),
    email: async (threadEventId, body) => ok(await disposition().reply({ threadEventId, body })),
  };
}

const THREAD = z.string().min(3).max(80).describe("The Inbox thread's id: dm:5, text:8, reply:6");
const BASE = z.looseObject({ thread: THREAD, ...PORTAL_FIELDS });
const REPLY = BASE.extend({
  channel: z.enum(INBOX_CHANNELS).describe("Where it goes: email, text, dm or comment"),
  target: z.string().min(1).max(80).describe("The channel's id from the thread's options"),
  body: z.string().describe("The words"),
});
const PICK = BASE.extend({ channel: z.enum(INBOX_CHANNELS), target: z.string().min(1).max(80) });
const ASKED = z.looseObject({ id: z.number().describe("The asked reply's id"), ...PORTAL_FIELDS });

interface Req {
  viewer?: Viewer;
  client?: string;
}

export function makeInboxDesk(deps: InboxDeskDeps) {
  const dbOf = (client: string | null): Db => {
    if (!client) return deps.db;
    if (!deps.clientDb) throw new restate.TerminalError("no client databases here");
    return deps.clientDb(client);
  };
  /** Whoever asks, signed in; the console fills `viewer`. */
  const by = (req: Req): string => {
    const v = req.viewer;
    if (!v || isDemo(v) || !v.email) throw new restate.TerminalError("sign in to do that");
    return v.email.toLowerCase();
  };
  const clientOf = (req: Req): string | null => req.client || null;
  /** Its refusals as terminal: a retry won't change them. */
  const terminal = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof restate.TerminalError) throw err;
      throw new restate.TerminalError(errorText(err));
    }
  };
  const nowOf = async (ctx: restate.Context) => new Date(await ctx.date.now());
  const channels = (ctx: restate.Context, client: string | null, viewer: Viewer) =>
    (deps.channels ?? restateChannels)(ctx, client, viewer);
  /** Who they are, and the client's sends and approver: what the gate reads. */
  const gateOf = (req: Req, channel: InboxChannel) =>
    terminal(async () => {
      const client = clientOf(req);
      const who: Who = await whoIs(deps.db, req.viewer as Viewer, client ?? undefined);
      const row: Client | null = client ? await findClient(deps.db, client) : null;
      if (client && !row) throw new Error(`no client ${client}`);
      return replyGate({ channel, client: row, who });
    });

  return restate.service({
    name: "InboxDesk",
    handlers: {
      /**
       * Send a reply on the channel picked, through its own desk; when the gate says ask, it waits
       * in To approve instead. The thread then waits on them.
       */
      reply: serviceHandler(
        { input: REPLY, effect: "sends" },
        async (
          ctx: restate.Context,
          req: Req & { thread: string; channel: InboxChannel; target: string; body: string },
        ): Promise<{ sent: boolean; asked: number | null; why: string | null }> => {
          const me = by(req);
          const client = clientOf(req);
          const db = dbOf(client);
          const body = await terminal(async () => replyWords(req.body));
          const option = await ctx.run("pick", () =>
            terminal(() => pickOption(db, req.thread, req.channel, req.target)),
          );
          const gate = await ctx.run("gate", () => gateOf(req, req.channel));
          if (gate.mode === "ask") {
            const asked = await ctx.run("ask", async () => {
              const p = await partyOf(db, req.thread);
              const row = await askReply(db, {
                thread: req.thread,
                option,
                body,
                who: p?.who ?? null,
                by: me,
                why: gate.why,
              });
              return row.id;
            });
            return { sent: false, asked, why: gate.why };
          }
          await sendOn(channels(ctx, client, req.viewer as Viewer), option, body);
          const now = await nowOf(ctx);
          await ctx.run("waiting", () => setThread(db, req.thread, { status: "waiting" }, me, now));
          return { sent: true, asked: null, why: null };
        },
      ),
      /** Ask for a yes: the reply waits in To approve. Nothing sends. */
      ask: serviceHandler(
        { input: REPLY },
        async (
          ctx: restate.Context,
          req: Req & { thread: string; channel: InboxChannel; target: string; body: string },
        ): Promise<{ asked: number }> => {
          const me = by(req);
          const db = dbOf(clientOf(req));
          const body = await terminal(async () => replyWords(req.body));
          const asked = await ctx.run("ask", () =>
            terminal(async () => {
              const option = await pickOption(db, req.thread, req.channel, req.target);
              const p = await partyOf(db, req.thread);
              const row = await askReply(db, {
                thread: req.thread,
                option,
                body,
                who: p?.who ?? null,
                by: me,
                why: null,
              });
              return row.id;
            }),
          );
          return { asked };
        },
      ),
      /** A yes on an asked reply: sent on its channel now. A second yes finds it sent and stops. */
      approve: serviceHandler(
        { input: ASKED, effect: "sends" },
        async (ctx: restate.Context, req: Req & { id: number }): Promise<{ sent: true }> => {
          const me = by(req);
          const client = clientOf(req);
          const db = dbOf(client);
          const row = await ctx.run("read", () => terminal(() => waitingReply(db, req.id)));
          const gate = await ctx.run("gate", () => gateOf(req, row.channel));
          if (gate.mode === "ask") throw new restate.TerminalError(gate.why ?? "you can't send");
          const option = await ctx.run("pick", () =>
            terminal(() => pickOption(db, row.thread, row.channel, row.target)),
          );
          const claimed = await ctx.run("claim", () => settleReply(db, req.id, "sent", me));
          if (!claimed) throw new restate.TerminalError("that reply was settled already");
          try {
            await sendOn(channels(ctx, client, req.viewer as Viewer), option, row.body);
          } catch (err) {
            await ctx.run("failed", () => failReply(db, req.id, errorText(err)));
            throw err;
          }
          const now = await nowOf(ctx);
          await ctx.run("waiting", () => setThread(db, row.thread, { status: "waiting" }, me, now));
          return { sent: true };
        },
      ),
      /** No to an asked reply: nothing sends. */
      drop: serviceHandler(
        { input: ASKED },
        async (ctx: restate.Context, req: Req & { id: number }): Promise<{ dropped: boolean }> => {
          const me = by(req);
          const db = dbOf(clientOf(req));
          return { dropped: await ctx.run("drop", () => settleReply(db, req.id, "dropped", me)) };
        },
      ),
      /** Words to start from: the DM drafter for a DM, else the dossier, touches and thread. */
      suggest: serviceHandler(
        { input: PICK },
        async (
          ctx: restate.Context,
          req: Req & { thread: string; channel: InboxChannel; target: string },
        ): Promise<{ text: string | null }> => {
          by(req);
          const llm = deps.llm;
          if (!llm) throw new restate.TerminalError("no model is set for suggestions");
          const db = dbOf(clientOf(req));
          const now = await nowOf(ctx);
          const text = await ctx.run("suggest", () =>
            terminal(async () => {
              await pickOption(db, req.thread, req.channel, req.target);
              return suggestReply(
                db,
                {
                  llm,
                  sender: deps.senderName,
                  ...(deps.facts ? { facts: deps.facts } : {}),
                },
                { thread: req.thread, channel: req.channel, target: req.target, now },
              );
            }),
          );
          return { text };
        },
      ),
      /** A note on the thread and its person, never sent; a teammate `@`ed gets a mention. */
      note: serviceHandler(
        { input: BASE.extend({ body: z.string().describe("The note") }) },
        async (
          ctx: restate.Context,
          req: Req & { thread: string; body: string },
        ): Promise<{ id: string; mentioned: string[] }> => {
          const me = by(req);
          const db = dbOf(clientOf(req));
          const now = await nowOf(ctx);
          return ctx.run("note", () =>
            terminal(async () => {
              const p = await partyOf(db, req.thread);
              if (!p) throw new Error("that thread is gone");
              const { note, mentioned } = await addInboxNote(db, {
                thread: req.thread,
                personId: p.personId,
                body: req.body,
                by: me,
                team: await teamEmails(deps.db),
                now,
              });
              return { id: note.id, mentioned };
            }),
          );
        },
      ),
      /** Give the thread to a teammate, or to nobody. */
      assign: serviceHandler(
        {
          input: BASE.extend({
            assignee: z.string().nullish().describe("A teammate's email; empty is nobody"),
          }),
        },
        async (
          ctx: restate.Context,
          req: Req & { thread: string; assignee?: string | null },
        ): Promise<{ assignee: string | null }> => {
          const me = by(req);
          const db = dbOf(clientOf(req));
          const who = req.assignee?.trim().toLowerCase() || null;
          const now = await nowOf(ctx);
          await ctx.run("assign", () =>
            terminal(async () => {
              if (who && !(await teamEmails(deps.db)).includes(who))
                throw new Error(`${who} is not on the team`);
              await setThread(db, req.thread, { assignee: who }, me, now);
            }),
          );
          return { assignee: who };
        },
      ),
      /** Take the thread: it's the caller's. */
      take: serviceHandler(
        { input: BASE },
        async (
          ctx: restate.Context,
          req: Req & { thread: string },
        ): Promise<{ assignee: string }> => {
          const me = by(req);
          const db = dbOf(clientOf(req));
          const now = await nowOf(ctx);
          await ctx.run("take", () => setThread(db, req.thread, { assignee: me }, me, now));
          return { assignee: me };
        },
      ),
      /** Open, waiting on them, or closed. Closing touches nothing on the channel. */
      status: serviceHandler(
        { input: BASE.extend({ status: z.enum(INBOX_STATUSES) }) },
        async (
          ctx: restate.Context,
          req: Req & { thread: string; status: InboxStatus },
        ): Promise<{ status: InboxStatus }> => {
          const me = by(req);
          const db = dbOf(clientOf(req));
          const now = await nowOf(ctx);
          // Open or closed by hand also ends a snooze.
          await ctx.run("status", () =>
            setThread(db, req.thread, { status: req.status, snoozeUntil: null }, me, now),
          );
          return { status: req.status };
        },
      ),
      /** Out of the way until then, or until they write; no time wakes it now. */
      snooze: serviceHandler(
        {
          input: BASE.extend({
            until: z.string().nullish().describe("When it comes back, ISO; empty wakes it"),
          }),
        },
        async (
          ctx: restate.Context,
          req: Req & { thread: string; until?: string | null },
        ): Promise<{ until: string | null }> => {
          const me = by(req);
          const db = dbOf(clientOf(req));
          const now = await nowOf(ctx);
          const until = req.until ? new Date(req.until) : null;
          if (until && (Number.isNaN(until.getTime()) || until <= now))
            throw new restate.TerminalError("pick a time ahead");
          await ctx.run("snooze", () => setThread(db, req.thread, { snoozeUntil: until }, me, now));
          return { until: until?.toISOString() ?? null };
        },
      ),
    },
  });
}

export type InboxDesk = ReturnType<typeof makeInboxDesk>;
