/**
 * `ContentDesk/default`: the loop's writes that must not run twice. Drafting
 * is paid, so each platform's draft is one journaled step; a retry after a
 * crash resumes at the next platform instead of paying again. Ideas and
 * review verdicts are plain rows: the CLI writes them straight to Postgres,
 * the console through `approve`, `edit` and `reject` here.
 *
 * `ContentDesk/<client>/desk`: the same over a client's own database. Its drafts speak as the
 * client (its plan's About and voice), on its own `models` vendor; they wait in its To approve.
 *
 * `settlePost` settles a post that may have gone out (designs/2026-10-16-maybe-sent.md). It asks
 * for the stored verdict under the post's send key, Wren's or a client's, and reads no words.
 * Found runs the after-publish. Else the person's word: posted, again, or dropped.
 */
import * as restate from "@restatedev/restate-sdk";
import { approvalsHandlers } from "./desk-approvals.js";
import { type ContentDeskDeps, contentDeskContext } from "./desk-context.js";
import { draftingHandlers } from "./desk-drafting.js";
import { editsHandlers } from "./desk-edits.js";
import { formatsHandlers } from "./desk-formats.js";
import { swapsHandlers } from "./desk-swaps.js";

export {
  type ContentDeskDeps,
  clientDrafting,
  type DraftReport,
  type DraftRequest,
  type WriteResult,
} from "./desk-context.js";
export { type FunnelRequest, funnelPatch, NOT_CONNECTED } from "./desk-edits.js";

export const DESK_KEY = "default";

/** A client's desk is `ContentDesk/<client>/desk`. */
export const DESK_UNIT = "desk";

export function makeContentDesk(deps: ContentDeskDeps) {
  const desk = contentDeskContext(deps);
  return restate.object({
    name: "ContentDesk",
    handlers: {
      ...draftingHandlers(desk),
      ...formatsHandlers(desk),
      ...approvalsHandlers(desk),
      ...swapsHandlers(desk),
      ...editsHandlers(desk),
    },
  });
}

export type ContentDesk = ReturnType<typeof makeContentDesk>;
