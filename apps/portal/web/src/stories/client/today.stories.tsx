/** A client's Today: needs you, approve, messages, calendar. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { pageAt, shows, tidy } from "../../mocks/page.js";
import { answers } from "./client-places-kit.js";

const meta: Meta = { title: "Client/Today" };
export default meta;

export const Default = pageAt("/", { empty: false });

export const NeedsYou = pageAt("/today/needs-you", {
  answers,
  check: shows("Needs you", "Answer"),
});

export const Approve = pageAt("/today/approve", {
  answers,
  check: shows("To approve", "Approve"),
});

export const Messages = pageAt("/today/messages", {
  answers,
  check: shows("Messages", "Reply"),
});

export const Calls = pageAt("/today/calls", { answers, check: shows("Calls") });

export const Calendar = pageAt("/today/calendar", { empty: false });

/** The agenda as `Rows`: a band per day, a call a row, and a press opens it beside the list. */
export const CalendarAgenda = tidy(
  pageAt("/today/calendar?v=list&d=2026-10-12", {
    check: async (page) => {
      await expect(await within(page).findByText("Tuesday, October 13")).toBeVisible();
      await expect(within(page).getByText("Thursday, October 15")).toBeVisible();
      const ada = await within(page).findByRole("button", { name: "Ada North" });
      // The Offer column is wide only; a phone keeps the name and the time.
      const row = ada.closest<HTMLElement>("tr, li");
      if (!row) throw new Error("Ada North is not in a row");
      // the sidebar names Reactivation too: read the row
      if (window.innerWidth > 640)
        await expect(within(row).getByText("Reactivation")).toBeVisible();
      // A press on a call puts it in the address, which opens its panel.
      await userEvent.click(ada);
      await waitFor(() => expect(row).toHaveAttribute("data-row"));
    },
  }),
);
