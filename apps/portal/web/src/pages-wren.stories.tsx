/**
 * Each of Wren's own apps' first page, as Wren's admin sees
 * it, on the fake server (designs/2026-10-18-portal-page-stories.md). The pages that follow one
 * are in `pages-wren-done.stories.tsx`; Engage and Outbound in `pages-wren-port.stories.tsx`.
 * `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { ADMIN } from "./mocks/data/me.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Wren/Places", id: "pages-wren" };
export default meta;

export const People = pageAt("/people", { me: ADMIN });
export const Clients = pageAt("/people/clients", { me: ADMIN });
export const Campaigns = pageAt("/campaigns", { me: ADMIN });
export const Money = pageAt("/office/money", { me: ADMIN });
export const OfficeBare = pageAt("/office", { me: ADMIN });
export const Team = pageAt("/office/team", { me: ADMIN });
export const Experiments = pageAt("/office/experiments", { me: ADMIN });
export const MapPlace = pageAt("/map", { me: ADMIN });
export const Calendar = pageAt("/today/calendar", { me: ADMIN });
