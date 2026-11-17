/** Aerie › Intake (aerie Intake table, WA-1420): one story per row that can be shown. */
import type { Meta } from "@storybook/react-vite";
import { forgetKept, WRITES } from "@wren/ui";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { refuse } from "../../../mocks/api.js";
import { AERIE_RECEIPTS, fileInto, manyReceipts, receiptsOf } from "../../../mocks/data/aerie.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, tidy } from "../../../mocks/page.js";

// one page load runs every story: no kept words, and no press a story left open, reach the next
const meta: Meta = { title: "Wren/Aerie/Intake", beforeEach: () => forgetKept("aerie:intake") };
export default meta;

const WAIT = { timeout: 5000 };
const AT = "/aerie/intake";

const openIntake = () =>
  WRITES.snapshot().some(
    (w) =>
      (w.status === "unsure" || w.status === "sending") &&
      w.calls.some((c) => c.path === "aerie/intake"),
  );
const settled = () => waitFor(() => expect(openIntake()).toBe(false), { timeout: 10_000 });

/**
 * Newest first. Split: its tasks as rows, a maybe-dup marked, a missed sentence under Not filed. Waiting: the
 * model's error and the Split task. Held: the CLI line. Split with no tasks: the line that says so.
 */
export const Receipts = pageAt(AT, {
  me: ADMIN,
  check: async (page) => {
    const view = within(page);
    await view.findAllByText(/remind me to call the printer/, {}, WAIT);
    const [split, waiting, held, none] = view.getAllByRole("article");
    await expect(split).toHaveTextContent(/Split by claude-haiku/);
    await expect(within(split as HTMLElement).getAllByRole("link")).toHaveLength(3);
    await expect(within(split as HTMLElement).getByText("maybe dup")).toBeVisible();
    await expect(within(split as HTMLElement).getByText("Not filed")).toBeVisible();
    await expect(waiting).toHaveTextContent(/did not answer in 60 s/);
    await expect(waiting).toHaveTextContent(/A session will split this/);
    await expect(within(waiting as HTMLElement).getByRole("link")).toHaveTextContent(
      /Split intake 7/,
    );
    await expect(held).toHaveTextContent(/aerie intake --into 6 --split -/);
    await expect(none).toHaveTextContent(/No tasks came from this/);
    await expect(
      within(split as HTMLElement)
        .getAllByRole("link")[0]
        ?.getAttribute("href"),
    ).toContain("task=EX-101");
  },
});

/** Words in, File: the receipt leads the list, waiting for a session; the box clears. */
export const File = tidy(
  pageAt(AT, {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      const box = await view.findByRole("textbox", { name: "The work, in your words" }, WAIT);
      const file = view.getByRole("button", { name: "File" });
      await expect(file).toBeDisabled();
      await userEvent.type(box, "Draft the spring offer email.");
      await expect(file).toBeEnabled();
      await userEvent.click(file);
      await waitFor(
        () =>
          expect(view.getAllByRole("article")[0]).toHaveTextContent(/Draft the spring offer email/),
        WAIT,
      );
      await expect(view.getAllByRole("article")[0]).toHaveTextContent(/A session will split this/);
      await expect(box).toHaveValue("");
    },
  }),
);

/** ⌘ Enter files from the box. */
export const FileByKey = tidy(
  pageAt(AT, {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      const box = await view.findByRole("textbox", { name: "The work, in your words" }, WAIT);
      await userEvent.type(box, "Order new labels.{Meta>}{Enter}{/Meta}");
      await waitFor(
        () => expect(view.getAllByRole("article")[0]).toHaveTextContent(/Order new labels/),
        WAIT,
      );
    },
  }),
);

/** The write is in flight: File reads Filing…, the box is read only, a pending receipt shows the words. */
let release: ((answer: unknown) => void) | null = null;
export const Filing = tidy({
  ...pageAt(AT, {
    me: ADMIN,
    answers: {
      "aerie/intake": () =>
        new Promise((r) => {
          release = r;
        }),
    },
    check: async (page) => {
      const view = within(page);
      const box = await view.findByRole("textbox", { name: "The work, in your words" }, WAIT);
      await userEvent.type(box, "Book the venue for March.");
      await userEvent.click(view.getByRole("button", { name: "File" }));
      await view.findByRole("button", { name: "Filing…" }, WAIT);
      await expect(box).toHaveAttribute("readonly");
      await expect(view.getByRole("article", { name: "Filing" })).toHaveTextContent(
        /Book the venue/,
      );
    },
  }),
  // held while shown; settled after
  beforeEach: () => async () => {
    release?.(refuse(400, "story over"));
    await settled();
  },
});

