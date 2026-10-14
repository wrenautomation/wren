/**
 * The sent log (designs/2026-10-14-customerio-audit.md, B2): everything we sent, on every
 * channel, as one list with one ladder. A row opens the message as it went out; its history is
 * the record's own tab.
 */
import type { SentDetail } from "@wren/core/sent/records";
import { type MessageKind, MessagePreview, type RecordExtras } from "@wren/ui";
import type { ListPage } from "../../module.js";

/** The preview's kind for a sent message: its channel's look, from its own sender and subject. */
export function looksOf(d: SentDetail): MessageKind {
  const from = d.from ? { from: d.from } : {};
  if (d.as === "email") return { kind: "email", ...from, subject: d.subject };
  if (d.as === "sms") return { kind: "sms", ...from };
  if (d.as === "dm") return { kind: "dm", site: d.site ?? "DM", ...from, subject: d.subject };
  // A comment: the platform's own feed, all of its words.
  return {
    kind: "post",
    site: d.site ?? "Post",
    ...from,
    feed: { laptop: null, phone: null },
  };
}

/**
 * The message as it went out. `to` is the address as sent. When profiles are wired in, this is
 * where the profile's name and link replace it: the row's `key_kind` and `key_value` are the
 * `profile_keys` pair (`@wren/core/sent/records`).
 */
export const sentExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const d = detail as SentDetail | null;
  if (!d?.body) return {} satisfies RecordExtras;
  return {
    sections: [
      ["As it went out", <MessagePreview key="looks" message={looksOf(d)} body={d.body} />],
    ],
  } satisfies RecordExtras;
};

export const sentPage: ListPage = {
  id: "sent",
  label: "Sent",
  about: "Everything we sent, on every channel, and how far each one got.",
  template: "list",
  record: "people.sent",
  columns: ["at", "channel", "to", "subject", "state", "campaign"],
  empty: {
    all: "Messages show here once we send one.",
    failed: "Nothing has bounced or failed.",
    opened: "Opened emails show here.",
    replied: "Replies show here once someone writes back.",
  },
  extras: sentExtras,
};
