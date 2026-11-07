/** A client's accounts, social and mail, with row actions. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { pageAt, shows, tidy } from "../../../mocks/page.js";
import { answers } from "../client-places-kit.js";
import { accountAt, fromMenu, rowOf, sent, yes } from "./account-kit.js";

const meta: Meta = { title: "Client/Back office/Accounts" };
export default meta;

export const Accounts = pageAt("/office/accounts", { answers, check: shows("Accounts") });

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
