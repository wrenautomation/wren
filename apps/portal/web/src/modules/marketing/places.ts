/**
 * Reads on his click: audience.
 */
import type { Action } from "@wren/ui";

/** One read on his click; the loops behind these pages stay as they are. */
const readNow = (id: string, handler: string, done: (answer: unknown) => string): Action => ({
  id,
  label: "Read now",
  handler,
  form: [],
  done,
});
export const AUDIENCE_ACTIONS: Action[] = [
  readNow(
    "marketing.audienceRead",
    "marketing/audienceRead",
    (a) => `LinkedIn: ${(a as { followers?: number } | null)?.followers ?? "no"} followers`,
  ),
];
