/** Marketing / build agencies: directory-sourced firms, people crawled from their sites. */
import { join } from "node:path";
import { threeEmailSequence, twoEmailSequence } from "@wren/channel-email";
import { ClutchPagesSource } from "./agencies/clutch-pages.js";
import { AgencyDirectoryCsvSource, DIRECTORY_DOMAINS } from "./agencies/directory.js";
import { shopifyProfileDataset } from "./agencies/profiles.js";
import { ShopifyPagesSource } from "./agencies/shopify-pages.js";
import { defineNiche, leadFormat, rawLocation, templatesDir } from "./niche.js";

const NICHE = "agencies";

const ARMS = ["marketing", "build"] as const;

export const agencies = defineNiche({
  name: NICHE,
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
  offers: { marketing: "ops-audit", build: "ops-audit" },
  // The arm follows the firm's own service mix (`agency_facts.segment`, from the directory
  // listing): marketing shops hear about month end, build shops about the invoice. A firm
  // whose mix says neither gets the marketing arm, so no lead waits on a label.
  plan: [
    { sequence: "marketing-days-0-5", where: { "company.segment": "marketing" } },
    { sequence: "build-days-0-5", where: { "company.segment": "build" } },
    { sequence: "marketing-days-0-5" },
  ],
  mailsRoleInboxes: true,
  // Clutch and Shopify pages both store "City, ST" under `Location` on companies.raw.
  companyLocation: (company) => rawLocation(company, "Location"),
  // No lawful bulk feed exists for the listing data: every format below reads what
  // a human exported or saved. None of them fetches.
  leadSourceFormats: [
    leadFormat(
      NICHE,
      "agency-directory-csv",
      "manual agency-directory export CSV (Clutch/DesignRush/Sortlist)",
      (p) => new AgencyDirectoryCsvSource(p),
    ),
    leadFormat(
      NICHE,
      "clutch-pages",
      "hand-saved Clutch listing pages — one category directory per batch",
      (p) => new ClutchPagesSource(p),
      { directory: true },
    ),
    leadFormat(
      NICHE,
      "shopify-pages",
      "hand-saved Shopify Partners listing pages, enriched from fetched profiles",
      (p) => new ShopifyPagesSource(p),
      { directory: true },
    ),
  ],
  adKeywords: [
    "marketing agency",
    "digital marketing agency",
    "social media marketing agency",
    "SEO agency",
    "web design agency",
    "Shopify agency",
    "lead generation agency",
    "branding agency",
  ],
  groupKeywords: [
    "marketing agency owners",
    "digital agency owners",
    "agency owners",
    "social media agency",
    "web design business",
  ],
  platformDomains: DIRECTORY_DOMAINS,
  // The one fetch: profile pages for slugs a human already saved under <data>/agencies/shopify.
  datasets: (dataDir) => [shopifyProfileDataset(join(dataDir, NICHE, "shopify"))],
});
