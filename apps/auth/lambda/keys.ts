/**
 * `/api/keys/stage` (designs/2026-10-07-key-store.md): a pasted key, sealed with the store's
 * public key and set aside for an hour; the answer is its ref and last 4. Only the portal Worker
 * reaches it, with the edge secret and the signed-in person it checked. This Lambda can seal but
 * never open. Nothing here logs the body.
 */
import { KEY_MAX, KEY_STAGE_PATH, KEY_VIEWER_HEADER } from "@wren/core/key-refs";
import { intakeKey, type Sealer } from "@wren/core/keys";
import type { Db } from "@wren/db";
import type { UrlEvent } from "./http.js";

export interface KeyResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const answer = (statusCode: number, body: unknown): KeyResult => ({
  statusCode,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

/** The answer for a key call, or null when the path is another one. Call after `fromEdge`. */
export async function keyIntake(
  event: UrlEvent,
  db: Db,
  sealer: Sealer | null,
): Promise<KeyResult | null> {
  if (event.rawPath !== KEY_STAGE_PATH) return null;
  if (event.requestContext.http.method !== "POST") return answer(405, { error: "POST only" });
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : (event.body ?? "");
  if (raw.length > KEY_MAX + 1024) return answer(413, { error: "too large" });
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return answer(400, { error: "not json" });
  }
  try {
    const out = await intakeKey(db, sealer, event.headers?.[KEY_VIEWER_HEADER] ?? null, body);
    return answer(out.status, out.body);
  } catch (err) {
    // A database error can quote the query: its name only.
    console.error(`key stage failed: ${(err as Error)?.name ?? "error"}`);
    return answer(500, { error: "Couldn't save the key. Try again." });
  }
}
