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
  Rows,
  RowsFoot,
  type RowsLine,
  relative,
  statsOf,
  useNarrow,
} from "@wren/ui";
import { useMemo } from "react";
import { useCall } from "../../load.js";
import { type PageProps, WREN } from "../../module.js";
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
        <div className="border border-(--ui-hair) bg-(--ui-paper) p-3">
          <LoadFailed error={got.error} onRetry={got.retry} />
        </div>
      ) : !data ? (
        <Loading shape="rows" lines={5} />
      ) : !data.mentions.length ? (
        <div className="border border-(--ui-hair) bg-(--ui-paper)">
          <Empty>No mentions yet. When someone tags you with @, it shows here.</Empty>
        </div>
      ) : (
        <div className="overflow-x-auto border border-(--ui-hair) bg-(--ui-paper) [border-radius:var(--ui-leaf-panel)]">
          <Rows<NoteMention>
            label="mentions"
            noun="mention"
            narrow={narrow}
            scroller="window"
            lines={lines}
            open={{ id: null, onOpen: (m) => navigate(linkOf(m, client)) }}
            foot={<RowsFoot stats={statsOf(lines.map(() => null))} waits={false} />}
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
        </div>
      )}
    </>
  );
}
