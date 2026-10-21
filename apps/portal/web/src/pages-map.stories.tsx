/**
 * The Map on the fake server (designs/2026-10-19-business-map.md, "Map page"): Wren's Home for the
 * team, the shape drawn down the whole page. Today is a sheet over it (a tab on a phone). Edit mode
 * (`?edit=1`) adds the palette, the draft bar and the edit cards. Hover, click, drag and Save run in
 * `play`. `pnpm --filter @wren/portal storybook`.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { EDITS } from "@wren/ui";
import { expect, fireEvent, fn, spyOn, userEvent, waitFor, within } from "storybook/test";
import { TodayTasks } from "./map/TodayTasks.js";
import type { Task } from "./map/tasks.js";
import { freshStory, refuse } from "./mocks/api.js";
import { ANSWERS } from "./mocks/data/index.js";
import {
  FILE_TEXT,
  forgetMapCalls,
  liveShape,
  MAP_CALLS,
  planAnswers,
  SHAPE_SPUR,
  SPUR_PERSON,
} from "./mocks/data/map.js";
import { REFUSED_UNDO } from "./mocks/data/map-drafts.js";
import { ADMIN } from "./mocks/data/me.js";
import { type PageAt, pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Pages/Map" };
export default meta;

/** The layout is async: a node shows when elk has placed it. */
const LATE = { timeout: 10_000 };
const node = (page: HTMLElement, name: RegExp | string) =>
  within(page).findByRole(
    "button",
    { name: new RegExp(typeof name === "string" ? name : name.source) },
    LATE,
  );

type Reply = (b: Record<string, unknown>) => unknown;
const SHARED = {
  get: ANSWERS["pipeline/recordsGet"] as Reply,
  list: ANSWERS["pipeline/recordsList"] as Reply,
};

const onPhone = () => matchMedia("(max-width: 900px)").matches;
/** The Map's own width: the canvas box inside its section. */
const widthOf = (page: HTMLElement) =>
  page.querySelector<HTMLElement>('[aria-label="Map of the shape"]')?.getBoundingClientRect()
    .width ?? 0;

/**
 * A story that edits: nothing of an earlier story's draft or calls is left, since the edits store
 * and the call log outlive a story in one frame.
 */
const editAt = (at: string, opts: PageAt = {}) => ({
  ...pageAt(at, { me: ADMIN, ...opts }),
  beforeEach: () => {
    freshStory();
    EDITS.wipe();
    forgetMapCalls();
  },
});

/**
 * Home for the team: the shape's sources, steps and offer, a ribbon between each, and the ghost, a
 * node an older version had that one person still sits on, dashed with its count. The
 * Map is the whole page; Today waits behind its header button.
 */
export const Default = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    for (const name of ["Spring list", "Winter ads", "Engaged", "Booked", "Signed", "Joined"])
      await node(page, name);
    await expect(await within(page).findByRole("heading", { name: "Map" })).toBeVisible();
    // The ghost holds its one person.
    await expect(await node(page, "Joined")).toHaveTextContent("1");
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

/** Today opens as a sheet over the Map from its header; the canvas keeps its width. */
export const TodaySheet = {
  ...pageAt("/", {
    me: ADMIN,
    check: async (page) => {
      await node(page, "Engaged");
      const before = widthOf(page);
      await expect(before).toBeGreaterThan(300);
      const open = within(page).getByRole("button", { name: "Today" });
      await expect(open).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(open);
      const sheet = await within(document.body).findByRole("dialog", { name: "Today" });
      await expect(await within(sheet).findByRole("heading", { name: /^Write/ })).toBeVisible();
      // The tasks sit at the top: the late one first.
      const tasks = await within(sheet).findAllByRole("button", { name: /waiting at/ });
      await expect(tasks[0]).toHaveTextContent("Call scheduled");
      await expect(tasks[0]).toHaveTextContent(/Late · promise 4h/);
      await expect(Math.abs(widthOf(page) - before)).toBeLessThan(20);
    },
  }),
  globals: { viewport: { value: "desktop" } },
};

/** Dark theme: the Map wears the app's tokens, nothing forces a look of its own. */
export const Dark = {
  ...pageAt("/", {
    me: ADMIN,
    check: async (page) => {
      await node(page, "Engaged");
      await node(page, "Joined");
      await expect(within(page).getByRole("region", { name: "Map" })).toBeVisible();
    },
  }),
  globals: { theme: "dark" },
};

