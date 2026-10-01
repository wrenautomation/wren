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
  templatesDir: templatesDir(import.meta.url, "recruiting"),
  sequences: [twoEmailSequence("reactivation/opener", "reactivation/followup")],
  offers: { reactivation: "reactivation" },
  plan: [{ sequence: "reactivation-days-0-5" }],
  // Overture, SBA, google-maps and csv imports all keep "City, ST" under `geo`.
  companyLocation: (company) => rawLocation(company, "geo"),
  leadSourceFormats: recruitingLeadFormats,
  datasets: recruitingDatasets,
  screen: recruitingScreen,
});
