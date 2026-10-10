/**
 * Scoring: each read item judged 0-10 against how its workspace works today. Wren's own items
 * against Wren's pushed SOPs, by Wren's model. A client's against its own SOPs alone, signed with
 * its name, on its own `models` allowance (gated and metered): nothing of Wren's is in its prompt.
 * The score sets the verdict: 7 and up shows, 4 to 6 holds, the rest drops. It reads the
 * transcript when there is one, so a reel is judged on what was said and shown, not its caption.
 */
import { WREN } from "@wren/core/access";
import { findClient } from "@wren/core/clients";
import type { KeyStore } from "@wren/core/keys";
import { isVendorStop, meteredModel } from "@wren/core/metered";
import type { Step } from "@wren/core/spine";
import { gate } from "@wren/core/vendors";
import type { Db, Queryable } from "@wren/db";
import { completeAndParse, type LlmClient, llmForKey } from "@wren/llm";
import { and, asc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { secondsOf } from "./feeds.js";
import { items, type Moment, sopSources, sources, type Verdict } from "./schema.js";

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
  /** Moments worth jumping to, when the text carries [m:ss] marks. */
  moments: z
    .array(z.object({ at: z.string(), label: z.string().min(1) }))
    .max(8)
    .default([]),
});

/** Text with [m:ss] or [h:mm:ss] marks: a transcript the scorer can point into. */
export const timed = (text: string): boolean => /\[\d{1,2}:\d{2}(:\d{2})?\]/.test(text);

/** The scorer's moments as seconds, in order, dropping any it can't place. */
export function momentsOf(raw: readonly { at: string; label: string }[]): Moment[] {
  return raw
    .map((m) => ({ t: secondsOf(m.at) ?? (m.at.trim() === "0:00" ? 0 : null), label: m.label }))
    .filter((m): m is Moment => m.t !== null)
    .sort((a, b) => a.t - b.t);
}

