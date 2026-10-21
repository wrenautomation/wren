/**
 * The Map on the fake server (designs/2026-10-21-design-language-d.md, part D3a): Wren's Home for
 * the team, the shape drawn by the metro renderer down the whole page. Today is a sheet over it (a
 * tab on a phone). A part opens its panel, a draft opens with its marks, History draws a compare.
 * Hover, click and Apply run in `play`. `pnpm --filter @wren/portal storybook`.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, spyOn, userEvent, waitFor, within } from "storybook/test";
import { TodayTasks } from "./map/TodayTasks.js";
import type { Task } from "./map/tasks.js";
import { freshStory, refuse } from "./mocks/api.js";
import { ANSWERS } from "./mocks/data/index.js";
import { SHAPE_GRAPH } from "./mocks/data/journeys.js";
import {
  FILE_TEXT,
  forgetMapCalls,
  liveShape,
  MAP_CALLS,
  planAnswers,
  SHAPE_HUB_CLASH,
  shapeAnswers,
} from "./mocks/data/map.js";
import { REFUSED_UNDO } from "./mocks/data/map-drafts.js";
import { ADMIN } from "./mocks/data/me.js";
import { type PageAt, pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Pages/Map" };
export default meta;

/** The layout is async: a station shows when the renderer has placed it. */
const LATE = { timeout: 10_000 };
/** The drawn map: the renderer's svg, apart from Today's task buttons that share a name. */
const mapOf = async (page: HTMLElement) => {
  const svg = await waitFor(() => {
    const el = page.querySelector<HTMLElement>("svg[role='group']");
    if (!el) throw new Error("The map is not drawn yet.");
    return el;
  }, LATE);
  return within(svg);
};

/**
 * A station of the map, by the start of its name: "Engaged, 5 now" is found by "Engaged". A phone
 * folds the map by its width, so the zoom goes to Stations first and every station shows.
 */
const station = async (page: HTMLElement, name: RegExp | string) => {
  const zoom = await within(page).findByRole("group", { name: "Zoom level" }, LATE);
  const stations = within(zoom).getByRole("button", { name: "Stations" });
  if (stations.getAttribute("aria-pressed") !== "true") await userEvent.click(stations);
  return (await mapOf(page)).findByRole(
    "button",
    { name: new RegExp(`^${typeof name === "string" ? name : name.source}`) },
    LATE,
  );
};

type Reply = (b: Record<string, unknown>) => unknown;
const SHARED = {
  get: ANSWERS["pipeline/recordsGet"] as Reply,
  list: ANSWERS["pipeline/recordsList"] as Reply,
};

const onPhone = () => matchMedia("(max-width: 900px)").matches;

/**
 * A Map story: nothing of an earlier story is left. The view a viewer keeps (zoom, folds, the open
 * panel) is in the browser store, and the call log outlives a story in one frame.
 */
const mapAt = (at: string, opts: PageAt = {}) => ({
  ...pageAt(at, { me: ADMIN, ...opts }),
  beforeEach: () => {
    freshStory();
    forgetMapCalls();
    for (const k of Object.keys(localStorage))
      if (k.startsWith("map:view:")) localStorage.removeItem(k);
  },
});

/**
 * Home for the team: the shape's lines, stations and tracks, the hub with its lead count, and the
 * ghost, a part an older version had that one person still sits on, in a note above the map. The
 * Map is the whole page; Today waits behind its header button.
 */
export const Default = mapAt("/", {
  check: async (page) => {
    for (const name of ["Spring list", "Winter ads", "Engaged", "Booked", "Signed"])
      await station(page, name);
    await expect(await within(page).findByRole("heading", { name: "Map" })).toBeVisible();
    // The hub reads its lead count.
    await expect(await station(page, "First touch")).toHaveAccessibleName("First touch, 18 leads");
    // The ghost holds its one person.
    await expect(within(page).getByRole("button", { name: "Open Joined" })).toBeVisible();
    // Today is no column beside the Map: closed, it takes no room (on a phone it is a tab).
    await expect(within(page).queryByRole("heading", { name: "Today", level: 1 })).toBeNull();
    if (!onPhone()) {
      await expect(within(page).queryByRole("heading", { name: /^Write/ })).toBeNull();
      const map = within(page).getByRole("region", { name: "Map" });
      // Edge to edge of the window, which sits 10px in from the screen (--ui-frame).
      await expect(Math.round(map.getBoundingClientRect().right)).toBeGreaterThanOrEqual(
        innerWidth - 12,
      );
    }
  },
});

