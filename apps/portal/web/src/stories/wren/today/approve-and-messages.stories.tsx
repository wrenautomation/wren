/** Today › Approve and Messages, with DMs and comments. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, rowsFit, tidy } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Today/Approve and messages" };
export default meta;

export const Approve = pageAt("/today/approve", { me: ADMIN });

export const Messages = pageAt("/today/messages", { me: ADMIN });

/**
 * Engage's Inbox as a queue table (rows-everywhere F1, F2): its wait column reads late past 24h,
 * and "By type" folds the rows by kind, each fold with its count and oldest
 * wait. A fold shuts on a press.
 */
export const MessagesByType = tidy(
  pageAt("/today/messages?view=all", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      // A row that waited past its promise says so in its wait, as text.
      await waitFor(() => expect(page.querySelectorAll("[data-late]").length).toBeGreaterThan(0));
      // Only open threads read late: a thread already answered shows its age.
      const rows = page.querySelectorAll("tbody tr[data-index], li[data-index]").length;
      await expect(page.querySelectorAll("[data-late]").length).toBeLessThan(rows);
      await userEvent.click(await view.findByRole("link", { name: "By type" }));
      const fold = await view.findByRole("button", { name: /DM/ });
      await expect(fold).toHaveAttribute("aria-expanded", "true");
      // Two groups show, each its own fold.
      await expect(await view.findByRole("button", { name: /Comment/ })).toBeVisible();
      await userEvent.click(fold);
      await expect(fold).toHaveAttribute("aria-expanded", "false");
    },
  }),
);

export const Dms = pageAt("/today/dms", { me: ADMIN });

export const Comments = pageAt("/today/comments", { me: ADMIN });

/** A comment opened: the whole comment docks beside the list (`peek: false`), never over it. */
export const CommentsOpen = pageAt("/today/comments?comment=1", {
  me: ADMIN,
  check: async (page) => {
    await rowsFit(page);
    // Docked, not a sheet over the rows: the record's panel starts right of the list.
    // A phone opens it in a sheet.
    if (window.innerWidth < 900) return;
    const list = page.querySelector("table[aria-label]")?.getBoundingClientRect();
    const open = await within(page).findByRole("complementary", { name: "Comment" });
    expect(open.getBoundingClientRect().left).toBeGreaterThanOrEqual(list?.right ?? 0);
  },
});
