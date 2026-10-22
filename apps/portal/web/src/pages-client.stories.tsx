/**
 * Each client app's first page, as the client's owner sees it, on the fake server
 * (designs/2026-10-18-portal-page-stories.md). `pnpm --filter @wren/portal storybook`.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { freshStory } from "./mocks/api.js";
import { starring } from "./mocks/data/apps.js";
import { failedIn, pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Pages/Client" };
export default meta;

export const Today = pageAt("/");
export const Work = pageAt("/work");
export const Reactivation = pageAt("/reactivation");
export const Leads = pageAt("/leads");
export const Texts = pageAt("/texts");
export const Calls = pageAt("/calls");
export const Payments = pageAt("/payments");
export const Documents = pageAt("/documents");
export const Pipelines = pageAt("/pipelines");
export const People = pageAt("/people");
export const Marketplace = pageAt("/marketplace");
export const Marketing = pageAt("/marketing");
export const Sites = pageAt("/sites");
export const Learn = pageAt("/learn");
export const Notes = pageAt("/notes");
export const Calendar = pageAt("/calendar");

/** The agenda as `Rows`: a band per day, a call a row, and a press opens it beside the list. */
export const CalendarAgenda = pageAt("/calendar?v=list&d=2026-10-12", {
  check: async (page) => {
    await expect(await within(page).findByText("Tuesday, October 13")).toBeVisible();
    await expect(within(page).getByText("Thursday, October 15")).toBeVisible();
    const ada = await within(page).findByRole("button", { name: "Ada North" });
    await expect(within(page).getByText("Reactivation")).toBeVisible();
    // A press on a call puts it in the address, which opens its panel.
    await userEvent.click(ada);
    await waitFor(() => expect(ada.closest("tr, li")).toHaveAttribute("data-row"));
  },
});

/** Notes as `Rows`: a star writes, the list reads again, and two fast presses both land. */
const stars = starring();
export const NotesRows: StoryObj = {
  ...pageAt("/notes", {
    answers: stars.answers,
    check: async (page) => {
      const row = (name: string) => within(page).findByRole("link", { name });
      await expect(await row("Spring promo plan")).toBeVisible();
      // Rows, not a hand list: a table on a wide screen, a list on a phone.
      await expect(
        within(page).queryByRole("table", { name: "notes" }) ??
          within(page).getByRole("list", { name: "notes" }),
      ).toBeInTheDocument();
      // Spring promo plan starts starred. Press it: it reads again and shows unstarred.
      await userEvent.click(
        await within(page).findByRole("button", { name: "Unstar Spring promo plan" }),
      );
      await within(page).findByRole("button", { name: "Star Spring promo plan" });
      // Two rows pressed fast: both stars land, neither press is lost.
      await userEvent.click(
        within(page).getByRole("button", { name: "Star Call back the Brandt job" }),
      );
      await userEvent.click(
        within(page).getByRole("button", { name: "Star Crew schedule for November" }),
      );
      await waitFor(() => {
        expect(
          within(page).getByRole("button", { name: "Unstar Call back the Brandt job" }),
        ).toBeVisible();
        expect(
          within(page).getByRole("button", { name: "Unstar Crew schedule for November" }),
        ).toBeVisible();
      });
    },
  }),
  // The server's stars start over with each story.
  beforeEach: () => {
    stars.reset();
    freshStory();
  },
};

/** Mentions as `Rows`: a new tag reads heavier with a dot, and a row opens its note. */
export const NoteMentions = pageAt("/notes/mentions", {
  check: async (page) => {
    const link = await within(page).findByRole("link", { name: "Spring promo plan" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/notes/doc/n1");
    await expect(within(page).getByRole("img", { name: "New" })).toBeVisible();
  },
});
export const Voice = pageAt("/voice");
export const Settings = pageAt("/settings");
export const Library = pageAt("/library");
export const Account = pageAt("/account");

/** The list: a person's name with an avatar, their stage as its square, their last touch as an age. */
export const PeopleList = pageAt("/people/people", {
  check: async (page) => {
    const names = await within(page).findAllByRole("link", { name: "Ada North" });
    await expect(names[0]).toBeVisible();
  },
});

/** The open record's panel (wide) or sheet (phone). */
const peekOf = () =>
  document.body.querySelector<HTMLElement>(
    'aside[aria-label="Person"], [role="dialog"][aria-label="Person"]',
  );

/** A person's peek (`?<record's one name>=<id>`): their properties, newest activity and one action. */
export const PersonPeek = pageAt("/people/people?person=1", {
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
});

/** The shell while nothing has come back, and when every read fails: an error, never "nothing waits". */
export const Loading = pageAt("/", { mode: "pending" });
export const Failed = pageAt("/", { mode: "fails", check: failedIn("Needs you") });
