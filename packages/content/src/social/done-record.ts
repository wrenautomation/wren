/**
 * Inbox → Done (designs/2026-10-11-done.md): what was approved, rejected, edited and sent, from
 * `draft_events`, newest first, with Today and This week as tabs.
 */
import { cued, date, defineRecord, link, prose, status, text } from "@wren/core/records";
import { PLATFORM_LABELS } from "@wren/outreach/records";

const neutral = (label: string) => ({ label, tone: "neutral" as const });

export const doneRecord = defineRecord({
  id: "marketing.done",
  app: "marketing",
  channel: { field: "platform" },
  name: { one: "step", many: "steps" },
  view: "done_records",
  key: "id",
  title: "what",
  subtitle: "note",
  fields: {
    what: text("What"),
    event: status(
      {
        approved: { label: "Approved", tone: "good" },
        sent: { label: "Sent", tone: "good" },
        scheduled: neutral("Scheduled"),
        edited: neutral("Edited"),
        rejected: { label: "Rejected", tone: "warn" },
        failed: { label: "Failed", tone: "bad" },
      },
      "Step",
    ),
    kind: status(
      cued({
        post: neutral("Post"),
        comment: neutral("Comment answer"),
        thread: neutral("Thread reply"),
        dm: neutral("DM"),
        invite: neutral("Invite"),
        invite_note: neutral("Invite note"),
        video: neutral("Video"),
        post_comment: neutral("Comment on a post"),
      }),
      "Kind",
    ),
    platform: status(PLATFORM_LABELS, "Site"),
    via: status(
      {
        person: neutral("You"),
        claude: neutral("Claude, at your ask"),
        wren: neutral("Wren"),
        model: neutral("The model"),
      },
      "By",
    ),
    by: text("Who", { listed: false }),
    words: prose("Words"),
    note: text("Note"),
    day: status(
      { today: neutral("Today"), week: neutral("This week"), older: neutral("Older") },
      "Day",
      { listed: false },
    ),
    at: date("When"),
    open: link("Open it"),
    url: link("Live"),
  },
  quick: ["event", "platform", "kind"],
  views: [
    { id: "today", label: "Today", where: { day: ["today"] }, sort: "-at", at: "at" },
    { id: "week", label: "This week", where: { day: ["today", "week"] }, sort: "-at", at: "at" },
    { id: "approved", label: "Approved", where: { event: ["approved"] }, sort: "-at", at: "at" },
    { id: "rejected", label: "Rejected", where: { event: ["rejected"] }, sort: "-at", at: "at" },
    { id: "sent", label: "Sent", where: { event: ["sent", "failed"] }, sort: "-at", at: "at" },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
});
