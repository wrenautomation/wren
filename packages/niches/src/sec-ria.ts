/** SEC-registered investment advisers: regulator bulk files, two hook arms. */
import { threeEmailSequence, twoEmailSequence } from "@wren/channel-email";
import { defineNiche, rawLocation, templatesDir } from "./niche.js";

export const secRia = defineNiche({
  name: "sec_ria",
  factsView: "firm_facts",
  lander: "/ria",
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
  // One arm until the RIA copy is re-read for role inboxes (its openers still assume a name).
  plan: [{ sequence: "operations-days-0-5" }],
  // The SEC feed's "City, ST" `geo` field on companies.raw.
  companyLocation: (company) => rawLocation(company, "geo"),
});
