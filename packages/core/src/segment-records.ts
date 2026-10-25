/**
 * Groups (once Segments) as console records (designs/2026-10-14-customerio-audit.md, B5), the People app's: each
 * group with its size and what uses it (`people.segment`), and who is in each
 * (`people.member`). Changes go through PeopleConsole's segment handlers. Views in
 * `./segments-schema.ts`.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import {
  cued,
  date,
  defineRecord,
  link,
  name,
  number,
  prose,
  type State,
  status,
  text,
} from "./records.js";
import { type Rule, ruleWords, segmentById, segmentNames } from "./segments.js";
import type { SegmentKind } from "./segments-schema.js";

/** Each kind its own swatch: hashed, live and snapshot would share one. */
const SEGMENT_KIND_STATES: Readonly<Record<SegmentKind, State>> = {
  live: { label: "Live", tone: "good", tint: 4 },
  manual: { label: "Manual", tone: "neutral", tint: 6 },
  snapshot: { label: "Snapshot", tone: "neutral", tint: 1 },
};
const SEGMENT_STATE_STATES = cued({
  active: { label: "Active", tone: "good" },
  archived: { label: "Archived", tone: "neutral" },
} as const);

/** What a group's page shows past the row: its rule, in words and as data, and recent moves. */
export interface SegmentDetail {
  rule: Rule | null;
  ruleWords: string | null;
  /** Entries and exits in the last 7 and 30 days before its last count. */
  moves: { entered7: number; left7: number; entered30: number; left30: number };
  /** When it last changed: its editor saves over this one only. */
  version: string;
}

export async function segmentDetail(db: Queryable, id: string): Promise<SegmentDetail | null> {
  const s = await segmentById(db, Number(id));
  if (!s) return null;
  const at = s.computedAt ?? s.createdAt;
  const [m] = (await db.execute(sql`
    select count(*) filter (where change = 'entered' and e.at > ${at}::timestamptz - interval '7 days')::int entered7,
      count(*) filter (where change = 'left' and e.at > ${at}::timestamptz - interval '7 days')::int left7,
      count(*) filter (where change = 'entered')::int entered30,
      count(*) filter (where change = 'left')::int left30
    from segment_member_events e
    where e.segment_id = ${s.id} and e.at > ${at}::timestamptz - interval '30 days'`)) as unknown as {
    entered7: number;
    left7: number;
    entered30: number;
    left30: number;
  }[];
  return {
    rule: s.rule,
    ruleWords: s.rule ? ruleWords(s.rule, await segmentNames(db)) : null,
    moves: {
      entered7: Number(m?.entered7 ?? 0),
      left7: Number(m?.left7 ?? 0),
      entered30: Number(m?.entered30 ?? 0),
      left30: Number(m?.left30 ?? 0),
    },
    version: s.updatedAt,
  };
}

/** The handlers a group's buttons call; Save is its Rule section's. */
const SEGMENT_ACTIONS = [
  "people.segmentSave",
  "people.segmentArchive",
  "people.segmentRestore",
  "people.segmentRetake",
] as const;

const segmentRecord = defineRecord({
  id: "people.segment",
  app: "people",
  channel: null,
  name: { one: "group", many: "groups" },
  view: "segment_records",
  key: "id",
  title: "name",
  subtitle: "kind",
  fields: {
    name: name("Name"),
    kind: status(SEGMENT_KIND_STATES, "Kind"),
    state: status(SEGMENT_STATE_STATES, "State"),
    size: number("People"),
    usedBy: text("Used by"),
    words: prose("Described as", { listed: false }),
    computedAt: date("Counted"),
    usedAt: date("Last used"),
    archivedAt: date("Archived", { listed: false }),
    by: text("Made by", { listed: false }),
    createdAt: date("Made"),
    members: link("Its people"),
  },
  quick: ["kind"],
  views: [
    { id: "active", label: "Active", where: { state: "active" }, sort: "name" },
    { id: "archived", label: "Archived", where: { state: "archived" }, sort: "-archivedAt" },
    { id: "all", label: "All", sort: "name" },
  ],
  actions: SEGMENT_ACTIONS,
  load: segmentDetail,
});

const memberRecord = defineRecord({
  id: "people.member",
  app: "people",
  channel: null,
  name: { one: "member", many: "members" },
  view: "segment_member_records",
  key: "id",
  title: "name",
  subtitle: "segment",
  fields: {
    name: name("Person"),
    segment: text("Group"),
    segmentKind: status(SEGMENT_KIND_STATES, "Group kind", { listed: false }),
    emails: text("Emails"),
    phones: text("Phones"),
    since: date("In since"),
    profileLink: link("Profile"),
    segmentId: number("Group id", { listed: false }),
    profileId: number("Profile id", { listed: false }),
  },
  views: [{ id: "all", label: "All", sort: "-since", at: "since" }],
  actions: ["people.memberRemove"],
});

/** The People app's segment records. */
export const SEGMENT_RECORDS = [segmentRecord, memberRecord];
