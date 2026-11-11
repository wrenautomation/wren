/**
 * A platform's playbook (an SOP pushed from the private sops folder) goes
 * into every draft prompt for that platform. The newest row wins; pushing
 * the same text again stores nothing.
 */

import {
  type KindStandard,
  kindStandardIn,
  type PlaybookStandard,
  type SopScope,
  standardLines,
} from "@wren/content-standard";
import type { Platform } from "@wren/core/autobrowse";
import type { Queryable } from "@wren/db";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { type ContentPlaybook, contentPlaybooks } from "./schema.js";

/** About 2,000 words: an SOP past this is too long to steer a 1,300-character post. */
const MAX_PLAYBOOK_CHARS = 16_000;

/** The SOP pushed as `comments` steers answers to comments, never post drafts. */
export const COMMENTS_SOP = "comments";
/**
 * The SOP pushed as `outbound-copy` (his outbound rules) steers DM drafts (`@wren/starling-outbound`
 * drafts.ts), never post drafts. There is no separate `dm` SOP (content desk, 6).
 */
export const DM_SOP = "outbound-copy";
const NOT_POSTS = [COMMENTS_SOP, DM_SOP];

/**
 * An SOP whose notes scope names kinds without `post` (a film SOP pushed on YouTube) governs
 * those kinds only: it never steers a post draft.
 */
const governsPosts = sql`(${contentPlaybooks.scope} is null
  or coalesce(jsonb_array_length(${contentPlaybooks.scope}->'kinds'), 0) = 0
  or ${contentPlaybooks.scope}->'kinds' ? 'post')`;

/** The platform's post playbook: its newest row that isn't the comments or DM SOP, nor a non-post SOP. */
export async function playbookFor(
  db: Queryable,
  platform: Platform,
): Promise<ContentPlaybook | null> {
  const [row] = await db
    .select()
    .from(contentPlaybooks)
    .where(
      and(
        eq(contentPlaybooks.platform, platform),
        notInArray(contentPlaybooks.sop, NOT_POSTS),
        governsPosts,
      ),
    )
    .orderBy(desc(contentPlaybooks.createdAt))
    .limit(1);
  return row ?? null;
}

/** The newest SOP pushed as `sop` for the platform. */
async function sopFor(
  db: Queryable,
  platform: Platform,
  sop: string,
): Promise<ContentPlaybook | null> {
  const [row] = await db
    .select()
    .from(contentPlaybooks)
    .where(and(eq(contentPlaybooks.platform, platform), eq(contentPlaybooks.sop, sop)))
    .orderBy(desc(contentPlaybooks.createdAt))
    .limit(1);
  return row ?? null;
}

/** The newest `comments` SOP pushed for the platform. */
const commentsSopFor = (db: Queryable, platform: Platform) => sopFor(db, platform, COMMENTS_SOP);

/**
 * What a DM draft follows: the `outbound-copy` SOP pushed for the platform, else the newest pushed
 * for any (it is one set of rules); "" = none, and the draft keeps its brief.
 */
export async function dmGuide(db: Queryable, platform: Platform): Promise<string> {
  const [row] = await db
    .select({ text: contentPlaybooks.text })
    .from(contentPlaybooks)
    .where(eq(contentPlaybooks.sop, DM_SOP))
    .orderBy(sql`${contentPlaybooks.platform} = ${platform} desc`, desc(contentPlaybooks.createdAt))
    .limit(1);
  return row?.text ?? "";
}

/**
 * What `comments.sort` drafts an answer against: the platform's playbook, then its comments SOP.
 * "" = neither, and the sort keeps its plain prompt.
 */
export async function commentGuide(db: Queryable, platform: Platform): Promise<string> {
  const [playbook, sop] = await Promise.all([
    playbookFor(db, platform),
    commentsSopFor(db, platform),
  ]);
  return [
    playbook ? `The ${platform} playbook:\n"""\n${playbook.text}\n"""` : "",
    sop ? `How we answer comments:\n"""\n${sop.text}\n"""` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function pushPlaybook(
  db: Queryable,
  p: {
    platform: Platform;
    sop: string;
    text: string;
    scope?: SopScope | null;
    standard?: PlaybookStandard | null;
  },
): Promise<{ playbook: ContentPlaybook; changed: boolean }> {
  const text = p.text.trim();
  if (text.length === 0) throw new Error(`${p.sop}: empty SOP`);
  if (text.length > MAX_PLAYBOOK_CHARS)
    throw new Error(
      `${p.sop}: ${text.length} chars, over ${MAX_PLAYBOOK_CHARS}; cut the SOP first`,
    );
  const posts = !p.scope?.kinds.length || p.scope.kinds.includes("post");
  const live =
    NOT_POSTS.includes(p.sop) || !posts
      ? await sopFor(db, p.platform, p.sop)
      : await playbookFor(db, p.platform);
  const scope = p.scope ?? null;
  const standard = p.standard ?? null;
  if (
    live &&
    live.sop === p.sop &&
    live.text === text &&
    sameScope(live.scope ?? null, scope) &&
    sameStandard(live.standard ?? null, standard)
  )
    return { playbook: live, changed: false };
  const [row] = await db
    .insert(contentPlaybooks)
    .values({ platform: p.platform, sop: p.sop, text, scope, standard })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return { playbook: row, changed: true };
}

/** Field by field: jsonb gives the keys back in its own order. */
const sameScope = (a: SopScope | null, b: SopScope | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.topic === b.topic &&
    (["kinds", "platforms", "set"] as const).every((k) => a[k].join() === b[k].join()));

/** Keys sorted: jsonb gives them back in its own order. */
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
/** The numbers and calls, not the time they were read. */
const sameStandard = (a: PlaybookStandard | null, b: PlaybookStandard | null) =>
  stable(a && { ...a, at: null }) === stable(b && { ...b, at: null });

export function playbookBlock(playbook: Pick<ContentPlaybook, "text"> | null): string {
  if (!playbook) return "";
  return `
The playbook for this platform. Follow what it says about writing a post; its steps for posting, replying and measuring are not your job here. The voice above and the rules in this message win where they differ:
"""
${playbook.text}
"""
`;
}

/**
 * The numbers a post draft is held to (designs/2026-10-25-competitor-analyzer.md, Use): the `post`
 * standard pushed with the playbook (Canon, WA-1317). Null with no playbook, or under
 * `MIN_STANDARD` pieces.
 */
export const postStandardFor = (
  playbook: Pick<ContentPlaybook, "standard"> | null,
): KindStandard | null => kindStandardIn(playbook?.standard, "post");

export function standardBlock(standard: KindStandard | null): string {
  if (!standard) return "";
  return `
How the ${standard.n} best posts on this platform are built (the median, and the middle half). Land inside the middle half unless the idea needs otherwise; never pad or cut words to hit a number:
${standardLines(standard).join("\n")}
`;
}
