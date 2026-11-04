/** The sidebar is the places, in order; a workspace shows the ones it has. */
import { describe, expect, it } from "vitest";
import { areasOf, dockOf, PLACES, pageIcon, phoneTabsOf, sidebarOf } from "./areas.js";

// The apps read the page's address as they load; a bare one does here.
Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { MODULES, appsIn } = await import("./modules/index.js");

const ALL = new Set(
  MODULES.flatMap((m) => [m.component, ...m.pages.map((p) => p.component)]).filter(
    (c): c is string => !!c,
  ),
);
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);

describe("the places", () => {
  it("gives Wren's team the eight places, in order", () => {
    const apps = appsIn(MODULES, { wren: true, team: true, installed: ALL });
    expect(sidebarOf(apps).map((i) => i.label)).toEqual([
      "Map",
      "Campaigns",
      "Content",
      "People",
      "Inbox",
      "Calendar",
      "Research",
      "Back office",
    ]);
  });

  it("gives a client every place but Research", () => {
    const apps = appsIn(MODULES, { wren: false, team: false, installed: ALL });
    expect(sidebarOf(apps).map((i) => i.app.id)).toEqual(
      PLACES.map((p) => p.app).filter((id) => id !== "research"),
    );
  });

  it("shows no app outside a place, and no parked app", () => {
    for (const wren of [true, false]) {
      const apps = appsIn(MODULES, { wren, team: wren, installed: ALL });
      const areas = areasOf(apps);
      expect(ids(areas.map((a) => a.area))).toEqual(["places"]);
      expect(areas.flatMap((a) => ids(a.apps)).every((id) => apps.some((m) => m.id === id))).toBe(
        true,
      );
    }
    expect(
      sidebarOf([{ id: "inbox", parked: true as const }, { id: "map" }]).map((i) => i.label),
    ).toEqual(["Map"]);
  });

  it("drops a client's page whose product it lacks, and a place left empty", () => {
    const apps = appsIn(MODULES, { wren: false, team: false, installed: new Set() });
    const campaigns = apps.find((m) => m.id === "campaigns");
    expect(campaigns?.pages.some((p) => p.id === "run")).toBeFalsy();
  });

  it("docks Inbox, Calendar, Content, People, then the first pin", () => {
    const apps = ["map", "people", "content", "calendar", "inbox", "office"].map((id) => ({ id }));
    const pins = [{ href: "/content/studio" }, { href: "/campaigns/engage" }];
    expect(dockOf(apps, pins).map((d) => ("pin" in d ? d.pin.href : d.app.id))).toEqual([
      "inbox",
      "calendar",
      "content",
      "people",
      "/content/studio",
    ]);
    expect(dockOf(apps, [])).toHaveLength(4);
    expect(dockOf(apps, pins, 3)).toHaveLength(2);
    expect(dockOf([{ id: "inbox", parked: true as const }], [])).toEqual([]);
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
  it("gives Inbox its daily three: Today, Messages, Approve", () => {
    const tabs = [t("overview"), t("approve"), t("messages"), t("today")];
    expect(phoneTabsOf("inbox", tabs).map((x) => x.id)).toEqual([
      "today",
      "messages",
      "approve",
      "overview",
    ]);
  });
  it("skips picks the workspace lacks", () => {
    expect(phoneTabsOf("campaigns", [t("engage"), t("ads")]).map((x) => x.id)).toEqual([
      "engage",
      "ads",
    ]);
  });
  it("names an icon from the page", () => {
    expect(pageIcon("calls")).toBe("phone");
    expect(pageIcon("zzz")).toBe("list");
  });
});
