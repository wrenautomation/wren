/** Marketing / build agencies: directory-sourced firms, people crawled from their sites. */
import { threeEmailSequence, twoEmailSequence } from "@wren/channel-email";
import { defineNiche, rawLocation, templatesDir } from "./niche.js";

const ARMS = ["marketing", "build"] as const;

export const agencies = defineNiche({
  name: "agencies",
  factsView: "agency_facts",
  lander: "/agencies",
  crawlHints: [
    "meet",
    "crew",
    "makers",
    "humans",
    "culture",
    "our-people",
    "our-team",
    "leadership-team",
  ],
  discoveryGenericWords: [
    "agency",
    "agencies",
    "media",
    "marketing",
    "creative",
    "digital",
    "studio",
    "studios",
    "social",
    "brand",
    "branding",
    "design",
    "video",
    "content",
    "production",
    "productions",
    "growth",
    "lab",
    "labs",
    "collective",
    "interactive",
    "communications",
    "pr",
    "solutions",
    "group",
    "partners",
  ],
  templatesDir: templatesDir(import.meta.url, "agencies"),
  sequences: ARMS.flatMap((arm) => [
    threeEmailSequence(`${arm}/opener`, `${arm}/followup`, "final_followup"),
    twoEmailSequence(`${arm}/opener`, `${arm}/followup`),
  ]),
  // The arm follows the firm's own service mix (`agency_facts.segment`, from the directory
  // listing): marketing shops hear about month end, build shops about the invoice. A firm
  // whose mix says neither gets the marketing arm, so no lead waits on a label.
  plan: [
    { sequence: "marketing-days-0-5", where: { "company.segment": "marketing" } },
    { sequence: "build-days-0-5", where: { "company.segment": "build" } },
    { sequence: "marketing-days-0-5" },
  ],
  // Clutch and Shopify pages both store "City, ST" under `Location` on companies.raw.
  companyLocation: (company) => rawLocation(company, "Location"),
});
