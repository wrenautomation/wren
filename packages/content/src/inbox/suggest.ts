/**
 * A suggested reply for the Inbox's box (designs/2026-10-07-inbox-reply.md). A DM goes through
 * the DM drafter as it is (`draftDm`: the person, their touches, the thread, his DM edits). Email,
 * text and comment replies read the dossier, the touches and the conversation, in one call,
 * checked by the same grounding guard. Nothing is sent or kept as a draft here.
 */
import { factsBlock } from "@wren/core/facts";
import { guardDraft } from "@wren/core/grounded";
import { touchesContext, touchesFor } from "@wren/core/touches";
import type { Queryable } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { draftDm } from "@wren/outreach";
import { dossiers, dossierText } from "@wren/research/dossier";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { InboxChannel } from "../schema.js";
import { type Entry, partyOf, timelineOf } from "./conversation.js";
import { reviewHow, reviewOf } from "./review.js";
import { REPLY_MAX } from "./send.js";

const DRAFT = z.object({ draft: z.string() });
/** How many lines of the conversation the model reads: the newest. */
const TAIL = 16;
/** How much of the dossier it reads. */
const DOSSIER_MAX = 2500;

const HOW: Record<Exclude<InboxChannel, "dm">, string> = {
  email: "an email reply: plain text, no subject, under 120 words, no sign-off",
  text: "a text message: under 300 characters, no links unless they asked",
  comment: "a public reply under their comment: one or two sentences, friendly, no pitch",
  chat: "a live chat reply on the website: one to three short sentences, plain, no sign-off",
};

export interface SuggestDeps {
  llm: LlmClient;
  /** Who signs: his name. */
  sender: string;
  /** What is true about him (`wrenFacts`); left out, the draft claims nothing first-person. */
  facts?: () => Promise<readonly string[]>;
}

const line = (e: Entry) =>
  `${e.direction === "in" ? "Them" : e.direction === "out" ? "Me" : "Team note"} (${e.channel}${
    e.platform ? `, ${e.platform}` : ""
  }): ${e.body.replace(/\s+/g, " ").trim()}`;

/** Their company's dossier, short; empty with no company. */
async function dossierOf(db: Queryable, personId: number | null): Promise<string> {
  if (personId === null) return "";
  const [p] = (await db.execute(
    sql`select company_id from people where id = ${personId}`,
  )) as unknown as Array<{ company_id: number | null }>;
  if (!p?.company_id) return "";
  const [d] = await dossiers(db, [p.company_id]);
  return d ? dossierText(d).slice(0, DOSSIER_MAX) : "";
}

/**
 * Suggest words for a reply on `channel` (to `target`, the path's id). Null when the model
 * gives nothing usable. A provider failure throws.
 */
export async function suggestReply(
  db: Queryable,
  deps: SuggestDeps,
  o: { thread: string; channel: InboxChannel; target: string; now: Date },
): Promise<string | null> {
  const facts = deps.facts ? await deps.facts() : [];
  if (o.channel === "dm")
    return draftDm(db, deps.llm, Number(o.target), { sender: deps.sender, facts, now: o.now });
  const p = await partyOf(db, o.thread);
  if (!p) throw new Error("that thread is gone");
  const [entries, touches, dossier, review] = await Promise.all([
    timelineOf(db, p),
    touchesFor(db, { personId: p.personId, leadId: p.leadId }, 20),
    dossierOf(db, p.personId),
    reviewOf(db, p.commentId),
  ]);
  const said = entries.filter((e) => e.channel !== "touch" && e.body.trim()).slice(-TAIL);
  const prompt = [
    `About them:\nName: ${p.who ?? "unknown"}`,
    dossier ? `What we know about their company:\n${dossier}` : "",
    touchesContext(touches, o.now),
    `The conversation, oldest first:\n${said.map(line).join("\n") || "(nothing yet)"}`,
    `Write ${review ? reviewHow(review) : HOW[o.channel]}. Answer their last message. Return JSON {"draft": "..."}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const system = [
    `You are ${deps.sender}, replying to someone who wrote to us. Sound like a person: short, plain, warm, specific to what they said.`,
    "Team notes are private: use them as context, never quote them.",
    factsBlock(facts),
  ].join("\n\n");
  const g = await guardDraft(
    async (fix) => {
      const out = await completeAndParse(deps.llm, fix ? `${prompt}\n\n${fix}` : prompt, DRAFT, {
        maxTokens: 500,
        system,
        name: "inbox.reply_suggest",
      });
      return { text: out.parsed?.draft.trim() ?? "", result: out };
    },
    {
      facts,
      sources: [prompt],
      own: said.filter((e) => e.direction === "out").map((e) => e.body),
    },
  );
  const text = g.text?.trim() ?? "";
  return text && text.length <= REPLY_MAX ? text : null;
}
