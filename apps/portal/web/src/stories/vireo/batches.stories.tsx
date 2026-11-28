/** Vireo (Variants) › Batches: a batch, open samples, pages, the hand. Fake server: `web/src/mocks/`. */
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Row } from "@wren/core/records/serve";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { refuse } from "../../mocks/api.js";
import SETUPS from "../../mocks/data/agent/setups.json";
import { ANSWERS } from "../../mocks/data/index.js";
import { ADMIN } from "../../mocks/data/me.js";
import { ownRows } from "../../mocks/data/records.js";
import { ago } from "../../mocks/data/shell.js";
import { pageAt, storyHref, tidy } from "../../mocks/page.js";
import { fakeRelay } from "../../mocks/relay.js";
import { told } from "../../topic-socket.js";

const meta: Meta = { title: "Vireo/Batches" };
export default meta;

/** cold load */
const LATE = { timeout: 8000 };
/** The dialog's own button: its X is a "Close" too. */
const confirm = (ask: HTMLElement) => {
  const go = ask.querySelector<HTMLButtonElement>("button[type=submit]");
  if (!go) throw new Error("no submit");
  return go;
};
/** The list draws as cards, never the table. */
const cards = async (page: HTMLElement) => {
  await waitFor(
    () => expect(page.querySelectorAll("li[data-row]").length).toBeGreaterThan(0),
    LATE,
  );
  await expect(page.querySelector("table[aria-label]")).toBeNull();
};

/** Cards: waiting batches first under Needs you; each card's Close and ⋯ (WA-1455). */
export const Default = pageAt("/variants/batches", { me: ADMIN, check: (page) => cards(page) });

/** Open batches a newer one replaced: Close is their only way out. */
export const ReplacedTab = pageAt("/variants/batches?view=replaced", {
  me: ADMIN,
  check: (page) => cards(page),
});

/** Closed batches: no Close. */
export const ClosedTab = pageAt("/variants/batches?view=closed", {
  me: ADMIN,
  check: async (page) => {
    await cards(page);
    await expect(within(page).queryByRole("button", { name: "Close" })).toBeNull();
  },
});

/** Close one from its card: the question, then the toast. */
export const CloseOne = pageAt("/variants/batches", {
  me: ADMIN,
  check: async (page) => {
    await cards(page);
    const [close] = await within(page).findAllByRole("button", { name: "Close" });
    if (!close) throw new Error("no Close");
    await userEvent.click(close);
    const ask = await within(document.body).findByRole("dialog");
    await within(ask).findByText(/^Close\? The marks stay/);
    await userEvent.click(confirm(ask));
    await within(document.body).findByText("Closed", {}, LATE);
  },
});

/** Two picked: the bulk bar's Close names both. */
export const CloseTwo = pageAt("/variants/batches?view=all", {
  me: ADMIN,
  check: async (page) => {
    await cards(page);
    const boxes = await within(page).findAllByRole("checkbox", { name: /^Select / });
    for (const b of boxes.slice(0, 2)) await userEvent.click(b);
    await userEvent.click(await within(page).findByRole("button", { name: "Close 2" }, LATE));
    const ask = await within(document.body).findByRole("dialog");
    await within(ask).findByText("2 batches.");
  },
});

/** ⋯ then Rename on the first card: its title box. */
async function renameBox(page: HTMLElement) {
  await cards(page);
  const [more] = await within(page).findAllByRole("button", { name: /^More for / });
  if (!more) throw new Error("no ⋯");
  await userEvent.click(more);
  await userEvent.click(await within(document.body).findByRole("button", { name: "Rename" }));
  return within(document.body).findByRole("textbox", { name: "Title" });
}

/** The title box opens in its card, in place of its actions; the cards beside it stay put. */
export const RenameOpen = pageAt("/variants/batches", {
  me: ADMIN,
  check: async (page) => {
    const box = await renameBox(page);
    const card = box.closest("li");
    if (!card?.hasAttribute("data-row")) throw new Error("box is not in its card");
  },
});

