/**
 * Account's lists as rows (designs/2026-10-21-crm-rows-everywhere.md, B4), on the fake server
 * (`./mocks/data/account.ts`): each page loads, a row's action runs and shows, and two quick
 * presses on two rows send one write. `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { freshStory, settled } from "./mocks/api.js";
import { ACCOUNT_ANSWERS, ACCOUNT_CALLS, forgetAccount } from "./mocks/data/account.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Pages/Account" };
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
  await userEvent.click(row.getByRole("button", { name: title }));
  await userEvent.click(await within(document.body).findByRole("button", { name: item }));
}

/** Webhooks: a row each with its state and what it hears; a failed test or off hook says why under it. */
export const Webhooks = accountAt("/account/webhooks", async (page) => {
  await expect((await within(page).findAllByText("Zapier: new reply"))[0]).toBeVisible();
  await expect(await within(page).findByText(/Failing since/)).toBeVisible();
  await expect(await within(page).findByText(/Turned off/, { selector: "p" })).toBeVisible();
});

/** Send test on a hook shows its answer under the row. */
export const WebhookTest = accountAt("/account/webhooks", async (page) => {
  const row = await rowOf(page, "Sheet of bookings");
  await userEvent.click(row.getByRole("button", { name: "Send test" }));
  await expect(await within(page).findByText(/It answered: 200/)).toBeVisible();
  await expect(sent("delivery/webhookTest")).toHaveLength(1);
});

/** Remove asks first, then the hook leaves the list. */
export const WebhookRemove = accountAt("/account/webhooks", async (page) => {
  const row = await rowOf(page, "Old CRM");
  // A phone row shows its first action alone; Remove is a swipe there, so this is the wide shape.
  const remove = row.queryByRole("button", { name: "Remove" });
  if (!remove) return;
  await yes(async () => {
    fireEvent.click(remove);
  });
  await waitFor(() => expect(within(page).queryByText("Old CRM")).toBeNull());
  await expect(sent("delivery/webhookRemove")).toEqual([
    { path: "delivery/webhookRemove", body: expect.objectContaining({ id: "wh3" }) },
  ]);
});

/** Two quick presses on two rows send one test: one write at a time. */
export const WebhookTwoRows = accountAt("/account/webhooks", async (page) => {
  await within(page).findAllByText("Sheet of bookings");
  const [a, b] = within(page).getAllByRole("button", { name: "Send test" });
  if (!a || !b) throw new Error("two rows have Send test");
  fireEvent.click(a);
  fireEvent.click(b);
  await settled();
  await expect(sent("delivery/webhookTest")).toHaveLength(1);
});

/** A delivery opens under its row. */
export const WebhookDelivery = accountAt("/account/webhooks", async (page) => {
  const title = await within(page).findByRole("button", { name: "reply.received" });
  await userEvent.click(title);
  await expect(await within(page).findByText("Internal error")).toBeVisible();
});

/** AI tools: a row each with what it can do; Remove asks, then the token leaves. */
export const AiTools = accountAt("/account/ai", async (page) => {
  const row = await rowOf(page, "Claude for the office");
  await yes(async () => {
    fireEvent.click(row.getByRole("button", { name: "Remove" }));
  });
  await waitFor(() => expect(within(page).queryByText("Claude for the office")).toBeNull());
  await expect(sent("console/tokenRevoke")).toHaveLength(1);
});

/** Two quick presses on two token rows revoke one token. */
export const AiToolsTwoRows = accountAt("/account/ai", async (page) => {
  await within(page).findByText("Claude for the office");
  await yes(async () => {
    const [a, b] = within(page).getAllByRole("button", { name: "Remove" });
    if (!a || !b) throw new Error("two rows have Remove");
    fireEvent.click(a);
    fireEvent.click(b);
    await settled();
  });
  await expect(sent("console/tokenRevoke")).toHaveLength(1);
});

/** People: a row each with role and last seen; their title opens their access under the row. */
export const People = accountAt("/account/people", async (page) => {
  const row = await rowOf(page, "sam@acme.example");
  await userEvent.click(row.getByRole("button", { name: "sam@acme.example" }));
  await expect(await within(page).findByText("Act in Leads on Email.")).toBeVisible();
  await expect(await within(page).findByText("History (1)")).toBeVisible();
});

