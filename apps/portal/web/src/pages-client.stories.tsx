/**
 * Each client app's first page, as the client's owner sees it, on the fake server
 * (designs/2026-10-18-portal-page-stories.md). `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
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
