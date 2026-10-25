/**
 * Learn as console records, in the Learn app: every item (feed or saved), what William saved,
 * the sources it follows, and the SOP library. Wren's team only.
 */
import { WREN } from "@wren/core/access";
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
const load = (db: Parameters<typeof itemOf>[0], id: string) => itemOf(db, WREN, Number(id));

const WAITING = { state: ["reading", "mac", "scoring", "failed"] };

const itemRecord = defineRecord({
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

const savedRecord = defineRecord({
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

const sourceRecord = defineRecord({
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
    rows: async (db) =>
      (await sopLibrary(db, WREN, sopsDir)) as unknown as Record<string, unknown>[],
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

const HOOK = status(
  {
    contrarian: { label: "Contrarian", tone: "neutral" },
    "demo-first": { label: "Demo first", tone: "neutral" },
    "result-first": { label: "Result first", tone: "neutral" },
    "identity-call": { label: "Identity call", tone: "neutral" },
    "list-tease": { label: "List tease", tone: "neutral" },
    question: { label: "Question", tone: "neutral" },
    story: { label: "Story", tone: "neutral" },
    warning: { label: "Warning", tone: "neutral" },
    news: { label: "News", tone: "neutral" },
    "how-to": { label: "How to", tone: "neutral" },
    "pattern-break": { label: "Pattern break", tone: "neutral" },
    other: { label: "Other", tone: "neutral" },
  },
  "Hook style",
);

/** Each broken-down reel or video, best reach first: who, the hook, the beats, the ask, the numbers. */
const breakdownRecord = defineRecord({
  id: "learn.breakdown",
  app: "learn",
  channel: null,
  needs: "team",
  name: { one: "breakdown", many: "breakdowns" },
  view: "learn.breakdown_records",
  key: "id",
  title: "title",
  subtitle: "creator",
  fields: {
    title: text(),
    creator: name("By"),
    kind: status(
      {
        reel: { label: "Reel", tone: "neutral" },
        video: { label: "Video", tone: "neutral" },
        post: { label: "Post", tone: "neutral" },
        film: { label: "Film", tone: "neutral" },
      },
      "Kind",
    ),
    hookStyle: HOOK,
    hook: text("Hook"),
    hookWhy: text("Why it works"),
    topic: text("Topic"),
    format: status(
      {
        "talking-head": { label: "Talking head", tone: "neutral" },
        "screen-demo": { label: "Screen demo", tone: "neutral" },
        voiceover: { label: "Voiceover", tone: "neutral" },
        "text-on-screen": { label: "Text on screen", tone: "neutral" },
        mixed: { label: "Mixed", tone: "neutral" },
      },
      "Format",
    ),
    beats: text("Beats"),
    ctaKind: status(
      {
        "comment-word": { label: "Comment a word", tone: "neutral" },
        follow: { label: "Follow", tone: "neutral" },
        link: { label: "Link", tone: "neutral" },
        dm: { label: "DM", tone: "neutral" },
        "save-share": { label: "Save or share", tone: "neutral" },
        none: { label: "None", tone: "neutral" },
        other: { label: "Other", tone: "neutral" },
      },
      "Call to action",
    ),
    cta: text("The ask"),
    reach: number("Reach"),
    views: number("Views"),
    likes: number("Likes"),
    comments: number("Comments"),
    score: score("Score", { max: 10 }),
    followed: status(
      {
        followed: { label: "Followed", tone: "neutral" },
        saved: { label: "Saved", tone: "neutral" },
      },
      "From",
    ),
    source: name("Source"),
    at: date("Published"),
    statsAt: date("Numbers from"),
    open: link("Open"),
    calls: number("Calls"),
    called: status(
      {
        true: { label: "Called", tone: "good" },
        false: { label: "To call", tone: "neutral" },
      },
      "His call",
    ),
    check: status({ check: { label: "Check this", tone: "warn" } }, "Our numbers"),
    checkWhy: text("Why to check"),
  },
  views: [
    { id: "all", label: "Best reach", sort: "-reach", at: "at" },
    { id: "to-call", label: "To call", where: { called: "false" }, sort: "-reach", at: "at" },
    {
      id: "check-this",
      label: "Check this",
      where: { check: "check" },
      sort: "-reach",
      at: "at",
    },
    { id: "films", label: "Films", where: { kind: "film" }, sort: "-reach", at: "at" },
    { id: "posts", label: "Posts", where: { kind: "post" }, sort: "-reach", at: "at" },
    { id: "new", label: "Newest", sort: "-at", at: "at" },
    {
      id: "followed",
      label: "Followed",
      where: { followed: "followed" },
      sort: "-reach",
      at: "at",
    },
    {
      id: "comment-word",
      label: "Comment a word",
      where: { ctaKind: "comment-word" },
      sort: "-reach",
      at: "at",
    },
  ],
  related: [{ record: "learn.item", by: "id" }],
});

/** Each hook style: how many reels, by how many creators, and how far it reaches. */
const hookRecord = defineRecord({
  id: "learn.hook",
  app: "learn",
  channel: null,
  needs: "team",
  name: { one: "hook style", many: "hook styles" },
  view: "learn.hook_records",
  key: "id",
  title: "style",
  subtitle: "top",
  fields: {
    style: HOOK,
    reels: number("Reels"),
    creators: number("Creators"),
    medianReach: number("Median reach"),
    topReach: number("Best reach"),
    top: text("Best reel"),
    topCreator: name("Best by"),
    lastAt: date("Last seen"),
  },
  views: [
    { id: "all", label: "By median reach", sort: "-medianReach", at: "lastAt" },
    { id: "used", label: "Most used", sort: "-reels", at: "lastAt" },
  ],
  related: [{ record: "learn.breakdown", by: "hook_style" }],
});

export const LEARN_RECORDS = [itemRecord, savedRecord, sourceRecord, breakdownRecord, hookRecord];
