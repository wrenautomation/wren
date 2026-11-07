/** One person's journey: live, stale, dropped, done. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { pageAt, tidy } from "../../../mocks/page.js";

const meta: Meta = { title: "Client/People/Journeys" };
export default meta;

/** A person's page leads with their journey: the steps reached, days at the step, owner and fit. */
export const Default = tidy(
  pageAt("/people/people/1", {
    check: async (page) => {
      const steps = await within(page).findByRole("list", { name: "Steps reached" });
      await expect(within(steps).getByText("Booked")).toBeVisible();
      await expect(within(steps).getByText("2 days here")).toBeVisible();
      await expect(within(page).getByText("82 of 100")).toBeVisible();
    },
  }),
);

/** A journey past its step's limit says so at the step. */
export const Stale = tidy(
  pageAt("/people/people/2", {
    check: async (page) => {
      await expect(await within(page).findByText("19 days here, past its limit")).toBeVisible();
    },
  }),
);

/** A dropped journey: where it stopped and why. */
export const Dropped = tidy(
  pageAt("/people/people/3", {
    check: async (page) => {
      await expect(await within(page).findByText("No budget this year")).toBeVisible();
    },
  }),
);

/** A done journey with five steps and a long source. */
export const Done = tidy(
  pageAt("/people/people/4", {
    check: async (page) => {
      await expect(await within(page).findByText("Proposal sent")).toBeVisible();
    },
  }),
);
