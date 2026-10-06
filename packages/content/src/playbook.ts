/**
 * A platform's playbook (an SOP pushed from the private sops folder) goes
 * into every draft prompt for that platform. The newest row wins; pushing
 * the same text again stores nothing.
 */
import type { Platform } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { and, desc, eq, ne } from "drizzle-orm";
import { type ContentPlaybook, contentPlaybooks } from "./schema.js";

/** About 2,000 words: an SOP past this is too long to steer a 1,300-character post. */
export const MAX_PLAYBOOK_CHARS = 16_000;

/** The SOP pushed as `comments` steers answers to comments, never post drafts. */
export const COMMENTS_SOP = "comments";

/** The platform's post playbook: its newest row that isn't the comments SOP. */
export async function playbookFor(
  db: Queryable,
  platform: Platform,
): Promise<ContentPlaybook | null> {
  const [row] = await db
    .select()
    .from(contentPlaybooks)
    .where(and(eq(contentPlaybooks.platform, platform), ne(contentPlaybooks.sop, COMMENTS_SOP)))
    .orderBy(desc(contentPlaybooks.createdAt))
    .limit(1);
  return row ?? null;
}

/** The newest `comments` SOP pushed for the platform. */
export async function commentsSopFor(
  db: Queryable,
  platform: Platform,
): Promise<ContentPlaybook | null> {
  const [row] = await db
    .select()
    .from(contentPlaybooks)
    .where(and(eq(contentPlaybooks.platform, platform), eq(contentPlaybooks.sop, COMMENTS_SOP)))
    .orderBy(desc(contentPlaybooks.createdAt))
    .limit(1);
  return row ?? null;
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
  const live = await (p.sop === COMMENTS_SOP ? commentsSopFor : playbookFor)(db, p.platform);
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
