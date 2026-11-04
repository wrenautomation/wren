/**
 * Each of Wren's own apps' first page that follows no artifact yet (Revamp), as Wren's admin sees
 * it, on the fake server (designs/2026-10-18-portal-page-stories.md). The pages that follow one
 * are in `pages-wren-done.stories.tsx`; Engage and Outbound in `pages-wren-port.stories.tsx`.
 * `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ADMIN } from "./mocks/data/me.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Revamp/Wren", id: "pages-wren" };
export default meta;

export const People = pageAt("/people", { me: ADMIN });
export const Pipelines = pageAt("/people", { me: ADMIN });
export const Content = pageAt("/content", { me: ADMIN });
export const Ads = pageAt("/campaigns", { me: ADMIN });
export const Analytics = pageAt("/campaigns", { me: ADMIN });
export const Sites = pageAt("/campaigns", { me: ADMIN });
export const Clients = pageAt("/people", { me: ADMIN });
export const Money = pageAt("/office", { me: ADMIN });
export const Team = pageAt("/office", { me: ADMIN });
export const Library = pageAt("/map", { me: ADMIN });
export const Notes = pageAt("/notes", { me: ADMIN });
export const Calendar = pageAt("/calendar", { me: ADMIN });

/** The group editor reads journeys: pick "A journey", then a node, now or earlier, and a status. */
export const GroupsJourney = pageAt("/people/groups", {
  me: ADMIN,
  answers: {
    "people/segmentContext": {
      traits: ["plan"],
      segments: [],
      describe: false,
      shape: {
        nodes: [
          { id: "engaged", name: "Engaged", kind: "step", depth: 1 },
          { id: "booked", name: "Booked", kind: "step", depth: 2 },
        ],
        sources: ["web", "mail"],
      },
    },
    "people/segmentPreview": { size: 2, sample: [], words: "journey through Booked" },
  },
  check: async (page) => {
    const view = within(page);
    await userEvent.click(await view.findByRole("button", { name: "New group" }));
    await userEvent.click(await view.findByRole("button", { name: "Add condition" }));
    await userEvent.selectOptions(await view.findByLabelText("Kind of condition"), "journey");
    await userEvent.selectOptions(await view.findByLabelText("Node"), "booked");
    await userEvent.selectOptions(await view.findByLabelText("Node now or ever"), "past");
    await userEvent.selectOptions(await view.findByLabelText("Journey status"), "open");
    await expect(await view.findByLabelText("Source")).toBeVisible();
    await waitFor(() => expect(view.getByLabelText("Node")).toHaveValue("booked"));
    // The count comes a beat after the last change: wait for it, or its call lands in the next
    // story's table, where nothing answers it.
    await expect(await view.findByText("journey through Booked")).toBeVisible();
  },
});

/** The text is on the page once its list has come in. */
const shows =
  (...texts: string[]) =>
  async (page: HTMLElement) => {
    for (const text of texts)
      await expect((await within(page).findAllByText(text))[0]).toBeVisible();
  };

// Numbers: the shape tables, and the books pages that moved here from Money.
export const NumbersFunnels = pageAt("/map/shape", { me: ADMIN, check: shows("Engaged") });
export const NumbersOffers = pageAt("/map/offer-numbers", { me: ADMIN, check: shows("Starter") });
export const NumbersEconomics = pageAt("/map/economics", { me: ADMIN });
export const NumbersMonths = pageAt("/map/months", { me: ADMIN });
export const NumbersChannels = pageAt("/map/channels", { me: ADMIN });
export const NumbersCohorts = pageAt("/map/cohorts", { me: ADMIN });

// Pipelines: the tabs only Wren's own app has.
export const PipelinesDeals = pageAt("/people/deals", { me: ADMIN, check: shows("Cai Moreno") });
export const PipelinesCalls = pageAt("/people/calls", { me: ADMIN });
export const PipelinesEntries = pageAt("/people/entries", {
  me: ADMIN,
  check: shows("Spring list", "Winter ads"),
});

// Admin > Systems: every app, split by the synthetic shape. The shape's nodes fill the first group.
export const SettingsSystems = pageAt("/office/systems", {
  me: ADMIN,
  check: async (page) => {
    const view = within(page);
    await expect(await view.findByRole("heading", { name: /^On your shape/ })).toBeVisible();
    await expect(await view.findByRole("heading", { name: /^Not on the shape/ })).toBeVisible();
    // Each group draws its apps as `Rows`: a table, or on a phone a list.
    await expect(await view.findByLabelText("Apps on your shape")).toBeVisible();
    await expect(await view.findByLabelText("Apps not on your shape")).toBeVisible();
  },
});

// Admin > Guide: every app by area as `Rows`, with its pages linked.
export const SettingsGuide = pageAt("/office/guide", {
  me: ADMIN,
  check: async (page) => {
    const view = within(page);
    await expect(await view.findByRole("heading", { name: "Getting around" })).toBeVisible();
    await expect((await view.findAllByLabelText(/ apps$/)).length).toBeGreaterThan(0);
  },
});
// While the shape is slow, Systems shows its header and a skeleton, not a blank page.
export const SettingsSystemsPending = pageAt("/office/systems", { me: ADMIN, mode: "pending" });
