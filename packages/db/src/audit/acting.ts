/**
 * View as, Act (designs/2026-10-14-view-as.md): who really acts, and whom as, for the rest of one
 * portal call. The portal's guard opens it; `setAuditActor` reads it, so every change in that call
 * is logged as the real person (`actor`) acting as someone (`acting_as`), whatever name the
 * handler passes.
 */
import { AsyncLocalStorage } from "node:async_hooks";

interface Acting {
  /** The real person: the operator signed in. */
  actor: string;
  /** Whom as, in words: `amy@acme.test at acme`. */
  as: string;
}

const acting = new AsyncLocalStorage<Acting>();

/** Run `fn` with every audited change in it logged as `who.actor` acting as `who.as`. */
export const actingAs = <T>(who: Acting, fn: () => T): T => acting.run(who, fn);

/** Who acts as whom right now, or null outside View as. */
export const actingNow = (): Acting | null => acting.getStore() ?? null;
