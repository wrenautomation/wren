/**
 * A booked call's page (designs/2026-10-07-close-brief-outcome.md): the header says who, the
 * company and when, with the outcome buttons; under it the three lines worth reading first, and
 * how it went once it's marked. The Details lead with the rest of the brief: what to ask, how they
 * came in, their words, what we know. Every line ends with its source and date in quiet type.
 * The same view serves Inbox > Calls, Calendar > Calls, the Schedule's panel and a client's Calls.
 */
import type { CallBrief, Cited, StoredBrief } from "@wren/channel-email/calls";
import { CALL_OUTCOME_LABELS, type CallOutcome } from "@wren/core/calls";
import { modelLabel } from "@wren/core/models/labels";
import { Button, type RecordExtras, StateMark } from "@wren/ui";
import { type ReactNode, useState } from "react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-03" as "Oct 3", with the year when it isn't this one. */
export function dayOf(at: string, now = new Date()): string {
  const [y, m, d] = at.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  const mon = MONTHS[m - 1] ?? "";
  return y === now.getFullYear() ? `${mon} ${d}` : `${mon} ${d}, ${y}`;
}

/** Where a line came from and when: a link when it has one. */
function Cite({ line }: { line: Cited }) {
  const where = line.href ? (
    <a
      href={line.href}
      target="_blank"
      rel="noreferrer"
      className="underline decoration-(--ui-hair) underline-offset-2 hover:text-(--ui-ink-2)"
    >
      {line.source}
    </a>
  ) : (
    line.source
  );
  return (
    <span className="text-[12px] whitespace-nowrap text-(--ui-ink-3)">
      {where} · {dayOf(line.at)}
    </span>
  );
}

/** One cited line: its words, then where and when. */
function Line({ line, quote }: { line: Cited; quote?: boolean }) {
  return (
    <li className="grid gap-0.5">
      <span
        className={
          quote
            ? "border-l-2 border-(--ui-hair) pl-3 text-[14px] leading-[1.6] text-pretty"
            : "text-[14px] leading-[1.6] text-pretty"
        }
      >
        {line.text}
      </span>
      <span className={quote ? "pl-3.5" : undefined}>
        <Cite line={line} />
      </span>
    </li>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid content-start gap-2">
      <h3 className="text-[13px] font-medium text-(--ui-ink-2)">{title}</h3>
      {children}
    </section>
  );
}

const Lines = ({ lines, quote, none }: { lines: Cited[]; quote?: boolean; none: string }) =>
  lines.length ? (
    <ul className="grid gap-3">
      {lines.map((l) => (
        <Line key={`${l.source}:${l.at}:${l.text}`} line={l} quote={quote ?? false} />
      ))}
    </ul>
  ) : (
    <p className="text-[14px] text-(--ui-ink-3)">{none}</p>
  );

