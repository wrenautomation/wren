/**
 * Learn as console records, in the Learn app: every item (feed or saved), what William saved,
 * the sources it follows, and the SOP library. Wren's team only.
 */
import { date, defineRecord, link, name, number, score, status, text } from "@wren/core/records";
import { itemOf } from "./items.js";
import { sopLibrary } from "./sops.js";

const STATE = status(
  {
    show: { label: "Worth reading", tone: "warn" },
    hold: { label: "Worth knowing", tone: "neutral" },
    drop: { label: "Dropped", tone: "neutral" },
    reading: { label: "Reading", tone: "neutral" },
    mac: { label: "Waits for the Mac", tone: "warn" },
    scoring: { label: "Scoring", tone: "neutral" },
    failed: { label: "Read failed", tone: "bad" },
    archived: { label: "Archived", tone: "good" },
  },
  "State",
);

const KIND = status(
  {
    article: { label: "Article", tone: "neutral" },
    video: { label: "Video", tone: "neutral" },
    reel: { label: "Reel", tone: "neutral" },
    episode: { label: "Episode", tone: "neutral" },
  },
  "Kind",
);

const TYPE = status(
  {
    youtube: { label: "YouTube", tone: "neutral" },
    shorts: { label: "Shorts", tone: "neutral" },
    podcast: { label: "Podcast", tone: "neutral" },
    newsletter: { label: "Newsletter", tone: "neutral" },
    blog: { label: "Blog", tone: "neutral" },
    reddit: { label: "Reddit", tone: "neutral" },
    x: { label: "X", tone: "neutral" },
    instagram: { label: "Instagram", tone: "neutral" },
    tiktok: { label: "TikTok", tone: "neutral" },
    releases: { label: "Releases", tone: "neutral" },
    link: { label: "Link", tone: "neutral" },
  },
  "Type",
);

const ITEM_FIELDS = {
  title: text(),
  type: TYPE,
  kind: KIND,
  creator: name("By"),
  source: name("Source"),
  score: score("Score", { max: 10 }),
  summary: text(),
  changes: text("Would change"),
  why: text("What this changes"),
  state: STATE,
  status: status(
    {
      unread: { label: "Unread", tone: "warn" },
      read: { label: "Read", tone: "neutral" },
      archived: { label: "Archived", tone: "neutral" },
    },
    "Status",
  ),
  tags: text("Tags"),
  collection: name("Collection"),
  duration: number("Seconds"),
  failure: text("Read error"),
  sops: text("In SOPs"),
  at: date("Published"),
  savedAt: date("Saved"),
  savedVia: status(
    {
      portal: { label: "Portal", tone: "neutral" },
      shortcut: { label: "Phone", tone: "neutral" },
      cli: { label: "CLI", tone: "neutral" },
    },
    "Saved from",
  ),
  open: link("Open"),
  chars: number("Characters"),
};

/** The item whole for its page: the transcript and its SOP asks. */
const load = (db: Parameters<typeof itemOf>[0], id: string) => itemOf(db, Number(id));

const WAITING = { state: ["reading", "mac", "scoring", "failed"] };

