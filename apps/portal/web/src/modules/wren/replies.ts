/**
 * A warm reply's answer (`email.reply`, keyed by its call invite): on the Inbox app's replies page
 * and on the one queue's email rows.
 */
import type { Action, MessageKind } from "@wren/ui";
import { call } from "../../api.js";

const said = (line: string) => () => line;

export const REPLY_WAITING = { state: ["needs_you", "proposed"] };
/** Our answer rides their thread: the subject they replied under, as "Re: ...". */
const replyPreview = (id: string | number) =>
  call<{ row?: { subject?: string | null } }>("console/recordsGet", {
    record: "email.reply",
    id: String(id),
  }).then((r): MessageKind => {
    const subject = r.row?.subject?.trim();
    return {
      kind: "email",
      subject: subject ? (/^re:/i.test(subject) ? subject : `Re: ${subject}`) : "Re:",
    };
  });
export const REPLY_ACTIONS: Action[] = [
  {
    id: "email.approve",
    label: "Send",
    handler: "email/approve",
    ask: { field: "body", label: "Your reply", from: "draft", preview: replyPreview },
    key: "a",
    when: REPLY_WAITING,
    done: said("Sent"),
  },
  {
    id: "email.drop",
    label: "Don't answer",
    handler: "email/drop",
    confirm: "Leave this reply unanswered?",
    key: "s",
    when: REPLY_WAITING,
    done: said("Left unanswered"),
  },
];
