/**
 * Rows with long words, for the stories that hold a list's widths: names, roles and firms as
 * long as real ones run, beside short figures. Synthetic data only.
 */
import type { Row } from "@wren/core/records/serve";
import { ago } from "./shell.js";

const WHO = [
  "Maximiliana Featherstonehaugh-Montgomery",
  "Bo Fenwick",
  "Cai Alessandro Moreno-Villanueva",
  "Dee Okafor",
  "Eli Brandt",
  "Fay Lindqvist-Abernathy",
];
const ROLE = [
  "Founder and Managing Director, Residential and Commercial Roofing, Gutters and Siding",
  "Owner",
  "Head of Growth Partnerships for Home Services in the Pacific Northwest",
  "Office manager",
  "Chief Operating Officer and Co-Founder at a regional heating and cooling group",
  "Marketing lead",
];
const FIRM = [
  "Northwind Residential and Commercial Roofing Co.",
  "Fenwick & Sons",
  "Moreno Plumbing, Heating and Air Conditioning",
  "Okafor Electric",
  "Brandt HVAC Service and Installation Partners",
  "Lindqvist Studio",
];
const WHY = [
  "Runs a twelve-truck crew and posts about slow winter months; asked about missed calls twice.",
  "Small shop.",
  "Hiring two dispatchers this quarter and the site has no booking form or chat.",
  "Fits the plumbing list.",
  "Wrote about lead follow-up on LinkedIn last week and named a competitor that left.",
  "Agency side.",
];
const STATUS = ["proposed", "queued", "pending", "accepted", "pending", "withdrawn"];
const SIZE = ["201", "4", "51", "11", "1001", "2"];

/** LinkedIn invites (`marketing.invite`) whose words run long. */
export const LONG_INVITES: Row[] = WHO.map((who, i) => ({
  id: i + 1,
  who,
  headline: ROLE[i] ?? null,
  niche: i % 2 ? "Recruiting" : "Home services in the Pacific Northwest",
  status: STATUS[i] ?? "pending",
  next: i === 0 ? "approve" : i === 3 ? "message" : null,
  why: WHY[i] ?? null,
  company: FIRM[i] ?? null,
  size: SIZE[i] ?? null,
  stateReason: i === 5 ? "No answer in three weeks, so the invite was taken back." : null,
  note: null,
  account: i % 2 ? "linkedin:wren" : "linkedin:william",
  days: STATUS[i] === "pending" || STATUS[i] === "accepted" ? 3 + i * 4 : null,
  queuedAt: ago(i + 2),
  sentAt: i > 1 ? ago(i + 1) : null,
  connectedAt: STATUS[i] === "accepted" ? ago(1) : null,
  withdrawnAt: STATUS[i] === "withdrawn" ? ago(0.5) : null,
  url: `https://www.linkedin.com/in/example-person-${i + 1}`,
  draft: null,
}));