/** The window is in the address; 7 days is lit and the numbers are the window's. */
export const Window = pageAt("/?window=7", {
  me: ADMIN,
  check: async (page) => {
    await node(page, "Engaged");
    await expect(within(page).getByRole("link", { name: "7 days" })).toHaveAttribute(
      "aria-current",
      "page",
    );
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

/** No shape yet: one line, the palette inert, the start ready for a login that may edit. */
export const Empty = pageAt("/", {
  me: ADMIN,
  answers: NONE,
  check: async (page) => {
    await expect(await within(page).findByText(/^No shape yet/)).toBeVisible();
    await expect(
      within(page).getByRole("button", { name: "Start from Wren's shape" }),
    ).toBeEnabled();
    await expect(within(page).getByText("Source")).toHaveAttribute("aria-disabled", "true");
    await expect(within(page).queryByText(/arrives in the next build/)).toBeNull();
  },
});

/** A login that only reads cannot start one, and the page says so. */
export const EmptyReadOnly = pageAt("/", {
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
export const EmptyStart = {
  ...editAt("/", {
    answers: liveShape(SHARED, null),
    check: async (page) => {
      const start = await within(page).findByRole("button", { name: "Start from Wren's shape" });
      await userEvent.click(start);
      await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeStart"]));
      await node(page, "Engaged");
      await expect(within(page).queryByText(/^No shape yet/)).toBeNull();
    },
  }),
};

/** Click a node: its details open as a card over the canvas, people newest first, each a link. */
export const NodePanel = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    await userEvent.click(await node(page, "Engaged"));
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
  },
});

/** A ghost's panel lists the person who sits on the dropped node. */
export const Ghost = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    await userEvent.click(await node(page, "Joined"));
    const panel = await within(page).findByRole("region", { name: "Joined, details" });
    await expect(within(panel).getByText("Dropped from the newest version")).toBeVisible();
    await expect(within(panel).getByRole("link", { name: /Gus Held/ })).toBeVisible();
  },
});

/** History: pick version 1 and 2, and the Map draws the difference, the Joined node gone. */
export const History = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    await node(page, "Engaged");
    await userEvent.click(within(page).getByRole("button", { name: /History/ }));
    const panel = await within(page).findByRole("region", { name: "History" });
    const versions = within(panel).getAllByRole("button", { name: /^Version \d/ });
    await expect(versions.map((v) => v.textContent)).toEqual([
      expect.stringContaining("Version 2"),
      expect.stringContaining("Version 1"),
    ]);
    await userEvent.click(versions[0] as HTMLElement);
    await userEvent.click(versions[1] as HTMLElement);
    await expect(await within(panel).findByText("Removed node Joined.", {}, LATE)).toBeVisible();
    await expect(within(panel).getByText("Added edge Engaged to Booked.")).toBeVisible();
    await waitFor(() => expect(within(page).getAllByText("Gone").length).toBeGreaterThan(0), LATE);
  },
});

/** Restore on an older version shows what it changes, then saves a new version with its body. */
export const HistoryRestore = editAt("/", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await node(page, "Engaged");
    await userEvent.click(within(page).getByRole("button", { name: /History/ }));
    const panel = await within(page).findByRole("region", { name: "History" });
    await userEvent.click(within(panel).getByRole("button", { name: "Restore version 1" }));
    const restore = await within(panel).findByRole("region", { name: "Restore version 1" });
    await expect(await within(restore).findByText("Added node Joined.")).toBeVisible();
    await userEvent.click(within(restore).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeVersion"]));
    const sent = MAP_CALLS[0]?.body as { note: string; body: { nodes: { id: string }[] } };
    await expect(sent.note).toBe("Restore v1");
    await expect(sent.body.nodes.map((n) => n.id)).toContain("joined");
    // The restore is the newest version now.
    await userEvent.click(within(page).getByRole("button", { name: /History/ }));
    await userEvent.click(within(page).getByRole("button", { name: /History/ }));
    const again = await within(page).findByRole("region", { name: "History" });
    await expect(await within(again).findByText("Restore v1")).toBeVisible();
  },
});

/** A plan after the offer shows its collected money, and a loop back from Booked stays thin. */
export const Plan = pageAt("/", {
  me: ADMIN,
  answers: planAnswers(SHARED),
  check: async (page) => {
    const plan = await node(page, "Standard plan");
    await expect(plan).toHaveTextContent("CAD collected");
    await waitFor(
      () => expect(page.querySelectorAll(".react-flow__edge").length).toBeGreaterThanOrEqual(6),
      LATE,
    );
  },
});

