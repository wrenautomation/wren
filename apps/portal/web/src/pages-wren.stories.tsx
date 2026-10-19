/**
 * Each of Wren's own apps' first page, as Wren's admin sees it, on the fake server
 * (designs/2026-10-18-portal-page-stories.md). `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { AREAS_TEAM } from "./areas.js";
import { refuse } from "./mocks/api.js";
import { ADMIN } from "./mocks/data/me.js";
import { forgetTermsCalls, TERMS_CALLS } from "./mocks/data/offers.js";
import { failedIn, pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Pages/Wren" };
export default meta;

/** A records answer with no rows. */
const NONE = { record: "", view: null, rows: [], total: 0, counts: {}, next: null, totals: {} };

/**
 * Today: Write (a quota short on YouTube long-form and Instagram, met on LinkedIn and TikTok, X
 * on Autopilot) and Move (Ada's and Bo's lines under their journeys, the rest under Others).
 */
export const Today = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    const view = within(page);
    await expect(await view.findByRole("heading", { name: /^Write/ })).toBeVisible();
    await expect(await view.findByRole("heading", { name: /^Move/ })).toBeVisible();
    await expect(await view.findByText("YouTube long-form")).toBeVisible();
    await expect(await view.findByText("Autopilot")).toBeVisible();
    // Met quotas fold away.
    await expect(await view.findByText(/^Met today/)).toBeVisible();
    await expect((await view.findAllByText("Prepare call")).length).toBeGreaterThan(1);
    await expect((await view.findAllByText("Nudge or drop")).length).toBe(1);
    await expect(await view.findByText("Others")).toBeVisible();
    // Parked, activity and a draft are not moves.
    await expect(view.queryByText("Kit")).toBeNull();
  },
});

/** Nothing to write and nothing to move: Today says so once every read is in. */
export const TodayEmpty = pageAt("/", {
  me: ADMIN,
  answers: {
    "console/recordsList": () => NONE,
    "console/recordsCounts": (b) => ({
      totals: (Array.isArray(b.asks) ? b.asks : []).map(() => 0),
    }),
  },
  check: async (page) => {
    await expect(await within(page).findByText("Nothing waits on you.")).toBeVisible();
    await expect(await within(page).findByText("Nothing is due today.")).toBeVisible();
  },
});

/** Every read fails: Move says so with a retry, never "Nothing waits on you." */
export const TodayFailed = pageAt("/", {
  me: ADMIN,
  mode: "fails",
  check: failedIn("Move"),
});

/** Only the counts fail: Move says so, and Write still draws. */
export const TodayCountsFailed = pageAt("/", {
  me: ADMIN,
  answers: { "console/recordsCounts": refuse(500, "The counts failed, as asked.") },
  check: async (page) => {
    await failedIn("Move")(page);
    await expect(await within(page).findByText("YouTube long-form")).toBeVisible();
  },
});

/** On a phone: the dock under the page carries the Move count, and the apps sit by area. */
export const TodayPhone = {
  ...pageAt("/", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByRole("heading", { name: /^Move/ })).toBeVisible();
      const area = await view.findAllByRole("heading", { name: AREAS_TEAM[0]?.label ?? "" });
      await expect(area.length).toBeGreaterThan(0);
    },
  }),
  globals: { viewport: { value: "phone" } },
};
export const Inbox = pageAt("/inbox", { me: ADMIN });
export const People = pageAt("/people", { me: ADMIN });
export const Outbound = pageAt("/outbound", { me: ADMIN });
export const Pipelines = pageAt("/pipelines", { me: ADMIN });
export const Content = pageAt("/content", { me: ADMIN });
export const Engage = pageAt("/engage", { me: ADMIN });
export const Ads = pageAt("/ads", { me: ADMIN });
export const Analytics = pageAt("/analytics", { me: ADMIN });
export const Sites = pageAt("/sites", { me: ADMIN });
export const Learn = pageAt("/learn", { me: ADMIN });
export const Workflows = pageAt("/workflows", { me: ADMIN });
export const Loops = pageAt("/loops", { me: ADMIN });
export const Handlers = pageAt("/handlers", { me: ADMIN });
export const Review = pageAt("/review", { me: ADMIN });
export const Ask = pageAt("/ask", { me: ADMIN });
export const Clients = pageAt("/clients", { me: ADMIN });
export const Money = pageAt("/money", { me: ADMIN });
export const Team = pageAt("/team", { me: ADMIN });
export const Library = pageAt("/library", { me: ADMIN });
export const Notes = pageAt("/notes", { me: ADMIN });
export const Calendar = pageAt("/calendar", { me: ADMIN });
export const Marketplace = pageAt("/marketplace", { me: ADMIN });

