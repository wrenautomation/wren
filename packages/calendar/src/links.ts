/**
 * Signatures, with no new secret: both come from the token the lander and Wren already share
 * (`WREN_SITE_EXPORT_TOKEN`, the lander's `EXPORT_TOKEN`).
 *
 * - `bookSig`: the lander's proof that a booking passed its bot check. Only the lander holds the
 *   token, so the public door can't book without it.
 * - `manageToken`: a booking's own reschedule and cancel link, one per booking. It names the
 *   booking and nothing else, so it stays good across a reschedule.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 of `book:<offer>:<start ISO>:<email>`, hex; the lander signs the same string. */
export const bookSig = (shared: string, offer: string, start: string, email: string) =>
  createHmac("sha256", shared)
    .update(`book:${offer}:${start}:${email.trim().toLowerCase()}`)
    .digest("hex");

/** True when `sig` is `bookSig` of the rest. */
export function bookSigned(
  shared: string,
  sig: string,
  offer: string,
  start: string,
  email: string,
): boolean {
  const want = Buffer.from(bookSig(shared, offer, start, email), "hex");
  const got = Buffer.from(/^[0-9a-f]{64}$/.test(sig) ? sig : "", "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

const manageKey = (shared: string) =>
  createHmac("sha256", shared).update("wren calendar v1").digest();
const manageMac = (shared: string, id: number) =>
  createHmac("sha256", manageKey(shared)).update(`manage:${id}`).digest().subarray(0, 18);

/** `<id>.<mac>`: the path segment of a booking's manage link. */
export const manageToken = (shared: string, id: number) =>
  `${id}.${manageMac(shared, id).toString("base64url")}`;

/** The booking a manage token names, or null when it wasn't signed with `shared`. */
export function readManage(shared: string, token: string): number | null {
  const m = /^(\d{1,9})\.([A-Za-z0-9_-]{24})$/.exec(token.trim());
  if (!m) return null;
  const id = Number(m[1]);
  const want = manageMac(shared, id);
  const got = Buffer.from(m[2] as string, "base64url");
  return got.length === want.length && timingSafeEqual(got, want) ? id : null;
}

/** The page a booker manages their call on. */
export const manageUrl = (site: string, shared: string, id: number) =>
  `${site.replace(/\/+$/, "")}/booking/${manageToken(shared, id)}`;
