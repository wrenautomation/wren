/**
 * A booked lead's visits to the lander, for the brief's "On the site" part: the visitors whose
 * application carries the booking's email, then those visitors' pages and recorded sessions. Read
 * live from the lander's export; only these lines are kept, never a visitor id (the 09-29 rule).
 */
import { type SiteApplication, siteExport } from "../inbox/clicks.js";
import type { Cited } from "./brief.js";

type Site = Parameters<typeof siteExport>[1];

/** How much a brief keeps: the pages seen most, the newest sessions, the visitors looked at. */
export const SITE_LIMITS = { pages: 4, sessions: 2, visitors: 3 } as const;

const day = (ts: string) => new Date(ts).toISOString().slice(0, 10);
const mins = (secs: number) =>
  secs < 60 ? `${Math.max(1, Math.round(secs))} sec` : `${Math.round(secs / 60)} min`;
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

/** The visitors who applied with this email, newest first. */
export const visitorsOf = (apps: readonly SiteApplication[], email: string): string[] => {
  const want = email.trim().toLowerCase();
  return [
    ...new Set(
      [...apps]
        .filter((a) => a.visitor && a.email?.trim().toLowerCase() === want)
        .sort((a, b) => b.id - a.id)
        .map((a) => a.visitor as string),
    ),
  ].slice(0, SITE_LIMITS.visitors);
};

/**
 * `BuildOptions.site` for Wren's own calls: pages link to the lander, sessions to Marketing →
 * Sessions. A failed read leaves the part empty, never the brief.
 */
export function landerVisits(site: Site): (email: string) => Promise<Cited[]> {
  const host = new URL(site.baseUrl).host;
  return async (email) => {
    try {
      const visitors = visitorsOf(await siteExport("applications", site), email);
      const pages = new Map<string, { n: number; secs: number; last: string }>();
      const sessions: Cited[] = [];
      for (const visitor of visitors) {
        const [hits, replays] = await Promise.all([
          siteExport("hits", { ...site, visitor }),
          siteExport("replays", { ...site, visitor }),
        ]);
        for (const h of hits) {
          const p = pages.get(h.page) ?? { n: 0, secs: 0, last: h.ts };
          p.n += 1;
          p.secs += Number(h.secs) || 0;
          if (h.ts > p.last) p.last = h.ts;
          pages.set(h.page, p);
        }
        for (const r of replays) {
          const secs = (Date.parse(r.last) - Date.parse(r.started)) / 1000;
          sessions.push({
            text: `Recorded visit to ${r.page}, ${mins(secs)}`,
            source: "Sessions",
            href: `/sites/sessions/${encodeURIComponent(r.view)}`,
            at: day(r.started),
          });
        }
      }
      const seen = [...pages]
        .sort((a, b) => b[1].n - a[1].n || b[1].last.localeCompare(a[1].last))
        .slice(0, SITE_LIMITS.pages)
        .map(([page, p]) => ({
          text: `Saw ${page} ${times(p.n)}${p.secs ? `, ${mins(p.secs)} in all` : ""}`,
          source: host,
          href: `${site.baseUrl.replace(/\/+$/, "")}${page}`,
          at: day(p.last),
        }));
      const recent = sessions
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, SITE_LIMITS.sessions);
      return [...seen, ...recent];
    } catch (err) {
      console.warn(`brief site visits: ${(err as Error).message}`);
      return [];
    }
  };
}

/** How many visit lines a profile page shows: the newest. */
export const VISIT_LINES = 40;

/**
 * People's `VisitReader` for Wren's own profiles (designs/2026-10-14-customerio-audit.md, B7):
 * each visitor's pages and recorded sessions, read live from the lander's export when the page
 * opens, newest first. Nothing is kept. A failed read shows none, never breaks the page.
 */
export function landerVisitLines(
  site: Site,
): (visitors: readonly string[]) => Promise<{ at: string; text: string; href: string | null }[]> {
  const base = site.baseUrl.replace(/\/+$/, "");
  return async (visitors) => {
    try {
      const lines: { at: string; text: string; href: string | null }[] = [];
      for (const visitor of visitors) {
        const [hits, replays] = await Promise.all([
          siteExport("hits", { ...site, visitor }),
          siteExport("replays", { ...site, visitor }),
        ]);
        for (const h of hits) {
          const secs = Number(h.secs) || 0;
          const from = h.utm_source ? `, from ${h.utm_source}` : "";
          const cta = Number(h.cta) > 0 ? ", clicked through" : "";
          lines.push({
            at: new Date(h.ts).toISOString(),
            text: `Saw ${h.page}${secs ? `, ${mins(secs)}` : ""}${cta}${from}`,
            href: `${base}${h.page}`,
          });
        }
        for (const r of replays)
          lines.push({
            at: new Date(r.started).toISOString(),
            text: `Recorded visit to ${r.page}, ${mins((Date.parse(r.last) - Date.parse(r.started)) / 1000)}`,
            href: `/sites/sessions/${encodeURIComponent(r.view)}`,
          });
      }
      return lines.sort((a, b) => b.at.localeCompare(a.at)).slice(0, VISIT_LINES);
    } catch (err) {
      console.warn(`profile site visits: ${(err as Error).message}`);
      return [];
    }
  };
}

/** The people map's reader (designs/2026-10-15-people-map.md): one visitor's hits, page and time only. */
export function landerHits(
  site: Site,
): (visitor: string) => Promise<{ ts: string; page: string }[]> {
  return async (visitor) =>
    (await siteExport("hits", { ...site, visitor })).map((h) => ({ ts: h.ts, page: h.page }));
}