/** The group editor reads journeys: pick "A journey", then a funnel, a stage and a status. */
export const GroupsJourney = pageAt("/people/groups", {
  me: ADMIN,
  answers: {
    "people/segmentContext": {
      traits: ["plan"],
      segments: [],
      describe: false,
      funnels: [
        {
          id: "organic",
          name: "Organic",
          stages: [
            { key: "engaged", label: "Engaged" },
            { key: "booked", label: "Booked" },
          ],
          entries: ["web", "mail"],
        },
      ],
    },
    "people/segmentPreview": { size: 2, sample: [], words: "journey in Organic" },
  },
  check: async (page) => {
    const view = within(page);
    await userEvent.click(await view.findByRole("button", { name: "New group" }));
    await userEvent.click(await view.findByRole("button", { name: "Add condition" }));
    await userEvent.selectOptions(await view.findByLabelText("Kind of condition"), "journey");
    await userEvent.selectOptions(await view.findByLabelText("Funnel"), "organic");
    await userEvent.selectOptions(await view.findByLabelText("Stage"), "booked");
    await userEvent.selectOptions(await view.findByLabelText("Stage only or later"), "past");
    await userEvent.selectOptions(await view.findByLabelText("Journey status"), "open");
    await expect(await view.findByLabelText("Entry")).toBeVisible();
    await waitFor(() => expect(view.getByLabelText("Stage")).toHaveValue("booked"));
    // The count comes a beat after the last change: wait for it, or its call lands in the next
    // story's table, where nothing answers it.
    await expect(await view.findByText("journey in Organic")).toBeVisible();
  },
});

/** The text is on the page once its list has come in. */
const shows =
  (...texts: string[]) =>
  async (page: HTMLElement) => {
    for (const text of texts)
      await expect((await within(page).findAllByText(text))[0]).toBeVisible();
  };

// Offers: each offer with its versions, and the terms it sells on.
export const OffersAll = pageAt("/offers/all", { me: ADMIN, check: shows("Starter", "Growth") });
export const OffersTerms = pageAt("/offers/terms", {
  me: ADMIN,
  check: shows("standard", "growth"),
});
/** The read fails: the page says so and never "No terms are live yet." */
export const OffersTermsFailed = pageAt("/offers/terms", {
  me: ADMIN,
  answers: { "console/recordsList": refuse(500, "The terms failed, as asked.") },
  check: async (page) => {
    await expect(await within(page).findByRole("alert")).toBeVisible();
    await expect(within(page).queryByText("No terms are live yet.")).toBeNull();
  },
});
/** Propose version asks for the offer, plan, date, terms JSON and why, and sends them as typed. */
export const OffersTermsPropose = pageAt("/offers/terms", {
  me: ADMIN,
  check: async (page) => {
    forgetTermsCalls();
    const ui = within(page);
    await userEvent.click(await ui.findByRole("button", { name: "Propose version" }));
    // The form opens in a dialog, outside the page.
    const form = within(await within(document.body).findByRole("dialog"));
    const offer = (await form.findByRole("combobox", { name: "Offer" })) as HTMLSelectElement;
    await userEvent.selectOptions(offer, offer.options[1] as HTMLOptionElement);
    await userEvent.type(await form.findByLabelText("Plan"), "standard");
    await userEvent.type(await form.findByLabelText("Effective from"), "2030-01-01");
    await fireEvent.change(await form.findByLabelText("Terms JSON"), {
      target: { value: '{"currency":"usd","payDays":7}' },
    });
    await userEvent.type(await form.findByLabelText("Why"), "Test price");
    await userEvent.click(
      await form.findByRole("button", { name: /^(Propose version|Send|Save)$/ }),
    );
    await waitFor(() => expect(TERMS_CALLS).toHaveLength(1));
    expect(TERMS_CALLS[0]).toMatchObject({
      offer: expect.any(String),
      plan: "standard",
      from: "2030-01-01",
      why: "Test price",
      body: { currency: "usd", payDays: 7 },
    });
  },
});

// Numbers: the funnel tables, and the books pages that moved here from Money.
export const NumbersFunnels = pageAt("/numbers/funnels", { me: ADMIN, check: shows("Engaged") });
export const NumbersEntries = pageAt("/numbers/entries", {
  me: ADMIN,
  check: shows("Spring list"),
});
export const NumbersOffers = pageAt("/numbers/offers", { me: ADMIN, check: shows("Starter") });
export const NumbersEconomics = pageAt("/numbers/economics", { me: ADMIN });
export const NumbersMonths = pageAt("/numbers/months", { me: ADMIN });
export const NumbersChannels = pageAt("/numbers/channels", { me: ADMIN });
export const NumbersCohorts = pageAt("/numbers/cohorts", { me: ADMIN });

// Pipelines: the tabs only Wren's own app has.
export const PipelinesDeals = pageAt("/pipelines/deals", { me: ADMIN, check: shows("Cai Moreno") });
export const PipelinesCalls = pageAt("/pipelines/calls", { me: ADMIN });
export const PipelinesEntries = pageAt("/pipelines/entries", {
  me: ADMIN,
  check: shows("mail", "ads1"),
});
