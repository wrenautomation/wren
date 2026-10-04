/**
 * The work behind one result, the way an answer engine shows its search: each
 * thing it did in order, what it searched for, the pages it read and what each
 * said, then the fact it kept and how sure it is. Kept steps lead to the answer;
 * dropped ones were dead ends, shown so nothing looks hidden.
 */
import { type ReactNode, useId } from "react";
import { cx } from "./format.js";
import { Icon, type IconName } from "./icons.js";
import { Sure } from "./sources.js";

export type RunWorkIcon = "mail" | "search" | "page" | "board" | "wait" | "rank" | "write";

export interface RunWorkLink {
  label: string;
  href: string | null;
}

export interface RunWorkStep {
  icon: RunWorkIcon;
  did: string;
  query: string | null;
  /** The same search, for the reader to run again. */
  queryHref?: string | null | undefined;
  page: RunWorkLink | null;
  result: string | null;
  options: { page: RunWorkLink; verdict: string; kept: boolean }[];
  tone: "kept" | "dropped" | "plain";
  /** The raw record, for our team only. */
  detail: string | null;
}

export interface RunWorkFact {
  kind: string;
  title: string | null;
  fields: [string, string][];
  sure: number | null;
  page: RunWorkLink | null;
  seen: string | null;
}

export interface RunWork {
  steps: RunWorkStep[];
  facts: RunWorkFact[];
  reasons: { reason: string; points: number }[];
}

const seenOn = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const QUERY =
  "rounded-full bg-(--ui-fill) px-2.5 py-px text-[13px] font-normal text-(--ui-ink) wrap-anywhere before:content-['“'] after:content-['”']";
const KEPT = "grid gap-2 border-t border-(--ui-hair) pt-3";
const KEPT_TITLE =
  "text-[12px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]";

const ICONS: Record<RunWorkIcon, IconName> = {
  mail: "mail",
  search: "search",
  page: "link",
  board: "board",
  wait: "clock",
  rank: "flag",
  write: "reply",
};

