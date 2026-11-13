/**
 * Wren's host for Aerie (`@wrenautomation/aerie`): its db and its live push. Schema `aerie` in Wren's Postgres,
 * tables owned by role `aerie` (migrated as that role); off the audit log (Aerie keeps its own, `task_event`).
 */
import { tellLive } from "@wren/core/live";
import type { Db } from "@wren/db";
import { type Db as AerieDb, type AerieStore, aerieStore } from "@wrenautomation/aerie";

export const AERIE_HOOKS: NonNullable<Parameters<typeof aerieStore>[0]["hooks"]> = {
  // open Aerie tabs read again (designs/2026-11-08-live-topics.md)
  afterWrite: () => tellLive(["aerie"]).then(() => undefined),
};

export const aerie = (db: Db): AerieStore =>
  aerieStore({ db: db as unknown as AerieDb, hooks: AERIE_HOOKS });

export * from "./console-routes.js";
