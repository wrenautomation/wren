/** Aerie › Decisions (aerie D16 Decisions table): one story per row that can be shown. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { refuse } from "../../../mocks/api.js";
import {
  AERIE_BOARD,
  AERIE_DECISIONS,
  decideWith,
  manyDecisions,
  WRITES_RACE,
} from "../../../mocks/data/aerie.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, tidy } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Aerie/Decisions" };
export default meta;

const WAIT = { timeout: 5000 };
/** the hold (`UNDO_MS`, 10 s) plus the call, with room for a loaded run */
const SENT = { timeout: 20_000 };
const AT = "/aerie/decisions";
const ON = { "aerie/board": { ...AERIE_BOARD, writes: true }, "aerie/decide": decideWith(true) };

const card = async (page: HTMLElement, question: RegExp) =>
  (await within(page).findByRole("article", { name: question }, WAIT)) as HTMLElement;
const toast = () => within(document.body);
/** takes this story's held answer back (`line`: its toast), so no hold outlives the story; toasts of the story before may still show */
async function undo(line: RegExp) {
  // the newest toast of that line: sonner puts it first (data-index 0)
  const own = (await toast().findAllByText(line, {}, WAIT))
    .map((t) => t.closest<HTMLElement>("[data-sonner-toast]"))
    .filter((t): t is HTMLElement => t !== null)
    .sort((x, y) => Number(x.dataset.index) - Number(y.dataset.index))[0];
  if (!own) throw new Error("the answer's toast is not a toast");
  const before = toast().queryAllByText("Undone").length;
  await userEvent.click(within(own).getByRole("button", { name: "Undo" }));
  await waitFor(
    () => expect(toast().queryAllByText("Undone").length).toBeGreaterThan(before),
    WAIT,
  );
}

/**
 * Open: due first (the overdue one leads), then oldest asked. The overdue card says so; its recommended
 * option is outlined and named; it blocks tasks while web writes are off, so it is locked with the CLI line.
 * A blocked task in the rows links with its title; one that is not (archived) is the id alone.
 */
export const Open = pageAt(AT, {
  me: ADMIN,
  check: async (page) => {
    const view = within(page);
    const cards = await view.findAllByRole("article", {}, WAIT);
    await expect(cards.map((c) => c.getAttribute("aria-labelledby"))).toEqual([
      "decision-7",
      "decision-8",
      "decision-9",
      "decision-10",
    ]);
    await expect(view.getByRole("heading", { name: "Open · 4" })).toBeTruthy();
    const queue = within(await card(page, /job queue/));
    await expect(queue.getByText(/^Overdue, due/)).toBeVisible();
    await expect(queue.getByText("Recommended")).toBeVisible();
    await expect(queue.queryByRole("button", { name: /pg-boss/ })).toBeNull();
    await expect(queue.getByText("aerie decide 7 a")).toBeVisible();
    // locked rows pick the CLI line's key
    await userEvent.click(queue.getByRole("radio", { name: /graphile-worker/ }));
    await waitFor(() => expect(queue.getByText("aerie decide 7 b")).toBeVisible(), WAIT);
    await waitFor(
      () => expect(queue.getByRole("link", { name: /EX-101 Move the sign-up/ })).toBeTruthy(),
      WAIT,
    );
    await expect(queue.queryByRole("link", { name: /EX-990/ })).toBeNull();
    await expect(queue.getByText("EX-990")).toBeVisible();
    // the brief's link is a link
    await expect(queue.getByRole("link", { name: "the queue notes" })).toBeTruthy();
    const digest = within(await card(page, /weekly digest/));
    await expect(digest.getAllByRole("button")).toHaveLength(3);
    await expect(digest.getByRole("textbox", { name: "Why (optional)" })).toBeTruthy();
    const free = within(await card(page, /holiday auto-reply/));
    await expect(free.getByRole("button", { name: "Answer" })).toBeDisabled();
  },
});

/**
 * One click answers a card that blocks nothing: it leaves at once, the toast offers Undo, and focus goes to
 * the next card. Undo puts it back in its place.
 */
export const Answer = tidy(
  pageAt(AT, {
    me: ADMIN,
    check: async (page) => {
      const digest = await card(page, /weekly digest/);
      await userEvent.type(
        within(digest).getByRole("textbox", { name: "Why (optional)" }),
        "short",
      );
      await userEvent.click(within(digest).getByRole("button", { name: /Numbers, Friday/ }));
      await expect(
        await toast().findByText("Answered b: Name for the weekly digest email?", {}, WAIT),
      ).toBeTruthy();
      await waitFor(
        () => expect(within(page).queryByRole("article", { name: /weekly digest/ })).toBeNull(),
        WAIT,
      );
      await waitFor(
        () => expect(document.activeElement?.getAttribute("aria-labelledby")).toBe("decision-9"),
        WAIT,
      );
      await expect(within(page).getByRole("heading", { name: "Open · 3" })).toBeTruthy();
      await undo(/^Answered b: Name for the weekly digest/);
      await card(page, /weekly digest/);
      const ids = within(page)
        .getAllByRole("article")
        .map((c) => c.getAttribute("aria-labelledby"));
      await expect(ids.indexOf("decision-8")).toBe(1);
    },
  }),
);

