/**
 * What a portal call meant, for autotrack (the recorder in wren_automation/autotrack). Each API call
 * posts an app event; autotrack's browser extension joins it to the click that caused it, so a
 * recorded session says "reactivation/approve on lead 42, 200" and not only "clicked Approve".
 * Only the route, the outcome and record ids, never a body. With no extension, nothing listens.
 */
const ID_KEY = /^(id|client)$|Ids?$/;
const MAX_IDS = 10;

/** The record ids a call names: `id`, `client`, `*Id`, `*Ids` (strings and numbers only). */
export function callIds(body: Record<string, unknown>): Record<string, unknown> | null {
  const ids: Record<string, unknown> = {};
  const plain = (x: unknown) => typeof x === "string" || typeof x === "number";
  for (const [k, v] of Object.entries(body)) {
    if (!ID_KEY.test(k)) continue;
    if (plain(v)) ids[k] = v;
    else if (Array.isArray(v)) ids[k] = v.filter(plain).slice(0, MAX_IDS);
  }
  return Object.keys(ids).length ? ids : null;
}

export function tellAutotrack(
  path: string,
  body: Record<string, unknown>,
  status: number,
  ms: number,
) {
  const ids = callIds(body);
  try {
    postMessage(
      {
        autotrack: { v: 1, action: path.slice(0, 64), detail: { status, ms, ...(ids && { ids }) } },
      },
      location.origin,
    );
  } catch {
    // No window (a test): nobody to tell.
  }
}
