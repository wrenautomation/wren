/**
 * Threads after the first touch, one protocol for every channel (designs/2026-11-02-starling.md,
 * batch 7, R2): the turn stores (contacts, DMs, comments, their touches) and the inbox protocol.
 * The channel that owns the accounts answers `TurnDeps`; records and touches are subpaths.
 */
export * from "./comments.js";
export * from "./contacts.js";
export * from "./deps.js";
export * from "./draft-kinds.js";
export * from "./email/index.js";
export * from "./item-kinds.js";
export * from "./replies.js";
export * from "./thread-context.js";
export * from "./threads.js";