/** No options: the person types the answer; Answer holds it like a click. */
export const OwnWords = tidy(
  pageAt(AT, {
    me: ADMIN,
    check: async (page) => {
      const free = within(await card(page, /holiday auto-reply/));
      await userEvent.type(free.getByRole("textbox", { name: "Your answer" }), "Back on Monday");
      await userEvent.click(free.getByRole("button", { name: "Answer" }));
      await undo(/^Answered Back on Monday:/);
    },
  }),
);

/**
 * Writes on: the blocking card has buttons and no CLI line. Its answer goes when the undo time ends (a
 * set-aside that lands says nothing) and shows under Answered.
 */
export const AnswerLands = tidy(
  pageAt(AT, {
    me: ADMIN,
    answers: ON,
    check: async (page) => {
      const queue = within(await card(page, /job queue/));
      await expect(queue.queryByText(/aerie decide/)).toBeNull();
      await userEvent.click(queue.getByRole("button", { name: /pg-boss/ }));
      await waitFor(() => expect(toast().queryByRole("button", { name: "Undo" })).toBeNull(), SENT);
      await userEvent.click(within(page).getByRole("link", { name: "Answered" }));
      const done = within(await card(page, /job queue/));
      // the Answered list fades in
      await waitFor(
        async () => expect(await done.findByText(/a from william/)).toBeVisible(),
        WAIT,
      );
    },
  }),
);

/**
 * The race: the board read said writes on, then the route refused (403). The card comes back, says why,
 * and locks: the board is read again.
 */
export const Refused = tidy(
  pageAt(AT, {
    me: ADMIN,
    answers: WRITES_RACE,
    check: async (page) => {
      const queue = within(await card(page, /job queue/));
      await userEvent.click(queue.getByRole("button", { name: /pg-boss/ }));
      await toast().findByText(/answer it in the CLI until the switch/, {}, SENT);
      const back = within(await card(page, /job queue/));
      await expect(await back.findByText("aerie decide 7 a", {}, WAIT)).toBeVisible();
      await expect(back.queryByRole("button", { name: /pg-boss/ })).toBeNull();
    },
  }),
);

/** Another hand answered it first (409): the toast names that answer. */
export const AnsweredElsewhere = tidy(
  pageAt(AT, {
    me: ADMIN,
    answers: { "aerie/decide": () => refuse(409, "decision 8 is answered (c)") },
    check: async (page) => {
      const digest = within(await card(page, /weekly digest/));
      await userEvent.click(digest.getByRole("button", { name: /The Weekly/ }));
      await toast().findByText(/Decision 8 was answered elsewhere: c\./, {}, SENT);
    },
  }),
);

/** The last card answered: the empty state shows and focus lands on the heading. */
export const LastOne = tidy(
  pageAt(AT, {
    me: ADMIN,
    answers: { "aerie/decisions": [AERIE_DECISIONS[1]] },
    check: async (page) => {
      const digest = within(await card(page, /weekly digest/));
      await userEvent.click(digest.getByRole("button", { name: /The Weekly/ }));
      await within(page).findByText("No decisions wait on you", {}, WAIT);
      await waitFor(() => expect(document.activeElement?.id).toBe("aerie-decisions"), WAIT);
      await undo(/^Answered a: Name for the weekly digest/);
    },
  }),
);

/** Answered: each card ticks its answer, mutes the rest, and says who, when and why. */
export const Answered = pageAt(`${AT}?open=0`, {
  me: ADMIN,
  check: async (page) => {
    const spring = within(await card(page, /spring offer/));
    await expect(spring.queryByRole("button")).toBeNull();
    await expect(spring.getByText(/b from william/)).toBeVisible();
    await expect(spring.getByText(/Why: The first week is a warm-up\./)).toBeVisible();
    await expect(within(page).getByRole("link", { name: "Answered" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
});

/** Nothing open. */
export const Empty = pageAt(AT, {
  me: ADMIN,
  answers: { "aerie/decisions": [] },
  check: async (page) => {
    await within(page).findByText("No decisions wait on you", {}, WAIT);
  },
});

/** Sixty cards, one column. */
export const Many = tidy(
  pageAt(AT, {
    me: ADMIN,
    answers: { "aerie/decisions": manyDecisions(60) },
    check: async (page) => {
      await waitFor(() => expect(within(page).getAllByRole("article")).toHaveLength(60), WAIT);
    },
  }),
);

/** The read is in flight. */
export const Loading = pageAt(AT, { me: ADMIN, mode: "pending" });

/** The read failed: the error and Try again, never the empty line. */
export const Failed = pageAt(AT, {
  me: ADMIN,
  mode: "fails",
  check: async (page) => {
    // the read retries first: the line shows after 3 to 6 s
    await within(page).findByText("The fake server failed, as asked.", {}, { timeout: 10_000 });
    await expect(within(page).getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(within(page).queryByText("No decisions wait on you")).toBeNull();
  },
});

/** The sign-in has no Aerie actor: the one CLI line that adds it. */
export const NoActor = pageAt(AT, {
  me: ADMIN,
  answers: { "aerie/board": () => refuse(403, "no Aerie actor for ada@example.com") },
  check: async (page) => {
    await within(page).findByText("No Aerie actor for ada@example.com", {}, WAIT);
  },
});