/** On a phone the Map fills the width and Today is a tab under it, open. */
export const Phone = {
  ...pageAt("/", {
    me: ADMIN,
    check: async (page) => {
      await node(page, "Engaged");
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

// --- edit mode ---------------------------------------------------------------------------------

const toolbar = (page: HTMLElement) =>
  within(page).findByRole("toolbar", { name: "Edit the shape" });
const parts = (page: HTMLElement) =>
  within(page).findByRole("region", { name: "Parts of a shape" });

/**
 * A drag from the palette as the browser makes it: the item starts it, the canvas takes the drop,
 * one `DataTransfer` through the three events (see the Journeys stories).
 */
async function dragPart(page: HTMLElement, kind: string) {
  const item = within(await parts(page)).getByRole("button", { name: new RegExp(`^${kind}`) });
  const canvas = page.querySelector(".react-flow");
  if (!canvas) throw new Error("no canvas");
  const dataTransfer = new DataTransfer();
  const send = (el: Element, type: string) =>
    el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
  send(item, "dragstart");
  send(canvas, "dragover");
  send(canvas, "drop");
}

const centre = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
};

/** A line dragged from one node's out handle to another's in handle, as a pointer makes it. */
async function join(page: HTMLElement, from: string, to: string) {
  const out = page.querySelector(`.react-flow__node[data-id="${from}"] .react-flow__handle.source`);
  const into = page.querySelector(`.react-flow__node[data-id="${to}"] .react-flow__handle.target`);
  if (!out || !into) throw new Error(`no handles for ${from} to ${to}`);
  fireEvent.mouseDown(out, { ...centre(out), button: 0 });
  fireEvent.mouseMove(document, centre(into));
  fireEvent.mouseMove(document, centre(into));
  fireEvent.mouseUp(document, centre(into));
}

const saveWith = async (note: string) => {
  const dialog = await within(document.body).findByRole("dialog", { name: "Save the shape" });
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Why it changed" }), note);
  await userEvent.click(within(dialog).getByRole("button", { name: "Save version" }));
  return dialog;
};

/** Edit mode: the palette lists the four parts, the bar counts nothing yet, Save waits. */
export const EditMode = editAt("/?edit=1", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await node(page, "Engaged");
    const palette = await parts(page);
    for (const k of ["Source", "Step", "Offer", "Plan"])
      await expect(
        within(palette).getByRole("button", { name: new RegExp(`^${k}`) }),
      ).toBeVisible();
    const bar = await toolbar(page);
    await expect(within(bar).getByText("No changes")).toBeVisible();
    await expect(within(bar).getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(within(page).getByRole("button", { name: "Edit" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  },
});

/** A login that may not act on the shape sees no Edit button, and the address does not turn it on. */
export const EditNotAllowed = pageAt("/?edit=1", {
  me: { ...ADMIN, team: { role: "viewer", wren: ["read"], flags: {} } },
  check: async (page) => {
    await node(page, "Engaged");
    await expect(within(page).queryByRole("button", { name: "Edit" })).toBeNull();
    await expect(within(page).queryByRole("toolbar", { name: "Edit the shape" })).toBeNull();
    await expect(within(page).queryByRole("button", { name: "Import" })).toBeNull();
  },
});

/**
 * Drag a Step from the palette: a node with a free id lands, its card opens, and the bar counts
 * one change and one problem (nothing leads to it). Leaving edit mode keeps the draft.
 */
export const EditAddNode = editAt("/?edit=1", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await node(page, "Engaged");
    await dragPart(page, "Step");
    const card = await within(page).findByRole("region", { name: "Step, edit" });
    await expect(within(card).getByRole("textbox", { name: "Name" })).toHaveValue("Step");
    const bar = await toolbar(page);
    await expect(await within(bar).findByText("Draft: 1 change")).toBeVisible();
    await userEvent.click(within(bar).getByText("1 problem"));
    await expect(
      await within(bar).findByText('Node "step" has no flow edge into it. Nothing can reach it.'),
    ).toBeVisible();
    await expect(within(bar).getByRole("button", { name: "Save" })).toBeDisabled();
    // Off and on again: the draft is still there.
    await userEvent.click(within(page).getByRole("button", { name: "Edit" }));
    await expect(within(page).queryByRole("toolbar", { name: "Edit the shape" })).toBeNull();
    await userEvent.click(await within(page).findByRole("button", { name: "Edit draft" }));
    await expect(await within(await toolbar(page)).findByText("Draft: 1 change")).toBeVisible();
  },
});

/** Join Engaged to the new Step by their handles: the problem goes, Save asks for a note and sends. */
export const EditConnectAndSave = {
  ...editAt("/?edit=1", {
    answers: liveShape(SHARED),
    check: async (page) => {
      await node(page, "Engaged");
      await dragPart(page, "Step");
      await waitFor(
        () => expect(page.querySelector('.react-flow__node[data-id="step"]')).not.toBeNull(),
        LATE,
      );
      const bar = await toolbar(page);
      // A new node takes its handles' places a moment after it shows: draw until the line holds.
      await waitFor(async () => {
        await join(page, "engaged", "step");
        await expect(within(bar).getByText("Draft: 2 changes")).toBeVisible();
      }, LATE);
      await expect(within(bar).queryByText("1 problem")).toBeNull();
      await userEvent.click(within(bar).getByRole("button", { name: "Save" }));
      await saveWith("Added a follow-up step");
      await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeVersion"]));
      const sent = MAP_CALLS[0]?.body as {
        note: string;
        moves: Record<string, string>;
        body: { nodes: { id: string }[]; edges: { id: string }[] };
      };
      await expect(sent.note).toBe("Added a follow-up step");
      await expect(sent.body.nodes.map((n) => n.id)).toContain("step");
      await expect(sent.body.edges.map((e) => e.id)).toContain("engaged_to_step");
      await expect(sent.moves).toEqual({});
      // The draft is spent: the saved shape has it, and the bar counts nothing.
      await expect(
        await within(await toolbar(page)).findByText("No changes", {}, LATE),
      ).toBeVisible();
    },
  }),
  // A phone shows too little of the canvas to reach a handle with a pointer.
  globals: { viewport: { value: "desktop" } },
};

/** A line that checkShape would refuse (into a source) is refused while it is dragged. */
export const EditRefusesLine = {
  ...editAt("/?edit=1", {
    answers: liveShape(SHARED),
    check: async (page) => {
      await node(page, "Engaged");
      await join(page, "engaged", "mail");
      const bar = await toolbar(page);
      await expect(within(bar).getByText("No changes")).toBeVisible();
      await expect(page.querySelectorAll(".react-flow__edge").length).toBe(4);
    },
  }),
  // A phone shows too little of the canvas to reach a handle with a pointer.
  globals: { viewport: { value: "desktop" } },
};

/** Rename a node in its card: the bar counts it, the Map draws the new name. */
export const EditRename = editAt("/?edit=1", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await userEvent.click(await node(page, "Booked"));
    const card = await within(page).findByRole("region", { name: "Booked, edit" });
    const name = within(card).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Call booked{Enter}");
    await expect(await within(await toolbar(page)).findByText("Draft: 1 change")).toBeVisible();
    await node(page, "Call booked");
  },
});

/** Pick a line: its card sets the label and removes it. */
export const EditLine = editAt("/?edit=1", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await node(page, "Engaged");
    const wire = await waitFor(() => {
      const w = page.querySelector<HTMLElement>('.react-flow__edge[data-id="engaged>booked"]');
      if (!w) throw new Error("no wire yet");
      return w;
    }, LATE);
    await userEvent.click(wire);
    const card = await within(page).findByRole("region", { name: "Engaged to Booked, edit" });
    await userEvent.type(within(card).getByRole("textbox", { name: "Label" }), "Replied{Enter}");
    await expect(await within(await toolbar(page)).findByText("Draft: 1 change")).toBeVisible();
    await userEvent.click(within(card).getByRole("button", { name: "Remove this line" }));
    await expect(await within(await toolbar(page)).findByText("Draft: 1 change")).toBeVisible();
    await waitFor(() => expect(page.querySelectorAll(".react-flow__edge").length).toBe(3), LATE);
  },
});

