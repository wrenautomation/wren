/**
 * A draft's share link (designs/2026-10-07-sites.md, Phase 3): anyone with it sees one version
 * for 7 days, no sign-in, nothing counted. Signed with a key from the secret the lander and Wren
 * already share (`WREN_SITE_EXPORT_TOKEN`), so no new secret and nothing stored per link.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SHARE_DAYS = 7;
const TOKEN = /^s\.(\d{1,6})\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{24})$/;

const keyOf = (shared: string) => createHmac("sha256", shared).update("wren share v1").digest();
const macOf = (shared: string, page: string, version: number, exp: number) =>
  createHmac("sha256", keyOf(shared))
    .update(`share:${page}:${version}:${exp}`)
    .digest()
    .subarray(0, 18)
    .toString("base64url");

/** `s.<version>.<expiry, unix seconds base 36>.<mac>`: the preview path's `t`. */
export function shareToken(shared: string, page: string, version: number, now: Date): string {
  const exp = Math.floor(now.getTime() / 1000) + SHARE_DAYS * 86400;
  return `s.${version}.${exp.toString(36)}.${macOf(shared, page, version, exp)}`;
}

export const isShareToken = (t: string) => t.startsWith("s.");

/** The version a share token opens, or null: not signed for this page, or past its 7 days. */
export function readShare(shared: string, page: string, token: string, now: Date): number | null {
  const m = TOKEN.exec(token);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const version = Number(m[1]);
  const exp = Number.parseInt(m[2], 36);
  if (exp * 1000 <= now.getTime()) return null;
  const want = Buffer.from(macOf(shared, page, version, exp));
  const got = Buffer.from(m[3]);
  return got.length === want.length && timingSafeEqual(got, want) ? version : null;
}
