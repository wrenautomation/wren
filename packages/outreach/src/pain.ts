/**
 * Pain points line (designs/2026-10-25-ingestion-engine.md, phase 3). The posts the reach reads
 * keep (`reach_posts`, fit at or over the platform's `minFit`) are read once more by the model:
 * does the author state a pain of their own business? A pain is kept only with a quote that is in
 * the post (the proof rule): a `fact` finding on the post's document (key `doc:<id>/pain/<hash>`,
 * question `pain`, proof the quote), a line on the author's timeline, and a `trigger.source` fire
 * for the author's profile at the line's list (`import:<batch>`): the shape's `sourced` source
 * opens the person's journey on the outreach shape, and the reach engine's comment draft on the
 * post waits in To approve as before.
 *
 * The list is one `imports` row (`pain`, `reach_posts`), made once by `painBatch`; its members are
 * the journeys opened at it, not `people` rows (a post's author has no firm we know, and a people
 * row needs one). A cursor (the last `reach_posts.id` read) keeps it one read per post.
 *
 * Pure of Restate: the worker's `PainFeed` loop keeps the cursor and sends the fires.
 */

import { createHash } from "node:crypto";
import type { Fired } from "@wren/core/executor";
import { profileOf } from "@wren/core/profiles";
import { profileEvents } from "@wren/core/profiles-schema";
import { imports } from "@wren/core/schema";
import { normalizeHandle, resolveHandle } from "@wren/core/touches";
import type { Queryable } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { findings, keepDocument } from "@wren/research";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { passedOn } from "./passes.js";
import { allCommentsSettings } from "./reach-posts/settings.js";
import { type ReachPost, type ReachPostPlatform, reachPosts } from "./schema.js";

/** The list's `imports` row. */
const PAIN_SOURCE_TYPE = "pain";
const PAIN_SOURCE_REF = "reach_posts";
/** Posts per model call. */
export const PER_CALL = 10;
/** A post older than this is left: its author's pain has moved on. */
export const MAX_AGE_DAYS = 14;
/** A quote shorter than this proves nothing; longer than this is the post. */
const QUOTE_MIN = 12;
const QUOTE_MAX = 400;
const DAY = 86_400_000;

export interface PainPass {
  fires: Fired[];
  /** The last `reach_posts.id` read; unchanged while the line's source is not live. */
  cursor: number;
  /** Rows read past the cursor. */
  scanned: number;
  /** Posts the model read (fit, not passed on, with a handle). */
  read: number;
  /** Pains kept, each a finding and a fire. */
  pains: number;
  /** Pains the model gave with a quote not in the post: dropped. */
  unproven: number;
  /** The shape has no live sourced source for the line's list: nothing read. */
  waiting: boolean;
  more: boolean;
}

/** The line's list, made once: `import:<id>`. */
export async function painBatch(db: Queryable): Promise<string> {
  const [had] = await db
    .select({ id: imports.id })
    .from(imports)
    .where(and(eq(imports.sourceType, PAIN_SOURCE_TYPE), eq(imports.sourceRef, PAIN_SOURCE_REF)))
    .orderBy(imports.id)
    .limit(1);
  if (had) return `import:${had.id}`;
  const [made] = await db
    .insert(imports)
    .values({ sourceType: PAIN_SOURCE_TYPE, sourceRef: PAIN_SOURCE_REF, stats: {} })
    .returning({ id: imports.id });
  if (!made) throw new Error("pain batch not made");
  return `import:${made.id}`;
}

const PAINS = z.object({
  pains: z.array(
    z.object({
      post: z.number().int(),
      pain: z.string(),
      quote: z.string(),
    }),
  ),
});
export type Pain = z.infer<typeof PAINS>["pains"][number];

const SYSTEM = `You read social posts by people who run recruiting, staffing and agency businesses.
For each post, decide whether the author states a pain of their own business: something that
costs them time, money, clients, candidates or sleep, said about themselves or their firm.
A tip for others, a job ad, a celebration, a question with no problem of their own, or a vendor's
pitch is not a pain. Leave those posts out.
For a pain: say it in one short plain sentence in the author's words where you can, and copy one
quote of 12 to 300 characters exactly as it appears in the post. Never paraphrase the quote.
Answer with JSON only: {"pains": [{"post": <number>, "pain": "...", "quote": "..."}]}.
No pains: {"pains": []}.`;

/** The prompt for one batch: each post numbered by its id. */
export const painPrompt = (posts: readonly ReachPost[]): string =>
  posts
    .map(
      (p) =>
        `Post ${p.id} by ${p.author}${p.headline ? ` (${p.headline})` : ""} on ${p.platform}:\n${p.text.slice(0, 3000)}`,
    )
    .join("\n\n---\n\n");

const plain = (s: string) =>
  s.replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();

/** The proof rule: the quote is in the post, whitespace and quote marks aside. */
export function proven(text: string, quote: string): boolean {
  const q = plain(quote);
  if (q.length < QUOTE_MIN || q.length > QUOTE_MAX) return false;
  return plain(text).includes(q);
}

/** A pain finding's key on its document: one per quote. */
export const painKey = (document: number, quote: string): string =>
  `doc:${document}/pain/${createHash("sha256").update(plain(quote)).digest("hex").slice(0, 12)}`;

