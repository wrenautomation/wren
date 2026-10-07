/**
 * Scoring: each read item judged 0-10 against how Wren works today (its pushed SOPs). The score
 * sets the verdict: 7 and up shows, 4 to 6 holds, the rest drops. It reads the transcript when
 * there is one, so a reel is judged on what was said and shown, not its caption.
 */
import type { Step } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { items, sources, type Verdict } from "./schema.js";

/** Text the model sees per item. */
const PROMPT_TEXT = 6_000;
/** Reads of the model's answer before the item waits unscored. */
const MAX_TRIES = 3;

/** One SOP as the scorer sees it: its name, what it's for, its section headings. */
export interface Practice {
  name: string;
  about: string;
  headings: string[];
}

/** An SOP's text read down to a practice: its first paragraph and its `##` headings. */
export function practiceOf(name: string, sop: string): Practice {
  const lines = sop.split("\n").map((l) => l.trim());
  const about = lines.find((l) => l && !l.startsWith("#") && !l.startsWith("---")) ?? "";
  const headings = lines.filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^#+\s*/, ""));
  return { name, about: about.slice(0, 300), headings: headings.slice(0, 12) };
}

export const scoreSchema = z.object({
  score: z.number().int().min(0).max(10),
  summary: z.string().min(1),
  changes: z.array(z.string()).default([]),
  why: z.string().min(1),
});

/** 7 and up shows, 4 to 6 holds, the rest drops. */
export const verdictOf = (score: number): Verdict =>
  score >= 7 ? "show" : score >= 4 ? "hold" : "drop";

const SYSTEM = `You read the news for Wren, a small AI automation agency. Wren finds leads, writes cold email and DMs, builds landing pages, posts content and runs it all on browser automation and AI models. You judge one item at a time against how Wren works today. Most items change nothing; say so. Answer with JSON only.`;

export interface ScoredItem {
  title: string;
  url: string;
  text: string;
  publishedAt: Date | null;
  /** Its source's name, or "saved" for one William shared in. */
  from: string;
}

export function scorePrompt(item: ScoredItem, practices: readonly Practice[]): string {
  const sops = practices
    .map(
      (p) =>
        `- ${p.name}: ${p.about}${p.headings.length ? ` Covers: ${p.headings.join("; ")}.` : ""}`,
    )
    .join("\n");
  return `How Wren works today, one SOP a line:
${sops || "- (no SOPs pushed yet)"}

Score how much this item should change what Wren does, 0 to 10:
0-3: nothing Wren can use, or news with no action in it.
4-6: worth knowing; no SOP changes.
7-8: a concrete better way to do a step an SOP covers, or a tool that replaces one.
9-10: urgent: a platform rule, ban, price or deliverability change that breaks what Wren runs now.

Answer {"score": n, "summary": "two plain sentences on what the item says", "changes": ["the SOP names it would change, from the list above"], "why": "one sentence: what Wren would do differently, or why nothing"}.

Item from ${item.from}${item.publishedAt ? `, ${item.publishedAt.toISOString().slice(0, 10)}` : ""}:
Title: ${item.title}
URL: ${item.url}
${item.text.slice(0, PROMPT_TEXT)}`;
}

/**
 * Score one read item. Null when there's no such row, it isn't read yet, or the model's answer
 * didn't read three times (it waits, unscored). A provider failure throws, so the step retries.
 */
export async function scoreItem(
  db: Db,
  llm: LlmClient | null,
  practices: readonly Practice[],
  id: number,
): Promise<Verdict | null> {
  const [row] = await db
    .select({ item: items, from: sources.name })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(eq(items.id, id));
  if (!row) return null;
  const { item } = row;
  if (item.verdict) return item.verdict;
  if (!item.readAt || item.tries >= MAX_TRIES) return null;
  if (!llm) {
    await db
      .update(items)
      .set({ verdict: "show", why: "No model is set, so it shows.", scoredAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.verdict)));
    return "show";
  }
  const scored: ScoredItem = {
    title: item.title,
    url: item.url,
    text: item.transcript ?? item.text,
    publishedAt: item.publishedAt,
    from: row.from ?? "saved by William",
  };
  const out = await completeAndParse(llm, scorePrompt(scored, practices), scoreSchema, {
    maxTokens: 600,
    system: SYSTEM,
    name: "learn.score",
  });
  const v = out.parsed;
  if (!v) {
    await db
      .update(items)
      .set({ tries: item.tries + 1 })
      .where(eq(items.id, id));
    return null;
  }
  const names = new Set(practices.map((p) => p.name));
  const verdict = verdictOf(v.score);
  await db
    .update(items)
    .set({
      score: v.score,
      verdict,
      summary: v.summary,
      changes: v.changes.filter((c) => names.has(c)),
      why: v.why,
      tries: item.tries + 1,
      scoredAt: new Date(),
    })
    .where(and(eq(items.id, id), isNull(items.verdict)));
  return verdict;
}

/** The item id an event carries; throws on one that carries none. */
export function itemIdOf(e: { subject: string; data: Record<string, unknown> }): number {
  const id = Number(e.data.itemId);
  if (!Number.isInteger(id)) throw new Error(`${e.subject} is no Learn item`);
  return id;
}

/** `learn.score` on the spine: the item leaves by its verdict's port. Wren's own, in main. */
export const scoreStep =
  (db: Db, llm: LlmClient | null, practices: () => Promise<Practice[]>): Step =>
  async (_port, e) => {
    const verdict = await scoreItem(db, llm, await practices(), itemIdOf(e));
    return verdict ? [{ port: verdict, event: e }] : [];
  };
