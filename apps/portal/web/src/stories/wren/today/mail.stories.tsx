/** Today › Mail and its hidden lists. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, shows } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Today/Mail" };
export default meta;

/** Your mail: the Monitor's queue of your own email. */
export const NeedsYou = pageAt("/today/mail?view=needs_you", { me: ADMIN });

export const Replies = pageAt("/today/replies", {
  me: ADMIN,
  check: shows("Email replies", "Send"),
});

export const Mentions = pageAt("/today/mentions", {
  me: ADMIN,
  check: shows("Mentions", "Mark read"),
});

export const Issues = pageAt("/today/issues", {
  me: ADMIN,
  check: shows("Issues", "Resolve"),
});

export const Asks = pageAt("/today/asks", {
  me: ADMIN,
  check: shows("Access asks", "Approve"),
});

export const Rules = pageAt("/today/rules", {
  me: ADMIN,
  check: shows("Mail rules", "Add rule"),
});