/** The pains the model finds in a batch of posts, keyed back to the posts (unknown ids left). */
export async function readPains(llm: LlmClient, posts: readonly ReachPost[]): Promise<Pain[]> {
  if (!posts.length) return [];
  const out = await completeAndParse(llm, painPrompt(posts), PAINS, {
    maxTokens: 1500,
    system: SYSTEM,
    name: "pain.read",
  });
  if (!out.parsed)
    throw new Error(
      `pain read did not parse: ${out.parseError ?? out.providerRejected ?? "no answer"}`,
    );
  const ids = new Set(posts.map((p) => p.id));
  return out.parsed.pains.filter((x) => ids.has(x.post));
}

/** The fire for one pain: the author's profile enters the shape at the line's list. */
export const painFired = (
  source: string,
  p: { id: number; profile: number; pain: string },
  now: Date,
): Fired => ({
  client: null,
  facts: { trigger: "trigger.source", source },
  event: {
    subject: `source:${source}:rp${p.id}`,
    kind: "lead",
    data: {
      profile: p.profile,
      row: `rp:${p.id}`,
      source,
      post: p.id,
      pain: p.pain,
      cause: { kind: "sourced", ref: source, at: now.toISOString() },
    },
  },
});

/** The author's profile, from the handle (made when new), or null without a handle. */
async function authorProfile(db: Queryable, p: ReachPost): Promise<number | null> {
  const ref = normalizeHandle(p.platform, p.handle);
  if (!ref) return null;
  await resolveHandle(db, { ...ref, url: ref.url ?? p.authorUrl ?? null }, { name: p.author });
  return profileOf(db, { kind: `handle:${p.platform}`, value: ref.handle });
}

/** One pain kept: the document, the finding, the timeline line. */
async function keepPain(
  db: Queryable,
  p: ReachPost,
  pain: Pain,
  profile: number | null,
  now: Date,
): Promise<void> {
  const document = await keepDocument(db, {
    url: p.url,
    kind: "post",
    title: `${p.author} on ${p.platform}`,
    text: p.text,
    fetchTier: p.platform,
  });
  const quote = pain.quote.trim();
  await db
    .insert(findings)
    .values({
      kind: "fact",
      factKey: painKey(document, quote),
      value: {
        pain: pain.pain.trim(),
        platform: p.platform,
        handle: p.handle,
        author: p.author,
        post: p.id,
        ...(profile === null ? {} : { profile }),
      },
      documentId: document,
      sourceUrl: p.url,
      confidence: 1,
      via: "pain",
      question: "pain",
      proof: { quote },
      by: "model",
    })
    .onConflictDoUpdate({
      target: findings.factKey,
      set: { value: sql`excluded.value`, observedAt: sql`now()` },
    });
  if (profile === null) return;
  await db
    .insert(profileEvents)
    .values({
      profileId: profile,
      kind: "finding",
      channel: p.platform,
      at: p.postedAt ?? p.createdAt ?? now,
      summary: `Pain: ${pain.pain.trim()}`,
      body: quote,
      link: p.url,
      source: "pain",
      sourceId: `rp:${p.id}`,
    })
    .onConflictDoNothing();
}

/**
 * The pains in the posts kept since `cursor`, at most `limit` rows read. `sources` are the lists
 * the newest shape's live sourced sources name: with the line's list not among them nothing is
 * read and the cursor stays, so the first posts are not lost before the map holds the line.
 */
export async function painPass(
  db: Queryable,
  llm: LlmClient,
  sources: readonly string[],
  cursor: number,
  now: Date,
  limit = 50,
): Promise<PainPass> {
  const source = await painBatch(db);
  const none: PainPass = {
    fires: [],
    cursor,
    scanned: 0,
    read: 0,
    pains: 0,
    unproven: 0,
    waiting: false,
    more: false,
  };
  if (!sources.includes(source)) return { ...none, waiting: true };
  const since = new Date(now.getTime() - MAX_AGE_DAYS * DAY);
  const rows = await db
    .select()
    .from(reachPosts)
    .where(
      and(
        sql`${reachPosts.id} > ${cursor}`,
        sql`${reachPosts.state} in ('found', 'queued', 'commented')`,
        sql`${reachPosts.fit} is not null`,
        sql`coalesce(${reachPosts.postedAt}, ${reachPosts.createdAt}) >= ${since.toISOString()}`,
      ),
    )
    .orderBy(reachPosts.id)
    .limit(limit);
  if (!rows.length) return none;
  const settings = await allCommentsSettings(db);
  const passed = new Map<ReachPostPlatform, Set<string>>();
  for (const p of new Set(rows.map((r) => r.platform))) passed.set(p, await passedOn(db, p));
  const fit = rows.filter(
    (r) =>
      r.handle !== null &&
      (r.fit ?? 0) >= settings[r.platform].minFit &&
      !passed.get(r.platform)?.has(r.handle),
  );
  const out: PainPass = {
    ...none,
    cursor: rows[rows.length - 1]?.id ?? cursor,
    scanned: rows.length,
    read: fit.length,
    more: rows.length === limit,
  };
  const byId = new Map(fit.map((r) => [r.id, r] as const));
  for (let i = 0; i < fit.length; i += PER_CALL) {
    const batch = fit.slice(i, i + PER_CALL);
    for (const pain of await readPains(llm, batch)) {
      const post = byId.get(pain.post);
      if (!post) continue;
      if (!proven(post.text, pain.quote)) {
        out.unproven++;
        continue;
      }
      const profile = await authorProfile(db, post);
      await keepPain(db, post, pain, profile, now);
      out.pains++;
      if (profile !== null)
        out.fires.push(painFired(source, { id: post.id, profile, pain: pain.pain }, now));
    }
  }
  return out;
}