/** Rename from ⋯: the title box starts from the shown name. */
export const RenameOne = pageAt("/variants/batches", {
  me: ADMIN,
  check: async (page) => {
    const box = await renameBox(page);
    await userEvent.clear(box);
    await userEvent.type(box, "Openers that name a street");
    // the box opens in its card, in place of its actions
    const form = box.closest("form");
    if (!form) throw new Error("no box");
    await userEvent.click(within(form).getByRole("button", { name: "Rename" }));
    await within(document.body).findByText("Renamed", {}, LATE);
  },
});

/** Vireo refuses the close: its words in the toast, the card stays. */
export const CloseFails = pageAt("/variants/batches", {
  me: ADMIN,
  answers: { "variants/close": () => refuse(409, "batch 7 is already closed") },
  check: async (page) => {
    await cards(page);
    const [close] = await within(page).findAllByRole("button", { name: "Close" });
    if (!close) throw new Error("no Close");
    await userEvent.click(close);
    const ask = await within(document.body).findByRole("dialog");
    await userEvent.click(confirm(ask));
    await within(document.body).findByText(/already closed/, {}, LATE);
  },
});

const LONG =
  "A subject whose name runs well past one line, as a long brief turned into a name does";
/** 120 batches: 120-character titles and subjects, no posters, no rate. Synthetic. */
const WORST: Row[] = Array.from({ length: 120 }, (_, i) => ({
  id: 1000 + i,
  name: `${LONG.slice(0, 60)} batch ${i + 1}, with a title that also wraps onto a second line`,
  n: i + 1,
  subject: `${LONG} ${i % 7}`,
  kind: ["text", "image", "video", "page"][i % 4] ?? "text",
  state: i < 7 ? "waiting" : i < 30 ? "replaced" : "closed",
  marked: `${i % 9} of ${8 + (i % 5)}`,
  goodRate: null,
  kept: 0,
  judges: null,
  folder: null,
  yours: i % 2 ? "yes" : "no",
  created: ago(i * 0.4),
  why: null,
  note: null,
}));
export const WorstCase = pageAt("/variants/batches?view=all", {
  me: ADMIN,
  answers: ownRows("variants.batch", WORST, ANSWERS),
  check: (page) => cards(page),
});

/** No batches yet: the head's Start in the chat. */
export const FirstRun = pageAt("/variants/batches?view=all", {
  me: ADMIN,
  answers: ownRows("variants.batch", [], ANSWERS),
  check: async (page) => {
    await within(page).findByText(/^No batches yet/, {}, LATE);
  },
});

/** A phone: one card across. */
export const Phone: StoryObj = {
  ...Default,
  globals: { viewport: { value: "phone" } },
};

/** A link made before refs (`?batch=<id>`) still opens its batch. */
export const OldLink = pageAt("/variants/batches?batch=6", { me: ADMIN, empty: false });

export const Batch = pageAt("/variants/batches?b=opener:2", { me: ADMIN, empty: false });

/** An open batch, marked here: blind, in queue order. */
export const Open = pageAt("/variants/batches?b=promo-cut:3", { me: ADMIN, empty: false });

/** Open but replaced by a newer batch: view only, still blind. */
export const Replaced = pageAt("/variants/batches?b=promo-cut:2", { me: ADMIN, empty: false });

/** Flag a moment in the video's bar (press, press again), then its note: Works, why, Save. */
export const Mark = pageAt("/variants/batches?b=promo-cut:3", {
  me: ADMIN,
  empty: false,
  check: async (page) => {
    const p = within(page);
    const late = { timeout: 8000 };
    const [flag] = await p.findAllByRole("button", { name: "Mark a moment" }, late);
    if (!flag) throw new Error("no flag");
    await userEvent.click(flag);
    await userEvent.click(p.getByRole("button", { name: /^End the moment/ }));
    const note = await p.findByRole("group", { name: "New note" });
    await userEvent.click(within(note).getByRole("button", { name: "Works" }));
    await userEvent.type(within(note).getByRole("textbox", { name: "Why" }), "Clear open");
    await userEvent.click(within(note).getByRole("button", { name: "Save" }));
    await p.findByText(/Clear open/, {}, late);
  },
});