/**
 * Remove a node that people sit on: the card says how many, will not remove until they are moved
 * or kept as ghosts, and Save sends the move with the new body.
 */
export const EditRemoveWithPeople = editAt("/?edit=1", {
  answers: liveShape(SHARED, SHAPE_SPUR, [SPUR_PERSON]),
  check: async (page) => {
    await userEvent.click(await node(page, "Follow up"));
    const card = await within(page).findByRole("region", { name: "Follow up, edit" });
    await expect(await within(card).findByText(/^1 person is here\./)).toBeVisible();
    const move = within(card).getByRole("button", { name: "Move them and remove" });
    await expect(move).toBeDisabled();
    await userEvent.selectOptions(
      within(card).getByRole("combobox", { name: "Move them to" }),
      "booked",
    );
    await userEvent.click(move);
    const bar = await toolbar(page);
    await expect(await within(bar).findByText("Draft: 2 changes")).toBeVisible();
    await userEvent.click(within(bar).getByRole("button", { name: "Save" }));
    await expect(
      await within(document.body).findByText(/People on 1 dropped node move first\./),
    ).toBeVisible();
    await saveWith("Folded the follow-up into Booked");
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeVersion"]));
    const sent = MAP_CALLS[0]?.body as {
      moves: Record<string, string>;
      body: { nodes: { id: string }[] };
    };
    await expect(sent.moves).toEqual({ follow: "booked" });
    await expect(sent.body.nodes.map((n) => n.id)).not.toContain("follow");
  },
});

