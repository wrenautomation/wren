/**
 * A niche's emails as the template store has them live (`@wren/core/templates`, kind email,
 * system the niche). Compose, refresh, replies and experiments read here; the `.email` files
 * only seed the store, by `wren templates import`.
 */
import type { Template } from "@wren/core/slots";
import { liveTemplates } from "@wren/core/templates";
import type { Queryable } from "@wren/db";

/** The live emails of `niche`, by name; `names` narrows the read. */
export async function liveEmails(
  db: Queryable,
  niche: string,
  names?: readonly string[],
): Promise<Map<string, Template>> {
  const live = await liveTemplates(db, "email", niche, names);
  return new Map([...live].map(([name, t]) => [name, t.template]));
}
