/**
 * Engage's and Outbound's first pages, as Wren's admin sees them, on the fake server. The Studio
 * and Marketing artifact draws both; the pages don't follow it yet. Same story ids as before the
 * split (`pages-wren--<app>`).
 */
import type { Meta } from "@storybook/react-vite";
import { ADMIN } from "./mocks/data/me.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Ready to build/Engage and Outbound home", id: "pages-wren" };
export default meta;

export const Outbound = pageAt("/outbound", { me: ADMIN });
export const Engage = pageAt("/engage", { me: ADMIN });
