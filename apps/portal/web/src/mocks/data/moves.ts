/**
 * What waits on Wren's team (`../../moves.ts`), one record each: a call within a day, approvals,
 * inbox items, replies, access asks, people past their step's limit. Cells set by hand on top of made-up rows. Names and
 * addresses match the journeys' (`./journeys.ts`), so Ada's and Bo's moves sit under their
 * journeys and the rest under Others. Synthetic data only.
 */
import type { Row } from "@wren/core/records/serve";
import { ago } from "./shell.js";

/** A person with no open journey: every step cell empty. */
const NO_STEP = {
  journey: null,
  step: null,
  stepNode: null,
  stepDays: null,
  stepFlag: null,
  stepSince: null,
  stepOwner: null,
};
/** A person at a node of the synthetic shape (`./journeys.ts`), `days` there. */
const at = (journey: string, node: string, step: string, days: number, owner?: string) => ({
  journey,
  step,
  stepNode: node,
  stepDays: days,
  stepFlag: days >= 14 ? "stale" : null,
  stepSince: ago(days),
  stepOwner: owner ?? null,
});

export const MOVE_ROWS: Record<string, Partial<Row>[]> = {
  // The made-up names run Ada, Bo, Cai, Dee, Eli, Fay, then again: the first four are on the Map.
  "people.profile": [
    { emails: "ada@example.test", ...at("j1", "engaged", "Engaged", 2) },
    { emails: "bo@example.test", ...at("j2", "engaged", "Engaged", 17) },
    { emails: "cai@example.test", ...at("j3", "booked", "Booked", 0, "Ada North") },
    { emails: "dee@example.test", ...at("j4", "booked", "Booked", 5) },
    NO_STEP,
    NO_STEP,
    NO_STEP,
    NO_STEP,
  ],
  "email.call": [
    {
      id: "c1",
      who: "Ada North",
      email: "ada@example.test",
      status: "upcoming",
      soon: "yes",
      start: ago(-0.1),
    },
    {
      id: "c2",
      who: "Hana Ruiz",
      email: "hana@example.test",
      status: "upcoming",
      soon: "yes",
      start: ago(-0.4),
    },
    {
      id: "c3",
      who: "Ivo Zeman",
      email: "ivo@example.test",
      status: "upcoming",
      soon: "no",
      start: ago(-3),
    },
  ],
  "marketing.approval": [
    { id: 1, type: "draft", kind: "draft", who: "Ada North", state: "new" },
    { id: 2, type: "video", kind: "video", who: "Wren", state: "new" },
    { id: 3, type: "invite", kind: "invite", who: "Cai Moreno", state: "new" },
    { id: 4, type: "invite", kind: "invite", who: "Dee Okafor", state: "waiting" },
    { id: 5, type: "template", kind: "template", who: "Wren", state: "new" },
    { id: 6, type: "reply", kind: "reply", who: "Eli Brandt", state: "queued" },
  ],
  "marketing.inbox": [
    { id: "dm:1", type: "dm", who: "Fay Lin", status: "open", url: null },
    { id: "comment:2", type: "comment", who: "Gus Held", status: "open", url: null },
    { id: "activity:3", type: "activity", who: "Kit Alder", status: "open", url: null },
    {
      id: "email:4",
      type: "email",
      who: "Ada North",
      status: "open",
      url: "/today/replies/4",
    },
    { id: "dm:5", type: "dm", who: "Old Thread", status: "closed", url: null },
  ],
  "email.reply": [
    { id: 1, who: "Ada North", email: "ada@example.test", state: "needs_you" },
    { id: 2, who: "Bo Fenwick", email: "bo@example.test", state: "proposed" },
    { id: 3, who: "Jun Park", email: "jun@example.test", state: "needs_you" },
    { id: 4, who: "Lee Odom", email: "lee@example.test", state: "booked" },
  ],
  "access.ask": [
    { id: 1, email: "ivy@example.test", state: "open", yours: "yes", mine: "no" },
    { id: 2, email: "kai@example.test", state: "open", yours: "no", mine: "no" },
  ],
};
