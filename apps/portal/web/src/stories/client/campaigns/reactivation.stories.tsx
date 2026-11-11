/** A client's reactivation run. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { OWNER } from "../../../mocks/data/me.js";
import { pageAt, shows } from "../../../mocks/page.js";
import { answers } from "../client-places-kit.js";

const meta: Meta = { title: "Client/Campaigns/Reactivation" };
export default meta;

export const Default = pageAt("/campaigns");

export const Emails = pageAt("/campaigns/emails", {
  answers,
  check: shows("Emails", "Approve"),
});

export const Replies = pageAt("/campaigns/replies", {
  answers,
  check: shows("Replies", "Mark booked"),
});

export const Setup = pageAt("/campaigns/setup", { empty: false, answers, check: shows("Setup") });

export const Run = pageAt("/campaigns/run", { empty: false, answers, check: shows("Run") });

export const People = pageAt("/campaigns/people", {
  answers,
  check: shows("People", "Mark called"),
});

export const Keep = pageAt("/campaigns/keep", { answers, check: shows("Keep") });

/** The sample company's own page, from the top bar's chip. */
export const Real = pageAt("/campaigns/real", {
  empty: false,
  me: { ...OWNER, demo: true },
  answers,
  check: shows("What's real"),
});

export const Calls = pageAt("/campaigns/calls", { answers, check: shows("Booked calls") });
