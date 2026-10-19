/** Every app sits in one area, and an area shows only the apps a workspace has. */
import { describe, expect, it } from "vitest";
import { AREAS_CLIENT, AREAS_TEAM, areasOf, dockOf, pageIcon, phoneTabsOf } from "./areas.js";

// The apps read the page's address as they load; a bare one does here.
Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { MODULES } = await import("./modules/index.js");

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

  it("docks the daily pages a team has, then its first apps", () => {
    const pages = (...ids: string[]) => ids.map((id) => ({ id }));
    const wren = [
      { id: "notes", pages: pages("home") },
      { id: "inbox", pages: pages("mail") },
      { id: "pipelines", pages: pages("board") },
      { id: "content", pages: pages("plan", "studio", "pieces") },
      { id: "engage", pages: pages("engage", "dms") },
    ];
    expect(dockOf(wren, true).map((d) => d.pick.page ?? d.app.id)).toEqual([
      "pipelines",
      "studio",
      "engage",
    ]);
    // A parked app never docks, even as a first app.
    const bare = [{ id: "notes", parked: true as const, pages: pages("home") }, wren[1]];
    expect(dockOf(bare as typeof wren, true).map((d) => d.app.id)).toEqual(["inbox"]);
  });

  it("docks a client's first apps by area, with no daily picks", () => {
    const pages = (...ids: string[]) => ids.map((id) => ({ id }));
    const client = [
      { id: "notes", pages: pages("home") },
      { id: "marketing", pages: pages("inbox") },
      { id: "money", pages: pages("x") },
    ];
    expect(dockOf(client, false).map((d) => d.app.id)).toEqual(["marketing", "money", "notes"]);
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
