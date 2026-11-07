import { userEvent, within } from "storybook/test";
import { freshStory } from "../../../mocks/api.js";
import { ACCOUNT_ANSWERS, ACCOUNT_CALLS, forgetAccount } from "../../../mocks/data/account.js";
import { pageAt } from "../../../mocks/page.js";

/** A page on the account answers; each story starts from the same lists. */
export const accountAt = (at: string, check?: (page: HTMLElement) => void | Promise<void>) => ({
  ...pageAt(at, { answers: ACCOUNT_ANSWERS, ...(check ? { check } : {}) }),
  beforeEach: [freshStory, forgetAccount],
});

/** The row holding `text`: a table row, or a phone's list item. */
export const rowOf = async (page: HTMLElement, text: string | RegExp) => {
  // The first match in a row: a delivery log under a list names its hook again.
  const cells = await within(page).findAllByText(text);
  const row = cells.map((c) => c.closest<HTMLElement>("tr, li")).find(Boolean);
  if (!row) throw new Error(`"${text}" is not in a row`);
  return within(row);
};

/** Every confirm answers yes while `run` runs. */
export async function yes(run: () => Promise<void>) {
  const was = window.confirm;
  window.confirm = () => true;
  try {
    await run();
  } finally {
    window.confirm = was;
  }
}

/** The writes sent so far, by path. */
export const sent = (path: string) => ACCOUNT_CALLS.filter((c) => c.path === path);

/** An action behind a row's ⋯: open it, press the item. */
export async function fromMenu(
  row: ReturnType<typeof within>,
  title: string | RegExp,
  item: string,
) {
  // The row menu comes back once the row's last write ends ("Checking" holds it).
  await userEvent.click(await row.findByRole("button", { name: title }, { timeout: 5_000 }));
  await userEvent.click(await within(document.body).findByRole("button", { name: item }));
}
