/**
 * Each client app's first page, as the client's owner sees it, on the fake server
 * (designs/2026-10-18-portal-page-stories.md). `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { failedIn, pageAt, tidy } from "./mocks/page.js";

const meta: Meta = { title: "Client/Places", id: "pages-client" };
export default meta;

export const Today = pageAt("/");
export const Project = pageAt("/project");
export const Campaigns = pageAt("/campaigns");
export const People = pageAt("/people");
export const Office = pageAt("/office");
export const Calendar = pageAt("/today/calendar");

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

/** The list: a person's name with an avatar, their stage as its square, their last touch as an age. */
export const PeopleList = tidy(
  pageAt("/people/people", {
    check: async (page) => {
      const names = await within(page).findAllByRole("link", { name: "Ada North" });
      await expect(names[0]).toBeVisible();
    },
  }),
);

/** The open record's panel (wide) or sheet (phone). */
const peekOf = () =>
  document.body.querySelector<HTMLElement>(
    'aside[aria-label="Person"], [role="dialog"][aria-label="Person"]',
  );

/** A person's peek (`?<record's one name>=<id>`): their properties, newest activity and one action. */
export const PersonPeek = tidy(
  pageAt("/people/people?person=1", {
    check: async () => {
      await waitFor(() => expect(peekOf()).not.toBeNull());
      const shell = peekOf() as HTMLElement;
      // A wide screen floats a panel; a phone slides up a sheet.
      if (shell.tagName !== "ASIDE") expect(shell.hasAttribute("data-sheet")).toBe(true);
      const peek = within(shell);
      await expect(await peek.findByRole("heading", { name: "Ada North" })).toBeVisible();
      for (const label of ["Stage", "Warmth", "Persona", "Last touch", "Last touch on"])
        await expect(peek.getByText(label, { selector: "dt" })).toBeVisible();
      const last = await peek.findByRole("region", { name: "Last activity" });
      await expect(within(last).getByText("Asked if the winter run has room.")).toBeVisible();
      await expect(peek.getByRole("link", { name: "Open the full record" })).toBeVisible();
    },
  }),
);

/** The shell while nothing has come back, and when every read fails: an error, never "nothing waits". */
export const Loading = pageAt("/", { mode: "pending" });
export const Failed = pageAt("/", { mode: "fails", check: failedIn("Needs you") });