/** A transcript's chapter headings (`## [m:ss] Name`) as moments: the fallback when none were scored. */
export function chaptersOf(transcript: string | null): Moment[] {
  if (!transcript) return [];
  const out: Moment[] = [];
  for (const m of transcript.matchAll(/^##\s+\[(\d{1,2}(?::\d{2}){1,2})\]\s+(.+)$/gm)) {
    const t = m[1] === "0:00" ? 0 : secondsOf(m[1] ?? "");
    if (t !== null) out.push({ t, label: (m[2] ?? "").trim() });
  }
  return out;
}

/** 7 and up shows, 4 to 6 holds, the rest drops. */
export const verdictOf = (score: number): Verdict =>
  score >= 7 ? "show" : score >= 4 ? "hold" : "drop";

const SYSTEM = `You read the news for Wren, a small AI automation agency. You judge one item at a time by how much Wren can use it. Use the whole scale. Answer with JSON only.`;

/**
 * What Wren builds and runs: the scorer's yardstick beside its SOPs. SOPs alone left nearly every
 * item "worth knowing, no SOP changes" (all 4s, 2026-10-09): few areas have an SOP yet.
 */
export const WREN_FOCUS: readonly string[] = [
  "a done-for-you stack for local service businesses (roofers, home services): CRM, client portal, texts, reviews, booking, AI agents and dashboards",
  "finding leads; cold email, DMs and texts",
  "organic content and audience growth: YouTube, Instagram reels, TikTok, X, LinkedIn",
  "paid ads (Meta)",
  "landing pages and search",
  "video editing with AI",
  "browser automation and AI agents, and what the models cost",
];

/** What a client's items are scored against: the SOP names its own items fed. */
export async function clientPractices(db: Queryable, client: string): Promise<Practice[]> {
  const rows = await db
    .selectDistinct({ sop: sopSources.sop })
    .from(sopSources)
    .innerJoin(items, eq(items.id, sopSources.itemId))
    .where(and(eq(items.client, client), ne(sopSources.state, "failed")))
    .orderBy(asc(sopSources.sop));
  return rows.map((r) => practiceOf(r.sop, ""));
}

/** A client's: its name only, nothing of Wren's. */
const clientSystem = (name: string) =>
  `You read the news for ${name}. You judge one item at a time by how much ${name} can use it. Use the whole scale. Answer with JSON only.`;

/**
 * Who an item is scored for: Wren's own, or a client by its name, with that workspace's model and
 * SOPs. `wait` says why it can't be scored now (the client's models gate): it waits, unscored.
 */
export interface Judge {
  name: string;
  wren: boolean;
  llm: LlmClient | null;
  practices: readonly Practice[];
  /** What it builds and runs, one area a line ([] for a client: its SOPs alone). */
  focus?: readonly string[];
  wait?: string | null;
}
export type JudgeFor = (client: string) => Promise<Judge>;

/**
 * The judge for each workspace: Wren's model and pushed SOPs for Wren; for a client, its name,
 * its own SOPs, and the same model gated and metered on its `models` allowance.
 */
export function judges(o: {
  db: Db;
  llm: LlmClient | null;
  wrenPractices: () => Promise<Practice[]>;
  now?: () => Date;
  /** Clients' own keys: a client on its own model key scores on it. */
  keys?: KeyStore | null;
}): JudgeFor {
  const now = o.now ?? (() => new Date());
  return async (client) => {
    if (client === WREN)
      return {
        name: "Wren",
        wren: true,
        llm: o.llm,
        practices: await o.wrenPractices(),
        focus: WREN_FOCUS,
      };
    const row = await findClient(o.db, client);
    const name = row?.name ?? client;
    const practices = await clientPractices(o.db, client);
    const base = { name, wren: false, practices };
    if (!row) return { ...base, llm: null, wait: "no such client" };
    if (!o.llm) return { ...base, llm: null };
    const g = await gate(o.db, client, "models", 1, now());
    if (!g.ok) return { ...base, llm: null, wait: `models: ${g.why}` };
    return {
      ...base,
      llm: meteredModel(o.llm, {
        main: o.db,
        client,
        part: "learn.score",
        now,
        store: o.keys ?? null,
        own: llmForKey,
      }),
    };
  };
}

export interface ScoredItem {
  title: string;
  url: string;
  text: string;
  publishedAt: Date | null;
  /** Its source's name, or "saved" for one shared in by hand. */
  from: string;
  /** The text carries [m:ss] marks, so it asks for moments. */
  timed?: boolean;
}

/** The prompt, for `name` (Wren, or a client): what it runs, its SOPs one a line, then the item. */
export function scorePrompt(
  item: ScoredItem,
  practices: readonly Practice[],
  name = "Wren",
  focus: readonly string[] = [],
): string {
  const sops = practices
    .map(
      (p) =>
        `- ${p.name}${p.about ? `: ${p.about}` : ""}${p.headings.length ? ` Covers: ${p.headings.join("; ")}.` : ""}`,
    )
    .join("\n");
  const runs = focus.length
    ? `What ${name} builds and runs:\n${focus.map((f) => `- ${f}`).join("\n")}\n\n`
    : "";
  return `${runs}${name}'s SOPs, one a line:
${sops || "- (no SOPs yet)"}

Score how useful this item is to ${name}, 0 to 10. Use the whole scale:
0-2: nothing ${name} can use: off topic, pep talk, or news with no action in it.
3-4: on topic but generic: advice ${name} already follows, or too thin to act on.
5-6: a specific idea, tool or example in what ${name} runs, worth a look later.
7-8: worth acting on now: a tool, model, feature, tactic or offer ${name} should try, build or copy, or a better way to do a step an SOP covers.
9-10: urgent: a platform rule, ban, price or deliverability change that breaks what ${name} runs now, or a large saving on something it pays for.

Answer {"score": n, "summary": "two plain sentences on what the item says", "changes": ["the SOP names it would change, from the list above"], "why": "one sentence: what ${name} would do differently, or why nothing"${item.timed ? ', "moments": [{"at": "m:ss from the [m:ss] marks", "label": "what happens there, under 8 words"}] (up to 6, only the ones worth jumping to)' : ""}}.

Item from ${item.from}${item.publishedAt ? `, ${item.publishedAt.toISOString().slice(0, 10)}` : ""}:
Title: ${item.title}
URL: ${item.url}
${item.text.slice(0, PROMPT_TEXT)}`;
}

/**
 * Score one read item through its workspace's judge. Null when there's no such row, it isn't read
 * yet, the client's models gate is shut, or the model's answer didn't read three times (it waits,
 * unscored; each asked at once). A provider failure throws, so the step retries.
 */
export async function scoreItem(db: Db, judgeFor: JudgeFor, id: number): Promise<Verdict | null> {
  const [row] = await db
    .select({ item: items, from: sources.name })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(eq(items.id, id));
  if (!row) return null;
  const { item } = row;
  if (item.verdict) return item.verdict;
  if (!item.readAt || item.tries >= MAX_TRIES) return null;
  const judge = await judgeFor(item.client);
  const { llm, practices } = judge;
  const waits = (why: string) =>
    db
      .update(items)
      .set({ why: `Waits for ${why}` })
      .where(and(eq(items.id, id), isNull(items.verdict)));
  if (judge.wait) {
    await waits(judge.wait);
    return null;
  }
  if (!llm) {
    await db
      .update(items)
      .set({ verdict: "show", why: "No model is set, so it shows.", scoredAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.verdict)));
    return "show";
  }
  const text = item.transcript ?? item.text;
  const scored: ScoredItem = {
    title: item.title,
    url: item.url,
    text,
    publishedAt: item.publishedAt,
    from: row.from ?? (judge.wren ? "saved by William" : "saved"),
    timed: timed(text),
  };
  // An answer that doesn't read is asked again now: nothing comes back for a read item later.
  let tries = item.tries;
  let v: z.infer<typeof scoreSchema> | null = null;
  while (!v && tries < MAX_TRIES) {
    const out = await completeAndParse(
      llm,
      scorePrompt(scored, practices, judge.name, judge.focus),
      scoreSchema,
      {
        maxTokens: 900,
        system: judge.wren ? SYSTEM : clientSystem(judge.name),
        name: "learn.score",
      },
    ).catch(async (err: unknown) => {
      // The client's allowance ran out between the gate and the call: it waits, as a shut gate.
      if (!isVendorStop(err)) throw err;
      await waits(`models: ${err.why}`);
      return null;
    });
    if (!out) return null;
    tries++;
    v = out.parsed ?? null;
  }
  if (!v) {
    await db.update(items).set({ tries }).where(eq(items.id, id));
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
      moments: scored.timed ? momentsOf(v.moments) : [],
      tries,
      scoredAt: new Date(),
    })
    .where(and(eq(items.id, id), isNull(items.verdict)));
  return verdict;
}