/** The three lines worth reading if nothing else is, set big, above the tabs. */
export function BriefTop({ brief }: { brief: CallBrief }) {
  if (!brief.top.length) return null;
  return (
    <section
      aria-label="Before the call"
      className="grid gap-3 border-l-2 border-(--ui-accent) pl-4"
    >
      <h3 className="text-[13px] font-medium text-(--ui-ink-2)">Before the call</h3>
      <ul className="grid gap-3">
        {brief.top.map((l) => (
          <li key={`${l.source}:${l.at}:${l.text}`} className="grid gap-0.5">
            <span className="text-[17px] leading-[1.45] font-medium tracking-[-0.005em] text-pretty">
              {l.text}
            </span>
            <Cite line={l} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** How it went, once marked: the outcome, the reason in their words, who and when. */
export function OutcomeLine({
  outcome,
  reason,
  by,
  at,
}: {
  outcome: CallOutcome;
  reason: string | null;
  by: string | null;
  at: string | null;
}) {
  const state = CALL_OUTCOME_LABELS[outcome];
  const next =
    outcome === "won"
      ? "Onboarding is queued. Nothing sends until you say so."
      : outcome === "not_yet"
        ? "Back to keep warm in 30 days."
        : null;
  return (
    <section
      aria-label="How it went"
      className="grid gap-1 rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-wash) px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
        <StateMark state={state} />
        {reason ? <span className="text-pretty">{reason}</span> : null}
      </div>
      {next ? <p className="text-[13px] text-(--ui-ink-2)">{next}</p> : null}
      {by || at ? (
        <p className="text-[12px] text-(--ui-ink-3)">
          {[by ? `Marked by ${by}` : null, at ? dayOf(at) : null].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </section>
  );
}

/** The whole brief, under the header: what to ask first, then where each fact came from. */
export function BriefBody({
  stored,
  rebuild,
}: {
  stored: StoredBrief;
  rebuild?: (() => Promise<unknown>) | undefined;
}) {
  const b = stored.brief;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-x-10">
        <div className="grid content-start gap-6">
          <Part title="Ask">
            {b.questions.length ? (
              <ol className="grid gap-2">
                {b.questions.map((q) => (
                  <li key={q.text} className="flex gap-2 text-[14px] leading-[1.6] text-pretty">
                    <span aria-hidden className="text-(--ui-ink-3)">
                      ?
                    </span>
                    <span>{q.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[14px] text-(--ui-ink-3)">Nothing open.</p>
            )}
          </Part>
          <Part title="How they came in">
            <Lines lines={b.cameIn} none="We don't know yet." />
          </Part>
          <Part title="Their words">
            <Lines lines={b.thread} quote none="No reply or text from them yet." />
          </Part>
        </div>
        <div className="grid content-start gap-6">
          <Part title="What we know">
            <Lines lines={b.facts} none="No dossier on their company yet." />
          </Part>
          {b.posts.length ? (
            <Part title="Recent posts">
              <Lines lines={b.posts} none="" />
            </Part>
          ) : null}
          <Part title="Signals">
            <Lines lines={b.signals} none="Nothing new in the last 90 days." />
          </Part>
        </div>
      </div>
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-(--ui-hair) pt-3 text-[12px] text-(--ui-ink-3)">
        <span>
          {stored.saved ? "Built" : "Read just now"} {dayOf(b.built)} by{" "}
          {b.model ? (
            <>
              code, questions by <span title={b.model}>{modelLabel(b.model)}</span>
            </>
          ) : (
            "code"
          )}
          .{stored.sentAt ? ` Sent to the team ${dayOf(stored.sentAt)}.` : ""}
        </span>
        {rebuild ? (
          <Button
            tone="secondary"
            size="dense"
            busy={busy}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setFailed(null);
              rebuild()
                .catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false));
            }}
          >
            Rebuild
          </Button>
        ) : null}
        {failed ? <span className="text-(--ui-bad)">{failed}</span> : null}
      </footer>
    </div>
  );
}

const isOutcome = (v: unknown): v is CallOutcome =>
  typeof v === "string" && v in CALL_OUTCOME_LABELS;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/**
 * A call record's extras: the top lines and the outcome above the tabs, the brief first in the
 * Details. `reason` names the row's field with the outcome's reason.
 */
export function callExtras(
  detail: unknown,
  row: Readonly<Record<string, unknown>>,
  o: { reason: string; rebuild?: (() => Promise<unknown>) | undefined },
): RecordExtras {
  const stored = detail as StoredBrief | null;
  const outcome = isOutcome(row.status) ? row.status : null;
  const marked = outcome ? (
    <OutcomeLine
      outcome={outcome}
      reason={str(row[o.reason])}
      by={str(row.markedBy)}
      at={str(row.marked)}
    />
  ) : null;
  const top = stored ? <BriefTop brief={stored.brief} /> : null;
  return {
    ...(marked || top
      ? {
          top: (
            <div className="grid gap-4">
              {marked}
              {top}
            </div>
          ),
        }
      : {}),
    ...(stored ? { lead: <BriefBody stored={stored} rebuild={o.rebuild} /> } : {}),
  };
}
