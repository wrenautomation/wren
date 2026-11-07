/** Today › Calendar, calls and recordings. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, shows } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Today/Calendar" };
export default meta;

export const Default = pageAt("/today/calendar", { me: ADMIN });

export const Calls = pageAt("/today/calls", { me: ADMIN, check: shows("Calls") });

export const Recordings = pageAt("/today/recordings", {
  me: ADMIN,
  check: shows("Recordings"),
});
