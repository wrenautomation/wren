/**
 * A review's reply brief (designs/2026-10-09-review-replies.md): what Suggest and a draft on
 * arrival write under a review of the business, by its stars.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

export interface ReviewOf {
  stars: number | null;
  words: boolean;
}

/** The comment as a review: its stars and whether it has words; null for any other comment. */
export async function reviewOf(db: Queryable, commentId: number | null): Promise<ReviewOf | null> {
  if (commentId === null) return null;
  const [r] = (await db.execute(
    sql`select stars, body from comments where id = ${commentId} and kind = 'review'`,
  )) as unknown as Array<{ stars: number | null; body: string }>;
  if (!r) return null;
  return {
    stars: r.stars,
    words: !/^\d\/5 stars, no words\.$|^A rating, no words\.$/.test(r.body),
  };
}

/** How to answer it: thanks by first name, one thing they said, and the stars' tone. */
export function reviewHow(r: ReviewOf): string {
  const rules = [
    "a public reply from the business owner under their review",
    "thank them by first name",
    "never offer anything for a review; never name a job, price or detail they didn't write",
  ];
  if (!r.words) return `${rules[0]}: one line of thanks, by first name`;
  rules.push("say one specific thing from their words");
  if (r.stars !== null && r.stars <= 3)
    rules.push(
      "own the experience without admitting fault, never argue, and invite them to reach the owner directly (only with a phone or email from the facts; none given, just say to get in touch)",
    );
  else rules.push("short and warm: two sentences at most");
  return rules.join("; ");
}
