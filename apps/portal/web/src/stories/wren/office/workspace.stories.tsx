/** Back office › Workspace: look and experiments; the bare place. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, shows } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Back office/Workspace" };
export default meta;

export const Place = pageAt("/office", { me: ADMIN });

export const Look = pageAt("/office/look", {
  empty: false,
  me: ADMIN,
  check: shows("Look", "Save"),
});

export const Experiments = pageAt("/office/experiments", { empty: false, me: ADMIN });
