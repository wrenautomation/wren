/**
 * AutoReply (designs/2026-10-09-auto-reply.md): a reply drafted the moment someone writes in, so
 * it waits in To approve before anyone opens the thread. Keyed by thread: messages in a burst
 * queue behind the first, which finds the draft already waiting. Auto is held: it drafts like
 * Suggest and says so.
 */
import * as restate from "@restatedev/restate-sdk";
import { findClient } from "@wren/core/clients";
import type { KeyStore } from "@wren/core/keys";
import { meteredModel } from "@wren/core/metered";
import { clientKey, errorText } from "@wren/core/restate";
import type { Fired, FireTriggers } from "@wren/core/spine";
import { gate } from "@wren/core/vendors";
import type { Db } from "@wren/db";
import { type LlmClient, llmForKey } from "@wren/llm";
import {
  AUTO_BY,
  AUTO_HELD,
  AUTO_SETTLE_MS,
  autoModes,
  draftable,
  inboxChannelOf,
  threadOfReply,
} from "../inbox/auto.js";
import { askReply } from "../inbox/send.js";
import { suggestReply } from "../inbox/suggest.js";

export interface AutoReplyDeps {
  db: Db;
  clientDb?: (client: string) => Db;
  llm?: LlmClient | null;
  keys?: KeyStore | null;
  /** Who signs Wren's own: his name. */
  senderName: string;
  facts?: () => Promise<readonly string[]>;
}

interface Arrived {
  client: string | null;
  channel: "email" | "sms" | "dm";
  id: number;
}

const WREN = "wren";
const keyOf = (a: Arrived) =>
  a.client ? clientKey(a.client, `${a.channel}:${a.id}`) : `${WREN}/${a.channel}:${a.id}`;

/** Tell AutoReply about a reply the spine heard; anything else passes by. Send-only. */
export const autoReplyFire: FireTriggers = (ctx, req: Fired) => {
  if (req.facts.trigger !== "trigger.reply") return;
  const d = req.event.data;
  const id = Number(req.facts.channel === "email" ? d.enrollmentId : d.contactId);
  if (!Number.isInteger(id)) return;
  const a: Arrived = { client: req.client, channel: req.facts.channel, id };
  ctx.objectSendClient<AutoReply>({ name: "AutoReply" }, keyOf(a)).arrived(a);
};

export function makeAutoReply(deps: AutoReplyDeps) {
  const dbOf = (client: string | null): Db => {
    if (!client) return deps.db;
    if (!deps.clientDb) throw new restate.TerminalError("no client databases here");
    return deps.clientDb(client);
  };
  return restate.object({
    name: "AutoReply",
    handlers: {
      /** Someone wrote in: by the channel's mode, a draft waits in To approve, or nothing. */
      arrived: restate.handlers.object.exclusive(
        // Only the spine's fire sends it.
        { ingressPrivate: true },
        async (
          ctx: restate.ObjectContext,
          req: Arrived,
        ): Promise<{ asked: number | null; why: string }> => {
          const llm = deps.llm;
          if (!llm) return { asked: null, why: "no model is set" };
          const db = dbOf(req.client);
          const channel = inboxChannelOf(req.channel);
          const mode = await ctx.run("mode", async () => (await autoModes(db))[channel]);
          if (mode === "off") return { asked: null, why: "off" };
          await ctx.sleep(AUTO_SETTLE_MS);
          const thread = await ctx.run("thread", () => threadOfReply(db, req.channel, req.id));
          if (!thread) return { asked: null, why: "no thread to answer" };
          const at = await ctx.run("check", () => draftable(db, thread));
          if ("skip" in at) return { asked: null, why: at.skip };
          const now = new Date(await ctx.date.now());
          const words = await ctx.run("draft", async () => {
            try {
              const client = req.client;
              let sender = deps.senderName;
              let model = llm;
              if (client) {
                const row = await findClient(deps.db, client);
                if (!row) return { text: null, why: `no client ${client}` };
                const g = await gate(deps.db, client, "models", 1, now);
                if (!g.ok) return { text: null, why: `models: ${g.why}` };
                sender = row.name;
                model = meteredModel(llm, {
                  main: deps.db,
                  client,
                  part: "inbox.auto",
                  now: () => now,
                  store: deps.keys ?? null,
                  own: llmForKey,
                });
              }
              const text = await suggestReply(
                db,
                { llm: model, sender, ...(!client && deps.facts ? { facts: deps.facts } : {}) },
                { thread, channel: at.option.channel, target: at.option.target, now },
              );
              return { text, why: text ? null : "the model gave nothing usable" };
            } catch (err) {
              // A failed draft leaves the thread as it was: someone answers by hand.
              return { text: null, why: errorText(err) };
            }
          });
          if (!words.text) return { asked: null, why: words.why ?? "no draft" };
          const text = words.text;
          const asked = await ctx.run("ask", async () => {
            // Checked again in the same step: a reply typed by hand meanwhile wins.
            const still = await draftable(db, thread);
            if ("skip" in still) return null;
            const row = await askReply(db, {
              thread,
              option: still.option,
              body: text,
              who: still.who,
              by: AUTO_BY,
              why: mode === "auto" ? AUTO_HELD : "Drafted when they wrote.",
            });
            return row.id;
          });
          return { asked, why: asked ? mode : "answered meanwhile" };
        },
      ),
    },
  });
}

export type AutoReply = ReturnType<typeof makeAutoReply>;
