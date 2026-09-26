/** SEC-registered investment advisers: regulator bulk files, two hook arms. */
import { threeEmailSequence, twoEmailSequence } from "@wren/channel-email";
import { defineNiche, leadFormat, rawLocation, templatesDir } from "./niche.js";
import { SEC_DATASETS } from "./sec-ria/datasets.js";
import { AdvFilingDataSource } from "./sec-ria/filing-data.js";
import { SecFirmFeedSource } from "./sec-ria/firm-feed.js";
import { SecInvestmentAdviserSource } from "./sec-ria/roster.js";

const NICHE = "sec_ria";

export const secRia = defineNiche({
  name: NICHE,
  factsView: "firm_facts",
  // /ria was retired 2026-09-25 (301 to /); the general page until RIA gets its own offer.
  lander: "/",
  crawlHints: [
    "advisors",
    "advisers",
    "professionals",
    "principals",
    "our-firm",
    "ourfirm",
    "wealth-team",
  ],
  discoveryGenericWords: [
    "advisors",
    "advisers",
    "advisory",
    "wealth",
    "capital",
    "management",
    "asset",
    "financial",
    "investment",
    "investments",
    "planning",
    "partners",
    "group",
    "associates",
    "holdings",
    "fund",
    "funds",
    "global",
  ],
  templatesDir: templatesDir(import.meta.url, "sec_ria"),
  sequences: [
    threeEmailSequence("documents/opener", "documents/followup", "final_followup"),
    threeEmailSequence("operations/opener", "operations/followup", "final_followup"),
    twoEmailSequence("documents/opener", "documents/followup"),
    twoEmailSequence("operations/opener", "operations/followup"),
  ],
  // Both arms end on the free audit; they differ in the hook, not the offer.
  offers: { documents: "ops-audit", operations: "ops-audit" },
  // One arm until the RIA copy is re-read for role inboxes (its openers still assume a name).
  plan: [{ sequence: "operations-days-0-5" }],
  // The SEC feed's "City, ST" `geo` field on companies.raw.
  companyLocation: (company) => rawLocation(company, "geo"),
  // Everything that speaks the SEC/IAPD dialect (the monthly roster CSV, the daily
  // XML feed, the FOIA filing-data zips) is translated here; core never sees an ADV
  // item number.
  leadSourceFormats: [
    leadFormat(
      NICHE,
      "sec-investment-advisers",
      "SEC monthly firm roster CSV",
      (p) => new SecInvestmentAdviserSource(p),
    ),
    leadFormat(
      NICHE,
      "sec-firm-feed",
      "SEC daily firm feed XML(.gz): all WebAddrs + fresh Part 1A facts",
      (p) => new SecFirmFeedSource(p),
    ),
  ],
  personSourceFormats: [
    {
      name: "adv-filing-data",
      help: "SEC monthly ADV filing-data zip: Schedule A/B owners + 1J CCOs",
      build: (p) => new AdvFilingDataSource(p),
      niche: NICHE,
    },
  ],
  datasets: () => SEC_DATASETS,
});
