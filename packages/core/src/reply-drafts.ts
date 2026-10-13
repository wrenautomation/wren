/**
 * Who writes replies (comments on ours, others' posts, Reddit threads, DMs): the model drafts
 * each one for his edit, or he writes them all and the boxes start empty. With "you", nothing
 * is drafted: rows still come in, sorted and ranked by code.
 */
import type { Queryable } from "@wren/db";
import { z } from "zod";
import { settingsFor } from "./clients/index.js";

export const REPLY_DRAFTS_COMPONENT = "drafts.replies";

export const replyDraftsSchema = z
  .object({ by: z.enum(["model", "you"]).default("model") })
  .strict();
export type ReplyDrafts = z.infer<typeof replyDraftsSchema>;

/** True when the model drafts replies (the default). */
export async function modelDrafts(db: Queryable): Promise<boolean> {
  const got = replyDraftsSchema.safeParse(
    (await settingsFor(db, null))[REPLY_DRAFTS_COMPONENT] ?? {},
  );
  return !got.success || got.data.by === "model";
}
