/** Recruiting and staffing firms: the dead lead reactivation pilot, sold to the owner or MD. */
import { twoEmailSequence } from "@wren/channel-email";
import { defineNiche, rawLocation, templatesDir } from "./niche.js";

export const recruiting = defineNiche({
  name: "recruiting",
  factsView: null,
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
  // Leads arrive through the generic csv and google-maps imports; google-maps keeps "City, ST" under `geo`.
  companyLocation: (company) => rawLocation(company, "geo"),
});
