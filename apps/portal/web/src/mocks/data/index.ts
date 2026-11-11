/**
 * The fake server's answers, path → body (`../api.ts`), for every page story. Synthetic data only.
 * A story adds or swaps answers with `pageAt(at, { answers })`.
 */
import type { ProfileJourney } from "@wren/core/profile-records";
import type { Row } from "@wren/core/records/serve";
import type { Answers } from "../api.js";
import { APP_ANSWERS } from "./apps.js";
import { CLIENT_PAGE_ANSWERS } from "./client-pages.js";
import { FOLDERS_ANSWERS } from "./folders.js";
import { JOURNEY_DETAIL, JOURNEY_ROWS, JOURNEY_WRITES } from "./journeys.js";
import { MAP_ANSWERS } from "./map.js";
import { DRAFT_ANSWERS, draftRecords } from "./map-drafts.js";
import { AUTO_REPLY, CADENCE, PIECES, STUDIO_WAITING } from "./marketing.js";
import { MOVE_ROWS } from "./moves.js";
import { OFFER_ANSWERS, OFFER_ROWS } from "./offers.js";
import { recordsAnswers } from "./records.js";
import { ago, SHELL } from "./shell.js";
import { VARIANTS_ANSWERS } from "./variants.js";

/** A person's journey by their id: 1 open with a fit, 2 stale, 3 dropped, 4 done; the rest have none. */
const journeyOf = (id: string): ProfileJourney | null => {
  const base = {
    id: `j${id}`,
    ghost: false,
    source: "Cold email",
    owner: null,
    closedAt: null,
    reason: null,
    fit: null,
    earlier: 0,
  };
  const trail = (...steps: [string, number][]) => steps.map(([name, d]) => ({ name, at: ago(d) }));
  if (id === "1")
    return {
      ...base,
      status: "open",
      step: "Booked",
      days: 2,
      stale: false,
      owner: "sam@example.test",
      openedAt: ago(12),
      trail: trail(["Lead", 12], ["Engaged", 6], ["Booked", 2]),
      fit: {
        score: 82,
        reasons: ["Owner of the firm", "Home services", "11 to 50 people"],
        unknown: ["Region"],
      },
      earlier: 1,
    };
  if (id === "2")
    return {
      ...base,
      status: "open",
      step: "Engaged",
      days: 19,
      stale: true,
      openedAt: ago(30),
      trail: trail(["Lead", 30], ["Engaged", 19]),
    };
  if (id === "3")
    return {
      ...base,
      status: "dropped",
      step: "Engaged",
      days: 40,
      stale: false,
      openedAt: ago(60),
      closedAt: ago(40),
      reason: "No budget this year",
      trail: trail(["Lead", 60], ["Engaged", 48]),
    };
  if (id === "4")
    return {
      ...base,
      status: "done",
      step: "Signed",
      days: 9,
      stale: false,
      source: "A referral with a long name, from the partner page of the autumn campaign",
      openedAt: ago(50),
      closedAt: ago(9),
      trail: trail(
        ["Lead", 50],
        ["Engaged", 41],
        ["Booked", 30],
        ["Proposal sent", 20],
        ["Signed", 9],
      ),
    };
  return null;
};

/** A person's page read: their newest timeline lines, for the peek (`profileExtras`). */
const PERSON_DETAIL = (row: Row) => ({
  journey: journeyOf(String(row.id)),
  timeline: [],
  total: 3,
  href: "#",
  visits: null,
  warmth: null,
  reach: null,
  research: null,
  leadFit: null,
  lines: [
    {
      id: `${row.id}-3`,
      at: ago(0.4),
      kind: "reply",
      summary: "Asked if the winter run has room.",
      link: null,
      context: null,
      note: null,
      kindState: { label: "Replied", tone: "good" },
      channelState: { label: "Email", tone: "neutral" },
    },
    {
      id: `${row.id}-2`,
      at: ago(2),
      kind: "email_sent",
      summary: "Sent: A quote for the winter run.",
      link: null,
      context: null,
      note: null,
      kindState: { label: "Email sent", tone: "neutral" },
      channelState: { label: "Email", tone: "neutral" },
    },
    {
      id: `${row.id}-1`,
      at: ago(5),
      kind: "visit",
      summary: "Read the pricing page.",
      link: null,
      context: null,
      note: null,
      kindState: { label: "Visit", tone: "neutral" },
      channelState: null,
    },
  ],
});

const BASE: Answers = {
  ...recordsAnswers(
    { "marketing.cadence": CADENCE as unknown as Row[], ...JOURNEY_ROWS, ...OFFER_ROWS },
    { ...JOURNEY_DETAIL, "people.profile": PERSON_DETAIL },
    MOVE_ROWS,
  ),
  ...SHELL,
  ...APP_ANSWERS,
  ...CLIENT_PAGE_ANSWERS,
  ...JOURNEY_WRITES,
  ...MAP_ANSWERS,
  ...OFFER_ANSWERS,
  ...VARIANTS_ANSWERS,
  ...FOLDERS_ANSWERS,
  "console/call:PieceList.list": { pieces: PIECES },
  "console/call:ContentDesk.waiting": STUDIO_WAITING,
  "console/call:InboxDesk.autoReplies": AUTO_REPLY,
};

type Reply = (body: Record<string, unknown>) => unknown;

/** `BASE`, with the drafts record and the draft routes in front of the shared records answers. */
export const ANSWERS: Answers = {
  ...BASE,
  ...DRAFT_ANSWERS,
  ...draftRecords({
    get: BASE["pipeline/recordsGet"] as Reply,
    list: BASE["pipeline/recordsList"] as Reply,
  }),
};
