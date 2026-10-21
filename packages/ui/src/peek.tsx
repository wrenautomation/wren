/**
 * The peek (designs/2026-10-21-crm-rows-everywhere.md, F3): what a row click opens beside its
 * list. Not the whole record: its properties, the newest of what happened, and the one thing to
 * do now, with the full record one click on. `Panel` (records.tsx) is the shell (a floating
 * panel, a sheet on a phone); this is the body it draws, from what `PeekBody` reads. Look:
 * design-language.html, Inbox F3 (`.pk`).
 */
import { cn } from "cn";
import type { ReactNode } from "react";
import { Button } from "./controls.js";
import { Loading } from "./feedback.js";
import { dateOf, dateTip, relative } from "./fields.js";
import { Avatar } from "./rows.js";

/** A page's peek: the properties it shows, by field key. Left out, the list's columns. */
export interface PeekSpec {
  fields?: string[] | undefined;
}

/** One thing that happened to the record, as the peek says it. */
export interface PeekLine {
  /** Who did it ("Ada North", "You"). */
  who?: string | undefined;
  /** Where ("Email"). */
  channel?: string | undefined;
  at: string;
  text: string;
}

/** The one thing to do now, when the page has no reply box. */
export interface PeekAction {
  label: string;
  run: () => void;
  busy: boolean;
}

/** The record's avatar and title: the head of the panel, the top of a sheet. */
export function PeekTitle({
  avatar,
  title,
  className,
}: {
  avatar: string | null;
  title: string;
  className?: string | undefined;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {avatar ? <Avatar initials={avatar} lg /> : null}
      <h2 className="m-0 min-w-0 flex-1 truncate text-[17px] font-semibold">{title}</h2>
    </div>
  );
}

/** A field with nothing in it. */
const NONE = <span className="text-(--ui-ink-3)">-</span>;

/** The peek's body: properties, last activity, the reply box or main action, the way on. */
export function PeekView({
  props,
  recent,
  waiting = false,
  reply,
  action,
  openHref,
}: {
  /** The properties, label and drawn value, in order. */
  props: { label: string; node: ReactNode }[];
  /** The newest items, up to three; null when the record keeps none. */
  recent: PeekLine[] | null;
  /** The record is still being read: its activity shows as a skeleton in its place. */
  waiting?: boolean;
  /** The page's own reply box. */
  reply: ReactNode;
  action: PeekAction | null;
  openHref: string;
}) {
  return (
    <div className="grid content-start gap-3">
      {props.length ? (
        <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[13.5px]">
          {props.map((p) => (
            <div key={p.label} className="contents">
              <dt className="text-(--ui-ink-3)">{p.label}</dt>
              <dd className="m-0 flex min-w-0 items-center gap-1.5">{p.node ?? NONE}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {waiting ? <Loading lines={2} label="Loading activity" className="py-0" /> : null}
      {recent ? (
        <section aria-label="Last activity" className="grid gap-2">
          {recent.length ? (
            recent.map((m) => <Msg key={`${m.at} ${m.text}`} line={m} />)
          ) : (
            <p className="m-0 text-[13px] text-(--ui-ink-3)">Nothing has happened yet.</p>
          )}
        </section>
      ) : null}
      {reply ? <div className="grid gap-2">{reply}</div> : null}
      {!reply && action ? (
        <div>
          <Button tone="primary" size="dense" busy={action.busy} onClick={action.run}>
            {action.label}
          </Button>
        </div>
      ) : null}
      <a
        href={openHref}
        className="w-fit text-[13px] text-(--ui-ink-2) underline decoration-(--ui-hair) underline-offset-2 hover:text-(--ui-ink) hover:decoration-current"
      >
        Open the full record
      </a>
    </div>
  );
}

/** One item on a wash ground, the small "who · channel · when" line over its words. */
function Msg({ line }: { line: PeekLine }) {
  const d = dateOf(line.at);
  return (
    <div className="rounded-[4px_14px_14px_14px] bg-(--ui-accent-wash) px-3 py-2.5 text-[14px] text-(--ui-ink)">
      <small className="mb-[3px] block text-[12px] text-(--ui-ink-3)">
        {[line.who, line.channel].filter(Boolean).join(" · ")}
        {line.who || line.channel ? " · " : ""}
        <time dateTime={d?.toISOString()} {...(d ? dateTip(d) : {})}>
          {d ? relative(d) : ""}
        </time>
      </small>
      <span className="wrap-anywhere">{line.text}</span>
    </div>
  );
}