/** Rename the subject and the batch title in place: Rename, a new name, Enter; each shows it. */
export const Rename = pageAt("/variants/batches?b=opener:2", {
  me: ADMIN,
  empty: false,
  check: async (page) => {
    const p = within(page);
    await userEvent.click(
      await p.findByRole("button", { name: "Rename subject" }, { timeout: 8000 }),
    );
    const field = p.getByRole("textbox", { name: "Subject name" });
    await userEvent.clear(field);
    await userEvent.type(field, "Spring opener{Enter}");
    await p.findByRole("heading", { name: "Spring opener" });
    await userEvent.click(p.getByRole("button", { name: "Rename batch" }));
    const title = p.getByRole("textbox", { name: "Batch title" });
    await userEvent.clear(title);
    await userEvent.type(title, "Openers that name a street{Enter}");
    await p.findByText("Openers that name a street");
  },
});

/** page samples that run code: each still waits behind a glass play mark */
export const Pages = pageAt("/variants/batches?b=hero-background:2", { me: ADMIN, empty: false });

/** Hand to Vireo: the batch closes, Anton opens on the Vireo setup and holds the turn that points at it. */
export const Hand: StoryObj = tidy(
  (() => {
    const base = pageAt("/variants/batches?b=promo-cut:3", {
      me: ADMIN,
      empty: false,
      check: async (page) => {
        const p = within(page);
        const late = { timeout: 8000 };
        await userEvent.click(await p.findByRole("button", { name: "Hand to Vireo" }, late));
        const chat = await p.findByRole("complementary", { name: "Agent" }, late);
        // the turn lands only on the setup it names (panel.tsx `hand.setup === setup.name`): Vireo;
        // the setup's name sits in the chats menu since the Anton dock (WA-1457)
        await within(chat).findAllByText(/^Batch 3 of promo-cut/, {}, late);
      },
    });
    const relay = fakeRelay({ tape: [], setups: SETUPS });
    return {
      ...base,
      parameters: { ...base.parameters, msw: [...relay, ...(base.parameters?.msw ?? [])] },
    };
  })(),
);

/** The next batch, made by a session while he reads this one: the page reads it live. */
let made = false;
const nextBatch = (go: boolean) =>
  pageAt("/variants/batches?b=opener:2", {
    me: ADMIN,
    empty: false,
    answers: {
      "variants/batch": (b: Record<string, unknown>) => {
        const whole = (ANSWERS["variants/batch"] as (b: Record<string, unknown>) => object)(b);
        return { ...whole, newer: made ? { n: 4, ref: "opener:4" } : null };
      },
    },
    check: async (page) => {
      made = false;
      const p = within(page);
      await p.findByText(/^Batch 2 ·/, {}, LATE);
      // a story before may leave its answer kept on the device: wait for this read
      await waitFor(() => expect(p.queryByText(/waits on you/)).toBeNull(), LATE);
      made = true;
      told(["variants"]);
      await p.findByText(/^Batch 4 waits on you/, {}, LATE);
      const body = within(document.body);
      await body.findByText("Batch 4 is ready", {}, LATE);
      // the next story's first read is before its play
      made = false;
      if (!go) return;
      await userEvent.click(body.getByRole("button", { name: "Open batch 4" }));
      await waitFor(() => expect(storyHref()).toMatch(/b=opener(%3A|:)4/));
    },
  });
/** It lands: a toast with the way there, and a line on the page. */
export const NextBatch = nextBatch(false);
/** Its toast's button opens it. */
export const NextBatchOpen = nextBatch(true);
