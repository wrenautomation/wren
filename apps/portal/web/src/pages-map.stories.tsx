/**
 * The Map on the fake server (designs/2026-10-19-business-map.md, "Map page"): Wren's Home for the
 * team, the shape drawn down the whole page. Today is a sheet over it (a tab on a phone). Edit mode
 * (`?edit=1`) adds the palette, the draft bar and the edit cards. Hover, click, drag and Save run in
 * `play`. `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { EDITS } from "@wren/ui";
import { expect, fireEvent, spyOn, userEvent, waitFor, within } from "storybook/test";
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
    const versions = within(panel).getAllByRole("button", { name: /^Version/ });
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