/** Today opens as a sheet over the Map from its header; a task opens its track. */
export const TodaySheet = {
  ...mapAt("/", {
    check: async (page) => {
      await station(page, "Engaged");
      const open = within(page).getByRole("button", { name: "Today" });
      await expect(open).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(open);
      const sheet = await within(document.body).findByRole("dialog", { name: "Today" });
      await expect(await within(sheet).findByRole("heading", { name: /^Write/ })).toBeVisible();
      // The tasks sit at the top: the late one first.
      const tasks = await within(sheet).findAllByRole("button", { name: /waiting at/ });
      await expect(tasks[0]).toHaveTextContent("Booked");
      await expect(tasks[0]).toHaveTextContent(/Late · promise 4h/);
      // A task opens its track panel and closes the sheet.
      await userEvent.click(tasks[0] as HTMLElement);
      const panel = await within(page).findByRole("region", { name: "Engaged to Booked, details" });
      await expect(within(panel).getByText("Moved by Ada North")).toBeVisible();
    },
  }),
  globals: { viewport: { value: "desktop" } },
};

/** Dark theme: the Map wears the app's tokens, nothing forces a look of its own. */
export const Dark = {
  ...mapAt("/", {
    check: async (page) => {
      await station(page, "Engaged");
      await expect(within(page).getByRole("region", { name: "Map" })).toBeVisible();
    },
  }),
  globals: { theme: "dark" },
};

