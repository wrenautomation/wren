/** Search and site numbers as console records for the Marketing app (views in `./schema.ts`). */
import {
  date,
  defineRecord,
  link,
  number,
  rate,
  type State,
  status,
  text,
} from "@wren/core/records";

const neutral = (label: string): State => ({ label, tone: "neutral" });
/** Its week against the week before, as `marketing_search_page_records` reads Search Console. */
const WEEK = {
  clicks: number(),
  impressions: number(),
  ctr: rate("impressions", "CTR", { from: "clicks" }),
  position: number("Avg position"),
  clicksChange: number("Clicks vs last week"),
  impressionsChange: number("Impressions vs last week"),
};

export const searchPageRecord = defineRecord({
  id: "marketing.search_page",
  name: { one: "page", many: "pages" },
  view: "marketing_search_page_records",
  key: "id",
  title: "url",
  fields: {
    url: link("Page"),
    indexed: status(
      {
        indexed: { label: "Indexed", tone: "good" },
        not_indexed: { label: "Not indexed", tone: "warn" },
      },
      "Google",
    ),
    coverage: text(),
    checked: date(),
    ...WEEK,
  },
  views: [
    { id: "all", label: "All", sort: "-impressions" },
    {
      id: "not_indexed",
      label: "Not indexed",
      where: { indexed: "not_indexed" },
      sort: "-checked",
    },
  ],
});

export const keywordRecord = defineRecord({
  id: "marketing.keyword",
  name: { one: "keyword", many: "keywords" },
  view: "marketing_keyword_records",
  key: "id",
  title: "phrase",
  subtitle: "page",
  fields: {
    phrase: text("Keyword"),
    source: status({ seed: neutral("Seed"), fanout: neutral("Fan-out"), query: neutral("Query") }),
    page: text(),
    state: status({ active: { label: "Active", tone: "good" }, retired: neutral("Retired") }),
    ...WEEK,
    added: date(),
  },
  views: [
    { id: "active", label: "Active", where: { state: "active" }, sort: "-impressions" },
    { id: "all", label: "All", sort: "-impressions" },
  ],
});

export const searchDayRecord = defineRecord({
  id: "marketing.search_day",
  name: { one: "day in Google", many: "days in Google" },
  view: "marketing_search_day_records",
  key: "id",
  title: "day",
  fields: {
    day: date(),
    clicks: number(),
    impressions: number(),
    ctr: rate("impressions", "CTR", { from: "clicks" }),
    position: number("Avg position"),
  },
  views: [{ id: "all", label: "All", sort: "-day", at: "day" }],
});

export const answerRecord = defineRecord({
  id: "marketing.answer",
  name: { one: "answer", many: "answers" },
  view: "marketing_answer_records",
  key: "id",
  title: "phrase",
  subtitle: "engine",
  fields: {
    phrase: text("Keyword"),
    engine: status({ google: neutral("Google"), perplexity: neutral("Perplexity") }),
    asked: date(),
    cited: status(
      { cited: { label: "Names Wren", tone: "good" }, not_cited: neutral("Doesn't") },
      "Cited",
    ),
    rank: number(),
    overview: status({ shown: neutral("Shown"), none: neutral("None") }, "AI Overview"),
    latest: status({ latest: neutral("Newest"), older: neutral("Older") }, "Asked"),
  },
  views: [
    { id: "latest", label: "Newest", where: { latest: "latest" }, sort: "-asked", at: "asked" },
    {
      id: "cited",
      label: "Names Wren",
      where: { latest: "latest", cited: "cited" },
      sort: "-asked",
      at: "asked",
    },
    { id: "all", label: "All", sort: "-asked", at: "asked" },
  ],
});

export const siteDayRecord = defineRecord({
  id: "marketing.site_day",
  name: { one: "site day", many: "site days" },
  view: "marketing_site_day_records",
  key: "id",
  title: "channel",
  subtitle: "campaign",
  fields: {
    channel: status(
      {
        email: neutral("Email"),
        sms: neutral("Texts"),
        ads: neutral("Ads"),
        content: neutral("Content"),
        search: neutral("Search"),
        reach: neutral("Reach"),
        other: neutral("Other"),
        direct: neutral("Direct"),
      },
      "First touch",
    ),
    campaign: text(),
    day: date(),
    visits: number(),
    firstTouches: number("New visitors"),
    forms: number(),
    bookings: number("Booking clicks"),
    watchPlays: number("Video views"),
    booked: rate("visits", "Visit to booking click", { from: "bookings" }),
    age: status(
      { week: neutral("Last 7 days"), month: neutral("Last 30 days"), earlier: neutral("Earlier") },
      "When",
    ),
  },
  views: [
    { id: "week", label: "Last 7 days", where: { age: "week" }, sort: "-day", at: "day" },
    { id: "month", label: "Last 30", where: { age: ["week", "month"] }, sort: "-day", at: "day" },
    { id: "channel", label: "By channel", sort: "channel", at: "day" },
  ],
});

export const SEARCH_RECORDS = [
  searchPageRecord,
  keywordRecord,
  searchDayRecord,
  answerRecord,
  siteDayRecord,
];
