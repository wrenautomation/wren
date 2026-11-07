/** Campaigns › Cold email: overview, campaigns, inboxes, calls. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, shows } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Campaigns/Cold email" };
export default meta;

// Outbound: one story per tab.
export const Overview = pageAt("/campaigns/email", { me: ADMIN });

export const Campaigns = pageAt("/campaigns/email-campaigns", { me: ADMIN });

export const Inboxes = pageAt("/campaigns/inboxes", { me: ADMIN });

export const Calls = pageAt("/campaigns/calls", {
  me: ADMIN,
  check: shows("Booked calls"),
});
