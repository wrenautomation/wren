/** Vireo (Variants) › Batches: a batch, open samples, pages, the hand. Fake server: `web/src/mocks/`. */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import SETUPS from "../../mocks/data/agent/setups.json";
import { ADMIN } from "../../mocks/data/me.js";
import { pageAt, storyHref, tidy } from "../../mocks/page.js";
import { fakeRelay } from "../../mocks/relay.js";

const meta: Meta = { title: "Vireo/Batches" };
export default meta;

export const Default = pageAt("/variants/batches", { me: ADMIN });

/** By subject, closed only: the address holds the list's state. */
export const Sorted = pageAt("/variants/batches?sort=subject&state=closed", { me: ADMIN });

/** A filter no batch matches: the bar stays, one line says so. */
export const NoMatch = pageAt("/variants/batches?kind=image", { me: ADMIN });

/** Pick a sort: the address and the list follow. */
export const PickSort = pageAt("/variants/batches", {
  me: ADMIN,
  check: async (page) => {
    const p = within(page);
    const sort = await p.findByRole("combobox", { name: "Sort" }, { timeout: 8000 });
    await userEvent.selectOptions(sort, "oldest");
    await p.findByRole("combobox", { name: "Sort" });
    if (!storyHref().includes("sort=oldest")) throw new Error(`address: ${storyHref()}`);
  },
});

/** A link made before refs (`?batch=<id>`) still opens its batch. */
export const OldLink = pageAt("/variants/batches?batch=6", { me: ADMIN });

export const Batch = pageAt("/variants/batches?b=opener:2", { me: ADMIN });

/** An open batch, marked here: blind, in queue order. */
export const Open = pageAt("/variants/batches?b=promo-cut:3", { me: ADMIN });

/** Open but replaced by a newer batch: view only, still blind. */
export const Replaced = pageAt("/variants/batches?b=promo-cut:2", { me: ADMIN });

/** Flag a moment in the video's bar (press, press again), then its note: Works, why, Save. */
export const Mark = pageAt("/variants/batches?b=promo-cut:3", {
  me: ADMIN,
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
export const Pages = pageAt("/variants/batches?b=hero-background:2", { me: ADMIN });

/** Hand to Vireo: the batch closes, the side chat opens on Vireo and holds the turn that points at it. */
export const Hand: StoryObj = tidy(
  (() => {
    const base = pageAt("/variants/batches?b=promo-cut:3", {
      me: ADMIN,
      check: async (page) => {
        const p = within(page);
        const late = { timeout: 8000 };
        await userEvent.click(await p.findByRole("button", { name: "Hand to Vireo" }, late));
        const chat = await p.findByRole("complementary", { name: "Agent" }, late);
        await within(chat).findAllByText(/^Batch 3 of promo-cut/, {}, late);
        await within(chat).findByText("Vireo", {}, late);
      },
    });
    const relay = fakeRelay({ tape: [], setups: SETUPS });
    return {
      ...base,
      parameters: { ...base.parameters, msw: [...relay, ...(base.parameters?.msw ?? [])] },
    };
  })(),
);