export const itemRecord = defineRecord({
  id: "learn.item",
  app: "learn",
  channel: null,
  needs: "team",
  name: { one: "item", many: "items" },
  view: "learn.item_records",
  key: "id",
  title: "title",
  subtitle: "source",
  fields: ITEM_FIELDS,
  views: [
    { id: "show", label: "Worth reading", where: { state: "show" }, sort: "-score", at: "at" },
    { id: "hold", label: "Worth knowing", where: { state: "hold" }, sort: "-at", at: "at" },
    { id: "waiting", label: "Waiting", where: WAITING, sort: "-at", at: "at" },
    { id: "archived", label: "Archived", where: { state: "archived" }, sort: "-at", at: "at" },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
  load,
  actions: ["learn.archive", "learn.toSop", "learn.readAgain"],
});

export const savedRecord = defineRecord({
  id: "learn.saved",
  app: "learn",
  channel: null,
  needs: "team",
  name: { one: "saved item", many: "saved" },
  view: "learn.saved_records",
  key: "id",
  title: "title",
  subtitle: "creator",
  fields: ITEM_FIELDS,
  views: [
    { id: "all", label: "All", sort: "-savedAt", at: "savedAt" },
    { id: "reels", label: "Reels", where: { kind: "reel" }, sort: "-savedAt", at: "savedAt" },
    { id: "videos", label: "Videos", where: { kind: "video" }, sort: "-savedAt", at: "savedAt" },
    {
      id: "articles",
      label: "Articles",
      where: { kind: ["article", "episode"] },
      sort: "-savedAt",
      at: "savedAt",
    },
    { id: "waiting", label: "Waiting", where: WAITING, sort: "-savedAt", at: "savedAt" },
  ],
  load,
  actions: ["learn.archive", "learn.toSop", "learn.readAgain"],
});

export const sourceRecord = defineRecord({
  id: "learn.source",
  app: "learn",
  channel: null,
  needs: "team",
  name: { one: "source", many: "sources" },
  view: "learn.source_records",
  key: "id",
  title: "name",
  subtitle: "kind",
  fields: {
    name: name("Source"),
    kind: status(
      {
        youtube: { label: "YouTube", tone: "neutral" },
        podcast: { label: "Podcast", tone: "neutral" },
        newsletter: { label: "Newsletter", tone: "neutral" },
        blog: { label: "Blog", tone: "neutral" },
        reddit: { label: "Reddit", tone: "neutral" },
        forum: { label: "Forum", tone: "neutral" },
        releases: { label: "Releases", tone: "neutral" },
      },
      "Kind",
    ),
    tell: status(
      {
        every: { label: "Every item", tone: "warn" },
        top: { label: "Score 8+", tone: "neutral" },
        digest: { label: "Digest only", tone: "neutral" },
      },
      "Tell me",
    ),
    state: status({
      following: { label: "Following", tone: "good" },
      failing: { label: "Failing", tone: "bad" },
      stopped: { label: "Stopped", tone: "neutral" },
    }),
    items: number("Items"),
    shown: number("Worth reading"),
    url: link("Feed"),
    page: link("Page"),
    fetchedAt: date("Read"),
    failure: text("Last error"),
    by: text("By"),
    createdAt: date("Followed"),
  },
  views: [
    { id: "all", label: "All", sort: "-createdAt", at: "createdAt" },
    { id: "failing", label: "Failing", where: { state: "failing" } },
    { id: "stopped", label: "Stopped", where: { state: "stopped" } },
  ],
  related: [{ record: "learn.item", by: "source_id" }],
  actions: ["learn.follow", "learn.tell", "learn.unfollow"],
});

/** The SOP library: folders where `sopsDir` is readable (the Mac, the preview), else the database. */
export const sopRecordFor = (sopsDir: string | null) =>
  defineRecord({
    id: "learn.sop",
    app: "learn",
    channel: null,
    needs: "team",
    name: { one: "SOP", many: "SOPs" },
    // A few dozen SOPs: read as rows, queried as a table.
    rows: async (db) => (await sopLibrary(db, sopsDir)) as unknown as Record<string, unknown>[],
    key: "id",
    title: "sop",
    subtitle: "state",
    fields: {
      sop: name("SOP"),
      state: status(
        {
          pushed: { label: "Pushed", tone: "good" },
          changed: { label: "Changed since push", tone: "warn" },
          unpushed: { label: "Not pushed", tone: "neutral" },
          unknown: { label: "In development", tone: "neutral" },
        },
        "Pushed",
      ),
      seen: status(
        {
          folder: { label: "Folder", tone: "neutral" },
          database: { label: "Database only", tone: "neutral" },
        },
        "Read from",
      ),
      sources: number("Sources"),
      fromItems: number("From Learn"),
      asked: number("Asked"),
      items: text("Learn items"),
      built: date("Built"),
      pushed: date("Pushed at"),
      words: number("Words"),
    },
    views: [{ id: "all", label: "All", sort: "sop", at: "built" }],
  });

export const LEARN_RECORDS = [itemRecord, savedRecord, sourceRecord];
