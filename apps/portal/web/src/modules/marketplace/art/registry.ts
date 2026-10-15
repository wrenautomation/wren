/**
 * Which scene draws each part, workflow and template in the Shop. A new id with no line here
 * falls back by shape (a cadence by its `follow_up.` id) and then to its icon, so nothing is
 * ever blank.
 */
import type { IconName } from "@wren/ui";
import type { Spec } from "./scenes.js";

const ART: Record<string, Spec> = {
  // Find: the lead sheet and what fills it.
  "research.discovery": { scene: "sheet", v: "find" },
  "research.crawl": { scene: "sheet", v: "crawl" },
  "research.people": { scene: "sheet", v: "people" },
  "research.verify": { scene: "sheet", v: "verify" },
  "research.lead_sheet": { scene: "sheet" },
  "research.leads": { scene: "sheet", v: "find" },
  "research.dossier": { scene: "doc", v: "dossier" },
  "research.signals": { scene: "sheet", v: "signals" },
  "research.social": { scene: "post", v: "scan", on: "linkedin" },
  "signals.triggers": { scene: "sheet", v: "signals" },
  signals: { scene: "flow", via: ["globe", "search", "flag"] },

  // Reach: email, texts, calls, socials, pages, ads.
  "email.sequences": { scene: "inbox", v: "sent" },
  "email.touch": { scene: "inbox", v: "sent" },
  "email.inbox_health": { scene: "chart", v: "gauge" },
  "email.replies": { scene: "thread" },
  "email.marketing": { scene: "inbox", v: "sent" },
  "sms.texts": { scene: "texts" },
  "sms.touch": { scene: "texts" },
  "sms.text_back": { scene: "texts", v: "back" },
  "sms.forms": { scene: "texts", v: "form" },
  "sms.follow_up": { scene: "cadence", via: ["chat"], days: [0, 1, 3] },
  "content.whatsapp": { scene: "texts", on: "whatsapp" },
  "voice.call_now": { scene: "call", v: "now" },
  "voice.agent": { scene: "call" },
  "reach.outreach": { scene: "connect", on: "linkedin" },
  "linkedin.invites": { scene: "connect", on: "linkedin" },
  "reach.touch": { scene: "connect", v: "dm", on: "linkedin" },
  "linkedin.comments": { scene: "comments", on: "linkedin" },
  "x.comments": { scene: "comments", on: "x" },
  "instagram.comments": { scene: "comments", on: "instagram" },
  "comments.read": { scene: "comments", on: "reddit" },
  "comments.sort": { scene: "comments", v: "sort", on: "reddit" },
  "reach.comments": { scene: "comments", v: "find", on: "reddit" },
  "reddit.discovery": { scene: "post", v: "scan", on: "reddit" },
  "sites.pages": { scene: "page" },
  "sites.forms": { scene: "page", v: "form" },
  "sites.chat": { scene: "page", v: "chat" },
  "video.demo": { scene: "page", v: "video" },
  "ads.meta": { scene: "chart", v: "ad", on: "meta" },
  reactivation: {
    scene: "cadence",
    v: "wake",
    via: ["mail", "mail", "calendar"],
    days: [0, 0, 3, 7],
  },

  // Content.
  "content.posting": { scene: "post", on: "linkedin" },
  "content.planner": { scene: "post", v: "plan" },
  "content.social": { scene: "comments", on: "linkedin" },
  studio: { scene: "post", v: "video" },
  "marketing.stats": { scene: "chart" },
  "search.watch": { scene: "chart", v: "rank", on: "searchconsole" },
  content: { scene: "flow", via: ["sparkle", "write", "check", "megaphone"] },

  // Follow and book.
  follow_up: { scene: "cadence", via: ["chat", "people", "mail"], days: [0, 2, 5] },
  nurture: { scene: "cadence", via: ["mail", "chat", "mail", "calendar"], days: [0, 7, 14, 30] },
  keep_warm: {
    scene: "cadence",
    via: ["chat", "mail", "people", "calendar"],
    days: [0, 14, 30, 60],
  },
  "calendar.booking": { scene: "calendar" },
  "sms.reminders": { scene: "calendar", v: "remind" },
  "calls.brief": { scene: "doc", v: "brief" },
  "calls.outcome": { scene: "doc", v: "outcome" },
  close: { scene: "flow", via: ["calendar", "phone", "doc", "check"] },

  // Deliver and get paid.
  "deals.board": { scene: "board" },
  "delivery.portal": { scene: "board", v: "portal" },
  "delivery.contract": { scene: "doc", v: "sign" },
  "documents.docs": { scene: "doc", v: "sign" },
  "delivery.invoices": { scene: "doc", v: "invoice" },
  "payments.links": { scene: "doc", v: "pay" },
  "reviews.ask": { scene: "review", v: "ask" },
  "delivery.reviews": { scene: "review" },
  onboarding: { scene: "flow", via: ["write", "doc", "board", "check"] },

  // Run the business.
  books: { scene: "doc", v: "ledger" },
  "books.bills": { scene: "doc", v: "invoice" },
  offers: { scene: "page", v: "offer" },
  "drafts.facts": { scene: "doc", v: "facts" },
  "learn.save": { scene: "page", v: "save" },
  "learn.read": { scene: "doc", v: "read" },
  "learn.score": { scene: "sheet", v: "score" },
  learn: { scene: "flow", via: ["pin", "book", "search"] },
  "watch.read": { scene: "inbox" },
  "mail.read": { scene: "inbox" },
  "watch.triage": { scene: "inbox", v: "sort" },
  "mail.triage": { scene: "inbox", v: "sort" },
  watch: { scene: "flow", via: ["inbox", "sparkle", "check"] },
  mail: { scene: "flow", via: ["inbox", "sparkle", "check"] },
  outbound: { scene: "flow", via: ["search", "list", "mail", "calendar"] },
  paid: { scene: "flow", via: ["megaphone", "page", "phone", "calendar"] },
  wren: { scene: "flow", via: ["search", "mail", "calendar", "money"] },

  // Templates: the whole loop, start to what it gets.
  missed_call: { scene: "flow", v: "missed", via: ["phone", "chat", "reply"] },
  speed_to_lead: { scene: "flow", via: ["globe", "chat", "phone", "calendar"] },
  reviews: { scene: "flow", via: ["check", "chat", "star"] },
  win_back: { scene: "flow", via: ["list", "mail", "reply", "calendar"] },
};

/** A cadence's channel by its name: "email_…" mails, "linkedin-connect" connects, the rest text. */
const cadenceVia = (name: string): IconName[] =>
  name.startsWith("email")
    ? ["mail"]
    : name.includes("linkedin")
      ? ["people", "chat", "chat"]
      : ["chat"];

/** Its touch days, from an id that says them ("…-days-0-3-7"); else a first week. */
const daysOf = (id: string): number[] => {
  const m = /days((?:-\d+)+)$/.exec(id);
  const days = m?.[1]?.split("-").filter(Boolean).map(Number) ?? [];
  return days.length > 1 ? days : [0, 1, 3];
};

/** What draws `id`: its own line, a cadence by its id, or its icon. */
export function specOf(id: string, icon: string | null): Spec {
  const own = ART[id];
  if (own) return own;
  if (id.startsWith("follow_up.")) {
    const name = id.slice("follow_up.".length);
    return { scene: "cadence", via: cadenceVia(name), days: daysOf(name) };
  }
  return { scene: "glyph", icon: icon ?? "apps" };
}
