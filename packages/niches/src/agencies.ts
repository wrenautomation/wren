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
  // Clutch and Shopify pages both store "City, ST" under `Location` on companies.raw.
  companyLocation: (company) => rawLocation(company, "Location"),
});
