/** A client's team: people, grants, you, look. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { pageAt, shows, tidy } from "../../../mocks/page.js";
import { answers } from "../client-places-kit.js";
import { accountAt, fromMenu, rowOf, sent, yes } from "./account-kit.js";

const meta: Meta = { title: "Client/Back office/Team" };
export default meta;

/** People: a row each with role and last seen; their title opens their access under the row. */
export const Default = tidy(
  accountAt("/office/team", async (page) => {
    const row = await rowOf(page, "sam@acme.example");
    await userEvent.click(row.getByRole("button", { name: "sam@acme.example" }));
    await expect(await within(page).findByText("Act in Leads on Email.")).toBeVisible();
    await expect(await within(page).findByText("History (1)")).toBeVisible();
  }),
);

/** End now on an extra grant asks first, then the grant leaves the list. */
export const GrantEnd = tidy(
  accountAt("/office/team", async (page) => {
    const row = await rowOf(page, "sam@acme.example");
    await userEvent.click(row.getByRole("button", { name: "sam@acme.example" }));
    const grant = await rowOf(page, "Act in Leads on Email.");
    await yes(() => fromMenu(grant, /^More for/, "End now"));
    await waitFor(() => expect(within(page).queryByText("Act in Leads on Email.")).toBeNull());
    await expect(sent("console/grantEnd")).toHaveLength(1);
  }),
);

/** Remove a person asks first, then they leave the list. */
export const Remove = accountAt("/office/team", async (page) => {
  const row = await rowOf(page, "pat@acme.example");
  await yes(async () => {
    fireEvent.click(row.getByRole("button", { name: "Remove" }));
  });
  await waitFor(() => expect(within(page).queryByText("pat@acme.example")).toBeNull());
  await expect(sent("delivery/remove")).toHaveLength(1);
});

export const Grants = pageAt("/office/grants", {
  answers,
  check: shows("Grants", "Add grant"),
});

export const You = pageAt("/office/you", { answers, check: shows("Your settings") });

export const Look = pageAt("/office/look", { answers, check: shows("Look") });
