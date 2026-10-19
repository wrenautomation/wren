import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  atWrenOf,
  CLIENT_HELD,
  heldByClient,
  MOVED,
  MOVED_APPS,
  movedTo,
  namedIn,
} from "./moved.js";

// The apps read the page's address as they load; a bare one does here.
Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { MODULES } = await import("./modules/index.js");

const WREN = { atWren: true };
const CLIENT = { atWren: false };
const isTeam = (m: { requires?: { audience?: string } | undefined }) =>
  m.requires?.audience === "team";
const teamModules = MODULES.filter(isTeam);
const clientModules = MODULES.filter((m) => !isTeam(m));
const appOf = (href: string) => href.split("/")[1] ?? "";
const pageOf = (href: string) => href.split(/[?#]/)[0]?.split("/")[2] ?? "";

describe("movedTo", () => {
  it("sends Marketing's outbound pages to Engage, keeping path, search and hash", () => {
    expect(movedTo("/marketing/engage", WREN)).toBe("/engage/engage");
    expect(movedTo("/marketing/dms?view=waiting", WREN)).toBe("/engage/dms?view=waiting");
    expect(movedTo("/marketing/dms/12", WREN)).toBe("/engage/dms/12");
    expect(movedTo("/marketing/engage/onpost%3A3?view=all#x", WREN)).toBe(
      "/engage/engage/onpost%3A3?view=all#x",
    );
    expect(movedTo("/marketing/dm-copy", WREN)).toBe("/engage/dm-copy");
  });

  it("sends a page that left its app to the page's new place", () => {
    expect(movedTo("/inbox/waiting?view=waiting", WREN)).toBe("/engage/inbox?view=waiting");
    expect(movedTo("/inbox/approve", CLIENT)).toBe("/engage/approve");
    expect(movedTo("/marketing/comments?platform=x#r", WREN)).toBe("/engage/comments?platform=x#r");
    expect(movedTo("/marketing/ads", WREN)).toBe("/ads/sets");
    expect(movedTo("/marketing/site", WREN)).toBe("/analytics/visits");
    expect(movedTo("/marketing/keywords", WREN)).toBe("/engage/keywords");
    expect(movedTo("/marketing/texts", WREN)).toBe("/outbound/texts");
    expect(movedTo("/marketing/more", WREN)).toBe("/content/plan");
    expect(movedTo("/sites/sessions/5", WREN)).toBe("/analytics/sessions/5");
    expect(movedTo("/pipeline/overview", CLIENT)).toBe("/outbound/sheet");
  });

  it("renames an app and keeps the rest of the address", () => {
    expect(movedTo("/marketing/plan?x=1", WREN)).toBe("/content/plan?x=1");
    expect(movedTo("/marketing", WREN)).toBe("/content");
    expect(movedTo("/marketing?x=1#y", WREN)).toBe("/content?x=1#y");
    expect(movedTo("/deals/board", CLIENT)).toBe("/pipelines/board");
    expect(movedTo("/deals/journeys/7", CLIENT)).toBe("/pipelines/journeys/7");
    expect(movedTo("/deals", WREN)).toBe("/pipelines");
    expect(movedTo("/outreach/threads/4?view=all", WREN)).toBe("/engage/threads/4?view=all");
    expect(movedTo("/pipeline/companies", WREN)).toBe("/outbound/companies");
  });

  it("moves an app a client also holds at Wren only", () => {
    expect(movedTo("/marketing/inbox", WREN)).toBe("/engage/inbox");
    expect(movedTo("/marketing/inbox", CLIENT)).toBeNull();
    expect(movedTo("/marketing/plan", CLIENT)).toBeNull();
    expect(movedTo("/marketing", CLIENT)).toBeNull();
    expect(movedTo("/sites/sessions", CLIENT)).toBeNull();
    expect(movedTo("/sites/funnel", WREN)).toBeNull();
  });

  it("leaves every other address alone", () => {
    expect(movedTo("/content/plan", WREN)).toBeNull();
    expect(movedTo("/marketingx/plan", WREN)).toBeNull();
    expect(movedTo("/engage", WREN)).toBeNull();
    expect(movedTo("/constructor/x", WREN)).toBeNull();
    expect(movedTo("/calls/booked", CLIENT)).toBeNull();
    expect(movedTo("/", WREN)).toBeNull();
  });

  it("never moves an address onto one that moves again", () => {
    for (const to of [...Object.values(MOVED), ...Object.values(MOVED_APPS).map((a) => `/${a}`)])
      expect(movedTo(to, WREN), to).toBeNull();
  });
});

describe("who is at Wren", () => {
  it("is the team, unless a link names a client", () => {
    expect(atWrenOf(true, null)).toBe(true);
    expect(atWrenOf(true, "acme")).toBe(false);
    expect(atWrenOf(false, null)).toBe(false);
    expect(namedIn("/marketing/plan?client=acme")).toBe("acme");
    expect(namedIn("/marketing/plan?view=all")).toBeNull();
    expect(heldByClient("/marketing/plan")).toBe(true);
    expect(heldByClient("/deals/board")).toBe(false);
  });
});

describe("the move table", () => {
  it("lands every moved page on a page of Wren's own apps", () => {
    for (const [from, to] of Object.entries(MOVED)) {
      const m = teamModules.find((x) => x.id === appOf(to));
      expect(
        m?.pages.map((p) => p.id),
        `${from} -> ${to}`,
      ).toContain(pageOf(to));
    }
  });

  it("lands every page of a renamed app on a page of the new app", () => {
    // The ids each old app held that stay under their own name (the rest have an entry above).
    const stay: Record<string, string[]> = {
      deals: ["board", "journeys", "funnels"],
      outreach: ["engage", "dms", "invites", "people", "threads", "places", "accounts", "dm-copy"],
      pipeline: ["companies", "stalls"],
      marketing: [
        "plan",
        "studio",
        "pieces",
        "content",
        "overview",
        "feed",
        "topics",
        "facts",
        "drafts",
        "write",
        "videos",
        "explore",
        "today",
        "digest",
        "metrics",
        "cadence",
        "reports",
      ],
    };
    expect(Object.keys(stay).sort()).toEqual(Object.keys(MOVED_APPS).sort());
    for (const [old, now] of Object.entries(MOVED_APPS)) {
      const m = teamModules.find((x) => x.id === now);
      expect(m, now).toBeDefined();
      for (const id of stay[old] ?? []) {
        expect(
          m?.pages.map((p) => p.id),
          `${old}/${id} -> ${now}/${id}`,
        ).toContain(id);
        expect(movedTo(`/${old}/${id}`, WREN), `${old}/${id}`).toBe(`/${now}/${id}`);
      }
    }
    // A client's Journeys moved with the app.
    expect(clientModules.find((m) => m.id === "pipelines")?.pages.map((p) => p.id)).toContain(
      "journeys",
    );
  });

  it("holds the apps a client also serves, and only those, to Wren", () => {
    const olds = new Set([...Object.keys(MOVED).map(appOf), ...Object.keys(MOVED_APPS)]);
    const heldNow = [...olds].filter((id) => clientModules.some((m) => m.id === id));
    expect([...CLIENT_HELD].sort()).toEqual(heldNow.sort());
  });

  it("serves no old address of a blanket entry from a client's apps", () => {
    for (const from of Object.keys(MOVED)) {
      if (CLIENT_HELD.has(appOf(from))) continue;
      const served = clientModules.find((m) => m.id === appOf(from));
      expect(
        served?.pages.find((p) => p.id === pageOf(from)),
        from,
      ).toBeUndefined();
    }
    for (const old of Object.keys(MOVED_APPS))
      if (!CLIENT_HELD.has(old)) expect(clientModules.map((m) => m.id)).not.toContain(old);
  });

  it("lets a client's Marketing keep every page it had", () => {
    const client = clientModules.find((m) => m.id === "marketing");
    // Written out from the app before the reshape (origin/main): (id, record, template).
    expect(
      client?.pages.map((p) => [
        p.id,
        "record" in p ? p.record : null,
        "template" in p ? p.template : null,
      ]),
    ).toEqual([
      ["inbox", "marketing.inbox", "list"],
      ["auto-reply", null, null],
      ["reviews", "marketing.review", "list"],
      ["approve", "marketing.asked_reply", "list"],
      ["drafts", "marketing.draft", "list"],
      ["content", "marketing.post", "list"],
      ["ads", "marketing.ad_day", "list"],
      ["search", "marketing.search_page", "list"],
      ["keywords", "marketing.keyword", "list"],
      ["reports", null, null],
    ]);
  });
});

describe("link-only pages", () => {
  it("each light a tab that shows, in its own app", () => {
    for (const id of ["content", "engage", "analytics", "inbox", "outbound"]) {
      const m = teamModules.find((x) => x.id === id);
      const tabs = new Set(m?.pages.filter((p) => !p.hidden).map((p) => p.id));
      for (const p of m?.pages.filter((x) => x.hidden) ?? [])
        if (p.lights) expect(tabs, `${id}/${p.id} lights ${p.lights}`).toContain(p.lights);
    }
  });
});

describe("addresses in the apps", () => {
  const upto = (href: string) => href.split(/[?#]/)[0] ?? "";
  const hrefsOf = (m: (typeof MODULES)[number]) =>
    m.pages.flatMap((p) => [
      ...("tiles" in p ? p.tiles.map((t) => t.href) : []),
      ...("top" in p ? (p.top ?? []).map((t) => t.href) : []),
      ...("sources" in p ? p.sources.map((s) => s.open) : []),
    ]);

  it("no tile, top list or day source points at a moved address", () => {
    for (const m of MODULES)
      for (const href of hrefsOf(m))
        expect(movedTo(upto(href), { atWren: isTeam(m) }), `${m.id}: ${href}`).toBeNull();
  });

  it("no source file names an old address", () => {
    const here = new URL(".", import.meta.url).pathname;
    const files = readdirSync(here, { recursive: true, encoding: "utf8" }).filter(
      (f) =>
        /\.tsx?$/.test(f) &&
        !/\.test\.tsx?$/.test(f) &&
        f !== "moved.ts" &&
        // A client's own addresses: its Marketing, and Wren's thread link in Notes.
        f !== "modules/notes/mentions.tsx" &&
        f !== "pages-client.stories.tsx",
    );
    const old = [...Object.keys(MOVED), ...Object.keys(MOVED_APPS).map((k) => `/${k}`)];
    const hits: string[] = [];
    for (const f of files) {
      // Code only: a comment may say where a page was.
      const text = readFileSync(`${here}${f}`, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\/?\*)/.test(l))
        .join("\n");
      for (const k of old)
        if (new RegExp(`["'\`]${k}(?![A-Za-z0-9_-])`).test(text)) hits.push(`${f}: ${k}`);
    }
    expect(hits).toEqual([]);
  });
});
