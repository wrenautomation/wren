/**
 * Every kind a draft box shows, composed once for the CLI (designs/2026-11-02-starling.md, R3),
 * the same way the worker composes it: outbound's threads, posts and DMs with conversations'
 * comment, and inbound's own posts.
 */
import { type DraftDesk, draftDesk, type ItemKinds } from "@wren/starling-acts";
import { commentGuide, contentDraftKinds, contentKinds, dmGuide } from "@wren/starling-inbound";
import { reachDraftKinds, reachKinds, reachTurns } from "@wren/starling-outbound";

export const deskKinds: ItemKinds = { ...reachKinds, ...contentKinds };

export const deskDrafts: DraftDesk = draftDesk({
  kinds: { ...reachDraftKinds({ commentGuide, dmGuide }), ...contentDraftKinds },
  examplesFor: reachTurns.examplesFor,
});
