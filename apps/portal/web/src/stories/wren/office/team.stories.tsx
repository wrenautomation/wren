/** Back office › Accounts and Team. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, shows } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Back office/Team" };
export default meta;

export const Accounts = pageAt("/office/accounts", { me: ADMIN });

export const Team = pageAt("/office/team", { me: ADMIN });

export const Grants = pageAt("/office/grants", {
  me: ADMIN,
  check: shows("Grants", "Add grant"),
});