/** The window is in the address; 7 days is lit and the numbers are the window's. */
export const Window = mapAt("/?window=7", {
  check: async (page) => {
    await station(page, "Engaged");
    await expect(within(page).getByRole("link", { name: "7 days" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
});

/** A shape stored as the runtime graph still draws: the server lowers it to the map. */
export const GraphLive = mapAt("/", {
  answers: liveShape(SHARED, SHAPE_GRAPH),
  check: async (page) => {
    for (const name of ["Engaged", "Booked", "Signed"]) await station(page, name);
  },
});

const NONE = {
  "pipeline/recordsGet": (b: Record<string, unknown>) =>
    b.record === "pipeline.shape"
      ? { record: "pipeline.shape", row: null, detail: null }
      : SHARED.get(b),
  "pipeline/recordsList": (b: Record<string, unknown>) =>
    String(b.record).startsWith("pipeline.")
      ? {
          record: String(b.record),
          view: null,
          rows: [],
          total: 0,
          counts: {},
          next: null,
          totals: {},
        }
      : SHARED.list(b),
};

/** No shape yet: one line and the start, ready for a login that may edit. */
export const Empty = mapAt("/", {
  answers: NONE,
  check: async (page) => {
    await expect(await within(page).findByText(/^No shape yet/)).toBeVisible();
    await expect(
      within(page).getByRole("button", { name: "Start from Wren's shape" }),
    ).toBeEnabled();
    await expect(within(page).getByRole("list", { name: "Parts of a shape" })).toBeVisible();
  },
});

/** A login that only reads cannot start one, and the page says so. */
export const EmptyReadOnly = mapAt("/", {
  me: { ...ADMIN, team: { role: "viewer", wren: ["read"], flags: {} } },
  answers: NONE,
  check: async (page) => {
    await expect(await within(page).findByText(/^No shape yet/)).toBeVisible();
    await expect(
      within(page).getByRole("button", { name: "Start from Wren's shape" }),
    ).toBeDisabled();
    await expect(within(page).getByText("You need edit access to start a shape.")).toBeVisible();
  },
});

/** Start from Wren's shape: one click imports the starter, and the Map draws it. */
export const EmptyStart = mapAt("/", {
  answers: liveShape(SHARED, null),
  check: async (page) => {
    const start = await within(page).findByRole("button", { name: "Start from Wren's shape" });
    await userEvent.click(start);
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeStart"]));
    await station(page, "Engaged");
    await expect(within(page).queryByText(/^No shape yet/)).toBeNull();
  },
});

/** A shape the map cannot draw says so, with the server's reasons, and the page still works. */
export const CannotDraw = mapAt("/", {
  answers: shapeAnswers(SHARED, SHAPE_HUB_CLASH),
  check: async (page) => {
    await expect(
      await within(page).findByText("This shape cannot be drawn on the map."),
    ).toBeVisible();
    const why = within(page).getByRole("list", { name: "Why" });
    await expect(within(why).getAllByRole("listitem").length).toBeGreaterThan(0);
    await expect(within(page).queryByRole("group", { name: /./ })).toBeNull();
    // History and Export still answer for the shape.
    await expect(within(page).getByRole("button", { name: /History/ })).toBeVisible();
  },
});

/** Click a station: its details open as a card over the map, people newest first, each a link. */
export const StationPanel = mapAt("/", {
  check: async (page) => {
    await userEvent.click(await station(page, "Engaged"));
    const panel = await within(page).findByRole("region", { name: "Engaged, details" });
    const people = within(panel)
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/pipelines/journeys/"));
    await expect(people.map((a) => a.textContent)).toEqual([
      expect.stringContaining("Ada North"),
      expect.stringContaining("Bo Fenwick"),
    ]);
    await expect(people[0]).toHaveAttribute("href", "/pipelines/journeys/j1");
    await expect(within(panel).getByText("Numbers in the last 30 days.")).toBeVisible();
    const open = within(panel).getByRole("link", { name: "Open" });
    await expect(open).toHaveAttribute("href", "/pipelines/journeys?node=engaged&view=all");
    // A track of the station opens that track.
    await userEvent.click(within(panel).getByRole("button", { name: "Track to Booked" }));
    await expect(
      await within(page).findByRole("region", { name: "Engaged to Booked, details" }),
    ).toBeVisible();
  },
});

/** The hub holds the lead count and a link to People. */
export const HubPanel = mapAt("/", {
  check: async (page) => {
    await userEvent.click(await station(page, "First touch"));
    const panel = await within(page).findByRole("region", { name: "First touch, details" });
    await expect(within(panel).getByText(/18/)).toBeVisible();
    await expect(within(panel).getByRole("link", { name: "Open People" })).toHaveAttribute(
      "href",
      "/people/people",
    );
  },
});

/** A track opened by its address: who moves it, its promise, who waits and that they are late. */
export const TrackPanel = mapAt("/?track=engaged_to_booked", {
  check: async (page) => {
    const panel = await within(page).findByRole("region", { name: "Engaged to Booked, details" });
    await expect(within(panel).getByText("Moved by Ada North")).toBeVisible();
    await expect(within(panel).getByText("Promise 4h")).toBeVisible();
    await expect(within(panel).getByText(/waiting at Engaged/)).toHaveTextContent("Late");
    await expect(within(panel).getByText(/^Crossed: \d+/)).toBeVisible();
    await expect(await within(panel).findByRole("region", { name: "Track history" })).toBeVisible();
  },
});

/** A line opens from its chip on a station: its money, and its stations as buttons. */
export const LinePanel = mapAt("/", {
  check: async (page) => {
    await userEvent.click(await station(page, "Signed"));
    const station_ = await within(page).findByRole("region", { name: "Signed, details" });
    await userEvent.click(within(station_).getByRole("button", { name: "Line Signed" }));
    const panel = await within(page).findByRole("region", { name: "Signed, details" });
    await expect(within(panel).getByText("Core line")).toBeVisible();
    await expect(within(panel).getByText(/^Deals: 2/)).toBeVisible();
    await userEvent.click(within(panel).getByRole("button", { name: "Station Signed" }));
    await expect(
      await within(page).findByRole("region", { name: "Signed, details" }),
    ).toBeVisible();
  },
});

/** The view a viewer kept comes back: the panel they left open opens again on return. */
export const KeptPanel = {
  ...mapAt("/", {
    check: async (page) => {
      const panel = await within(page).findByRole("region", { name: "Booked, details" }, LATE);
      await expect(panel).toBeVisible();
      // A pick is kept for the next visit.
      await userEvent.click(await station(page, "Engaged"));
      await within(page).findByRole("region", { name: "Engaged, details" });
      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem("map:view:@wren") ?? "{}").panel).toEqual({
          kind: "station",
          id: "engaged",
        }),
      );
    },
  }),
  beforeEach: () => {
    freshStory();
    forgetMapCalls();
    localStorage.setItem(
      "map:view:@wren",
      JSON.stringify({ panel: { kind: "station", id: "booked" } }),
    );
  },
};

/** A ghost's panel lists the person who sits on the dropped station. */
export const Ghost = mapAt("/", {
  check: async (page) => {
    await userEvent.click(await within(page).findByRole("button", { name: "Open Joined" }));
    const panel = await within(page).findByRole("region", { name: "Joined, details" });
    await expect(within(panel).getByText("Dropped from the newest version")).toBeVisible();
    await expect(within(panel).getByRole("link", { name: /Gus Held/ })).toBeVisible();
  },
});

/** A plan after the offer shows as a station, and the loop back from Booked is a track. */
export const Plan = mapAt("/", {
  answers: planAnswers(SHARED),
  check: async (page) => {
    await expect(await station(page, "Standard plan")).toHaveAccessibleName(
      /^Standard plan, 3 now/,
    );
  },
});

/** On a phone the Map fills the width and Today is a tab under it, open. */
export const Phone = {
  ...mapAt("/", {
    check: async (page) => {
      await station(page, "Engaged");
      const tab = within(page).getByRole("button", { name: /Today/ });
      await expect(tab).toHaveAttribute("aria-expanded", "true");
      await expect(await within(page).findByRole("heading", { name: /^Write/ })).toBeVisible();
      // Closing the tab hides Today and leaves the Map as it was.
      await userEvent.click(tab);
      await expect(tab).toHaveAttribute("aria-expanded", "false");
      await expect(within(page).queryByRole("heading", { name: /^Write/ })).toBeNull();
    },
  }),
  globals: { viewport: { value: "phone" } },
};

// --- history: versions, compare, restore, tags, undo --------------------------------------------

const openHistory = async (page: HTMLElement) => {
  await station(page, "Engaged");
  await userEvent.click(within(page).getByRole("button", { name: /History/ }));
  return within(page).findByRole("region", { name: "History" });
};
const pickBoth = async (panel: HTMLElement) => {
  const versions = within(panel).getAllByRole("button", { name: /^Version \d/ });
  await userEvent.click(versions[0] as HTMLElement);
  await userEvent.click(versions[1] as HTMLElement);
  return within(panel).findByRole("region", { name: "Changes" }, LATE);
};

/** History: pick version 1 and 2, and the Map draws the difference: Joined removed, a track added. */
export const History = mapAt("/", {
  check: async (page) => {
    const panel = await openHistory(page);
    const versions = within(panel).getAllByRole("button", { name: /^Version \d/ });
    await expect(versions.map((v) => v.textContent)).toEqual([
      expect.stringContaining("Version 2"),
      expect.stringContaining("Version 1"),
    ]);
    const changes = await pickBoth(panel);
    await expect(await within(changes).findByText("Removed station Joined.")).toBeVisible();
    await expect(within(changes).getByText("Added track Engaged to Booked.")).toBeVisible();
    // The older side's station is drawn, marked removed; the new track is marked added.
    await expect(await station(page, "Joined, removed")).toBeVisible();
    const drawn = await mapOf(page);
    // The added track carries a person, so it draws as that person's pill.
    await expect(
      await drawn.findByRole("button", { name: /^Person task, .*, added$/ }, LATE),
    ).toBeVisible();
    await expect(
      await drawn.findByRole("img", { name: "Track from Joined to Booked, removed" }, LATE),
    ).toBeInTheDocument();
  },
});

/** Restore on an older version shows what it changes, then saves a new version from it, no body. */
export const HistoryRestore = mapAt("/", {
  answers: liveShape(SHARED),
  check: async (page) => {
    const panel = await openHistory(page);
    await userEvent.click(within(panel).getByRole("button", { name: "Restore version 1" }));
    const restore = await within(panel).findByRole("region", { name: "Restore version 1" });
    await expect(await within(restore).findByText("Added station Joined.")).toBeVisible();
    await userEvent.click(within(restore).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeVersion"]));
    const sent = MAP_CALLS[0]?.body as Record<string, unknown>;
    await expect(sent).toMatchObject({ from: 1, note: "Restore v1" });
    await expect(sent).not.toHaveProperty("body");
    // The restore is the newest version now.
    await userEvent.click(within(page).getByRole("button", { name: /History/ }));
    await userEvent.click(within(page).getByRole("button", { name: /History/ }));
    const again = await within(page).findByRole("region", { name: "History" });
    await expect(await within(again).findByText("Restore v1")).toBeVisible();
  },
});

/** A compare the server cannot draw (no views) lists the changes and draws no marks. */
export const HistoryNoViews = mapAt("/", {
  answers: {
    "pipeline/shapeDiff": (b: Record<string, unknown>) => ({
      a: b.a,
      b: b.b,
      diff: {
        nodes: { added: [], removed: [], changed: [] },
        edges: { added: [], removed: [], changed: [] },
      },
      changes: [{ key: "station:joined:removed", line: "Removed station Joined." }],
      views: null,
      marks: null,
    }),
  },
  check: async (page) => {
    const panel = await openHistory(page);
    const changes = await pickBoth(panel);
    await expect(await within(changes).findByText("Removed station Joined.")).toBeVisible();
    await expect(within(page).queryByRole("img", { name: /, added$/ })).toBeNull();
  },
});

/** Each version shows its tags and its commit in the git mirror, a short sha that opens the commit. */
export const HistoryTagged = mapAt("/", {
  check: async (page) => {
    const panel = await openHistory(page);
    await expect(within(panel).getByText("launch")).toBeVisible();
    const sha = within(panel).getByRole("link", { name: "Version 2 commit 9f3c2a1" });
    await expect(sha).toHaveTextContent("9f3c2a1");
    await expect(sha).toHaveAttribute("href", "https://example.test/shape/commit/9f3c2a1");
    await expect(sha).toHaveAttribute("target", "_blank");
    await expect(
      within(panel).getByRole("link", { name: "Version 1 commit 1a2b3c4" }),
    ).toBeVisible();
  },
});

/** Tag a version: a name and a note, sent to the server; a tag has no edit and no delete. */
export const HistoryTag = mapAt("/", {
  answers: liveShape(SHARED),
  check: async (page) => {
    const panel = await openHistory(page);
    await userEvent.click(within(panel).getByRole("button", { name: "Tag version 1" }));
    const form = await within(panel).findByRole("form", { name: "Tag version 1" });
    await userEvent.type(within(form).getByRole("textbox", { name: "Tag name" }), "first-cut");
    await userEvent.type(
      within(form).getByRole("textbox", { name: "Tag note" }),
      "Before the plan",
    );
    await userEvent.click(within(form).getByRole("button", { name: "Save tag" }));
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeTag"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({
      name: "first-cut",
      version: 1,
      note: "Before the plan",
    });
  },
});

