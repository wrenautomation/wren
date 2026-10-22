/**
 * Mentions: where someone `@`ed you, in a note's body, a comment or a client's Inbox note, newest
 * first. Only notes you can open: tagging someone never shares a note with them. Opening the note
 * marks it seen.
 */

import {
  Empty,
  Icon,
  LoadFailed,
  Loading,
  PageHeader,
  type RowsLine,
  relative,
  useNarrow,
} from "@wren/ui";
import { useMemo } from "react";
import { useCall } from "../../load.js";
import { type PageProps, WREN } from "../../module.js";
import { PageRows } from "../../page-rows.js";
import { navigate } from "../../route.js";
import { docPath, type NoteMention, notes } from "./api.js";

/** The Notes tab's number: mentions not seen yet. */
export const unseenMentions = (client: string) =>
  notes(client, "mentions", { limit: 1 }).then((r) => r.unseen);

/** A note, its comment, or an Inbox thread (a client's Marketing -> Inbox, Wren's Engage -> Inbox). */
const linkOf = (m: NoteMention, client: string) =>
  m.thread
    ? `${client === WREN.id ? "/engage/inbox" : "/marketing/inbox"}/${encodeURIComponent(m.thread)}`
    : m.commentId
      ? `${docPath(m.noteId ?? "")}?comment=${m.commentId}`
      : docPath(m.noteId ?? "");

/** What the tag sat in, in a word. */
const whereOf = (m: NoteMention) =>
  m.commentId ? "Comment" : m.thread ? "Inbox thread" : "Note body";

export function NoteMentions({ client }: PageProps) {
  const got = useCall(`notes:mentions:${client}`, () => notes(client, "mentions", {}));
  const data = got.data;
  const narrow = useNarrow();
  const lines = useMemo<RowsLine<NoteMention>[]>(
    () => (data?.mentions ?? []).map((m, index) => ({ kind: "row", key: m.id, index, row: m })),
    [data],
  );
  return (
    <>
      <PageHeader
        title="Mentions"
        lede="Where someone tagged you with @, in a note or a comment. Only notes you can open."
      />
      {got.error && !data ? (
        <LoadFailed error={got.error} onRetry={got.retry} />
      ) : !data ? (
        <Loading shape="rows" lines={5} />
      ) : !data.mentions.length ? (
        <Empty>No mentions yet. When someone tags you with @, it shows here.</Empty>
      ) : (
        <PageRows<NoteMention>
          label="mentions"
          noun="mention"
          lines={lines}
          open={{ id: null, onOpen: (m) => navigate(linkOf(m, client)) }}
          name={{
            label: "Note",
            icon: "note",
            min: 240,
            title: (m) => m.name,
            href: (m) => linkOf(m, client),
            // A tag not seen yet reads heavier.
            weight: (m) =>
              m.seen ? "font-normal text-(--ui-ink)" : "font-semibold text-(--ui-ink)",
            mark: () => <Icon name="note" size={15} className="flex-none text-(--ui-ink-2)" />,
            sub: (m) =>
              m.comment || narrow ? (
                <span className="truncate text-[12.5px] text-(--ui-ink-2)">
                  {narrow ? `${m.by}${m.comment ? `: ${m.comment}` : ""}` : m.comment}
                </span>
              ) : null,
            tail: (m) =>
              m.seen ? null : (
                <span
                  role="img"
                  aria-label="New"
                  className="inline-block size-2 flex-none rounded-full bg-(--ui-live)"
                />
              ),
          }}
          columns={[
            { key: "by", label: "Tagged by", icon: "user", width: 200, cell: (m) => m.by },
            { key: "where", label: "In", icon: "at", width: 130, cell: whereOf },
            {
              key: "at",
              label: "When",
              icon: "clock",
              width: 110,
              quiet: true,
              phone: true,
              cell: (m) => relative(new Date(m.at)),
            },
          ]}
        />
      )}
    </>
  );
}
