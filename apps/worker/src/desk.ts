/**
 * Every kind a draft box shows, composed once for the worker (designs/2026-11-02-starling.md,
 * R3): outbound's threads, posts and DMs with conversations' comment, and inbound's own posts.
 * The SOPs the kinds read are inbound's playbooks; the comment examples are outbound's.
 */
import { type DraftDesk, draftDesk, type ItemKinds } from "@wren/starling-acts";
import { commentGuide, contentDraftKinds, contentKinds, dmGuide } from "@wren/starling-inbound";
import { reachDraftKinds, reachKinds, reachTurns } from "@wren/starling-outbound";

export const deskKinds: ItemKinds = { ...reachKinds, ...contentKinds };

export const deskDrafts: DraftDesk = draftDesk({
  kinds: { ...reachDraftKinds({ commentGuide, dmGuide }), ...contentDraftKinds },
  examplesFor: reachTurns.examplesFor,
});
