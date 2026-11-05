/**
 * Each tab of Wren's reshaped apps that follows no artifact yet (Revamp), as Wren's admin sees it,
 * on the fake server (designs/2026-10-19-portal-reshape.md): Content, Ads, Analytics and
 * Pipelines. Studio, the sidebar and the dock are in `pages-wren-tabs-done.stories.tsx`; Engage
 * and Outbound in `pages-wren-tabs-port.stories.tsx`. One story per visible tab, listed by hand:
 * a story is a static export. `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { ADMIN } from "./mocks/data/me.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Revamp/Wren apps", id: "pages-wren-apps" };
export default meta;

export const ContentContent = pageAt("/campaigns/content", { me: ADMIN });
export const ContentFacts = pageAt("/campaigns/facts", { me: ADMIN });
