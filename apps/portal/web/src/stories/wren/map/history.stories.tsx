/** History: compare, restore, tag and undo. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { liveShape, MAP_CALLS } from "../../../mocks/data/map.js";
import { REFUSED_UNDO } from "../../../mocks/data/map-drafts.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { LATE, mapAt, mapOf, openHistory, SHARED, station, tools } from "./map-kit.js";

const meta: Meta = { title: "Wren/Map/History", globals: { data: "tidy" } };
export default meta;

const pickBoth = async (panel: HTMLElement) => {
  const versions = within(panel).getAllByRole("button", { name: /^Version \d/ });
  await userEvent.click(versions[0] as HTMLElement);
  await userEvent.click(versions[1] as HTMLElement);
  return within(panel).findByRole("region", { name: "Changes" }, LATE);
};

/** History: pick version 1 and 2, and the Map draws the difference: Joined removed, a track added. */
export const Default = mapAt("/", {
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
    // A mark fades in: it is in the page before it is fully shown.
    await expect(await station(page, "Joined, removed")).toBeInTheDocument();
    const drawn = await mapOf(page);
    // The added track carries a person, so it draws as that person's pill.
    const pill = await drawn.findByRole("button", { name: /^Person task, .*, added$/ }, LATE);
    await waitFor(() => expect(pill).toBeVisible(), LATE);
    await expect(
      await drawn.findByRole("img", { name: "Track from Joined to Booked, removed" }, LATE),
    ).toBeInTheDocument();
  },
});

/** Restore on an older version shows what it changes, then saves a new version from it, no body. */
export const Restore = mapAt("/", {
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
    await userEvent.click((await tools(page)).getByRole("button", { name: /History/ }));
    await userEvent.click((await tools(page)).getByRole("button", { name: /History/ }));
    const again = await within(page).findByRole("region", { name: "History" });
    await expect(await within(again).findByText("Restore v1")).toBeVisible();
  },
});

/** A compare the server cannot draw (no views) lists the changes and draws no marks. */
export const NoViews = mapAt("/", {
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
export const Tagged = mapAt("/", {
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
export const Tag = mapAt("/", {
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
export const ReadOnly = mapAt("/", {
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
export const UndoLine = mapAt("/", {
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
export const UndoRefused = mapAt("/", {
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
export const Station = mapAt("/", {
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
