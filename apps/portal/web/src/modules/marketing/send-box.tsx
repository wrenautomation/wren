/**
 * What Write's Carousel and Story boxes share once the content is in: where it goes, the three
 * ways to send it, and what ContentDesk said back.
 */
import type { Platform } from "@wren/core/content";
import { Button, PlatformMark } from "@wren/ui";
import type { Dispatch, SetStateAction } from "react";
import { ERROR, TOOLS } from "../work/bits.js";

export type Go = "draft" | "slot" | "now";

/** ContentDesk's answer for one platform: a draft made, or why not, or why it waits. */
export interface Result<P extends string> {
  platform: P;
  draftId: string | null;
  reason: string | null;
  at?: string | null;
  held?: string;
}

/** The lines after a send: how many were made and how, then each platform's refusal or hold. */
export function said<P extends string>(results: Result<P>[], go: Go, name: Record<P, string>) {
  const made = results.filter((r) => r.draftId && !r.held);
  const lines = [
    made.length === 0
      ? "Nothing was made."
      : go === "draft"
        ? `${made.length} saved as drafts. They wait in Studio.`
        : go === "now"
          ? `${made.length} posting on the next pass, within a few minutes.`
          : `${made.length} scheduled at the next slots.`,
  ];
  for (const r of results)
    if (r.reason) lines.push(`${name[r.platform]}: ${r.reason}.`);
    else if (r.held) lines.push(`${name[r.platform]} waits as a draft: ${r.held}`);
  return lines;
}

/** The platforms it can go to, each a toggle. */
export function WherePicker<P extends Platform>({
  all,
  name,
  where,
  onChange,
}: {
  all: readonly P[];
  name: Record<P, string>;
  where: P[];
  onChange: Dispatch<SetStateAction<P[]>>;
}) {
  return (
    <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
      <legend className="sr-only">Where it goes</legend>
      {all.map((p) => {
        const on = where.includes(p);
        return (
          <Button
            key={p}
            size="dense"
            tone={on ? "primary" : "secondary"}
            aria-pressed={on}
            onClick={() => onChange((w) => (on ? w.filter((x) => x !== p) : [...w, p]))}
          >
            <span className="inline-flex items-center gap-1.5">
              <PlatformMark mark={p} size={13} />
              {name[p]}
            </span>
          </Button>
        );
      })}
    </fieldset>
  );
}

/** Save as drafts, Schedule, Post now (asked twice), then what the send said or why it failed. */
export function SendTools({
  ready,
  busy,
  sure,
  count,
  send,
  cancel,
  lines,
  error,
}: {
  ready: boolean;
  busy: string | null;
  sure: boolean;
  /** How many platforms "Post now" would reach. */
  count: number;
  send: (go: Go) => void;
  cancel: () => void;
  lines: string[];
  error: string | null;
}) {
  return (
    <>
      <div className={TOOLS}>
        <Button size="dense" tone="secondary" disabled={!ready} onClick={() => send("draft")}>
          {busy === "draft" ? "Saving…" : "Save as drafts"}
        </Button>
        <Button size="dense" tone="secondary" disabled={!ready} onClick={() => send("slot")}>
          {busy === "slot" ? "Scheduling…" : "Schedule"}
        </Button>
        <Button tone="primary" size="dense" disabled={!ready} onClick={() => send("now")}>
          {busy === "now" ? "Posting…" : sure ? `Post ${count} now?` : "Post now"}
        </Button>
        {sure ? (
          <Button size="dense" tone="quiet" onClick={cancel}>
            Cancel
          </Button>
        ) : null}
      </div>
      {lines.length ? (
        <ul className="m-0 grid list-none gap-1 p-0 text-[14px]">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
      {error ? <p className={ERROR}>{error}</p> : null}
    </>
  );
}
