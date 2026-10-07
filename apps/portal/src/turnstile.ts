/**
 * Turnstile's check at the edge: the booking page and every Sites form submit. With no
 * TURNSTILE_SECRET set (local, tests) everything passes and the submit is kept as `off`.
 */
import type { Env } from "./env.js";

const VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Whether the visitor passed. A missing or oversized token fails without a call. */
export async function human(env: Env, token: unknown, ip: string | null): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true;
  if (typeof token !== "string" || !token || token.length > 3000) return false;
  try {
    const res = await fetch(VERIFY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}