/** The server refuses a save: its sentence shows in the dialog, and the draft and note stay. */
export const EditSaveRefused = editAt("/?edit=1", {
  answers: {
    ...liveShape(SHARED),
    "pipeline/shapeVersion": () =>
      refuse(
        400,
        'Source "mail" names group 12, which is archived. Restore it first. Nothing was saved.',
      ),
  },
  check: async (page) => {
    await userEvent.click(await node(page, "Booked"));
    const card = await within(page).findByRole("region", { name: "Booked, edit" });
    const name = within(card).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Call booked{Enter}");
    await userEvent.click(within(await toolbar(page)).getByRole("button", { name: "Save" }));
    const dialog = await saveWith("Clearer name");
    await expect(
      await within(dialog).findByText(/Source "mail" names group 12, which is archived\./),
    ).toBeVisible();
    // Nothing is lost: the note and the draft stay.
    await expect(within(dialog).getByRole("textbox", { name: "Why it changed" })).toHaveValue(
      "Clearer name",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expect(await within(await toolbar(page)).findByText("Draft: 1 change")).toBeVisible();
  },
});

// --- import and export -------------------------------------------------------------------------

/** Export downloads the shape as a YAML file named for it. */
export const Export = editAt("/", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await node(page, "Engaged");
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
    } finally {
      click.mockRestore();
    }
  },
});

/** Import a file: the dialog lists what it changes against the newest version, then saves it. */
export const ImportFile = editAt("/", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await node(page, "Engaged");
    const file = new File([FILE_TEXT], "sample.yaml", { type: "text/yaml" });
    await userEvent.upload(within(page).getByLabelText("Shape file"), file);
    const dialog = await within(document.body).findByRole("dialog", { name: "Import a shape" });
    const changes = await within(dialog).findByRole("region", { name: "Changes" });
    await expect(within(changes).getByText("Added node Replied.")).toBeVisible();
    await expect(within(changes).getByText("Added edge Engaged to Replied.")).toBeVisible();
    const save = within(dialog).getByRole("button", { name: "Save version" });
    await expect(save).toBeDisabled();
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Why it changed" }),
      "Imported",
    );
    await userEvent.click(save);
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeImport"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({ text: FILE_TEXT, note: "Imported" });
    await node(page, "Replied");
  },
});

/** A file that is no shape: the server's sentence shows, and nothing can be saved. */
export const ImportRefused = editAt("/", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await node(page, "Engaged");
    const file = new File(["hello"], "notes.yaml", { type: "text/yaml" });
    await userEvent.upload(within(page).getByLabelText("Shape file"), file);
    const dialog = await within(document.body).findByRole("dialog", { name: "Import a shape" });
    await expect(await within(dialog).findByText("The file is not a shape file.")).toBeVisible();
    await expect(within(dialog).queryByRole("button", { name: "Save version" })).toBeNull();
  },
});

// --- history: tags, shas, drafts, undo, node history ---------------------------------------------

const openHistory = async (page: HTMLElement) => {
  await node(page, "Engaged");
  await userEvent.click(within(page).getByRole("button", { name: /History/ }));
  return within(page).findByRole("region", { name: "History" });
};
const openDrafts = async (page: HTMLElement) => {
  const panel = await openHistory(page);
  await userEvent.click(await within(panel).findByRole("button", { name: "Drafts (3)" }));
  return { panel, drafts: await within(panel).findByRole("region", { name: "Drafts" }) };
};
const draftRow = (drafts: HTMLElement, name: string) =>
  within(drafts).findByRole("listitem", { name: `Draft ${name}` });