/** A login that only reads sees no Tag, Restore, Import or draft action. */
export const HistoryReadOnly = mapAt("/", {
  me: { ...ADMIN, team: { role: "viewer", wren: ["read"], flags: {} } },
  check: async (page) => {
    const panel = await openHistory(page);
    await expect(within(page).queryByRole("button", { name: "Import" })).toBeNull();
    await expect(within(panel).queryByRole("button", { name: /^Tag version/ })).toBeNull();
    await expect(within(panel).queryByRole("button", { name: /^Restore version/ })).toBeNull();
    await userEvent.click(await within(panel).findByRole("button", { name: "Drafts (2)" }));
    const drafts = await within(panel).findByRole("region", { name: "Drafts" });
    await within(drafts).findByRole("listitem", { name: "Draft Add a plan" });
    await expect(within(drafts).queryByRole("button", { name: /^(Apply|Drop) / })).toBeNull();
    await expect(within(drafts).getByRole("button", { name: "Compare Add a plan" })).toBeVisible();
  },
});

/** Undo one line of a difference: the preview lists what it would change, a second Undo saves it. */
export const HistoryUndoLine = mapAt("/", {
  check: async (page) => {
    const panel = await openHistory(page);
    const changes = await pickBoth(panel);
    await userEvent.click(
      await within(changes).findByRole("button", { name: "Undo: Removed station Joined." }),
    );
    const preview = await within(changes).findByRole("region", { name: "Undo preview" });
    await expect(await within(preview).findByText("Added station Joined.")).toBeVisible();
    await expect(within(preview).getByText("Note: Undo: Removed station Joined.")).toBeVisible();
    await userEvent.click(within(preview).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeUndo"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({
      a: 1,
      b: 2,
      change: "station:joined:removed",
    });
  },
});

