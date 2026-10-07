/**
 * Mentions: where someone `@`ed you, in a note's body or a comment, newest first. Only notes you
 * can open: tagging someone never shares a note with them. Opening the note marks it seen.
 */
import { Alert, Empty, Icon, Loading, PageHeader, relative } from "@wren/ui";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { docPath, type NoteMention, notes } from "./api.js";

/** The Notes tab's number: mentions not seen yet. */
export const unseenMentions = (client: string) =>
  notes(client, "mentions", { limit: 1 }).then((r) => r.unseen);

const linkOf = (m: NoteMention) =>
  m.commentId ? `${docPath(m.noteId)}?comment=${m.commentId}` : docPath(m.noteId);

export function NoteMentions({ client }: PageProps) {
  const got = useCall(`notes:mentions:${client}`, () => notes(client, "mentions", {}));
  const data = got.data;
  return (
    <>
      <PageHeader
        title="Mentions"
        lede="Where someone tagged you with @, in a note or a comment. Only notes you can open."
      />
      <div className="border border-(--ui-hair) bg-(--ui-paper)">
        {got.error && !data ? (
          <div className="p-3">
            <Alert onRetry={got.retry}>{got.error.message}</Alert>
          </div>
        ) : !data ? (
          <Loading lines={5} />
        ) : !data.mentions.length ? (
          <Empty>No mentions yet. When someone tags you with @, it shows here.</Empty>
        ) : (
          <ul className="m-0 list-none p-0">
            {data.mentions.map((m) => (
              <li key={m.id} className="border-b border-(--ui-hair) last:border-b-0">
                <a
                  href={linkOf(m)}
                  className="flex items-start gap-3 px-3 py-3 text-(--ui-ink) no-underline hover:bg-(--ui-wash)"
                >
                  <Icon name="note" className="mt-0.5 flex-none text-(--ui-ink-2)" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px]">
                      <span className={m.seen ? undefined : "font-semibold"}>{m.by}</span>{" "}
                      {m.commentId ? "tagged you in a comment on" : "tagged you in"}{" "}
                      <span className="font-medium">{m.name}</span>
                    </span>
                    {m.comment ? (
                      <span className="mt-0.5 line-clamp-2 block text-[13px] text-(--ui-ink-2)">
                        {m.comment}
                      </span>
                    ) : null}
                    <span className="mt-1 block text-[12px] text-(--ui-ink-2)">
                      {relative(new Date(m.at))}
                    </span>
                  </span>
                  {m.seen ? null : (
                    <span
                      role="img"
                      aria-label="New"
                      className="mt-2 inline-block size-2 flex-none rounded-full bg-(--ui-accent)"
                    />
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
