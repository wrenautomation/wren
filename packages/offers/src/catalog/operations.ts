/**
 * Operations: any industry. The free audit the agencies and RIA arms pitch, and the paid
 * build every ladder ends on: AI integration from the ground up, in four stages (figure out,
 * fix, connect, put AI to work). ICP (William, 2026-09-28): owner-led firms of about 10-50
 * people that can pay $10-15k upfront and a $5-10k/mo retainer.
 */
import { type Application, defineOffer } from "../offer.js";

// The hub's form (William's brief, 2026-09-29): the main bottleneck first (the page asks it before contact
// details, 2026-09-30), where the company is on the five levels, then the two gates, size and whether the
// person decides. A fit gets a call from William, fast.
const APPLICATION: Application = {
  questions: [
    {
      id: "bottleneck",
      ask: "What's your main bottleneck?",
      kind: "one",
      required: true,
      choices: [
        { id: "leads", label: "Getting leads and following up" },
        { id: "hiring", label: "Hiring and onboarding" },
        { id: "admin", label: "Admin, timesheets and invoicing" },
        { id: "data", label: "Data spread across too many tools" },
        { id: "other", label: "Something else" },
      ],
    },
    {
      id: "level",
      ask: "Where is your company today?",
      kind: "one",
      required: true,
      choices: [
        { id: "l1_sops", label: "Level 1: our processes are written down" },
        { id: "l2_crm", label: "Level 2: we run on a CRM, messy or clean" },
        { id: "l3_workflows", label: "Level 3: some work is automated" },
        { id: "l4_ai", label: "Level 4: AI agents run parts of the business" },
        { id: "l5_scale", label: "Level 5: we're scaling what's built" },
      ],
    },
    {
      id: "size",
      ask: "How many people work at your company?",
      kind: "one",
      required: true,
      choices: [
        { id: "s1_9", label: "1 to 9" },
        { id: "s10_50", label: "10 to 50" },
        { id: "s51_200", label: "51 to 200" },
        { id: "s201_plus", label: "201 or more" },
      ],
    },
    {
      id: "role",
      ask: "What's your role?",
      kind: "one",
      required: true,
      choices: [
        { id: "owner", label: "Owner, founder or CEO" },
        { id: "csuite", label: "Other C-suite or partner" },
        { id: "lead", label: "Head of a team or department" },
        { id: "other", label: "Something else" },
      ],
    },
  ],
  fit: [
    { question: "size", anyOf: ["s10_50", "s51_200", "s201_plus"] },
    { question: "role", anyOf: ["owner", "csuite", "lead"] },
  ],
};

export const opsAudit = defineOffer({
  id: "ops-audit",
  name: "Free consultation and audit",
  status: "live",
  audience: "Firms where someone retypes the same client into several tools by hand.",
  promise: "One page back: where the repeated hours go and what to fix first.",
  price: { kind: "free" },
  slots: null,
  days: null,
  youGet: [
    "A 30-minute call where you walk me through one normal week.",
    "One page back: each repeated job, the hours it takes a week, and what to automate first.",
  ],
  youGive: ["30 minutes and a screen share. No access to anything."],
  weGet: ["The chance to quote the build."],
  guarantee: "The page is yours whether or not we build anything.",
  measures: [
    { key: "hours_found_weekly", label: "Repeated hours found a week", unit: "hours" },
    { key: "quote_usd", label: "Build quoted", unit: "usd" },
  ],
  next: ["ops-automation-build"],
  page: "/agencies",
  booking: null,
  application: null,
});

export const opsAutomationBuild = defineOffer({
  id: "ops-automation-build",
  name: "AI integration build",
  status: "live",
  audience:
    "Owner-led firms, about 10 to 50 people, whose work lives in people's heads and data sits in five places.",
  promise:
    "I figure out how your firm runs, fix what leaks, connect your data into one CRM, then put AI to work on it.",
  price: {
    kind: "fixed",
    upfront: { min: 10_000, max: 15_000 },
    monthly: { min: 5_000, max: 10_000 },
  },
  slots: null,
  days: null,
  // The four stages, about 7 weeks to the connected CRM. The upfront fee covers the first three; the
  // retainer starts when the first AI job runs (around week 6) and adds one a month.
  youGet: [
    "Figure out: every core process written down as a plain SOP, from watching a normal week.",
    "Fix: the steps that leak time or deals cut, with one agreed way to do each thing.",
    "Connect: your ATS or CRM, inboxes, calendars and spreadsheets cleaned into one CRM.",
    "Put AI to work: AI jobs on that data, watched and fixed, one new one every month on the retainer.",
  ],
  youGive: [
    "An hour with you and 45 minutes with three or four of your team in the first two weeks.",
    "Access to the tools involved.",
    "A weekly 20-minute check-in.",
  ],
  weGet: [],
  guarantee: "If something I built breaks because of my mistake, I fix it free.",
  measures: [
    { key: "hours_saved_weekly", label: "Hours saved a week", unit: "hours" },
    { key: "upfront_usd", label: "Upfront paid", unit: "usd" },
    { key: "monthly_usd", label: "Monthly retainer", unit: "usd" },
  ],
  next: [],
  page: "/",
  booking: null,
  application: APPLICATION,
  // The four stages overlap on purpose: fixing starts before figuring out ends.
  plan: [
    {
      id: "figure-out",
      name: "Figure out",
      from: 1,
      to: 2,
      deliverables: ["Every core process written down as a plain SOP"],
      asks: ["An hour with you, and 45 minutes each with three or four of your team"],
    },
    {
      id: "fix",
      name: "Fix",
      from: 2,
      to: 4,
      deliverables: ["The steps that leak time or deals cut, one agreed way to do each thing"],
      asks: [],
    },
    {
      id: "connect",
      name: "Connect",
      from: 3,
      to: 7,
      deliverables: ["Your ATS or CRM, inboxes, calendars and spreadsheets in one CRM"],
      asks: ["Access to the tools involved"],
    },
    {
      id: "ai",
      name: "Put AI to work",
      from: 6,
      to: null,
      deliverables: ["The first AI job running on that data, then one new one a month"],
      asks: [],
    },
  ],
});
