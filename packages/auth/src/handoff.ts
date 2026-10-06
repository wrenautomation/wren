/**
 * Sign-in carried to a client's own host (designs/2026-10-06-custom-domains.md). On that host
 * our session cookie is third-party, so the browser goes through here instead: Better Auth's
 * one-time token, good for a minute and once, sent only to a live client host's `/__auth/back`.
 * That host's Worker redeems it server to server and keeps the session in its own cookie.
 *
 * The client controls its host's DNS. So a handoff goes only to that client's own members (never
 * Wren's team), and only from our sign-in page, never from a link on another site.
 */
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import * as z from "zod";

/** Where on the client's host the token lands. */
export const BACK_PATH = "/__auth/back";

/** The URL the token may go to, or null: https, the landing path, no login or port. */
export function handoffTarget(to: string): URL | null {
  let url: URL;
  try {
    url = new URL(to);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.pathname !== BACK_PATH) return null;
  if (url.username || url.password || url.port || url.hash) return null;
  if (url.searchParams.has("ott")) return null;
  return url;
}

export interface HandoffOptions {
  /** May this email be handed to this host: the host is a live client domain and they're its member. */
  allowed(host: string, email: string): Promise<boolean>;
  /** Mints the one-time token for the session these headers carry. */
  mint(headers: Headers): Promise<string>;
  /** Where a refused handoff goes: the portal. */
  home: string;
}

export const handoff = (o: HandoffOptions) =>
  ({
    id: "wren-handoff",
    endpoints: {
      handoff: createAuthEndpoint(
        "/handoff",
        {
          method: "GET",
          query: z.object({ to: z.string().max(2048) }),
          use: [sessionMiddleware],
        },
        async (c) => {
          const target = handoffTarget(c.query.to);
          // A link from another site lands on the sign-in page, which decides; never straight here.
          const site = c.request?.headers.get("sec-fetch-site");
          const ok =
            target !== null &&
            site !== "cross-site" &&
            site !== "same-site" &&
            (await o.allowed(target.hostname, c.context.session.user.email.toLowerCase()));
          if (!target || !ok || !c.headers) throw c.redirect(o.home);
          target.searchParams.set("ott", await o.mint(c.headers));
          throw c.redirect(target.toString());
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
