/**
 * DM row actions: reply, read and drop one of ours not sent yet.
 */
import { type Action, said } from "@wren/ui";

export const DM_ACTIONS: Action[] = [
  {
    id: "marketing.dmReply",
    label: "Reply",
    icon: "reply",
    handler: "marketing/dmReply",
    // The draft box holds the words; this sends what it saved.
    confirm: "Send this reply?",
    key: "r",
    done: said("Queued. It leaves on the next tick."),
  },
  {
    id: "marketing.dmRead",
    label: "Mark read",
    icon: "read",
    handler: "marketing/dmRead",
    bulk: true,
    key: "e",
    when: { waiting: ["waiting"] },
    done: said("Marked read"),
  },
];

/** A DM of ours not sent yet, dropped: it waits until they write again; Undo puts it back. */
export const DM_CANCEL: Action = {
  id: "marketing.dmCancel",
  label: "Cancel",
  handler: "marketing/dmCancel",
  undo: "marketing/dmUndo",
  bulk: true,
  key: "x",
  when: { turn: ["draft"] },
  optimistic: "Canceled",
  done: said("Canceled. A new draft comes only if they write."),
};
