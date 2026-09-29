/**
 * Recruiting firms. The ladder: lead reactivation, paid by meetings booked, that turns dead
 * leads into job orders (stage four of the build, run on an export), then the AI integration
 * build, which makes it run on everything. The free pilot came first; dropped 2026-09-29 for
 * the demo and a price that only pays for results.
 * ICP (William, 2026-09-28): owner-led firms of 10-50 recruiters, about $2-15M in fees, that can pay $10-15k upfront and a $5-10k/mo retainer.
 * Buyer: the owner, CEO or managing director. They care about more business (job orders,
 * a pipeline that doesn't hang on one rainmaker) and less busywork for their team.
 */
import { type Application, defineOffer } from "../offer.js";

// Four questions, fit gates first: fewest taps from the page to the calendar. The rest
// (placement type, fee, ATS) is asked on the call.
const APPLICATION: Application = {
  questions: [
    {
      id: "recruiters",
      ask: "How many recruiters do you have?",
      kind: "one",
      required: true,
      choices: [
        { id: "r1_4", label: "1 to 4" },
        { id: "r5_15", label: "5 to 15" },
        { id: "r16_50", label: "16 to 50" },
        { id: "r51_plus", label: "51 or more" },
      ],
    },
    {
      id: "past_contacts",
      ask: "Roughly how many past clients and hiring contacts sit in your ATS or CRM?",
      kind: "one",
      required: true,
      choices: [
        { id: "c0_500", label: "Under 500" },
        { id: "c500_2k", label: "500 to 2,000" },
        { id: "c2k_10k", label: "2,000 to 10,000" },
        { id: "c10k_plus", label: "More than 10,000" },
      ],
    },
    {
      id: "struggles",
      ask: "What's holding growth back right now? Pick any.",
      kind: "many",
      required: true,
      choices: [
        { id: "few_job_orders", label: "Not enough job orders" },
        { id: "bd_on_few", label: "BD depends on one or two people" },
        { id: "slow_follow_up", label: "Inbound leads wait too long for a reply" },
        { id: "admin_load", label: "Recruiters buried in admin" },
        { id: "cold_candidates", label: "Good candidates go cold" },
      ],
    },
    {
      id: "role",
      ask: "What's your role?",
      kind: "one",
      required: true,
      choices: [
        { id: "owner", label: "Owner, founder or CEO" },
        { id: "exec", label: "Managing director or partner" },
        { id: "bd_lead", label: "Head of sales or BD" },
        { id: "recruiter", label: "Recruiter or account manager" },
        { id: "other", label: "Something else" },
      ],
    },
  ],
  // Midsize with a list worth working: the work needs contacts to reactivate, and the
  // firm has to be the kind that buys the next rung.
  fit: [
    { question: "recruiters", anyOf: ["r5_15", "r16_50", "r51_plus"] },
    { question: "past_contacts", anyOf: ["c500_2k", "c2k_10k", "c10k_plus"] },
  ],
};

export const recruitingReactivation = defineOffer({
  id: "reactivation",
  name: "Lead reactivation",
  status: "live",
  audience:
    "Owners and leaders of midsize recruiting and staffing firms with years of past clients in their ATS.",
  promise: "I turn the past clients and cold contacts in your ATS into new job orders in 30 days.",
  // Never on a page (D14); the client's portal shows the running bill.
  price: {
    kind: "performance",
    upfront: 1000,
    perUnit: 500,
    unit: "meeting booked",
    cap: 15000,
  },
  slots: 3,
  days: 30,
  youGet: [
    "Every past client and dormant hiring contact in your ATS, cleaned and checked.",
    "A reactivation campaign written in your recruiter's voice, sent from a new domain in their name. Your main domain is never touched.",
    "You approve the first emails in your own portal before anything sends.",
    "Interested replies forwarded to your recruiter the same day.",
    "Replies and meetings booked, live in your portal.",
  ],
  youGive: [
    "An export of past clients and contacts from your ATS or CRM.",
    "One recruiter's name and signature on the emails.",
    "A 30-minute kickoff call.",
    "Your real numbers at the end, job orders and fees, so we both know what it was worth.",
  ],
  weGet: [],
  guarantee: "You keep the cleaned list, the copy and the domain whatever happens.",
  measures: [
    { key: "contacts_reached", label: "Contacts reached", unit: "count" },
    { key: "replies", label: "Replies", unit: "count" },
    { key: "meetings", label: "Meetings booked", unit: "count" },
    { key: "job_orders", label: "Job orders", unit: "count" },
    { key: "fees_usd", label: "Placement fees", unit: "usd" },
  ],
  next: ["recruiting-candidate-reactivation", "ops-automation-build"],
  page: "/recruiting/lead-reactivation",
  // Cal.com event "Pilot call" (autobrowse site `calcom`), 30 min on Meet, Mon-Fri 10-17 ET.
  booking: "https://cal.com/wrenautomation/pilot",
  application: APPLICATION,
});

