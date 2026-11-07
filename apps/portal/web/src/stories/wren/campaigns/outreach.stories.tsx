/** Campaigns › Outreach: engage, conversations, invites. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { ANSWERS } from "../../../mocks/data/index.js";
import { LONG_INVITES } from "../../../mocks/data/long.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { ownRows } from "../../../mocks/data/records.js";
import { pageAt, rowsFit } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Campaigns/Outreach" };
export default meta;

/** Long names, roles and firms beside short figures: every word shows whole, no sideways scroll. */
const LONG = ownRows("marketing.invite", LONG_INVITES, ANSWERS);

// Engage: one story per tab.
export const Engage = pageAt("/campaigns/engage", { me: ADMIN });

export const Conversation = pageAt("/campaigns/conversation", { me: ADMIN });

export const Invites = pageAt("/campaigns/invites", { me: ADMIN });

export const InvitesLong = pageAt("/campaigns/invites?view=all", {
  me: ADMIN,
  answers: LONG,
  check: rowsFit,
});

/** A row opened: the record beside the list, never over it. */
export const InvitesLongOpen = pageAt("/campaigns/invites?view=all&invite=1", {
  me: ADMIN,
  answers: LONG,
  check: rowsFit,
});