/** A line that no longer fits the newest shape: the server's reasons show and Undo cannot run. */
export const HistoryUndoRefused = mapAt("/", {
  check: async (page) => {
    const panel = await openHistory(page);
    const changes = await pickBoth(panel);
    await userEvent.click(
      await within(changes).findByRole("button", { name: "Undo: Added track Engaged to Booked." }),
    );
    const preview = await within(changes).findByRole("region", { name: "Undo preview" });
    await expect(
      await within(preview).findByText(/^Booked changed again in version 3\./),
    ).toBeVisible();
    await expect(within(preview).getByRole("button", { name: "Undo" })).toBeDisabled();
    await expect(MAP_CALLS).toEqual([]);
    await expect(REFUSED_UNDO).toBe("track:engaged_to_booked:added");
  },
});

/** A station's history: the versions that touched it, newest first; a line opens that version. */
export const StationHistory = mapAt("/", {
  check: async (page) => {
    await userEvent.click(await station(page, "Booked"));
    const panel = await within(page).findByRole("region", { name: "Booked, details" });
    const list = await within(panel).findByRole("region", { name: "Station history" });
    const lines = await within(list).findAllByRole("button");
    await expect(lines.map((l) => l.textContent)).toEqual([
      expect.stringContaining("Version 2 · Changed"),
      expect.stringContaining("Version 1 · Added"),
    ]);
    await userEvent.click(lines[0] as HTMLElement);
    // History opens on version 2 beside its parent, and the Map draws the difference.
    const history = await within(page).findByRole("region", { name: "History" });
    await expect(
      await within(history).findByText("Removed station Joined.", {}, LATE),
    ).toBeVisible();
  },
});

// --- drafts ------------------------------------------------------------------------------------

const openDrafts = async (page: HTMLElement) => {
  const panel = await openHistory(page);
  await userEvent.click(await within(panel).findByRole("button", { name: "Drafts (2)" }));
  return { panel, drafts: await within(panel).findByRole("region", { name: "Drafts" }) };
};
const draftRow = (drafts: HTMLElement, name: string) =>
  within(drafts).findByRole("listitem", { name: `Draft ${name}` });

/** The Drafts tab counts the open drafts and lists them: name, state, base, author, day. */
export const HistoryDrafts = mapAt("/", {
  check: async (page) => {
    const { drafts } = await openDrafts(page);
    const plan = await draftRow(drafts, "Add a plan");
    await expect(within(plan).getByText("Proposed")).toBeVisible();
    await expect(within(plan).getByText(/from version 2/)).toHaveTextContent("Bo Fenwick");
    await expect(within(plan).queryByRole("button", { name: "Propose Add a plan" })).toBeNull();
    const spur = await draftRow(drafts, "Follow-up step");
    await expect(within(spur).getByText("Draft")).toBeVisible();
    await expect(
      within(spur).getByRole("button", { name: "Propose Follow-up step" }),
    ).toBeVisible();
    // Applied and dropped drafts stay out until asked for.
    await expect(within(drafts).queryByRole("listitem", { name: "Draft Old idea" })).toBeNull();
    await userEvent.click(within(drafts).getByRole("button", { name: "Show applied and dropped" }));
    const old = await draftRow(drafts, "Old idea");
    await expect(within(old).getByText("Dropped")).toBeVisible();
    await expect(within(old).getByText("Dropped: Replaced by the plan draft.")).toBeVisible();
    await expect(within(old).queryByRole("button", { name: "Apply Old idea" })).toBeNull();
  },
});

