/**
 * The Inbox's queues: one list, read by Overview E (what waits, ranked by the oldest wait) and by
 * each queue's own page (`late`: the same date field and promise). A queue is a record's view; its
 * `wait` is the date a person began to wait, `promise` how long they may before it is late. 24h is
 * the default for each. A sibling of the modules, not in one, so no module imports another for it.
 */
import type { OverviewQueue } from "@wren/ui";

export const INBOX_QUEUES: OverviewQueue[] = [
  {
    label: "Waiting on you",
    record: "marketing.inbox",
    view: "waiting",
    href: "/engage/inbox?view=waiting",
    icon: "chat",
    line: 0,
    wait: "due",
    promise: "24h",
  },
  {
    label: "Issues for you",
    record: "access.issue",
    view: "waiting",
    href: "/inbox/issues?view=waiting",
    icon: "alert",
    line: 2,
    wait: "at",
    promise: "24h",
  },
  {
    label: "To approve",
    record: "marketing.approval",
    view: "waiting",
    href: "/engage/approve?view=waiting",
    icon: "check",
    line: 1,
    wait: "due",
    promise: "24h",
  },
  {
    label: "Mail that needs you",
    record: "watch.mail",
    view: "needs_you",
    href: "/inbox/mail?view=needs_you",
    icon: "mail",
    line: 3,
    wait: "at",
    promise: "24h",
  },
  // Yours only: the console reads the signed-in person's mentions (`mine`).
  {
    label: "Mentions",
    record: "notes.mention",
    view: "unread",
    href: "/inbox/mentions?view=unread",
    icon: "at",
    wait: "at",
    promise: "24h",
  },
  {
    label: "Asks for access",
    record: "access.ask",
    view: "waiting",
    href: "/inbox/asks?view=waiting",
    icon: "key",
    line: 1,
    wait: "at",
    promise: "24h",
  },
];

/**
 * The states in which a queue's rows wait on the viewer: the same field and values as the record's
 * "waiting" view (`where`). Only those rows can read late; an answered row shows its age.
 * Sources: INBOX_OPEN and INBOX_WAITING in `@wren/content` social records, the `needs_you` mail
 * queue, unread mentions, and open issues and asks.
 */
const OPEN: Record<string, { field: string; values: readonly string[] }> = {
  "marketing.inbox": { field: "status", values: ["open"] },
  "marketing.approval": { field: "state", values: ["new", "waiting"] },
  "watch.mail": { field: "queue", values: ["needs_you"] },
  "notes.mention": { field: "state", values: ["unread"] },
  "access.issue": { field: "state", values: ["open"] },
  "access.ask": { field: "state", values: ["open"] },
};

/** A queue's wait as a list page declares it (`late`): the same field, promise and open states. */
export function queueLate(record: string): {
  field: string;
  promise: string;
  open: { field: string; values: readonly string[] };
} {
  const q = INBOX_QUEUES.find((x) => x.record === record);
  const open = OPEN[record];
  if (!q || !open) throw new Error(`${record} is not an Inbox queue`);
  return { field: q.wait, promise: q.promise, open };
}
