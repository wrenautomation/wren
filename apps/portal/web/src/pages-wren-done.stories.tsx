/**
 * Wren's pages that follow the Design Language artifact, as Wren's admin sees them, on the fake
 * server: Today, Inbox and Offers. The rest of Wren's pages are in `pages-wren.stories.tsx`
 * (Revamp). Same story ids as before the split (`pages-wren--<app>`).
 */
import type { Meta } from "@storybook/react-vite";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { refuse } from "./mocks/api.js";
import { ADMIN } from "./mocks/data/me.js";
import { forgetTermsCalls, TERMS_CALLS } from "./mocks/data/offers.js";
import { failedIn, pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Done/Wren", id: "pages-wren" };
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
    const view = within(page);
    await expect(await view.findByText("Nothing waits on you.")).toBeVisible();
    await expect(await view.findByText("Nothing is due today.")).toBeVisible();
  },
});

/** Every read fails: Move says so with a retry, never "Nothing waits on you." */
export const TodayFailed = pageAt("/", {
  me: ADMIN,
  mode: "fails",
  check: async (page) => failedIn("Move")(page),
});

/** Only the counts fail: Move says so, and Write still draws. */
export const TodayCountsFailed = pageAt("/", {
  me: ADMIN,
  answers: { "console/recordsCounts": refuse(500, "The counts failed, as asked.") },
  check: async (page) => {
    const today = page;
    await failedIn("Move")(today);
    await expect(await within(today).findByText("YouTube long-form")).toBeVisible();
  },
});

/** On a phone: the dock under the page carries the Move count, . */
export const TodayPhone = {
  ...pageAt("/", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByRole("heading", { name: /^Move/ })).toBeVisible();
    },
  }),
  globals: { viewport: { value: "phone" } },
};
export const Inbox = pageAt("/inbox", { me: ADMIN });
/** Your mail: the Monitor's queue of your own email. */
export const InboxMail = pageAt("/inbox/mail?view=needs_you", { me: ADMIN });
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
  check: async (page) => {
    await shows("standard")(page);
    // A phone's row shows one property beside the name (the state): the offer reads in the wide table.
    if (within(page).queryByRole("table")) await shows("growth")(page);
  },
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