/**
 * Take a workspace's read items' scores back, so the next `scoreItem` judges them afresh (a new
 * rubric). An item already told stays told. Returns the ids cleared.
 */
export async function unscore(db: Db, client: string, ids: readonly number[]): Promise<number[]> {
  if (!ids.length) return [];
  const rows = await db
    .update(items)
    .set({
      score: null,
      verdict: null,
      summary: null,
      changes: [],
      why: null,
      moments: [],
      tries: 0,
      scoredAt: null,
    })
    .where(and(eq(items.client, client), inArray(items.id, [...ids]), isNotNull(items.readAt)))
    .returning({ id: items.id });
  return rows.map((r) => r.id).sort((a, b) => a - b);
}

/** The item id an event carries; throws on one that carries none. */
export function itemIdOf(e: { subject: string; data: Record<string, unknown> }): number {
  const id = Number(e.data.itemId);
  if (!Number.isInteger(id)) throw new Error(`${e.subject} is no Learn item`);
  return id;
}

/**
 * `learn.score` on the spine: the item leaves by its verdict's port. Every workspace's items live
 * in main; each is judged by its own. `after` runs on a scored item (a client's asked SOP notes).
 */
export const scoreStep =
  (db: Db, judgeFor: JudgeFor, after?: (itemId: number) => Promise<unknown>): Step =>
  async (_port, e) => {
    const id = itemIdOf(e);
    const verdict = await scoreItem(db, judgeFor, id);
    if (verdict && after) await after(id);
    return verdict ? [{ port: verdict, event: e }] : [];
  };
