/** Back office › Money: overview, spend, models, payments, subscriptions. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, shows } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Back office/Money" };
export default meta;

export const Overview = pageAt("/office/money", { me: ADMIN });

export const Spend = pageAt("/office/spend", { me: ADMIN, check: shows("Spend") });

/** A list page while its read is out, and once it is refused. */
export const SpendPending = pageAt("/office/spend", { me: ADMIN, mode: "pending" });

export const SpendFails = pageAt("/office/spend", { me: ADMIN, mode: "fails", lands: false });

export const Models = pageAt("/office/models", { me: ADMIN, check: shows("Model usage") });

export const PaymentsIn = pageAt("/office/payments-in", {
  me: ADMIN,
  check: shows("Payments in"),
});

export const Subscriptions = pageAt("/office/subscriptions", {
  me: ADMIN,
  check: shows("Subscriptions"),
});
