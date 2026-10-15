/**
 * Which lists stay rows (`ListPage.card`): logs, audits, runs and a day's numbers read down a
 * column, so a card says less than its row. Every other list gets Rows / Cards.
 */
import type { CardOption } from "@wren/ui";
import type { ListPage } from "./module.js";

/** Record types listed as rows only, wherever a page lists them. */
export const ROWS_ONLY: ReadonlySet<string> = new Set([
  // Logs and audits: what changed, who did what, what was sent.
  "console.change",
  "delivery.change",
  "access.review",
  "console.event",
  "people.event",
  "marketing.activity",
  "marketing.done",
  "marketing.keyword_hit",
  "people.sent",
  "people.merge",
  "email.call",
  // Runs and checks.
  "console.execution",
  "console.check",
  "console.hold",
  "console.handler",
  "voice.latency",
  // A day's or a month's numbers, and settings tables.
  "console.health_day",
  "console.health_input",
  "console.setting",
  "reactivation.setting",
  "marketing.site_day",
  "marketing.search_day",
  "marketing.search_page",
  "marketing.ad_day",
  "marketing.link_day",
  "marketing.metric",
  "marketing.session",
  "books.month",
  "books.channel",
  "books.cohort",
  "people.key",
  "people.trait",
  "people.datum",
]);

/** A page's cards: its own spec, else none for a rows-only type, else read from its columns. */
export const cardFor = (page: Pick<ListPage, "card" | "record">): CardOption | undefined =>
  page.card ?? (ROWS_ONLY.has(page.record) ? false : undefined);
