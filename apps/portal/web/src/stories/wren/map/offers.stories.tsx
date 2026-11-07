/** Map › Offers and Terms. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { refuse } from "../../../mocks/api.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { forgetTermsCalls, TERMS_CALLS } from "../../../mocks/data/offers.js";
import { pageAt } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Map/Offers" };
export default meta;

/** The text is on the page once its list has come in. */
const shows =
  (...texts: string[]) =>
  async (page: HTMLElement) => {
    for (const text of texts)
      await expect((await within(page).findAllByText(text))[0]).toBeVisible();
  };

// Offers: each offer with its versions, and the terms it sells on.
export const All = pageAt("/map/offers", { me: ADMIN, check: shows("Starter", "Growth") });

export const Terms = pageAt("/map/terms", {
  me: ADMIN,
  check: async (page) => {
    await shows("standard")(page);
    // A phone's row shows one property beside the name (the state): the offer reads in the wide table.
    if (within(page).queryByRole("table")) await shows("growth")(page);
  },
});

/** The read fails: the page says so and never "No terms are live yet." */
export const TermsFailed = pageAt("/map/terms", {
  me: ADMIN,
  answers: { "console/recordsList": refuse(500, "The terms failed, as asked.") },
  check: async (page) => {
    await expect(await within(page).findByRole("alert")).toBeVisible();
    await expect(within(page).queryByText("No terms are live yet.")).toBeNull();
  },
});

/** Propose version asks for the offer, plan, date, terms JSON and why, and sends them as typed. */
export const TermsPropose = pageAt("/map/terms", {
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
