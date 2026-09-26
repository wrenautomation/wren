/**
 * Operations: any industry. The free audit the agencies and RIA arms pitch, and the paid
 * build every ladder ends on: the admin that grows with each new client, automated.
 */
import { defineOffer } from "../offer.js";

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
  name: "Operations automation build",
  status: "live",
  audience: "Firms whose admin grows with every client they sign.",
  promise: "The admin that grows with every new client, built to run on its own inside your tools.",
  price: {
    kind: "fixed",
    upfront: { min: 10_000, max: 15_000 },
    monthly: { min: 5_000, max: 10_000 },
  },
  slots: null,
  days: null,
  youGet: [
    "The jobs with the most repeated hours, automated inside the tools you already pay for.",
    "Milestones agreed in writing, each one running before the next starts.",
    "Monitoring, fixes and new automations every month on the retainer.",
  ],
  youGive: ["Access to the tools involved.", "A weekly 20-minute check-in."],
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
  application: null,
});
