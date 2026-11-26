/** Today › Approve and Messages, with DMs and comments. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import type { Thumb } from "@wren/core/records";
import type { Row } from "@wren/core/records/serve";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ANSWERS } from "../../../mocks/data/index.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { ownRows } from "../../../mocks/data/records.js";
import { ago } from "../../../mocks/data/shell.js";
import { pageAt, rowsFit, storyHref, tidy } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Today/Approve and messages" };
export default meta;

export const Approve = pageAt("/today/approve", { me: ADMIN });

/** A synthetic poster: soft shapes, no words. */
const poster = (a: string, b: string): Thumb => ({
  kind: "image",
  url: `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="160" height="90" fill="url(#g)"/><circle cx="118" cy="30" r="18" fill="#fff" fill-opacity=".35"/><rect x="18" y="56" width="70" height="8" rx="4" fill="#fff" fill-opacity=".5"/></svg>`,
  )}`,
});

const item = (id: string, o: Partial<Row>): Row => ({
  id,
  who: null,
  type: "draft",
  platform: null,
  kind: "post",
  // Approve runs on a waiting row (`WAITS`).
  state: "waiting",
  body: null,
  held: null,
  sendAt: null,
  at: ago(1),
  due: ago(1),
  ...o,
});

/** To approve in Wren's workspace: drafts, a video, replies, a workflow. Synthetic. */
const ITEMS: Row[] = [
  item("draft:1", {
    who: "Three things a quote form should never ask",
    platform: "linkedin",
    body: "Most quote forms ask for a budget first. That one field cuts replies by a third. Ask what the job is, where it is, and when they need it.",
    due: ago(2.4),
  }),
  item("video:2", {
    who: "The winter run, in 40 seconds",
    type: "video",
    kind: "video",
    platform: "youtube",
    body: "Short cut of the route review. Captions on, music off.",
    due: ago(0.2),
  }),
  item("draft:3", {
    who: "What a booked call is worth",
    platform: "x",
    body: "One booked call pays for a month of this. Here is the math, line by line.",
    due: ago(0.6),
  }),
  item("reply:4", {
    who: "Ada North",
    type: "reply",
    kind: "reply",
    platform: "email",
    body: "Thanks Ada. Thursday at 10 works. I'll send the link.",
    due: ago(0.1),
  }),
  item("workflow:5", {
    who: "Spring check-in for past customers",
    type: "workflow",
    kind: "workflow",
    body: "Three steps: a text on day one, an email on day three, a call task on day five.",
    due: ago(5),
  }),
  item("draft:6", {
    who: "Before and after: one kitchen, two days",
    platform: "instagram",
    body: "Swipe for the finish. Same crew, same budget, two days.",
    due: ago(1.2),
  }),
  item("reply:7", {
    who: "Bo Fenwick",
    type: "reply",
    kind: "reply",
    platform: "linkedin",
    state: "queued",
    body: "Glad it helped, Bo. The checklist is in the post above.",
    held: "The daily reply cap is reached; it goes first tomorrow.",
    sendAt: ago(-0.6),
  }),
];

const POSTERS: Record<string, Thumb> = {
  "draft:1": poster("#c9d6f2", "#efe3f6"),
  "video:2": poster("#d8eadf", "#f4efd9"),
  "draft:3": poster("#e7e1f4", "#d9ecf2"),
  "draft:6": poster("#f2d9cf", "#e6e0f5"),
};

const CARDS = ownRows("marketing.approval", ITEMS, ANSWERS, POSTERS);

/** The card grid, not the table (WA-1453); the bar's first chip says Cards. */
const drawsCards = async (page: HTMLElement) => {
  const grid = await within(page).findByRole(
    "list",
    // the worst-case look lengthens the name
    { name: /^items to approve/ },
    // cold load
    { timeout: 8000 },
  );
  await waitFor(() => expect(grid.querySelectorAll("li[data-row]").length).toBeGreaterThan(0));
  await expect(page.querySelector("table[aria-label]")).toBeNull();
  await expect(within(page).getByRole("link", { name: "Cards" })).toBeVisible();
};

/** Wren's To approve as cards: site, kind and wait, title, poster, the whole text, Approve. */
export const ApproveCards = pageAt("/today/approve", {
  me: ADMIN,
  answers: CARDS,
  check: drawsCards,
});

/** Queued: why each is held, and when it sends. */
export const ApproveCardsQueued = pageAt("/today/approve?view=queued", {
  me: ADMIN,
  answers: CARDS,
  check: async (page) => {
    await drawsCards(page);
    await expect(await within(page).findByText(/^Held because/)).toBeVisible();
  },
});

/** By site folds the cards under each site. */
export const ApproveCardsBySite = pageAt("/today/approve?group=platform", {
  me: ADMIN,
  answers: CARDS,
  check: drawsCards,
});

/** One open: the peek docks beside the grid, and each card keeps its actions. */
// a click, not a link: the worst-case look renames the record, and its key with it
export const ApproveCardsOpen = pageAt("/today/approve", {
  me: ADMIN,
  answers: CARDS,
  check: async (page) => {
    await drawsCards(page);
    const [, card] = page.querySelectorAll<HTMLAnchorElement>("li[data-row] a[href]");
    if (!card) throw new Error("no second card");
    await userEvent.click(card);
    await waitFor(() => expect(storyHref()).toContain("draft:1"));
    await waitFor(() => expect(page.querySelector("li[data-row][aria-current]")).not.toBeNull());
  },
});

/** Redraft opens its box in the card, under the card's words; the cards beside it stay put. */
export const ApproveCardsBox = pageAt("/today/approve", {
  me: ADMIN,
  answers: CARDS,
  check: async (page) => {
    await drawsCards(page);
    const [redraft] = await within(page).findAllByRole("button", { name: /^Redraft/ });
    if (!redraft) throw new Error("no Redraft");
    await userEvent.click(redraft);
    const box = await within(page).findByRole("textbox", { name: "What to change" });
    if (!box.closest("li[data-row]")) throw new Error("box is not in its card");
  },
});

/** A pick shows every card's box and the bulk bar. */
export const ApproveCardsPicked = pageAt("/today/approve", {
  me: ADMIN,
  answers: CARDS,
  check: async (page) => {
    await drawsCards(page);
    const [box] = await within(page).findAllByRole("checkbox", { name: /^Select / });
    if (box) await userEvent.click(box);
    await waitFor(() => expect(within(page).getByText("1 selected")).toBeVisible());
  },
});

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
