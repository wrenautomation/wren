/** A client's billing and pay links. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { pageAt, shows } from "../../../mocks/page.js";
import { answers } from "../client-places-kit.js";

const meta: Meta = { title: "Client/Back office/Money" };
export default meta;

export const Billing = pageAt("/office/billing", { answers, check: shows("Billing") });

export const PayLinks = pageAt("/office/pay-links", {
  answers,
  check: shows("Pay links", "New pay link"),
});
