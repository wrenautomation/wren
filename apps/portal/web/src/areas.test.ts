/** Every app sits in one area, and an area shows only the apps a workspace has. */
import { describe, expect, it } from "vitest";
import {
  AREAS_CLIENT,
  AREAS_TEAM,
  areasOf,
  dockOf,
  pageIcon,
  phoneTabsOf,
  SIDEBAR,
  sidebarOf,
} from "./areas.js";

// The apps read the page's address as they load; a bare one does here.
Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { MODULES, appsIn } = await import("./modules/index.js");

const team = (m: { requires?: { audience?: string } }) => m.requires?.audience === "team";

describe("areas", () => {
  it("names every team app but the menu and parked ones, each once", () => {
    const named = AREAS_TEAM.flatMap((a) => a.apps);
    expect(new Set(named).size).toBe(named.length);
    for (const m of MODULES.filter((x) => team(x) && !x.menu && !x.parked))
      expect(named, m.id).toContain(m.id);
    for (const m of MODULES.filter((x) => team(x) && x.parked))
      expect(named, m.id).not.toContain(m.id);
  });

  it("names every client app but the menu ones, each once", () => {
    const named = AREAS_CLIENT.flatMap((a) => a.apps);
    expect(new Set(named).size).toBe(named.length);
    for (const m of MODULES.filter((x) => !team(x) && !x.menu)) expect(named, m.id).toContain(m.id);
  });

  it("parks Wren's dormant apps, and no client's", () => {
    expect(
      MODULES.filter((m) => m.parked)
        .map((m) => `${m.id} ${team(m)}`)
        .sort(),
    ).toEqual(["learn true", "notes true", "voice true"]);
  });

  it("shows the team Today's neighbours: Primary, Marketing, then Tools shut", () => {
    expect(AREAS_TEAM.map((a) => [a.id, a.shut ?? false])).toEqual([
      ["primary", false],
      ["marketing", false],
      ["tools", true],
    ]);
  });

  it("keeps area order, skips empty areas, puts an unnamed app under Tools", () => {
    const apps = [{ id: "calendar" }, { id: "new-app" }, { id: "pipelines" }, { id: "content" }];
    expect(areasOf(apps, true).map((a) => [a.area.id, a.apps.map((m) => m.id)])).toEqual([
      ["primary", ["pipelines"]],
      ["marketing", ["content"]],
      ["tools", ["calendar", "new-app"]],
    ]);
    const client = [{ id: "notes" }, { id: "new-app" }, { id: "inbox" }, { id: "money" }];
    expect(areasOf(client, false).map((a) => [a.area.id, a.apps.map((m) => m.id)])).toEqual([
      ["inbox", ["inbox"]],
      ["business", ["money"]],
      ["tools", ["notes", "new-app"]],
    ]);
  });

  it("leaves a parked app out of every area, and names none unnamed", () => {
    const apps = [
      { id: "notes", parked: true as const },
      { id: "learn", parked: true as const },
      { id: "calendar" },
    ];
    expect(areasOf(apps, true).flatMap((a) => a.apps.map((m) => m.id))).toEqual(["calendar"]);
  });

  it("fixes the sidebar at Inbox, People, Money, Admin, each an app that exists", () => {
    expect(SIDEBAR.map((i) => i.label)).toEqual(["Inbox", "People", "Money", "Admin"]);
    const wren = MODULES.filter(team);
    for (const i of SIDEBAR)
      expect(
        wren.map((m) => m.id),
        i.app,
      ).toContain(i.app);
  });

  it("gives Wren's team all four items, in order, and skips an app a workspace lacks", () => {
    const apps = ["settings", "money", "people", "inbox", "content"].map((id) => ({ id }));
    expect(sidebarOf(apps).map((i) => [i.label, i.app.id])).toEqual([
      ["Inbox", "inbox"],
      ["People", "people"],
      ["Money", "money"],
      ["Admin", "settings"],
    ]);
    // A client has no Inbox or Money app: People and Admin only.
    expect(
      sidebarOf([{ id: "people" }, { id: "marketing" }, { id: "settings" }]).map((i) => i.label),
    ).toEqual(["People", "Admin"]);
    expect(
      sidebarOf([{ id: "inbox", parked: true as const }, { id: "money" }]).map((i) => i.label),
    ).toEqual(["Money"]);
  });

  it("finds the real items in each workspace's apps", () => {
    const all = new Set(MODULES.flatMap((m) => (m.component ? [m.component] : [])));
    for (const wren of [true, false]) {
      const apps = appsIn(MODULES, { wren, team: wren, installed: all });
      expect(sidebarOf(apps).map((i) => i.label)).toEqual(
        wren ? ["Inbox", "People", "Money", "Admin"] : ["People", "Admin"],
      );
    }
  });

  it("docks Inbox, People, then the first pin that opens", () => {
    const apps = [{ id: "inbox" }, { id: "people" }, { id: "money" }, { id: "content" }];
    const pins = [{ href: "/content/studio" }, { href: "/engage/engage" }];
    expect(dockOf(apps, pins).map((d) => ("pin" in d ? d.pin.href : d.app.id))).toEqual([
      "inbox",
      "people",
      "/content/studio",
    ]);
    expect(dockOf(apps, [])).toHaveLength(2);
  });

  it("docks fewer when a workspace lacks an item, and never past the bar", () => {
    const client = [{ id: "people" }, { id: "settings" }];
    expect(
      dockOf(client, [{ href: "/marketing/content" }]).map((d) =>
        "pin" in d ? d.pin.href : d.app.id,
      ),
    ).toEqual(["people", "/marketing/content"]);
    // A parked app never docks.
    expect(dockOf([{ id: "inbox", parked: true as const }], [])).toEqual([]);
    const pins = [{ href: "/a" }, { href: "/b" }];
    expect(dockOf([{ id: "inbox" }, { id: "people" }], pins, 3)).toHaveLength(2);
  });
});

describe("phoneTabsOf", () => {
  const t = (id: string, group?: string, count?: number) => ({
    id,
    label: id,
    href: `/x/${id}`,
    ...(group ? { group } : {}),
    ...(count !== undefined ? { count } : {}),
  });
  it("leads with an app's picks, then a tab per page or group", () => {
    const tabs = [t("feed"), t("plan"), t("studio"), t("pieces"), t("a", "G", 2), t("b", "G", 3)];
    const out = phoneTabsOf("content", tabs);
    expect(out.map((x) => [x.id, x.label, x.holds])).toEqual([
      ["plan", "plan", ["plan"]],
      ["studio", "studio", ["studio"]],
      ["pieces", "pieces", ["pieces"]],
      ["feed", "feed", ["feed"]],
      ["a", "G", ["a", "b"]],
    ]);
    expect(out[4]?.count).toBe(5);
  });
  it("gives Engage its daily three: Engage, DMs, Invites", () => {
    const tabs = [t("people"), t("invites"), t("dms"), t("engage")];
    expect(phoneTabsOf("engage", tabs).map((x) => x.label)).toEqual([
      "engage",
      "DMs",
      "invites",
      "people",
    ]);
  });
  it("skips picks the workspace lacks", () => {
    expect(phoneTabsOf("engage", [t("engage"), t("approve")]).map((x) => x.label)).toEqual([
      "engage",
      "approve",
    ]);
  });
  it("names an icon from the page", () => {
    expect(pageIcon("calls")).toBe("phone");
    expect(pageIcon("zzz")).toBe("list");
  });
});