/** Compare a draft with live: the lines show, and the Map draws the marks; pick a version too. */
export const DraftCompare = mapAt("/", {
  check: async (page) => {
    const { drafts } = await openDrafts(page);
    await userEvent.click(
      await within(drafts).findByRole("button", { name: "Compare Add a plan" }),
    );
    const compare = await within(drafts).findByRole("region", {
      name: "Compare Add a plan with live",
    });
    await expect(
      await within(compare).findByText("Added station Standard plan.", {}, LATE),
    ).toBeVisible();
    await station(page, "Standard plan, .*added");
    await userEvent.selectOptions(
      within(compare).getByRole("combobox", { name: "Compare Add a plan with" }),
      "1",
    );
    await expect(
      await within(compare).findByText("Removed station Joined.", {}, LATE),
    ).toBeVisible();
  },
});

/** A draft opened from the list: the Map draws it with the marks of what it changes. */
export const DraftOpen = mapAt("/", {
  check: async (page) => {
    const { drafts } = await openDrafts(page);
    await userEvent.click(await within(drafts).findByRole("button", { name: "Open Add a plan" }));
    const banner = await within(page).findByRole("status", { name: "Open draft" });
    await expect(within(banner).getByText("Add a plan")).toBeVisible();
    await station(page, "Standard plan, .*added");
  },
});

const banner = (page: HTMLElement) => within(page).findByRole("status", { name: "Open draft" });

/**
 * A draft by its address (`?draft=<id>`): the banner names it, where it started, who made it and
 * its state. The Map draws the draft, never the live shape, with marks on what it adds.
 */
export const DraftView = mapAt("/?draft=d1", {
  check: async (page) => {
    const open = await banner(page);
    await station(page, "Standard plan");
    await expect(within(open).getByText("Add a plan")).toBeVisible();
    await expect(within(open).getByText(/from version 2/)).toHaveTextContent("Bo Fenwick");
    await expect(within(open).getByText("Proposed")).toBeVisible();
    await expect(within(open).queryByText(/Live moved/)).toBeNull();
    // The draft has a plan after the offer; the live shape does not.
    await expect(await station(page, "Standard plan, .*added")).toBeVisible();
    await expect(
      await (await mapOf(page)).findByRole(
        "img",
        { name: "Track from Booked to Engaged, added" },
        LATE,
      ),
    ).toBeInTheDocument();
    // A proposed draft takes Apply and Drop, and no Propose.
    await expect(within(open).getByRole("button", { name: "Apply Add a plan" })).toBeVisible();
    await expect(within(open).getByRole("button", { name: "Drop Add a plan" })).toBeVisible();
    await expect(within(open).queryByRole("button", { name: "Propose Add a plan" })).toBeNull();
    // Close goes back to the live Map.
    await userEvent.click(within(open).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(within(page).queryByRole("status", { name: "Open draft" })).toBeNull(),
    );
    await expect(within(page).queryByRole("button", { name: /^Standard plan/ })).toBeNull();
  },
});

/** Draft view for a login that only reads: the banner shows, with no action. */
export const DraftViewReadOnly = mapAt("/?draft=d1", {
  me: { ...ADMIN, team: { role: "viewer", wren: ["read"], flags: {} } },
  check: async (page) => {
    const open = await banner(page);
    await expect(within(open).getByText("Add a plan")).toBeVisible();
    await expect(within(open).queryByRole("button", { name: /^(Propose|Apply|Drop) / })).toBeNull();
  },
});

/** A draft that does not exist: the page says so and the live Map stays. */
export const DraftMissing = mapAt("/?draft=nope", {
  check: async (page) => {
    await station(page, "Engaged");
    await expect(await within(page).findByRole("alert")).toBeVisible();
    await expect(within(page).queryByRole("status", { name: "Open draft" })).toBeNull();
  },
});

/** Propose a draft that is still a draft, from its banner. */
export const DraftPropose = mapAt("/?draft=d2", {
  check: async (page) => {
    const open = await banner(page);
    await expect(within(open).getByText("Draft")).toBeVisible();
    await userEvent.click(within(open).getByRole("button", { name: "Propose Follow-up step" }));
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeDraftPropose"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({ id: "d2" });
  },
});

