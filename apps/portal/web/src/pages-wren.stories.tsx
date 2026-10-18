/**
 * Each of Wren's own apps' first page, as Wren's admin sees it, on the fake server
 * (designs/2026-10-18-portal-page-stories.md). `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { ADMIN } from "./mocks/data/me.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Pages/Wren" };
export default meta;

export const Today = pageAt("/", { me: ADMIN });
export const Inbox = pageAt("/inbox", { me: ADMIN });
export const Pipeline = pageAt("/pipeline", { me: ADMIN });
export const People = pageAt("/people", { me: ADMIN });
export const Outbound = pageAt("/outbound", { me: ADMIN });
export const Deals = pageAt("/deals", { me: ADMIN });
export const Marketing = pageAt("/marketing", { me: ADMIN });
export const Outreach = pageAt("/outreach", { me: ADMIN });
export const Ads = pageAt("/ads", { me: ADMIN });
export const Sites = pageAt("/sites", { me: ADMIN });
export const Learn = pageAt("/learn", { me: ADMIN });
export const Workflows = pageAt("/workflows", { me: ADMIN });
export const Loops = pageAt("/loops", { me: ADMIN });
export const Handlers = pageAt("/handlers", { me: ADMIN });
export const Review = pageAt("/review", { me: ADMIN });
export const Ask = pageAt("/ask", { me: ADMIN });
export const Clients = pageAt("/clients", { me: ADMIN });
export const Money = pageAt("/money", { me: ADMIN });
export const Team = pageAt("/team", { me: ADMIN });
export const Library = pageAt("/library", { me: ADMIN });
export const Notes = pageAt("/notes", { me: ADMIN });
export const Calendar = pageAt("/calendar", { me: ADMIN });
export const Marketplace = pageAt("/marketplace", { me: ADMIN });
