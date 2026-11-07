/** Drafts: open, compare, propose, drop and apply. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { refuse } from "../../../mocks/api.js";
import { MAP_CALLS } from "../../../mocks/data/map.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { banner, LATE, mapAt, mapOf, openHistory, station } from "./map-kit.js";

const meta: Meta = { title: "Wren/Map/Drafts", globals: { data: "tidy" } };
export default meta;

// --- drafts ------------------------------------------------------------------------------------

const openDrafts = async (page: HTMLElement) => {
  const panel = await openHistory(page);
  await userEvent.click(await within(panel).findByRole("button", { name: "Drafts (2)" }));
  return { panel, drafts: await within(panel).findByRole("region", { name: "Drafts" }) };
};

const draftRow = (drafts: HTMLElement, name: string) =>
  within(drafts).findByRole("listitem", { name: `Draft ${name}` });

/** The Drafts tab counts the open drafts and lists them: name, state, base, author, day. */
export const InHistory = mapAt("/", {
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

/** Compare a draft with live: the lines show, and the Map draws the marks; pick a version too. */
export const Compare = mapAt("/", {
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
export const Open = mapAt("/", {
  check: async (page) => {
    const { drafts } = await openDrafts(page);
    await userEvent.click(await within(drafts).findByRole("button", { name: "Open Add a plan" }));
    const banner = await within(page).findByRole("status", { name: "Open draft" });
    await expect(within(banner).getByText("Add a plan")).toBeVisible();
    await station(page, "Standard plan, .*added");
  },
});

/**
 * A draft by its address (`?draft=<id>`): the banner names it, where it started, who made it and
 * its state. The Map draws the draft, never the live shape, with marks on what it adds.
 */
export const View = mapAt("/?draft=d1", {
  check: async (page) => {
    const open = await banner(page);
    await station(page, "Standard plan");
    await expect(within(open).getByText("Add a plan")).toBeVisible();
    await expect(within(open).getByText(/from version 2/)).toHaveTextContent("Bo Fenwick");
    await expect(within(open).getByText("Proposed")).toBeVisible();
    await expect(within(open).queryByText(/Live moved/)).toBeNull();
    // The draft has a plan after the offer; the live shape does not.
    await expect(await station(page, "Standard plan, .*added")).toBeInTheDocument();
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
    await waitFor(() => {
      expect(within(page).queryByRole("status", { name: "Open draft" })).toBeNull();
      expect(within(page).queryByRole("button", { name: /^Standard plan/ })).toBeNull();
    });
  },
});

/** Draft view for a login that only reads: the banner shows, with no action. */
export const ViewReadOnly = mapAt("/?draft=d1", {
  me: { ...ADMIN, team: { role: "viewer", wren: ["read"], flags: {} } },
  check: async (page) => {
    const open = await banner(page);
    await expect(within(open).getByText("Add a plan")).toBeVisible();
    await expect(within(open).queryByRole("button", { name: /^(Propose|Apply|Drop) / })).toBeNull();
  },
});

/** A draft that does not exist: the page says so and the live Map stays. */
export const Missing = mapAt("/?draft=nope", {
  check: async (page) => {
    await station(page, "Engaged");
    await expect(await within(page).findByRole("alert")).toBeVisible();
    await expect(within(page).queryByRole("status", { name: "Open draft" })).toBeNull();
  },
});

/** Propose a draft that is still a draft, from its banner. */
export const Propose = mapAt("/?draft=d2", {
  check: async (page) => {
    const open = await banner(page);
    await expect(within(open).getByText("Draft")).toBeVisible();
    await userEvent.click(within(open).getByRole("button", { name: "Propose Follow-up step" }));
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeDraftPropose"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({ id: "d2" });
  },
});

/** Drop from the banner asks why; the reason goes with the drop, and the Map goes back to live. */
export const Drop = mapAt("/?draft=d2", {
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
export const Apply = mapAt("/?draft=d1", {
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
export const ApplyLiveChanged = mapAt("/?draft=d2", {
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
export const ApplyRefused = mapAt("/?draft=d2", {
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
