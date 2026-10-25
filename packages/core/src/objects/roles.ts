/**
 * Every column that names a post, comment or group by its platform ref: the roles an object plays
 * in other tables (designs/2026-10-20-platform-objects.md). `linkRefs` reads this list to move a
 * dropped spelling to the kept one. A new column that names an object goes here, and the
 * roles-vs-database test fails until it does.
 *
 * Plain table and column names: core imports no other package. Each of these columns, with its
 * platform column, is a composite foreign key to `platform_objects`. The roles-vs-database test
 * holds the list and the keys equal.
 */
import type { ObjectKind } from "../objects-schema.js";

/**
 * What a link does when the table already holds a row for both spellings:
 * - `comment`: one comment row. The kept row wins; it takes the dropped row's answer when it has
 *   none. Proofs, send attempts, drafts and touches of the dropped row move to the kept row.
 * - `reach`: one reach post row. The kept row wins. The dropped row's items and touches move.
 * - `drop`: the kept row wins, the dropped row goes.
 * - `refuse`: the link throws, naming both rows, and changes nothing.
 * - `move`: no unique key on the column; every row just takes the kept spelling.
 */
export type TwinRule = "comment" | "reach" | "drop" | "refuse" | "move";

export interface ObjectRole {
  table: string;
  /** The table's platform column: `platform`, or `network` on `social_posts` and `social_groups`. */
  platform: string;
  /** The column that holds the object's ref. */
  column: string;
  /** What the column names. A parent column names a comment, or the post when it is the root. */
  kind: ObjectKind;
  twin: TwinRule;
  /** The other columns of the unique key, beside the platform and `column`. */
  key?: readonly string[];
}

export const OBJECT_ROLES: readonly ObjectRole[] = [
  { table: "comments", platform: "platform", column: "ref", kind: "comment", twin: "comment" },
  { table: "comments", platform: "platform", column: "post", kind: "post", twin: "move" },
  { table: "comments", platform: "platform", column: "parent", kind: "comment", twin: "move" },
  { table: "comments", platform: "platform", column: "answer_ref", kind: "comment", twin: "move" },
  { table: "comment_threads", platform: "platform", column: "post", kind: "post", twin: "drop" },
  {
    table: "comment_keywords",
    platform: "platform",
    column: "post",
    kind: "post",
    twin: "drop",
    key: ["keyword"],
  },
  { table: "reach_posts", platform: "platform", column: "ref", kind: "post", twin: "reach" },
  { table: "reddit_threads", platform: "platform", column: "id", kind: "post", twin: "refuse" },
  {
    table: "reddit_threads",
    platform: "platform",
    column: "target",
    kind: "comment",
    twin: "move",
  },
  {
    table: "reddit_threads",
    platform: "platform",
    column: "answer_ref",
    kind: "comment",
    twin: "move",
  },
  { table: "social_posts", platform: "network", column: "ref", kind: "post", twin: "refuse" },
  { table: "social_groups", platform: "network", column: "ref", kind: "group", twin: "refuse" },
  {
    table: "content_drafts",
    platform: "platform",
    column: "published_id",
    kind: "post",
    twin: "move",
  },
  // A post for the post, video and post_comment kinds; a comment for thread and comment.
  {
    table: "draft_events",
    platform: "platform",
    column: "external_id",
    kind: "post",
    twin: "move",
  },
];

/** A table that keys rows by the typed id of a draft item: `comment:4`, `onpost:9`. */
interface ItemHome {
  table: string;
  column: string;
  /** One row per item (a primary key): the kept item's row wins and the dropped one goes. */
  unique: boolean;
}

/** Where a comment's or reach post's typed item id lives. */
export const ITEM_HOMES: readonly ItemHome[] = [
  { table: "comment_proofs", column: "item", unique: true },
  { table: "send_attempts", column: "item", unique: true },
  { table: "draft_accounts", column: "item", unique: true },
  { table: "draft_events", column: "item", unique: false },
  { table: "reach_passes", column: "item", unique: false },
];

/** The typed item id and the touch refs (`touches.ref`) a row owns, by its serial id. */
export const ROLE_ITEMS = {
  comment: {
    item: (id: number) => `comment:${id}`,
    touches: (id: number) => [`c:${id}`, `ca:${id}`],
  },
  reach: {
    item: (id: number) => `onpost:${id}`,
    touches: (id: number) => [`rp:${id}`, `rp:${id}:like`, `rp:${id}:follow`],
  },
} as const;
