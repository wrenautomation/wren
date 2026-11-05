/**
 * Account's lists as rows (designs/2026-10-21-crm-rows-everywhere.md, B4), on the fake server
 * (`./mocks/data/account.ts`): each page loads, a row's action runs and shows, and two quick
 * presses on two rows send one write. `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { freshStory } from "./mocks/api.js";
import { ACCOUNT_ANSWERS, ACCOUNT_CALLS, forgetAccount } from "./mocks/data/account.js";
import { pageAt, tidy } from "./mocks/page.js";

const meta: Meta = { title: "Client/Back office", id: "pages-account" };
export default meta;

/** A page on the account answers; each story starts from the same lists. */
const accountAt = (at: string, check?: (page: HTMLElement) => void | Promise<void>) => ({
  ...pageAt(at, { answers: ACCOUNT_ANSWERS, ...(check ? { check } : {}) }),
  beforeEach: [freshStory, forgetAccount],
});

/** The row holding `text`: a table row, or a phone's list item. */
const rowOf = async (page: HTMLElement, text: string | RegExp) => {
  // The first match in a row: a delivery log under a list names its hook again.
  const cells = await within(page).findAllByText(text);
  const row = cells.map((c) => c.closest<HTMLElement>("tr, li")).find(Boolean);
  if (!row) throw new Error(`"${text}" is not in a row`);
  return within(row);
};

/** Every confirm answers yes while `run` runs. */
async function yes(run: () => Promise<void>) {
  const was = window.confirm;
  window.confirm = () => true;
  try {
    await run();
  } finally {
    window.confirm = was;
  }
}

/** The writes sent so far, by path. */
const sent = (path: string) => ACCOUNT_CALLS.filter((c) => c.path === path);

/** An action behind a row's ⋯: open it, press the item. */
async function fromMenu(row: ReturnType<typeof within>, title: string | RegExp, item: string) {
  // The row menu comes back once the row's last write ends ("Checking" holds it).
  await userEvent.click(await row.findByRole("button", { name: title }, { timeout: 5_000 }));
  await userEvent.click(await within(document.body).findByRole("button", { name: item }));
}

/** People: a row each with role and last seen; their title opens their access under the row. */
export const People = tidy(
  accountAt("/office/team", async (page) => {
    const row = await rowOf(page, "sam@acme.example");
    await userEvent.click(row.getByRole("button", { name: "sam@acme.example" }));
    await expect(await within(page).findByText("Act in Leads on Email.")).toBeVisible();
    await expect(await within(page).findByText("History (1)")).toBeVisible();
  }),
);

/** End now on an extra grant asks first, then the grant leaves the list. */
export const PersonGrantEnd = tidy(
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
export const PersonRemove = accountAt("/office/team", async (page) => {
  const row = await rowOf(page, "pat@acme.example");
  await yes(async () => {
    fireEvent.click(row.getByRole("button", { name: "Remove" }));
  });
  await waitFor(() => expect(within(page).queryByText("pat@acme.example")).toBeNull());
  await expect(sent("delivery/remove")).toHaveLength(1);
});

/** Social: each platform's accounts as rows; a TikTok's numbers and newest videos under its row. */
export const Social = tidy(
  accountAt("/office/social", async (page) => {
    await expect(await within(page).findByText("@acme-plumbing")).toBeVisible();
    await expect(await within(page).findByText("Fix a dripping tap in two minutes")).toBeVisible();
    await expect(await within(page).findByText(/stopped the sign-in/)).toBeVisible();
  }),
);

/** Check (behind ⋯) sends the write; Turn off asks first, then the account leaves. */
export const SocialActions = accountAt("/office/social", async (page) => {
  const row = await rowOf(page, "@sam-rivera");
  await fromMenu(row, /^More for/, "Check");
  await waitFor(() => expect(sent("social/check")).toHaveLength(1));
  await yes(() => fromMenu(row, /^More for/, "Turn off"));
  await waitFor(() => expect(within(page).queryByText("@sam-rivera")).toBeNull());
  await expect(sent("social/disconnect")).toHaveLength(1);
});

/** Mail: a row per mailbox with its state; what blocks one and its next step sit under it. */
export const Mail = accountAt("/office/mail", async (page) => {
  await expect(await within(page).findByText("sales@acme.example")).toBeVisible();
  await expect(await within(page).findByText(/has not trusted Wren's app/)).toBeVisible();
});

/** Check (behind ⋯) sends the write for that mailbox. */
export const MailCheck = accountAt("/office/mail", async (page) => {
  const row = await rowOf(page, "owner@acme.example");
  await fromMenu(row, /^More for/, "Check");
  await waitFor(() => expect(sent("mail/check")).toHaveLength(1));
  await expect(sent("mail/check")[0]?.body).toEqual(expect.objectContaining({ account: 11 }));
});

/** Feedback: "When you're ready for more" as a row with its pitch under it; I'm interested sends. */
export const Feedback = {
  ...pageAt("/project/overview", {
    answers: ACCOUNT_ANSWERS,
    check: async (page) => {
      const row = await rowOf(page, "Reviews");
      await expect(await within(page).findByText(/Ask every happy customer/)).toBeVisible();
      await fromMenu(row, /^More for/, "I'm interested");
      await waitFor(() => expect(sent("delivery/interest")).toHaveLength(1));
    },
  }),
  beforeEach: [freshStory, forgetAccount],
};