/** Each version shows its tags and its commit in the git mirror, a short sha that opens the commit. */
export const HistoryTagged = pageAt("/", {
  me: ADMIN,
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
export const HistoryTag = editAt("/", {
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

/** A login that only reads sees no Tag, Restore or draft action. */
export const HistoryReadOnly = pageAt("/", {
  me: { ...ADMIN, team: { role: "viewer", wren: ["read"], flags: {} } },
  check: async (page) => {
    const panel = await openHistory(page);
    await expect(within(panel).queryByRole("button", { name: /^Tag version/ })).toBeNull();
    await expect(within(panel).queryByRole("button", { name: /^Restore version/ })).toBeNull();
    await userEvent.click(await within(panel).findByRole("button", { name: "Drafts (3)" }));
    const drafts = await within(panel).findByRole("region", { name: "Drafts" });
    await draftRow(drafts, "Add a plan");
    await expect(within(drafts).queryByRole("button", { name: /^(Open|Apply|Drop) / })).toBeNull();
    await expect(within(drafts).getByRole("button", { name: "Compare Add a plan" })).toBeVisible();
  },
});

/** The Drafts tab counts the open drafts and lists them: name, state, base, author, day. */
export const HistoryDrafts = pageAt("/", {
  me: ADMIN,
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

/** Compare a draft with live: the lines show, and the Map draws the difference; pick a version too. */
export const DraftCompare = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    const { drafts } = await openDrafts(page);
    await userEvent.click(
      await within(drafts).findByRole("button", { name: "Compare Add a plan" }),
    );
    const compare = await within(drafts).findByRole("region", {
      name: "Compare Add a plan with live",
    });
    await expect(
      await within(compare).findByText("Added node Standard plan.", {}, LATE),
    ).toBeVisible();
    await waitFor(() => expect(within(page).getAllByText("New").length).toBeGreaterThan(0), LATE);
    await userEvent.selectOptions(
      within(compare).getByRole("combobox", { name: "Compare Add a plan with" }),
      "1",
    );
    await expect(await within(compare).findByText("Removed node Joined.", {}, LATE)).toBeVisible();
  },
});

/** Propose a draft that is still a draft; the server's answer is read again. */
export const DraftPropose = editAt("/", {
  check: async (page) => {
    const { drafts } = await openDrafts(page);
    await userEvent.click(
      await within(drafts).findByRole("button", { name: "Propose Follow-up step" }),
    );
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeDraftPropose"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({ id: "d2" });
  },
});

/** Drop asks why; the reason goes with the drop. */
export const DraftDrop = editAt("/", {
  check: async (page) => {
    const { drafts } = await openDrafts(page);
    await userEvent.click(
      await within(drafts).findByRole("button", { name: "Drop Follow-up step" }),
    );
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
  },
});

/** Apply a draft that started from the newest version: its changes against live, then Apply. */
export const DraftApply = editAt("/", {
  check: async (page) => {
    const { drafts } = await openDrafts(page);
    await userEvent.click(await within(drafts).findByRole("button", { name: "Apply Add a plan" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Apply Add a plan" });
    await expect(await within(dialog).findByText("Added node Standard plan.")).toBeVisible();
    await expect(within(dialog).queryByText("Live changed since this draft started.")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeDraftApply"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({ id: "d1" });
  },
});

/**
 * Apply a draft that fell behind: the warning and what live changed since come first, then the
 * draft against live. No merge: Apply takes the draft as it is.
 */
export const DraftApplyLiveChanged = editAt("/", {
  check: async (page) => {
    const { drafts } = await openDrafts(page);
    await userEvent.click(
      await within(drafts).findByRole("button", { name: "Apply Follow-up step" }),
    );
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Apply Follow-up step",
    });
    const moved = await within(dialog).findByRole("region", { name: "Live changed" });
    await expect(within(moved).getByText("Live changed since this draft started.")).toBeVisible();
    await expect(await within(moved).findByText("Removed node Joined.")).toBeVisible();
    const against = within(dialog).getByRole("region", { name: "Draft against live" });
    await expect(await within(against).findByText("Added node Follow up.")).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeDraftApply"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({ id: "d2" });
  },
});

/** The server refuses an apply: its sentence shows in the dialog and the draft stays. */
export const DraftApplyRefused = editAt("/", {
  answers: {
    "pipeline/shapeDraftApply": () =>
      refuse(400, 'Node "follow" has no flow edge into it. Nothing was saved.'),
  },
  check: async (page) => {
    const { drafts } = await openDrafts(page);
    await userEvent.click(
      await within(drafts).findByRole("button", { name: "Apply Follow-up step" }),
    );
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Apply Follow-up step",
    });
    await expect(await within(dialog).findByText("Added node Follow up.")).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await expect(
      await within(dialog).findByText(/Node "follow" has no flow edge into it\./),
    ).toBeVisible();
  },
});

const pickBoth = async (panel: HTMLElement) => {
  const versions = within(panel).getAllByRole("button", { name: /^Version \d/ });
  await userEvent.click(versions[0] as HTMLElement);
  await userEvent.click(versions[1] as HTMLElement);
  return within(panel).findByRole("region", { name: "Changes" }, LATE);
};

/** Undo one line of a difference: the preview lists what it would change, a second Undo saves it. */
export const HistoryUndoLine = editAt("/", {
  check: async (page) => {
    const panel = await openHistory(page);
    const changes = await pickBoth(panel);
    await userEvent.click(
      await within(changes).findByRole("button", { name: "Undo: Removed node Joined." }),
    );
    const preview = await within(changes).findByRole("region", { name: "Undo preview" });
    await expect(await within(preview).findByText("Added node Joined.")).toBeVisible();
    await expect(within(preview).getByText("Note: Undo: Removed node Joined.")).toBeVisible();
    await userEvent.click(within(preview).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeUndo"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({ a: 1, b: 2, change: "node:joined:removed" });
  },
});

/** A line that no longer fits the newest shape: the server's reasons show and Undo cannot run. */
export const HistoryUndoRefused = editAt("/", {
  check: async (page) => {
    const panel = await openHistory(page);
    const changes = await pickBoth(panel);
    await userEvent.click(
      await within(changes).findByRole("button", { name: "Undo: Added edge Engaged to Booked." }),
    );
    const preview = await within(changes).findByRole("region", { name: "Undo preview" });
    await expect(
      await within(preview).findByText(/^Booked changed again in version 3\./),
    ).toBeVisible();
    await expect(within(preview).getByRole("button", { name: "Undo" })).toBeDisabled();
    await expect(MAP_CALLS).toEqual([]);
    await expect(REFUSED_UNDO).toBe("edge:engaged_to_booked:added");
  },
});

/** Node history: the versions that touched the node, newest first; a line opens that version. */
export const NodeHistory = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    await userEvent.click(await node(page, "Booked"));
    const panel = await within(page).findByRole("region", { name: "Booked, details" });
    const list = await within(panel).findByRole("region", { name: "Node history" });
    const lines = await within(list).findAllByRole("button");
    await expect(lines.map((l) => l.textContent)).toEqual([
      expect.stringContaining("Version 2 · Changed"),
      expect.stringContaining("Version 1 · Added"),
    ]);
    await userEvent.click(lines[0] as HTMLElement);
    // History opens on version 2 beside its parent, and the Map draws the difference.
    const history = await within(page).findByRole("region", { name: "History" });
    await expect(await within(history).findByText("Removed node Joined.", {}, LATE)).toBeVisible();
  },
});

/** Edit mode: a node's card and a line's card have the same history section. */
export const EditHistory = editAt("/?edit=1", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await userEvent.click(await node(page, "Booked"));
    const card = await within(page).findByRole("region", { name: "Booked, edit" });
    const list = await within(card).findByRole("region", { name: "Node history" });
    await expect(await within(list).findAllByRole("button")).toHaveLength(2);
    const wire = await waitFor(() => {
      const w = page.querySelector<HTMLElement>('.react-flow__edge[data-id="engaged>booked"]');
      if (!w) throw new Error("no wire yet");
      return w;
    }, LATE);
    await userEvent.click(wire);
    const line = await within(page).findByRole("region", { name: "Engaged to Booked, edit" });
    const lineList = await within(line).findByRole("region", { name: "Line history" });
    await expect(
      await within(lineList).findByRole("button", { name: /Version\s+2\s*·\s*Added/ }),
    ).toBeVisible();
  },
});

