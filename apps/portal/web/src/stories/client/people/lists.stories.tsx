/** A client's people, groups, broadcasts and import. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { pageAt, shows, tidy } from "../../../mocks/page.js";
import { answers } from "../client-places-kit.js";

const meta: Meta = { title: "Client/People/Lists" };
export default meta;

/** The open record's panel (wide) or sheet (phone). */
const peekOf = () =>
  document.body.querySelector<HTMLElement>(
    'aside[aria-label="Person"], [role="dialog"][aria-label="Person"]',
  );

export const Default = pageAt("/people");

/** The list: a person's name with an avatar, their stage as its square, their last touch as an age. */
export const List = tidy(
  pageAt("/people/people", {
    check: async (page) => {
      const names = await within(page).findAllByRole("link", { name: "Ada North" });
      await expect(names[0]).toBeVisible();
    },
  }),
);

/** A person's peek (`?<record's one name>=<id>`): their properties, newest activity and one action. */
export const Peek = tidy(
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

export const InJourney = pageAt("/people/people?view=journey", {
  answers,
  check: shows("People"),
});

export const Stale = pageAt("/people/people?view=stale", {
  answers,
  check: shows("People"),
});

export const Timeline = pageAt("/people/timeline", { answers, check: shows("Timeline") });

export const Sent = pageAt("/people/sent", { answers, check: shows("Sent") });

export const Groups = pageAt("/people/groups", {
  answers,
  check: shows("Groups", "New group"),
});

export const Members = pageAt("/people/members", { answers, check: shows("Members") });

export const Broadcasts = pageAt("/people/broadcasts", {
  answers,
  check: shows("Broadcasts", "New broadcast"),
});

export const Recipients = pageAt("/people/recipients", {
  answers,
  check: shows("Recipients"),
});

export const Import = pageAt("/people/import", {
  answers,
  check: shows("Import", "Import a CSV"),
});