/** End now on an extra grant asks first, then the grant leaves the list. */
export const PersonGrantEnd = accountAt("/account/people", async (page) => {
  const row = await rowOf(page, "sam@acme.example");
  await userEvent.click(row.getByRole("button", { name: "sam@acme.example" }));
  const grant = await rowOf(page, "Act in Leads on Email.");
  await yes(() => fromMenu(grant, /^More for/, "End now"));
  await waitFor(() => expect(within(page).queryByText("Act in Leads on Email.")).toBeNull());
  await expect(sent("console/grantEnd")).toHaveLength(1);
});

/** Remove a person asks first, then they leave the list. */
export const PersonRemove = accountAt("/account/people", async (page) => {
  const row = await rowOf(page, "pat@acme.example");
  await yes(async () => {
    fireEvent.click(row.getByRole("button", { name: "Remove" }));
  });
  await waitFor(() => expect(within(page).queryByText("pat@acme.example")).toBeNull());
  await expect(sent("delivery/remove")).toHaveLength(1);
});

/** Connectors: an app's accounts as rows, a broken one saying why under it. */
export const Connectors = accountAt("/account/connectors", async (page) => {
  await expect(await within(page).findByText("Acme Plumbing CRM")).toBeVisible();
  await expect(await within(page).findByText(/sign-in ended/)).toBeVisible();
});

/** Read now (behind ⋯) sends the write and says so. */
export const ConnectorsReadNow = accountAt("/account/connectors", async (page) => {
  const row = await rowOf(page, "Acme Plumbing CRM");
  await fromMenu(row, /^More for/, "Read now");
  await expect(await within(page).findByText(/Reading now/)).toBeVisible();
  await expect(sent("connectors/syncNow")).toHaveLength(1);
});

/** Disconnect asks first, then the account leaves the list. */
export const ConnectorsDisconnect = accountAt("/account/connectors", async (page) => {
  const row = await rowOf(page, "Account 9071");
  await yes(() => fromMenu(row, /^More for/, "Disconnect"));
  await waitFor(() => expect(within(page).queryByText("Account 9071")).toBeNull());
  await expect(sent("connectors/disconnect")).toHaveLength(1);
});

/** Social: each platform's accounts as rows; a TikTok's numbers and newest videos under its row. */
export const Social = accountAt("/account/social", async (page) => {
  await expect(await within(page).findByText("@acme-plumbing")).toBeVisible();
  await expect(await within(page).findByText("Fix a dripping tap in two minutes")).toBeVisible();
  await expect(await within(page).findByText(/stopped the sign-in/)).toBeVisible();
});

/** Check (behind ⋯) sends the write; Turn off asks first, then the account leaves. */
export const SocialActions = accountAt("/account/social", async (page) => {
  const row = await rowOf(page, "@sam-rivera");
  await fromMenu(row, /^More for/, "Check");
  await waitFor(() => expect(sent("social/check")).toHaveLength(1));
  await yes(() => fromMenu(row, /^More for/, "Turn off"));
  await waitFor(() => expect(within(page).queryByText("@sam-rivera")).toBeNull());
  await expect(sent("social/disconnect")).toHaveLength(1);
});

/** Mail: a row per mailbox with its state; what blocks one and its next step sit under it. */
export const Mail = accountAt("/account/mail", async (page) => {
  await expect(await within(page).findByText("sales@acme.example")).toBeVisible();
  await expect(await within(page).findByText(/has not trusted Wren's app/)).toBeVisible();
});

/** Check (behind ⋯) sends the write for that mailbox. */
export const MailCheck = accountAt("/account/mail", async (page) => {
  const row = await rowOf(page, "owner@acme.example");
  await fromMenu(row, /^More for/, "Check");
  await waitFor(() => expect(sent("mail/check")).toHaveLength(1));
  await expect(sent("mail/check")[0]?.body).toEqual(expect.objectContaining({ account: 11 }));
});

/** Feedback: "When you're ready for more" as a row with its pitch under it; I'm interested sends. */
export const Feedback = {
  ...pageAt("/work", {
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