/** A 5xx: the queue keeps the press and sends it again; the words stay, locked so they can't fork a second filing. */
let over = false;
export const FileFailed = tidy({
  ...pageAt(AT, {
    me: ADMIN,
    answers: {
      "aerie/intake": () =>
        over ? refuse(400, "story over") : refuse(503, "not filed: the database did not answer"),
    },
    check: async (page) => {
      const view = within(page);
      const box = await view.findByRole("textbox", { name: "The work, in your words" }, WAIT);
      await userEvent.type(box, "Renew the domain.");
      await userEvent.click(view.getByRole("button", { name: "File" }));
      await view.findByText(/Not filed yet: the database did not answer/, {}, WAIT);
      await expect(box).toHaveValue("Renew the domain.");
      await expect(box).toHaveAttribute("readonly");
      await expect(view.getByRole("button", { name: "File" })).toBeEnabled();
    },
  }),
  // the queue's resend, once the story is over, is refused: nothing stays open
  beforeEach: () => {
    over = false;
    return async () => {
      over = true;
      window.dispatchEvent(new Event("focus"));
      await settled();
    };
  },
});

/** A refusal (4xx): nothing queued; the words stay and can change. */
export const FileRefused = tidy(
  pageAt(AT, {
    me: ADMIN,
    answers: { "aerie/intake": () => refuse(400, "words: too long") },
    check: async (page) => {
      const view = within(page);
      const box = await view.findByRole("textbox", { name: "The work, in your words" }, WAIT);
      await userEvent.type(box, "Renew the domain.");
      await userEvent.click(view.getByRole("button", { name: "File" }));
      await view.findByText(/Not filed: words: too long\. Your words are kept/, {}, WAIT);
      await expect(box).not.toHaveAttribute("readonly");
      await expect(box).toHaveValue("Renew the domain.");
    },
  }),
);

/** Lost once, then the queue's own resend lands (on the tab's return): the box clears, once. */
let tries = 0;
const fileOnce = fileInto(AERIE_RECEIPTS);
export const FileLandsLater = tidy(
  pageAt(AT, {
    me: ADMIN,
    answers: {
      "aerie/intake": (b: Record<string, unknown>) =>
        tries++ === 0 ? refuse(503, "not filed: the database did not answer") : fileOnce(b),
    },
    check: async (page) => {
      tries = 0;
      const view = within(page);
      const box = await view.findByRole("textbox", { name: "The work, in your words" }, WAIT);
      await userEvent.type(box, "Call the landlord.");
      await userEvent.click(view.getByRole("button", { name: "File" }));
      await view.findByText(/Not filed yet/, {}, WAIT);
      window.dispatchEvent(new Event("focus"));
      await waitFor(() => expect(box).toHaveValue(""), WAIT);
      await expect(view.queryByText(/Not filed yet/)).toBeNull();
      await expect(tries).toBe(2);
    },
  }),
);

/** Nothing filed yet. */
export const Empty = pageAt(AT, {
  me: ADMIN,
  answers: { "aerie/intakes": receiptsOf([]) },
  check: async (page) => {
    await within(page).findByText("Nothing filed from words yet", {}, WAIT);
  },
});

/** 30 receipts: page one holds 20, Show older adds 10, then the button goes. */
export const Many = tidy(
  pageAt(AT, {
    me: ADMIN,
    answers: { "aerie/intakes": receiptsOf(manyReceipts(30)) },
    check: async (page) => {
      const view = within(page);
      await waitFor(() => expect(view.getAllByRole("article")).toHaveLength(20), WAIT);
      await userEvent.click(view.getByRole("button", { name: "Show older" }));
      await waitFor(() => expect(view.getAllByRole("article")).toHaveLength(30), WAIT);
      await expect(view.queryByRole("button", { name: "Show older" })).toBeNull();
    },
  }),
);

/** The read is in flight. */
export const Loading = pageAt(AT, { me: ADMIN, mode: "pending" });

/** The read failed: the error and Try again; the box still takes words. */
export const Failed = pageAt(AT, {
  me: ADMIN,
  mode: "fails",
  check: async (page) => {
    await within(page).findByText("The fake server failed, as asked.", {}, { timeout: 10_000 });
    await expect(within(page).getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(within(page).queryByText("Nothing filed from words yet")).toBeNull();
  },
});

/** The sign-in has no Aerie actor: the one CLI line that adds it. */
export const NoActor = pageAt(AT, {
  me: ADMIN,
  answers: { "aerie/intakes": () => refuse(403, "no Aerie actor for ada@example.com") },
  check: async (page) => {
    await within(page).findByText("No Aerie actor for ada@example.com", {}, WAIT);
  },
});
