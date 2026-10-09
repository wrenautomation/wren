import type { Need, RouteApps } from "@wren/core/access";

/**
 * LearnConsole's handlers and what each needs: the edge Worker opens only these. Each works in
 * one workspace's Learn: Wren's own for its team (the handler asks for Wren's team), or a
 * client's, which the handler checks again. Type imports only.
 */
export const LEARN_CONSOLE_ROUTES = {
  save: "act",
  follow: "act",
  // The workspace's alerts per source (Discord's too): someone who manages it.
  tell: "manage",
  unfollow: "act",
  browse: "read",
  rail: "read",
  home: "read",
  sources: "read",
  mark: "act",
  // Where you are in an item, and when you last looked: about you, as a star is.
  open: "read",
  progress: "read",
  move: "act",
  tag: "act",
  collectionAdd: "act",
  collectionEdit: "act",
  collectionDrop: "act",
  readAgain: "act",
  toSop: "act",
  search: "read",
  item: "read",
  unseen: "read",
  seen: "read",
  // Pictures and audio: only the workspace's own items'.
  media: "read",
  // Your bell, your Today and your alert picks: about you, as a star is.
  bell: "read",
  bellSeen: "read",
  today: "read",
  alerts: "read",
  alertPick: "read",
  // Mailing the digest is the workspace's call: off until someone with manage turns it on.
  digestMail: "manage",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): the Learn app. */
export const LEARN_CONSOLE_APPS = { "*": "learn" } as const satisfies RouteApps<
  typeof LEARN_CONSOLE_ROUTES
>;
export const LEARN_CONSOLE_WRITES: readonly (keyof typeof LEARN_CONSOLE_ROUTES)[] = [
  "save",
  "follow",
  "tell",
  "unfollow",
  "mark",
  "open",
  "progress",
  "move",
  "tag",
  "collectionAdd",
  "collectionEdit",
  "collectionDrop",
  "readAgain",
  "toSop",
  "seen",
  "bellSeen",
  "alertPick",
  "digestMail",
];