/** Retired 2026-09-29: the free first rung, replaced by `reactivation`. Kept for its enrollments. */
export const recruitingReactivationPilot = defineOffer({
  id: "recruiting-reactivation-pilot",
  name: "Dead lead reactivation pilot",
  status: "retired",
  audience:
    "Owners and leaders of midsize recruiting and staffing firms with years of past clients in their ATS.",
  promise:
    "I turn the past clients and cold contacts in your ATS into new job orders in 30 days, free.",
  price: { kind: "free" },
  slots: 3,
  days: 30,
  youGet: [
    "Every past client and dormant hiring contact in your ATS, cleaned and checked.",
    "A reactivation campaign written in your recruiter's voice, sent from a new domain in their name. Your main domain is never touched.",
    "Replies sorted and handed to your recruiter the same day.",
    "A weekly report: replies, meetings, job orders.",
  ],
  youGive: [
    "An export of past clients and contacts from your ATS or CRM.",
    "One recruiter's name and signature on the emails.",
    "A 30-minute kickoff call.",
    "Your real numbers at the end, job orders and fees, so we both know what it was worth.",
  ],
  weGet: [
    "The results as a case study, named or anonymous, your call.",
    "Introductions to firms you know, if it worked.",
    "Straight feedback on what it was worth to you.",
  ],
  guarantee: "You keep the cleaned list, the copy and the domain whatever happens.",
  measures: [
    { key: "contacts_reached", label: "Contacts reached", unit: "count" },
    { key: "replies", label: "Replies", unit: "count" },
    { key: "meetings", label: "Meetings booked", unit: "count" },
    { key: "job_orders", label: "Job orders", unit: "count" },
    { key: "fees_usd", label: "Placement fees", unit: "usd" },
  ],
  next: ["recruiting-candidate-reactivation", "ops-automation-build"],
  page: "/recruiting/lead-reactivation",
  // Cal.com event "Pilot call" (autobrowse site `calcom`), 30 min on Meet, Mon-Fri 10-17 ET.
  booking: "https://cal.com/wrenautomation/pilot",
  application: APPLICATION,
});

export const recruitingCandidateReactivation = defineOffer({
  id: "recruiting-candidate-reactivation",
  name: "Candidate reactivation",
  status: "live",
  audience: "Recruiting firms that ran lead reactivation and want the candidate side worked too.",
  promise: "The dormant candidates in your ATS, re-engaged for the roles you have open now.",
  price: { kind: "quoted" },
  slots: null,
  days: null,
  youGet: [
    "Dormant candidates matched to your open roles and re-engaged in your recruiter's voice.",
    "Interested candidates handed over with their current status and availability.",
  ],
  youGive: ["Read access to candidates and open roles in your ATS."],
  weGet: [],
  guarantee: null,
  measures: [
    { key: "candidates_reached", label: "Candidates reached", unit: "count" },
    { key: "candidates_interested", label: "Candidates interested", unit: "count" },
    { key: "submittals", label: "Submittals", unit: "count" },
    { key: "placements", label: "Placements", unit: "count" },
  ],
  next: ["ops-automation-build"],
  page: null,
  booking: null,
  application: null,
});
