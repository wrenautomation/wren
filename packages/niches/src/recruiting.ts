/** Recruiting and staffing firms: the dead lead reactivation pilot, sold to the owner or MD. */
import { twoEmailSequence } from "@wren/channel-email";
import { defineNiche, rawLocation, templatesDir } from "./niche.js";
import {
  recruitingDatasets,
  recruitingLeadFormats,
  recruitingScreen,
} from "./recruiting/sources.js";

export const recruiting = defineNiche({
  name: "recruiting",
  factsView: "recruiting_facts",
  lander: "/recruiting/lead-reactivation",
  crawlHints: [
    "recruiters",
    "consultants",
    "our-recruiters",
    "our-consultants",
    "meet-the-team",
    "leadership",
  ],
  discoveryGenericWords: [
    "staffing",
    "recruiting",
    "recruitment",
    "recruiters",
    "search",
    "talent",
    "personnel",
    "executive",
    "consulting",
    "resources",
    "solutions",
    "group",
    "partners",
    "associates",
  ],
  // Staffing firms advertise roles and their services; both name the firm.
  adKeywords: [
    "staffing agency",
    "recruiting firm",
    "recruitment agency",
    "executive search",
    "staffing services",
    "temp agency",
    "healthcare staffing",
    "IT staffing",
  ],
  templatesDir: templatesDir(import.meta.url, "recruiting"),
  // Every firm gets book-first for now (William, 10-02). The demo arm stays defined so
  // switching it back on is one plan line. Each arm's `reply` copy is drafted for
  // William's approval when a warm reply lands; it is in no sequence.
  sequences: [
    twoEmailSequence("book-first/opener", "book-first/followup"),
    twoEmailSequence("watch-first/opener", "watch-first/followup"),
  ],
  // Two texts, three days apart. The words are William's, in sms_templates (recruiting-sms#1, #2):
  // nothing enrolls until both are filled. Only contacts whose basis the registered campaign
  // covers ever get them (WREN_SMS_BASES).
  smsSequences: [
    {
      name: "recruiting-sms",
      steps: [
        { step: 1, afterDays: 0 },
        { step: 2, afterDays: 3 },
      ],
    },
  ],
  offers: { "book-first": "reactivation", "watch-first": "reactivation" },
  plan: [{ sequence: "book-first-days-0-5" }],
  // Real named people only (William, 10-02): an info@ is not a person.
  mailsRoleInboxes: false,

  // Overture, SBA, google-maps and csv imports all keep "City, ST" under `geo`.
  companyLocation: (company) => rawLocation(company, "geo"),
  leadSourceFormats: recruitingLeadFormats,
  datasets: recruitingDatasets,
  screen: recruitingScreen,
});
