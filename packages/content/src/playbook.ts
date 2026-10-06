/**
 * A platform's playbook (an SOP pushed from the private sops folder) goes
 * into every draft prompt for that platform. The newest row wins; pushing
 * the same text again stores nothing.
 */
import type { Platform } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { type ContentPlaybook, contentPlaybooks } from "./schema.js";

/** About 2,000 words: an SOP past this is too long to steer a 1,300-character post. */
export const MAX_PLAYBOOK_CHARS = 16_000;

/** The SOP pushed as `comments` steers answers to comments, never post drafts. */
export const COMMENTS_SOP = "comments";
/**
 * The SOP pushed as `outbound-copy` (his outbound rules) steers DM drafts (`@wren/outreach`
 * drafts.ts), never post drafts. There is no separate `dm` SOP (content desk, 6).
 */
export const DM_SOP = "outbound-copy";
const NOT_POSTS = [COMMENTS_SOP, DM_SOP];

/** The platform's post playbook: its newest row that isn't the comments or DM SOP. */
export async function playbookFor(
  db: Queryable,
  platform: Platform,
): Promise<ContentPlaybook | null> {
  const [row] = await db
    .select()
    .from(contentPlaybooks)
    .where(
      and(eq(contentPlaybooks.platform, platform), notInArray(contentPlaybooks.sop, NOT_POSTS)),
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
export const commentsSopFor = (db: Queryable, platform: Platform) =>
  sopFor(db, platform, COMMENTS_SOP);

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
  p: { platform: Platform; sop: string; text: string },
): Promise<{ playbook: ContentPlaybook; changed: boolean }> {
  const text = p.text.trim();
  if (text.length === 0) throw new Error(`${p.sop}: empty SOP`);
  if (text.length > MAX_PLAYBOOK_CHARS)
    throw new Error(
      `${p.sop}: ${text.length} chars, over ${MAX_PLAYBOOK_CHARS}; cut the SOP first`,
    );
  const live = NOT_POSTS.includes(p.sop)
    ? await sopFor(db, p.platform, p.sop)
    : await playbookFor(db, p.platform);
  if (live && live.sop === p.sop && live.text === text) return { playbook: live, changed: false };
  const [row] = await db
    .insert(contentPlaybooks)
    .values({ platform: p.platform, sop: p.sop, text })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return { playbook: row, changed: true };
}

export function playbookBlock(playbook: Pick<ContentPlaybook, "text"> | null): string {
  if (!playbook) return "";
  return `
The playbook for this platform. Follow what it says about writing a post; its steps for posting, replying and measuring are not your job here. The voice above and the rules in this message win where they differ:
"""
${playbook.text}
"""
`;
}
