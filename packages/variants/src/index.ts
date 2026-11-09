/**
 * Wren's host for vireo (`@wrenautomation/vireo`): its db, its collectors, its audit actor, its live push.
 * Every store call is `variants(db).<call>`.
 */
import { tellLive } from "@wren/core/live";
import { type Db, setAuditActor } from "@wren/db";
import { type Vireo, type Db as VireoDb, vireo } from "@wrenautomation/vireo";
import { collectors } from "./collectors.js";

export const variants = (db: Db): Vireo =>
  vireo({
    db: db as unknown as VireoDb,
    collectors: collectors(db),
    hooks: {
      onWrite: (tx, by) => setAuditActor(tx as never, by),
      // open Variants tabs read again (designs/2026-11-08-live-topics.md)
      afterWrite: () => tellLive(["variants"]).then(() => undefined),
    },
  });

export { collectors, POST_COUNTS, POST_MEANS } from "./collectors.js";
export * from "./console-routes.js";
