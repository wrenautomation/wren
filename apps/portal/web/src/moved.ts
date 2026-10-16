/**
 * Pages that moved to another app, by their old address: the router sends an old link on to the
 * new one before anything draws, the rest of its path, search and hash kept. One table for every
 * move, so a link from a mail, a saved view or a ping still lands.
 */

/** Old `/app/page` → new `/app/page`. */
export const MOVED: Readonly<Record<string, string>> = {
  // Outbound left Marketing for Outreach (designs/2026-10-16-outreach-app.md).
  ...Object.fromEntries(
    ["engage", "dms", "invites", "people", "threads", "places", "accounts", "dm-copy"].map((p) => [
      `/marketing/${p}`,
      `/outreach/${p}`,
    ]),
  ),
};

/** Where an address moved to, or null: `/marketing/dms/5?x=1` → `/outreach/dms/5?x=1`. */
export function movedTo(href: string): string | null {
  const m = /^(\/[^/?#]+\/[^/?#]+)(.*)$/.exec(href);
  const to = m?.[1] ? MOVED[m[1]] : undefined;
  return to ? `${to}${m?.[2] ?? ""}` : null;
}
