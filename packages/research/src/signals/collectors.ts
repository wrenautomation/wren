/**
 * The collector registry. A collector is one file in this folder, listed here once; its settings
 * join the `research.signals` component under its name, with `on` (default: built).
 */
import { settingsFor } from "@wren/core/clients";
import type { Queryable } from "@wren/db";
import { z } from "zod";
import { demand } from "./demand.js";
import { funding } from "./funding.js";
import { hiring } from "./hiring.js";
import { type Collector, SIGNALS_COMPONENT, type SignalsSettings } from "./index.js";
import { linkedin } from "./linkedin.js";
import { news } from "./news.js";
import { site } from "./site.js";
import { stack } from "./stack.js";
import { talks } from "./talks.js";

export * from "./index.js";

export const COLLECTORS: readonly Collector[] = [
  hiring,
  news,
  funding,
  stack,
  linkedin,
  talks,
  site,
  demand,
];

export const collectorNamed = (name: string) => COLLECTORS.find((c) => c.name === name) ?? null;

/** Any collector built: the pool stage and the loop stay off until one is. */
export const anyCollectorBuilt = () => COLLECTORS.some((c) => c.built);

/** `research.signals`: each collector's own knobs under its name, plus `on`. */
export const signalsSettingsSchema = z
  .object(
    Object.fromEntries(
      COLLECTORS.map((c) => [
        c.name,
        c.settings.extend({ on: z.boolean().default(c.built) }).prefault({}),
      ]),
    ),
  )
  .strict();

/** Wren's signal settings; a bad block reads as the defaults. */
export async function signalSettings(db: Queryable): Promise<SignalsSettings> {
  const blocks = await settingsFor(db, null);
  const parsed = signalsSettingsSchema.safeParse(blocks[SIGNALS_COMPONENT] ?? {});
  return (parsed.success ? parsed.data : signalsSettingsSchema.parse({})) as SignalsSettings;
}
