/** Fixtures for `day.tsx`: two record types of work, their rows around today, and fake reads. */
import type { RecordMeta } from "@wren/core/records";
import { cued, date, defineRecord, metaOf, name, status, text } from "@wren/core/records";
import type { Row } from "@wren/core/records/serve";
import type { Action, Call } from "../action.js";
import type { DaySource } from "../day.js";
import type { RecordActs, RecordsApi } from "../records.js";
import { answer, fails, pending } from "./load.js";
import { WORST } from "./worst.js";

const PLATFORMS = cued({
  reddit: { label: "Reddit", tone: "neutral" as const },
  linkedin: { label: "LinkedIn", tone: "neutral" as const },
  x: { label: "X", tone: "neutral" as const },
});

const type = (id: string, one: string, many: string, stamp: string, actions: string[]) =>
  metaOf(
    defineRecord({
      id,
      app: "marketing",
      channel: { field: "platform" },
      name: { one, many },
      rows: async () => [],
      key: "id",
      title: "who",
      subtitle: "note",
      fields: {
        who: name("Title"),
        platform: status(PLATFORMS, "Site"),
        [stamp]: date("When"),
        note: text("Note"),
      },
      views: [{ id: "all", label: "All" }],
      actions,
    }),
    false,
  );

export const DAY_METAS: RecordMeta[] = [
  type("day.post", "post", "posts", "published", []),
  type("day.draft", "draft", "drafts", "created", ["post"]),
];

/** What a day's page reads: posted work, and drafts that wait (older ones sit on today). */
export const DAY_SOURCES: DaySource[] = [
  { record: "day.post", label: "Posted", at: "published", open: "/marketing/posts" },
  {
    record: "day.draft",
    label: "Waiting",
    at: "created",
    carry: true,
    action: "post",
    open: "/marketing/drafts",
  },
];

export const DAY_ACTIONS: Action[] = [{ id: "post", label: "Post now", handler: "demo/post" }];

/** A moment `days` from today at `hour`, in the viewer's own time. */
const at = (days: number, hour: number, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const post = (id: number, who: string, platform: string, when: string, note: string): Row => ({
  id: `p${id}`,
  who,
  platform,
  published: when,
  note,
});
const draft = (
  id: number,
  who: string,
  platform: string,
  when: string | null,
  note: string,
): Row => ({
  id: `d${id}`,
  who,
  platform,
  created: when,
  note,
});

/** Work around today: two posts today, drafts that wait (one old, one undated), posts on the next days. */
export const DAY_POSTS: Row[] = [
  post(1, "Spring release notes", "linkedin", at(0, 9, 30), "Went out with the changelog link."),
  post(2, "Pricing thread", "x", at(0, 14, 5), "Nine posts, one link."),
  post(3, "Webinar recap", "reddit", at(1, 10), "Recording and slides."),
  post(4, "Customer story", "linkedin", at(2, 16), "Quote approved."),
];
export const DAY_DRAFTS: Row[] = [
  draft(1, "Hiring update", "linkedin", at(-3, 11), "Waiting on a final read."),
  draft(2, "Founder AMA teaser", "reddit", at(0, 11, 15), "Needs a thread title."),
  draft(3, "Release poll", "x", null, "No date yet."),
];

/** Worst values: long titles and notes, mixed scripts, many rows in one group. */
export const WORST_POSTS: Row[] = [
  post(1, WORST.longName, "linkedin", at(0, 8), WORST.longText),
  post(2, WORST.url, "x", at(0, 9), WORST.email),
  post(3, WORST.nonLatin, "reddit", at(0, 10), WORST.rtl),
  post(4, WORST.emoji, "reddit", at(0, 12), WORST.emoji),
  post(5, WORST.empty, "x", at(0, 13), WORST.empty),
];
export const WORST_DRAFTS: Row[] = [
  draft(1, WORST.longLabel, "linkedin", at(-400, 9), WORST.longText),
  ...Array.from({ length: 12 }, (_, i) =>
    draft(i + 2, `${WORST.shortName} ${i}`, "reddit", at(-i - 1, 10), WORST.longCompany),
  ),
];

type RecordsPage = Awaited<ReturnType<RecordsApi["list"]>>;
type Range = { gte?: string; lte?: string; empty?: true };

/** A list read over rows: the date range and platform a Day asks for, like the server's. */
function listFrom(byRecord: Record<string, Row[]>, stamps: Record<string, string>) {
  return async (ask: Parameters<RecordsApi["list"]>[0]): Promise<RecordsPage> => {
    const stamp = stamps[ask.record] ?? "";
    const where = (ask.where ?? {}) as Record<string, unknown>;
    const range = (where[stamp] ?? {}) as Range;
    const sites = where.platform;
    const rows = (byRecord[ask.record] ?? []).filter((r) => {
      const v = r[stamp];
      const ms = typeof v === "string" ? Date.parse(v) : null;
      if (range.empty) return ms === null;
      if (ms === null) return false;
      if (range.gte !== undefined && ms < Date.parse(range.gte)) return false;
      if (range.lte !== undefined && ms > Date.parse(range.lte)) return false;
      return !Array.isArray(sites) || sites.includes(r.platform);
    });
    return {
      record: ask.record,
      view: ask.view ?? null,
      rows,
      total: rows.length,
      counts: {},
      next: null,
      totals: {},
    };
  };
}

const STAMPS = { "day.post": "published", "day.draft": "created" };

/** Reads that answer from `posts` and `drafts`. */
export const dayApi = (posts: Row[], drafts: Row[]): RecordsApi => ({
  types: answer(DAY_METAS, 200),
  list: listFrom({ "day.post": posts, "day.draft": drafts }, STAMPS),
  get: pending(),
  export: pending(),
});

/** The types answer; no list ever does: the day waits on its work. */
export const dayWaiting = (): RecordsApi => ({ ...dayApi([], []), list: pending() });

/** The types answer; the list read fails: the day says it could not load. */
export const dayDown = (): RecordsApi => ({
  ...dayApi([], []),
  list: fails("The server could not answer.", 500),
});

/** Every action works, after a short wait. */
export const DAY_CALL: Call = answer({ ok: true }, 600);

export const DAY_ACTS: RecordActs = {
  actions: DAY_ACTIONS,
  viewer: { team: true, demo: false },
  call: DAY_CALL,
};