/** Drop from the banner asks why; the reason goes with the drop, and the Map goes back to live. */
export const DraftDrop = mapAt("/?draft=d2", {
  check: async (page) => {
    const open = await banner(page);
    await userEvent.click(within(open).getByRole("button", { name: "Drop Follow-up step" }));
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Drop Follow-up step",
    });
    const drop = within(dialog).getByRole("button", { name: "Drop draft" });
    await expect(drop).toBeDisabled();
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Why drop it" }),
      "Not needed",
    );
    await userEvent.click(drop);
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeDraftDrop"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({ id: "d2", reason: "Not needed" });
    await waitFor(() =>
      expect(within(page).queryByRole("status", { name: "Open draft" })).toBeNull(),
    );
  },
});

/** Apply a draft that started from the newest version: its changes against live, then Apply. */
export const DraftApply = mapAt("/?draft=d1", {
  check: async (page) => {
    const open = await banner(page);
    await userEvent.click(within(open).getByRole("button", { name: "Apply Add a plan" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Apply Add a plan" });
    await expect(await within(dialog).findByText("Added station Standard plan.")).toBeVisible();
    await expect(within(dialog).queryByText("Live changed since this draft started.")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeDraftApply"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({ id: "d1" });
  },
});

/**
 * Apply a draft that fell behind: the banner says live moved, and the dialog shows base to live
 * first, then the draft against live. No merge: Apply takes the draft as it is.
 */
export const DraftApplyLiveChanged = mapAt("/?draft=d2", {
  check: async (page) => {
    const open = await banner(page);
    await expect(within(open).getByText(/Live moved to version 2 since/)).toBeVisible();
    await userEvent.click(within(open).getByRole("button", { name: "Apply Follow-up step" }));
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Apply Follow-up step",
    });
    const moved = await within(dialog).findByRole("region", { name: "Live changed" });
    await expect(within(moved).getByText("Live changed since this draft started.")).toBeVisible();
    await expect(await within(moved).findByText("Removed station Joined.")).toBeVisible();
    const against = within(dialog).getByRole("region", { name: "Draft against live" });
    await expect(await within(against).findByText("Added station Follow up.")).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeDraftApply"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({ id: "d2" });
  },
});

/** The server refuses an apply: each line of its reason shows in the dialog and the draft stays. */
export const DraftApplyRefused = mapAt("/?draft=d2", {
  answers: {
    "pipeline/shapeDraftApply": () =>
      refuse(400, 'Station "follow" has no track into it.\nNothing was saved.'),
  },
  check: async (page) => {
    const open = await banner(page);
    await userEvent.click(within(open).getByRole("button", { name: "Apply Follow-up step" }));
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Apply Follow-up step",
    });
    await expect(await within(dialog).findByText("Added station Follow up.")).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await expect(
      await within(dialog).findByText('Station "follow" has no track into it.'),
    ).toBeVisible();
    await expect(within(dialog).getByText("Nothing was saved.")).toBeVisible();
    await expect(dialog).toBeVisible();
  },
});

// --- import and export -------------------------------------------------------------------------

/** Export downloads the shape as a YAML file; the call names the version, never a body. */
export const Export = mapAt("/", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await station(page, "Engaged");
    const names: string[] = [];
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    try {
      await userEvent.click(within(page).getByRole("button", { name: "Export" }));
      await waitFor(() => expect(names).toEqual(["sample-shape.yaml"]));
      await expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeExport"]);
      const sent = MAP_CALLS[0]?.body as Record<string, unknown>;
      await expect(sent).toMatchObject({ ref: 2 });
      await expect(sent).not.toHaveProperty("body");
    } finally {
      click.mockRestore();
    }
  },
});

/** Export on an open draft names the draft: `ref` is `draft:<id>`. */
export const ExportDraft = mapAt("/?draft=d1", {
  check: async (page) => {
    await banner(page);
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      await userEvent.click(within(page).getByRole("button", { name: "Export" }));
      await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeExport"]));
      const sent = MAP_CALLS[0]?.body as Record<string, unknown>;
      await expect(sent).toMatchObject({ ref: "draft:d1" });
      await expect(sent).not.toHaveProperty("body");
    } finally {
      click.mockRestore();
    }
  },
});

/** Import a file: the Map draws it with marks, the card lists what it changes, then Save. */
export const ImportFile = mapAt("/", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await station(page, "Engaged");
    const file = new File([FILE_TEXT], "sample.yaml", { type: "text/yaml" });
    await userEvent.upload(within(page).getByLabelText("Shape file"), file);
    const card = await within(page).findByRole("region", { name: "Import a shape" });
    const changes = await within(card).findByRole("region", { name: "Changes" });
    await expect(within(changes).getByText("Added station Replied.")).toBeVisible();
    await expect(within(changes).getByText("Added track Engaged to Replied.")).toBeVisible();
    // The preview draws the file with its marks.
    await station(page, "Replied, .*added");
    const save = within(card).getByRole("button", { name: "Save version" });
    await expect(save).toBeDisabled();
    await userEvent.type(within(card).getByRole("textbox", { name: "Why it changed" }), "Imported");
    await userEvent.click(save);
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeImport"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({ text: FILE_TEXT, note: "Imported" });
    await station(page, "Replied");
    await expect(within(page).queryByRole("region", { name: "Import a shape" })).toBeNull();
  },
});

