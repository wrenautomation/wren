/** A client's Back office: the bare place and feedback. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { freshStory } from "../../../mocks/api.js";
import { ACCOUNT_ANSWERS, forgetAccount } from "../../../mocks/data/account.js";
import { pageAt } from "../../../mocks/page.js";
import { fromMenu, rowOf, sent } from "./account-kit.js";

const meta: Meta = { title: "Client/Back office/Account" };
export default meta;

export const Default = pageAt("/office");

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
