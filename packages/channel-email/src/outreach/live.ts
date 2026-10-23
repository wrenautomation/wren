/**
 * A niche's emails as the template store has them live (`@wren/core/templates`, kind email,
 * system the niche). Compose, refresh and replies read here. Wren ships no email copy: the
 * store holds every word, so a sequence can have none (`copyGap`).
 */
import { factKeys, type Template } from "@wren/core/slots";
import { liveTemplates } from "@wren/core/templates";
import type { Queryable } from "@wren/db";
import type { Sequence } from "./sequences.js";

/** The live emails of `niche`, by name; `names` narrows the read. */
export async function liveEmails(
  db: Queryable,
  niche: string,
  names?: readonly string[],
): Promise<Map<string, Template>> {
  const live = await liveTemplates(db, "email", niche, names);
  return new Map([...live].map(([name, t]) => [name, t.template]));
}

/**
 * Why `sequence` cannot compose from `live`, or null when it can: a step with no live
 * template; an opener with no subject (a thread-rider has no thread yet, so it would skip on
 * day one and finish the enrollment, using up the company for nothing); or copy quoting an
 * `offer.*` term the offer does not set (it would refuse every draft). A missing template is a
 * sequence that waits for copy, never an error.
 */
export function copyGap(
  sequence: Sequence,
  live: ReadonlyMap<string, Template>,
  offerFacts: Readonly<Record<string, string>> = {},
): string | null {
  const names = [...new Set(sequence.steps.map((s) => s.template))];
  const missing = names.filter((t) => !live.has(t)).sort();
  if (missing.length > 0) return `no copy: ${missing.join(", ")} not live`;
  const opener = (sequence.steps[0] as { template: string }).template;
  if (live.get(opener)?.subject === null) return `no copy: opener ${opener} has no subject`;
  for (const name of names) {
    const unset = [...factKeys(live.get(name) as Template)]
      .filter((k) => k.startsWith("offer.") && !(k in offerFacts))
      .sort();
    if (unset.length > 0)
      return `no copy: ${name} quotes ${unset.join(", ")}, which the offer does not set`;
  }
  return null;
}
