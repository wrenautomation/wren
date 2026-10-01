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
  const host = site.split("/")[0] ?? site;
  const letter =
    host
      .replace(/^www\./, "")
      .charAt(0)
      .toUpperCase() || "?";
  return (
    <span className="ui-sitemark" aria-hidden="true">
      {letter}
    </span>
  );
}

/** A page it read: the site's mark and the short address, a link when there is one. */
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
      <span className="ui-pagechip-label">{page.label}</span>
    </>
  );
  return page.href ? (
    <a
      className="ui-pagechip"
      data-tone={tone}
      href={page.href}
      target="_blank"
      rel="noreferrer noopener"
    >
      {body}
    </a>
  ) : (
    <span className="ui-pagechip" data-tone={tone}>
      {body}
    </span>
  );
}

function Step({ s }: { s: RunWorkStep }) {
  return (
    <li className="ui-work-step" data-tone={s.tone}>
      <span className="ui-work-icon" aria-hidden="true">
        <Icon name={ICONS[s.icon]} size={14} />
      </span>
      <div className="ui-work-body">
        <p className="ui-work-did">
          {s.did}
          {s.query ? <span className="ui-work-query">{s.query}</span> : null}
        </p>
        {s.page ? <PageChip page={s.page} tone={s.tone === "plain" ? undefined : s.tone} /> : null}
        {s.result ? <p className="ui-work-result">{s.result}</p> : null}
        {s.options.length ? (
          <ul className="ui-work-options">
            {s.options.map((o) => (
              <li key={o.page.label} data-kept={o.kept || undefined}>
                <PageChip page={o.page} tone={o.kept ? "kept" : "dropped"} />
                <span className="ui-work-verdict">
                  {o.kept ? <Icon name="check" size={12} /> : null}
                  {o.verdict}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {s.detail ? <code className="ui-work-detail">{s.detail}</code> : null}
      </div>
    </li>
  );
}

function Fact({ f }: { f: RunWorkFact }) {
  return (
    <div className="ui-work-fact">
      <div className="ui-work-fact-top">
        <span className="ui-work-fact-kind">{f.kind}</span>
        {f.sure !== null ? <Sure value={f.sure} /> : null}
      </div>
      {f.fields.length ? (
        <dl className="ui-work-fields">
          {f.fields.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {f.page || f.seen ? (
        <p className="ui-work-fact-from">
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
    <section className={cx("ui-work", className)} aria-labelledby={id}>
      <h3 id={id} className="ui-work-title">
        {title}
      </h3>
      {work.steps.length ? (
        <>
          <p className="ui-work-count">
            {work.steps.length} {work.steps.length === 1 ? "step" : "steps"}
            {read ? `, ${read} ${read === 1 ? "page" : "pages"} read` : ""}
          </p>
          <ol className="ui-work-steps">
            {work.steps.map((s, i) => (
              // Steps repeat (two searches), and their order is the identity.
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, never reordered.
              <Step key={i} s={s} />
            ))}
          </ol>
        </>
      ) : null}
      {work.facts.length ? (
        <div className="ui-work-kept">
          <h4>What we found</h4>
          {work.facts.map((f, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, never reordered.
            <Fact key={i} f={f} />
          ))}
        </div>
      ) : null}
      {work.reasons.length ? (
        <div className="ui-work-kept">
          <h4>Why they rank here</h4>
          <ul className="ui-work-reasons">
            {work.reasons.map((r) => (
              <li key={r.reason}>
                <span>{r.reason}</span>
                <b>{r.points > 0 ? `+${r.points}` : r.points}</b>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!work.steps.length && !work.facts.length && !work.reasons.length ? (
        <p className="ui-work-result">Nothing more to show for this line.</p>
      ) : null}
    </section>
  );
}
