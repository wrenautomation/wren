/**
 * A platform's playbook (an SOP pushed from the private sops folder) goes
 * into every draft prompt for that platform. The newest row wins; pushing
 * the same text again stores nothing.
 */
import type { Platform } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { desc, eq } from "drizzle-orm";
import { type ContentPlaybook, contentPlaybooks } from "./schema.js";

/** About 2,000 words: an SOP past this is too long to steer a 1,300-character post. */
export const MAX_PLAYBOOK_CHARS = 16_000;

export async function playbookFor(
  db: Queryable,
  platform: Platform,
): Promise<ContentPlaybook | null> {
  const [row] = await db
    .select()
    .from(contentPlaybooks)
    .where(eq(contentPlaybooks.platform, platform))
    .orderBy(desc(contentPlaybooks.createdAt))
    .limit(1);
  return row ?? null;
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
  const live = await playbookFor(db, p.platform);
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
