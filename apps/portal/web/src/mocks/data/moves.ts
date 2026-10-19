/**
 * What waits on Wren's team (`../../moves.ts`), one record each: a call within a day, approvals,
 * inbox items, replies, access asks. Cells set by hand on top of made-up rows. Names and
 * addresses match the journeys' (`./journeys.ts`), so Ada's and Bo's moves sit under their
 * journeys and the rest under Others. Synthetic data only.
 */
import type { Row } from "@wren/core/records/serve";
import { ago } from "./shell.js";

export const MOVE_ROWS: Record<string, Partial<Row>[]> = {
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
      url: "/inbox/replies/4",
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
