/** Every app sits in one area, and an area shows only the apps a workspace has. */
import { describe, expect, it } from "vitest";
import { AREAS, areasOf, dockOf, pageIcon, phoneTabsOf } from "./areas.js";

// The apps read the page's address as they load; a bare one does here.
Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { MODULES } = await import("./modules/index.js");

describe("areas", () => {
  it("names every app but the menu ones, each once", () => {
    const named = AREAS.flatMap((a) => a.apps);
    expect(new Set(named).size).toBe(named.length);
    for (const m of MODULES.filter((x) => !x.menu)) expect(named, m.id).toContain(m.id);
  });

  it("keeps area order, skips empty areas, puts an unnamed app under Tools", () => {
    const apps = [{ id: "notes" }, { id: "new-app" }, { id: "inbox" }, { id: "money" }];
    expect(areasOf(apps).map((a) => [a.area.id, a.apps.map((m) => m.id)])).toEqual([
      ["inbox", ["inbox"]],
      ["business", ["money"]],
      ["tools", ["notes", "new-app"]],
    ]);
  });

  it("docks the daily pages a workspace has, then its first apps", () => {
    const pages = (...ids: string[]) => ids.map((id) => ({ id }));
    const wren = [
      { id: "notes", pages: pages("home") },
      { id: "inbox", pages: pages("overview") },
      { id: "marketing", pages: pages("plan", "studio", "engage") },
    ];
    expect(dockOf(wren).map((d) => d.pick.page ?? d.app.id)).toEqual(["inbox", "studio", "engage"]);
    const client = [
      { id: "notes", pages: pages("home") },
      { id: "money", pages: pages("x") },
    ];
    expect(dockOf(client).map((d) => d.app.id)).toEqual(["money", "notes"]);
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
    const tabs = [t("pieces"), t("plan"), t("studio"), t("engage"), t("a", "G", 2), t("b", "G", 3)];
    const out = phoneTabsOf("marketing", tabs);
    expect(out.map((x) => [x.id, x.label, x.holds])).toEqual([
      ["plan", "plan", ["plan"]],
      ["studio", "studio", ["studio"]],
      ["engage", "engage", ["engage"]],
      ["pieces", "pieces", ["pieces"]],
      ["a", "G", ["a", "b"]],
    ]);
    expect(out[4]?.count).toBe(5);
  });
  it("skips picks the workspace lacks", () => {
    expect(phoneTabsOf("inbox", [t("overview"), t("done")]).map((x) => x.label)).toEqual([
      "All",
      "done",
    ]);
  });
  it("names an icon from the page", () => {
    expect(pageIcon("calls")).toBe("phone");
    expect(pageIcon("zzz")).toBe("list");
  });
});
