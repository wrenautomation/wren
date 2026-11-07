/** People, clients and the timeline. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { ADMIN } from "../../mocks/data/me.js";
import { pageAt, shows } from "../../mocks/page.js";

const meta: Meta = { title: "Wren/People" };
export default meta;

export const People = pageAt("/people", { me: ADMIN });

export const Clients = pageAt("/people/clients", { me: ADMIN });

export const Timeline = pageAt("/people/timeline", { me: ADMIN, check: shows("Timeline") });
