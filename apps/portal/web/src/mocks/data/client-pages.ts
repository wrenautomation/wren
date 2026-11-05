/**
 * Reads of a client's own pages that no other table answers: the contract, the run, the recap.
 * Synthetic; long words where a page has to hold them (`@wren/ui/fixtures` `WORST`).
 */
import { WORST } from "@wren/ui/fixtures";
import type { Answers } from "../api.js";
import { ago } from "./shell.js";

const BODY = [
  "# Services agreement",
  "## 1. Scope",
  `Wren reactivates past customers of ${WORST.longCompany}: it finds who to write to, drafts each email, and sends after the client approves.`,
  "- One reactivation run of up to 2,000 past customers.",
  `- A named contact for each reply: ${WORST.longName}.`,
  "- Weekly updates in the portal.",
  "## 2. Fees",
  WORST.longText,
  "## 3. Term",
  "Either side may end this agreement with 14 days written notice.",
].join("\n\n");

export const CLIENT_PAGE_ANSWERS: Answers = {
  "delivery/contract": {
    engagementId: 1,
    version: "2026-10",
    body: BODY,
    sha256: "0".repeat(64),
    terms: {
      currency: "usd",
      setupCents: 150_000,
      monthlyCents: null,
      perUnitCents: 50_000,
      unit: "meeting booked",
      capCents: 1_000_000,
      days: 90,
      payDays: 14,
    },
    issuedAt: ago(2),
    signed: null,
  },
  "reactivation/run": { live: null, story: null },
  "delivery/recap": {
    recap: {
      subject: "This week: 41 replies, 6 meetings booked",
      text: `${WORST.longText}\n\n${WORST.nonLatin}`,
    },
  },
};