/** A node the saved shape lacks (just added in the draft) has no history yet, and says so. */
export const EditHistoryNewNode = editAt("/?edit=1", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await node(page, "Engaged");
    await dragPart(page, "Step");
    const card = await within(page).findByRole("region", { name: "Step, edit" });
    const list = await within(card).findByRole("region", { name: "Node history" });
    await expect(await within(list).findByText("No history yet.")).toBeVisible();
  },
});

// --- drafts in edit mode -----------------------------------------------------------------------

const banner = (page: HTMLElement) => within(page).findByRole("status", { name: "Open draft" });

/**
 * A draft opened in edit mode (`?edit=1&draft=<id>`): the banner names it and where it started, the
 * canvas draws the draft, and the bar saves into the draft ("Update draft"), not a version.
 */
export const EditOpenDraft = editAt("/?edit=1&draft=d1", {
  answers: liveShape(SHARED),
  check: async (page) => {
    const open = await banner(page);
    await expect(within(open).getByText("Add a plan")).toBeVisible();
    await expect(within(open).getByText(/from version 2/)).toHaveTextContent("Bo Fenwick");
    // The draft has a plan after the offer; the live shape does not.
    await node(page, "Standard plan");
    const bar = await toolbar(page);
    await expect(within(bar).getByText("No changes")).toBeVisible();
    await expect(within(bar).queryByRole("button", { name: "Save" })).toBeNull();
    await expect(within(bar).getByRole("button", { name: "Update draft" })).toBeDisabled();
    await userEvent.click(await node(page, "Booked"));
    const card = await within(page).findByRole("region", { name: "Booked, edit" });
    const name = within(card).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Call booked{Enter}");
    await expect(await within(bar).findByText("Draft: 1 change")).toBeVisible();
    await userEvent.click(within(bar).getByRole("button", { name: "Update draft" }));
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeDraftUpdate"]));
    const sent = MAP_CALLS[0]?.body as { id: string; body: { nodes: { name: string }[] } };
    await expect(sent.id).toBe("d1");
    await expect(sent.body.nodes.map((n) => n.name)).toContain("Call booked");
  },
});

