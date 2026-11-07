/**
 * Every page a person can open has a page story (designs/2026-11-05-story-parity.md): the story
 * renders the real page, so a page with none can drift unseen. Client stories live in
 * `stories/client/`; the rest sign in as Wren's team.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { CLIENT_PLACES, TEAM_PLACES } = await import("./modules/places.js");
const { research } = await import("./modules/research/index.js");
const { MOVED_APPS } = await import("./moved.js");

const DIR = new URL("./stories/", import.meta.url);
/** Each story file's address literals: "/place/page…" anywhere in the file. */
const addresses = (client: boolean) =>
  readdirSync(DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx") && f.startsWith("client/") === client)
    .flatMap((f) => [...readFileSync(new URL(f, DIR), "utf8").matchAll(/["'`](\/[a-z][\w/-]*)/g)])
    .map((m) => m[1] ?? "");

type Place = { id: string; pages: { id: string; hidden?: boolean }[] };
/** Each page's address; a bare place address (`/project`) also opens its first shown page. */
const pages = (places: readonly Place[]) =>
  places.flatMap((m) => {
    const first = m.pages.find((p) => !p.hidden) ?? m.pages[0];
    return m.pages.map((p) => ({ at: `/${m.id}/${p.id}`, bare: p === first ? `/${m.id}` : null }));
  });
const missing = (want: ReturnType<typeof pages>, have: string[]) =>
  want
    .filter(
      ({ at, bare }) =>
        !have.some(
          (a) => a === at || a === bare || a.startsWith(`${at}/`) || a.startsWith(`${at}?`),
        ),
    )
    .map((w) => w.at);

describe("page stories", () => {
  it("cover every team page", () => {
    expect(missing(pages([...TEAM_PLACES, research]), addresses(false))).toEqual([]);
  });
  it("cover every client page", () => {
    expect(missing(pages(CLIENT_PLACES), addresses(true))).toEqual([]);
  });
  // an old address redirects and still renders: the story would test the page it moved to
  it("open no moved or gone address", () => {
    const stale = (places: readonly Place[], client: boolean) => {
      const known = new Set(pages(places).flatMap((p) => (p.bare ? [p.at, p.bare] : [p.at])));
      const ids = new Set([...places.map((m) => m.id), ...Object.keys(MOVED_APPS)]);
      return [
        ...new Set(
          addresses(client).filter((a) => {
            const [, app, page, id] = a.split("/");
            if (!app || !ids.has(app)) return false;
            // a part of the Map (`/map/station/book`): the Map's own stories own those
            if (app === "map" && id !== undefined) return false;
            return !known.has(page === undefined ? a : `/${app}/${page}`);
          }),
        ),
      ];
    };
    expect(stale([...TEAM_PLACES, research], false)).toEqual([]);
    expect(stale(CLIENT_PLACES, true)).toEqual([]);
  });
});