/** A file that is no shape: the server's sentence shows, and nothing can be saved. */
export const ImportRefused = mapAt("/", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await station(page, "Engaged");
    const file = new File(["hello"], "notes.yaml", { type: "text/yaml" });
    await userEvent.upload(within(page).getByLabelText("Shape file"), file);
    const card = await within(page).findByRole("region", { name: "Import a shape" });
    await expect(await within(card).findByText("The file is not a shape file.")).toBeVisible();
    await expect(within(card).queryByRole("button", { name: "Save version" })).toBeNull();
  },
});

// --- Today ---------------------------------------------------------------------------------------

/** Today says how many shape proposals wait, and links to History on the Drafts tab. */
export const TodayProposals = {
  ...mapAt("/", {
    check: async (page) => {
      await station(page, "Engaged");
      await userEvent.click(within(page).getByRole("button", { name: "Today" }));
      const sheet = await within(document.body).findByRole("dialog", { name: "Today" });
      const line = await within(sheet).findByText("1 shape proposal waits");
      await expect(line.closest("a")).toHaveAttribute("href", "/?history=drafts");
    },
  }),
  globals: { viewport: { value: "desktop" } },
};

/** The Today link lands on the Map with History open on Drafts. */
export const HistoryOnDrafts = mapAt("/?history=drafts", {
  check: async (page) => {
    await station(page, "Engaged");
    const panel = await within(page).findByRole("region", { name: "History" });
    await expect(await within(panel).findByRole("region", { name: "Drafts" })).toBeVisible();
    await expect(
      await within(panel).findByRole("listitem", { name: "Draft Add a plan" }),
    ).toBeVisible();
  },
});

const TASKS: Task[] = [
  {
    id: "reply_to_book",
    name: "Book calls with people who replied",
    owner: "Ada North",
    initials: "AN",
    line: "web",
    lineName: "Webinar",
    at: "Replied",
    waiting: 4,
    medianHours: 6,
    promise: "4h",
    promiseHours: 4,
    late: true,
  },
  {
    id: "post_to_hub",
    name: "Comment on new threads",
    owner: "Cai Moreno",
    initials: "CM",
    line: "yt",
    lineName: "YouTube",
    at: "Post a video",
    waiting: 2,
    medianHours: 3,
    promise: "1d",
    promiseHours: 24,
    late: false,
  },
  {
    id: "book_to_pay",
    name: "Send the contract",
    owner: "Bo Fenwick",
    initials: "BF",
    line: "web",
    lineName: "Webinar",
    at: "Booked",
    waiting: 0,
    medianHours: null,
    promise: "2d",
    promiseHours: 48,
    late: false,
  },
];

/** Today's task card: the late task first, hover or focus lights its line, a click opens it. */
export const Tasks: StoryObj<typeof TodayTasks> = {
  args: { tasks: TASKS, onLight: fn(), onOpen: fn() },
  render: (a) => (
    <div className="max-w-[460px] p-4">
      <TodayTasks {...a} />
    </div>
  ),
  play: async ({ canvasElement, args }) => {
    const rows = await within(canvasElement).findAllByRole("button", { name: /waiting at/ });
    await expect(rows).toHaveLength(3);
    await expect(rows[0]).toHaveTextContent("Book calls with people who replied");
    await expect(rows[0]).toHaveTextContent("Webinar · 4 waiting at Replied");
    await expect(rows[0]).toHaveTextContent("Late · promise 4h, median 6h");
    await expect(rows[1]).toHaveTextContent("Promise 1d");
    await userEvent.hover(rows[0] as HTMLElement);
    await expect(args.onLight).toHaveBeenLastCalledWith("web");
    await userEvent.unhover(rows[0] as HTMLElement);
    await expect(args.onLight).toHaveBeenLastCalledWith(null);
    (rows[1] as HTMLElement).focus();
    await expect(args.onLight).toHaveBeenLastCalledWith("yt");
    await userEvent.click(rows[1] as HTMLElement);
    await expect(args.onOpen).toHaveBeenCalledWith("post_to_hub");
  },
};

/** No person track, or none with anyone to act on: the empty line. */
export const NoTasks: StoryObj<typeof TodayTasks> = {
  args: { tasks: [], onLight: fn(), onOpen: fn() },
  render: (a) => (
    <div className="max-w-[460px] p-4">
      <TodayTasks {...a} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No tasks waiting.")).toBeVisible();
  },
};