/** A site's mark: its first letter on a tint, so no third-party image loads. */
export function SiteMark({ site }: { site: string }) {
  const host = site.replace(/^[a-z]+:\/\//i, "").split("/")[0] ?? site;
  const letter =
    host
      .replace(/^www\./, "")
      .charAt(0)
      .toUpperCase() || "?";
  return (
    <span
      className="grid size-[18px] flex-none place-items-center rounded-full bg-(--ui-ink) text-[10px] leading-none font-bold text-(--ui-on-ink)"
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

/** A page it read: the site's mark and the address, a link when there is one. */
export function PageChip({
  page,
  tone,
}: {
  page: RunWorkLink;
  tone?: "kept" | "dropped" | undefined;
}) {
  const body = (
    <>
      <SiteMark site={page.label} />
      <span
        className={cx(
          "min-w-0 wrap-anywhere",
          tone === "dropped" && "line-through decoration-(--ui-ink-3)",
        )}
      >
        {page.label}
      </span>
    </>
  );
  const chip = cx(
    "inline-flex max-w-full items-center gap-1.5 rounded-full border bg-(--ui-paper) py-0.5 pr-2.5 pl-[3px] text-[12px] no-underline",
    tone === "kept" ? "border-(--ui-accent)" : "border-(--ui-hair)",
    tone === "dropped" ? "text-(--ui-ink-2)" : "text-(--ui-ink)",
  );
  return page.href ? (
    <a
      className={cx(chip, "hover:border-(--ui-accent) hover:text-(--ui-accent)")}
      data-tone={tone}
      href={page.href}
      target="_blank"
      rel="noreferrer noopener"
    >
      {body}
    </a>
  ) : (
    <span className={chip} data-tone={tone}>
      {body}
    </span>
  );
}

function Step({ s }: { s: RunWorkStep }) {
  return (
    <li
      // The thread between steps.
      className="relative grid grid-cols-[26px_minmax(0,1fr)] gap-2.5 pb-3 not-last:before:absolute not-last:before:top-[26px] not-last:before:bottom-0 not-last:before:left-3 not-last:before:w-px not-last:before:bg-(--ui-hair)"
      data-tone={s.tone}
    >
      <span
        className={cx(
          "grid size-[26px] place-items-center rounded-full",
          s.tone === "kept"
            ? "bg-(--ui-accent-tint) text-(--ui-accent)"
            : "bg-(--ui-fill) text-(--ui-ink-2)",
        )}
        aria-hidden="true"
      >
        <Icon name={ICONS[s.icon]} size={14} />
      </span>
      <div className="grid min-w-0 justify-items-start gap-1.5 pt-[3px]">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5 text-[14px] font-medium">
          {s.did}
          {s.query ? (
            s.queryHref ? (
              <a
                className={cx(QUERY, "decoration-(--ui-hair) hover:text-(--ui-accent)")}
                href={s.queryHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                {s.query}
              </a>
            ) : (
              <span className={QUERY}>{s.query}</span>
            )
          ) : null}
        </p>
        {s.page ? <PageChip page={s.page} tone={s.tone === "plain" ? undefined : s.tone} /> : null}
        {s.result ? (
          <p
            className={cx(
              "text-[13px]",
              s.tone === "dropped" ? "text-(--ui-ink-3)" : "text-(--ui-ink-2)",
            )}
          >
            {s.result}
          </p>
        ) : null}
        {s.options.length ? (
          <ul className="grid list-none gap-1">
            {s.options.map((o) => (
              <li
                key={o.page.label}
                className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]"
                data-kept={o.kept || undefined}
              >
                <PageChip page={o.page} tone={o.kept ? "kept" : "dropped"} />
                <span
                  className={cx(
                    "inline-flex items-center gap-1",
                    o.kept ? "font-semibold text-(--ui-good-ink)" : "text-(--ui-ink-3)",
                  )}
                >
                  {o.kept ? <Icon name="check" size={12} /> : null}
                  {o.verdict}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {s.detail ? (
          <code className="block max-w-full text-[11px] text-(--ui-ink-3) wrap-anywhere">
            {s.detail}
          </code>
        ) : null}
      </div>
    </li>
  );
}

function Fact({ f }: { f: RunWorkFact }) {
  return (
    <div className="grid gap-2 rounded-(--ui-radius-control) bg-(--ui-tile) px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{f.kind}</span>
        {f.sure !== null ? <Sure value={f.sure} /> : null}
      </div>
      {f.fields.length ? (
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-4 gap-y-2">
          {f.fields.map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] text-(--ui-ink-3)">{k}</dt>
              <dd className="text-[14px]">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {f.page || f.seen ? (
        <p className="flex flex-wrap items-center gap-2 text-[12px] text-(--ui-ink-3)">
          {f.page ? <PageChip page={f.page} /> : null}
          {f.seen ? <span>Seen {seenOn(f.seen)}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

/** One result's work: the steps, then what it kept, then why it ranks. */
export function RunWorkTrail({
  work,
  title,
  className,
}: {
  work: RunWork;
  /** What this is the work behind ("How we found Dana Reyes"). */
  title: ReactNode;
  className?: string | undefined;
}) {
  const id = useId();
  const read = work.steps.filter((s) => s.page || s.options.length).length;
  return (
    <section className={cx("grid gap-3", className)} aria-labelledby={id}>
      <h3 id={id} className="pr-8 text-[15px] font-semibold">
        {title}
      </h3>
      {work.steps.length ? (
        <>
          <p className="-mt-2 text-[12px] text-(--ui-ink-3)">
            {work.steps.length} {work.steps.length === 1 ? "step" : "steps"}
            {read ? `, ${read} ${read === 1 ? "page" : "pages"} read` : ""}
          </p>
          <ol className="grid list-none">
            {work.steps.map((s, i) => (
              // Steps repeat (two searches), and their order is the identity.
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, never reordered.
              <Step key={i} s={s} />
            ))}
          </ol>
        </>
      ) : null}
      {work.facts.length ? (
        <div className={KEPT}>
          <h4 className={KEPT_TITLE}>What we found</h4>
          {work.facts.map((f, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, never reordered.
            <Fact key={i} f={f} />
          ))}
        </div>
      ) : null}
      {work.reasons.length ? (
        <div className={KEPT}>
          <h4 className={KEPT_TITLE}>Why they rank here</h4>
          <ul className="grid list-none gap-1 text-[14px]">
            {work.reasons.map((r) => (
              <li key={r.reason} className="flex justify-between gap-3">
                <span>{r.reason}</span>
                <b className="text-(--ui-good-ink) tabular-nums">
                  {r.points > 0 ? `+${r.points}` : r.points}
                </b>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!work.steps.length && !work.facts.length && !work.reasons.length ? (
        <p className="text-[13px] text-(--ui-ink-2)">Nothing more to show for this line.</p>
      ) : null}
    </section>
  );
}
