import { describe, expect, it } from "vitest";
import {
  atWrenOf,
  CLIENT_MOVED,
  heldByClient,
  MOVED,
  MOVED_APPS,
  movedTo,
  namedIn,
} from "./moved.js";

// The apps read the page's address as they load; a bare one does here.
Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { MODULES } = await import("./modules/index.js");
const { CLIENT_PLACES, TEAM_PLACES, wasOf } = await import("./modules/places.js");

const WREN = { atWren: true };
const CLIENT = { atWren: false };
const isTeam = (m: { requires?: { audience?: string } | undefined }) =>
  m.requires?.audience === "team";
const live = (team: boolean) =>
  new Set(
    MODULES.filter((m) => isTeam(m) === team).flatMap((m) =>
      m.pages.map((p) => `/${m.id}/${p.id}`),
    ),
  );
const TEAM_LIVE = live(true);
const CLIENT_LIVE = live(false);
const pathOf = (href: string) => href.split(/[?#]/)[0]?.split("/").slice(0, 3).join("/") ?? "";

describe("movedTo", () => {
  it("sends a page to its place, keeping the rest of the path, search and hash", () => {
    expect(movedTo("/engage/dms/12?view=all#x", WREN)).toBe("/today/dms/12?view=all#x");
    expect(movedTo("/campaigns/email", WREN)).toBe("/outbound/overview");
    expect(movedTo("/clients/all?view=live", WREN)).toBe("/clients/clients?view=live");
    expect(movedTo("/work/needs-you", CLIENT)).toBe("/today/needs-you");
    expect(movedTo("/map/plan/3", CLIENT)).toBe("/project/plan/3");
    expect(movedTo("/account/people", CLIENT)).toBe("/office/team");
  });

  it("sends an older address straight to the page's place: one hop", () => {
    expect(movedTo("/marketing/dms/5", WREN)).toBe("/today/dms/5");
    expect(movedTo("/outreach/inbox", WREN)).toBe("/today/messages");
    expect(movedTo("/inbox/waiting", WREN)).toBe("/today/messages");
    expect(movedTo("/reactivation/plan", CLIENT)).toBe("/project/plan");
  });

  it("sends a gone app's other pages, and the app itself, to its place", () => {
    expect(movedTo("/inbox/replies/4", WREN)).toBe("/today/replies/4");
    expect(movedTo("/calendar/schedule?d=2026-11-04", WREN)).toBe("/today/calendar?d=2026-11-04");
    expect(movedTo("/inbox", WREN)).toBe("/today");
    expect(movedTo("/campaigns/emails?view=sent", CLIENT)).toBe("/reactivation/emails?view=sent");
    expect(heldByClient("/marketing/drafts")).toBe(false);
  });

  it("leaves every live address alone", () => {
    expect(movedTo("/content/plan", WREN)).toBeNull();
    expect(movedTo("/today/approve", CLIENT)).toBeNull();
    expect(movedTo("/outbound/engage", WREN)).toBeNull();
    expect(movedTo("/map/station/booked", WREN)).toBeNull();
    expect(movedTo("/marketingx/plan", WREN)).toBeNull();
    expect(movedTo("/", WREN)).toBeNull();
  });
});

describe("who is at Wren", () => {
  it("is the team, unless a link names a client", () => {
    expect(atWrenOf(true, null)).toBe(true);
    expect(atWrenOf(true, "acme")).toBe(false);
    expect(atWrenOf(false, null)).toBe(false);
    expect(namedIn("/content/plan?client=acme")).toBe("acme");
    expect(namedIn("/content/plan?view=all")).toBeNull();
  });
});

describe("the move table", () => {
  it("moves no address that is live", () => {
    for (const from of [...Object.keys(MOVED), ...Object.keys(CLIENT_MOVED)]) {
      expect(TEAM_LIVE.has(from), from).toBe(false);
      expect(CLIENT_LIVE.has(from), from).toBe(false);
    }
    const apps = new Set(MODULES.map((m) => m.id));
    for (const old of Object.keys(MOVED_APPS)) expect(apps.has(old), old).toBe(false);
  });

  it("lands every move on a live page, in one hop", () => {
    for (const [from, to] of Object.entries(MOVED)) {
      expect(TEAM_LIVE.has(to) || CLIENT_LIVE.has(to), `${from} -> ${to}`).toBe(true);
      expect(movedTo(to, WREN), to).toBeNull();
      expect(movedTo(to, CLIENT), to).toBeNull();
    }
    for (const [from, to] of Object.entries(CLIENT_MOVED))
      expect(CLIENT_LIVE.has(to), `${from} -> ${to}`).toBe(true);
    for (const to of Object.values(MOVED_APPS)) expect(movedTo(`/${to}`, WREN)).toBeNull();
  });

  it("lands every place page's old address on that page", () => {
    for (const [places, at] of [
      [TEAM_PLACES, WREN],
      [CLIENT_PLACES, CLIENT],
    ] as const)
      for (const [was, now] of places.flatMap(wasOf))
        expect(was === now ? null : pathOf(movedTo(was, at) ?? ""), was).toBe(
          was === now ? null : now,
        );
  });
});
