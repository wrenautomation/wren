/**
 * Each of Wren's own apps' first page, as Wren's admin sees
 * it, on the fake server (designs/2026-10-18-portal-page-stories.md). The pages that follow one
 * are in `pages-wren-done.stories.tsx`; Engage and Outbound in `pages-wren-port.stories.tsx`.
 * `pnpm --filter @wren/portal storybook`.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import SETUPS from "./mocks/data/agent/setups.json";
import { ADMIN } from "./mocks/data/me.js";
import { pageAt, tidy } from "./mocks/page.js";
import { fakeRelay } from "./mocks/relay.js";

const meta: Meta = { title: "Wren/Places", id: "pages-wren" };
export default meta;

export const People = pageAt("/people", { me: ADMIN });
export const Clients = pageAt("/people/clients", { me: ADMIN });
export const Campaigns = pageAt("/campaigns", { me: ADMIN });
export const Variants = pageAt("/variants/pick", { me: ADMIN });
export const VariantsBatches = pageAt("/variants/batches", { me: ADMIN });
export const VariantsBatch = pageAt("/variants/batches?batch=6", { me: ADMIN });

/** Hand to Vireo: the batch closes, the side chat opens on Vireo and holds the turn that points at it. */
export const VariantsHand: StoryObj = tidy(
  (() => {
    const base = pageAt("/variants/pick", {
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
export const Money = pageAt("/office/money", { me: ADMIN });
export const OfficeBare = pageAt("/office", { me: ADMIN });
export const Team = pageAt("/office/team", { me: ADMIN });
export const Experiments = pageAt("/office/experiments", { me: ADMIN });
export const MapPlace = pageAt("/map", { me: ADMIN });
export const Calendar = pageAt("/today/calendar", { me: ADMIN });
