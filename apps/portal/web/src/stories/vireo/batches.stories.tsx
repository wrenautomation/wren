/** Vireo (Variants) › Batches: a batch, open samples, pages, the hand. Fake server: `web/src/mocks/`. */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import SETUPS from "../../mocks/data/agent/setups.json";
import { ADMIN } from "../../mocks/data/me.js";
import { pageAt, tidy } from "../../mocks/page.js";
import { fakeRelay } from "../../mocks/relay.js";

const meta: Meta = { title: "Vireo/Batches" };
export default meta;

export const Default = pageAt("/variants/batches", { me: ADMIN });

export const Batch = pageAt("/variants/batches?batch=6", { me: ADMIN });

/** An open batch, marked here: blind, in queue order. */
export const Open = pageAt("/variants/batches?batch=7", { me: ADMIN });

/** page samples that run code: each still waits behind a glass play mark */
export const Pages = pageAt("/variants/batches?batch=9", { me: ADMIN });

/** Hand to Vireo: the batch closes, the side chat opens on Vireo and holds the turn that points at it. */
export const Hand: StoryObj = tidy(
  (() => {
    const base = pageAt("/variants/batches?batch=7", {
      me: ADMIN,
      check: async (page) => {
        const p = within(page);
        const late = { timeout: 8000 };
        await userEvent.click(await p.findByRole("button", { name: "Hand to Vireo" }, late));
        const chat = await p.findByRole("complementary", { name: "Agent" }, late);
        await within(chat).findAllByText(/^Batch 7 of promo-cut/, {}, late);
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
