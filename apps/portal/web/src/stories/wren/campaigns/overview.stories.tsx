/** Campaigns › Overview. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Campaigns/Overview" };
export default meta;

export const Default = pageAt("/campaigns", { me: ADMIN });