/** Close asks first when edits are not saved in the draft; the edits stay on the device. */
export const EditCloseDraft = editAt("/?edit=1&draft=d1", {
  answers: liveShape(SHARED),
  check: async (page) => {
    const open = await banner(page);
    await userEvent.click(await node(page, "Booked"));
    const card = await within(page).findByRole("region", { name: "Booked, edit" });
    const name = within(card).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Call booked{Enter}");
    await expect(await within(await toolbar(page)).findByText("Draft: 1 change")).toBeVisible();
    await userEvent.click(within(open).getByRole("button", { name: "Close" }));
    await expect(within(open).getByText("Your edits stay on this device.")).toBeVisible();
    await userEvent.click(within(open).getByRole("button", { name: "Close the draft" }));
    // Back on the live shape: no banner, and Save is a version again.
    await waitFor(() =>
      expect(within(page).queryByRole("status", { name: "Open draft" })).toBeNull(),
    );
    await expect(
      await within(await toolbar(page)).findByRole("button", { name: "Save" }),
    ).toBeVisible();
  },
});

/** A draft that does not exist: the page says so and the live shape stays editable. */
export const EditDraftMissing = editAt("/?edit=1&draft=nope", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await node(page, "Engaged");
    await expect(await within(page).findByText(/No such draft\./)).toBeVisible();
    await expect(within(page).queryByRole("status", { name: "Open draft" })).toBeNull();
  },
});

/** "Save as draft" in the bar: a name and a note, sent with the edits; the new draft opens. */
export const EditSaveAsDraft = editAt("/?edit=1", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await userEvent.click(await node(page, "Booked"));
    const card = await within(page).findByRole("region", { name: "Booked, edit" });
    const name = within(card).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Call booked{Enter}");
    const bar = await toolbar(page);
    await expect(await within(bar).findByText("Draft: 1 change")).toBeVisible();
    await userEvent.click(within(bar).getByRole("button", { name: "Save as draft" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Save as draft" });
    const save = within(dialog).getByRole("button", { name: "Save draft" });
    await expect(save).toBeDisabled();
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Draft name" }),
      "Saved from edits",
    );
    await userEvent.click(save);
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeDraftNew"]));
    const sent = MAP_CALLS[0]?.body as {
      name: string;
      base: number;
      body: { nodes: { name: string }[] };
    };
    await expect(sent.name).toBe("Saved from edits");
    await expect(sent.base).toBe(2);
    await expect(sent.body.nodes.map((n) => n.name)).toContain("Call booked");
    // The new draft is open now, and the device holds nothing for the live shape.
    const open = await banner(page);
    await expect(within(open).getByText("Saved from edits")).toBeVisible();
    await expect(
      await within(await toolbar(page)).findByRole("button", { name: "Update draft" }),
    ).toBeVisible();
  },
});

/** The server refuses the draft: its sentence shows in the dialog, and the name and edits stay. */
export const EditSaveAsDraftRefused = editAt("/?edit=1", {
  answers: {
    ...liveShape(SHARED),
    "pipeline/shapeDraftNew": () => refuse(400, "A draft named Spring is already open."),
  },
  check: async (page) => {
    await userEvent.click(await node(page, "Booked"));
    const card = await within(page).findByRole("region", { name: "Booked, edit" });
    const name = within(card).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Call booked{Enter}");
    await userEvent.click(
      within(await toolbar(page)).getByRole("button", { name: "Save as draft" }),
    );
    const dialog = await within(document.body).findByRole("dialog", { name: "Save as draft" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Draft name" }), "Spring");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save draft" }));
    await expect(
      await within(dialog).findByText("A draft named Spring is already open."),
    ).toBeVisible();
    await expect(within(dialog).getByRole("textbox", { name: "Draft name" })).toHaveValue("Spring");
  },
});

// --- Today ---------------------------------------------------------------------------------------

/** Today says how many shape proposals wait, and links to History on the Drafts tab. */
export const TodayProposals = {
  ...pageAt("/", {
    me: ADMIN,
    check: async (page) => {
      await node(page, "Engaged");
      await userEvent.click(within(page).getByRole("button", { name: "Today" }));
      const sheet = await within(document.body).findByRole("dialog", { name: "Today" });
      const line = await within(sheet).findByText("1 shape proposal waits");
      await expect(line.closest("a")).toHaveAttribute("href", "/?history=drafts");
    },
  }),
  globals: { viewport: { value: "desktop" } },
};

/** The Today link lands on the Map with History open on Drafts. */
export const HistoryOnDrafts = pageAt("/?history=drafts", {
  me: ADMIN,
  check: async (page) => {
    await node(page, "Engaged");
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
