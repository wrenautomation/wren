/**
 * Birdwatch in a chat (WA-1123): a run and one read source as cards, built from the graph's own
 * parts. A pick in a row lights the same claim or source in the graph. Draft.
 */
import { type ReactNode, useState } from "react";
import { Button, Tag } from "../controls.js";
import { cx } from "../format.js";
import { Icon } from "../icons.js";
import { ResearchGraph, SourceMark } from "./graph.js";
import {
  type Claim,
  claimLine,
  count,
  type NextAsk,
  type Pick,
  type ResearchRun,
  type ResearchSource,
  sourceLine,
  totals,
  usedOf,
} from "./model.js";

const CARD =
  "ui-rise grid w-full max-w-[44rem] min-w-0 gap-3 rounded-[12px] bg-(--ui-paper) p-3.5 shadow-[inset_0_0_0_1px_var(--ui-hair)]";
const ROW =
  "flex w-full min-w-0 items-start gap-2.5 rounded-[8px] px-2 py-1.5 text-left transition-colors duration-150 hover:bg-(--ui-hover) aria-pressed:bg-(--ui-fill)";
const SMALL = "text-[12px]/[1.45] text-(--ui-ink-3)";

function Head({
  name,
  meta,
  href,
  live,
}: {
  name: string;
  meta: string;
  href?: string | undefined;
  live?: boolean | undefined;
}) {
  return (
    <header className="flex min-w-0 items-start gap-3">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-[12px] font-semibold text-(--ui-ink-3)">Birdwatch</span>
        <span className="text-[14.5px]/[1.35] font-semibold text-(--ui-ink) wrap-anywhere">
          {name}
        </span>
        <span className={cx(SMALL, "flex flex-wrap items-center gap-x-3")}>
          {meta}
          {href && !live ? (
            <a
              href={href}
              className="inline-flex items-center gap-1 font-semibold text-(--ui-link) no-underline hover:underline"
            >
              Open in Research
              <Icon name="arrow" size={13} />
            </a>
          ) : null}
        </span>
      </div>
      {live ? (
        <Tag tone="accent" busy>
          Reading
        </Tag>
      ) : null}
    </header>
  );
}

/** A run's counts on one line. */
export function RunFacts({ run }: { run: ResearchRun }) {
  const t = totals(run);
  const facts: [number, string][] = [
    [run.searches, run.searches === 1 ? "search" : "searches"],
    [run.hits, run.hits === 1 ? "hit" : "hits"],
    [run.pages, run.pages === 1 ? "page read" : "pages read"],
    [t.kept, t.kept === 1 ? "finding kept" : "findings kept"],
    ...(run.claims.length
      ? [[run.claims.length, run.claims.length === 1 ? "claim" : "claims"] as [number, string]]
      : []),
    [t.cut, "cut"],
  ];
  return (
    <p className="m-0 flex flex-wrap gap-x-3.5 gap-y-0.5 text-[12.5px] text-(--ui-ink-2)">
      {facts.map(([n, word]) => (
        <span key={word}>
          <b className="font-semibold text-(--ui-ink) tabular-nums">{n.toLocaleString("en-US")}</b>{" "}
          {word}
        </span>
      ))}
    </p>
  );
}

/** A claim as a row: its number, its words, its findings and sources. */
function ClaimRow({
  run,
  claim,
  on,
  hold,
}: {
  run: ResearchRun;
  claim: Claim;
  on: boolean;
  hold: Hold;
}) {
  return (
    <button type="button" aria-pressed={on} className={ROW} {...hold({ claim: claim.n })}>
      <span
        aria-hidden="true"
        className={cx(
          "grid size-[22px] flex-none place-items-center rounded-full text-[11.5px] font-semibold tabular-nums shadow-[inset_0_0_0_1.3px_currentColor]",
          on ? "text-(--ui-active)" : "text-(--ui-ink)",
        )}
      >
        {claim.n}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-[13.5px]/[1.4] font-medium text-(--ui-ink) wrap-anywhere">
          <span className="sr-only">Claim {claim.n}: </span>
          {claim.text}
        </span>
        <span className={SMALL}>{claimLine(run, claim.n)}</span>
      </span>
    </button>
  );
}

/** A source as a row: the graph's circle, its name, how much of it a claim uses. */
export function SourceRow({
  source,
  claims,
  on,
  hold,
  line,
}: {
  source: ResearchSource;
  claims: boolean;
  on: boolean;
  hold?: Hold | undefined;
  /** In the place of its own line. */
  line?: string | undefined;
}) {
  const body = (
    <>
      <SourceMark kept={source.findings.length} used={claims ? usedOf(source) : 0} lit={on} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[13.5px]/[1.4] font-medium text-(--ui-ink)">
          {source.icon ? (
            <Icon name={source.icon} size={13} className="flex-none text-(--ui-ink-3)" />
          ) : null}
          <span className="min-w-0 wrap-anywhere">{source.name}</span>
        </span>
        <span className={SMALL}>{line ?? sourceLine(source, claims)}</span>
      </span>
    </>
  );
  return hold ? (
    <button type="button" aria-pressed={on} className={ROW} {...hold({ source: source.id })}>
      {body}
    </button>
  ) : (
    <div className="flex min-w-0 items-start gap-2.5">{body}</div>
  );
}

type Hold = (pick: Pick) => {
  onClick: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
};

function FindingLine({
  text,
  tail,
  at,
}: {
  text: string;
  tail?: ReactNode;
  at?: string | undefined;
}) {
  return (
    <li className="flex min-w-0 gap-2.5 text-[13px]/[1.5] text-(--ui-ink-2)">
      {at ? (
        <span className="w-9 flex-none pt-px font-mono text-[11.5px] text-(--ui-ink-3) tabular-nums">
          {at}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 wrap-anywhere">
        {text}
        {tail}
      </span>
    </li>
  );
}

const LIST = "m-0 grid list-none gap-1.5 p-0";
const DETAIL = "grid min-w-0 gap-2.5 rounded-[10px] bg-(--ui-tile) p-3";

/** Under a picked claim: its findings, by the source that said them. */
function Evidence({ run, claim }: { run: ResearchRun; claim: number }) {
  const from = run.sources.filter((s) => s.findings.some((f) => f.claim === claim));
  return (
    <section
      aria-label={`Claim ${claim}`}
      className="mt-2 mr-2 mb-2 ml-[40px] grid min-w-0 gap-3 border-(--ui-hair) border-l pl-3"
    >
      {from.map((s) => (
        <div key={s.id} className="grid min-w-0 gap-1">
          <SourceRow
            source={s}
            claims
            on={false}
            line={`${s.findings.filter((f) => f.claim === claim).length} of its ${count(s.findings.length, "finding")}`}
          />
          <ul className={cx(LIST, "pl-[32px]")}>
            {s.findings
              .filter((f) => f.claim === claim)
              .map((f) => (
                <FindingLine key={f.text} text={f.text} at={f.at} />
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** A picked source: its findings, the ones a claim uses first. */
function SourceDetail({
  run,
  id,
  hold,
  close,
}: {
  run: ResearchRun;
  id: string;
  hold: Hold;
  close: () => void;
}) {
  const shut = (
    <Button tone="quiet" size="dense" onClick={close} className="flex-none">
      Close
    </Button>
  );
  const s = run.sources.find((q) => q.id === id);
  if (!s) return null;
  const used = s.findings.filter((f) => f.claim !== undefined);
  const rest = s.findings.filter((f) => f.claim === undefined);
  const shown = rest.slice(0, 3);
  return (
    <section aria-label={s.name} className={DETAIL}>
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <SourceRow source={s} claims={run.claims.length > 0} on={false} />
        </div>
        {shut}
      </div>
      <p className={cx(SMALL, "m-0")}>
        {s.kind} · {s.cut.toLocaleString("en-US")} cut
      </p>
      {s.findings.length ? (
        <ul className={LIST}>
          {used.map((f) => (
            <FindingLine
              key={f.text}
              text={f.text}
              at={f.at}
              tail={
                <button
                  type="button"
                  className="ml-1.5 rounded-[4px] text-[12px] font-semibold text-(--ui-link) hover:underline"
                  {...hold({ claim: f.claim ?? 0 })}
                >
                  claim {f.claim}
                </button>
              }
            />
          ))}
          {shown.map((f) => (
            <FindingLine key={f.text} text={f.text} at={f.at} />
          ))}
        </ul>
      ) : null}
      {rest.length > shown.length ? (
        <p className={cx(SMALL, "m-0")}>
          {count(rest.length - shown.length, "more finding")} in no claim.
          {run.href ? " Open the run to read them." : ""}
        </p>
      ) : null}
    </section>
  );
}

/** A run in a chat: its counts, its graph, its claims. A row or a circle picks; the pick opens. */
type OnAsk = ((text: string) => void) | undefined;

/** The agent's next asks; the why rides as the tip. */
function Asks({ asks, onAsk }: { asks: readonly NextAsk[] | undefined; onAsk: OnAsk }) {
  if (!asks?.length || !onAsk) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {asks.map((a) => (
        <Button key={a.ask} tone="quiet" size="dense" title={a.why} onClick={() => onAsk(a.ask)}>
          {a.ask}
        </Button>
      ))}
    </div>
  );
}

export function RunCard({ run, onAsk }: { run: ResearchRun; onAsk?: OnAsk }) {
  const [picked, setPicked] = useState<Pick | null>(null);
  const [point, setPoint] = useState<Pick | null>(null);
  const lit = point ?? picked;
  const same = (a: Pick | null, b: Pick) =>
    !!a &&
    ("claim" in a ? "claim" in b && a.claim === b.claim : "source" in b && a.source === b.source);
  const pick = (p: Pick) => setPicked((was) => (same(was, p) ? null : p));
  const hold: Hold = (p) => ({
    onClick: () => pick(p),
    onPointerEnter: () => setPoint(p),
    onPointerLeave: () => setPoint(null),
    onFocus: () => setPoint(p),
    onBlur: () => setPoint(null),
  });
  const t = totals(run);
  const claims = run.claims.length > 0;
  const at = lit && "source" in lit ? run.sources.find((s) => s.id === lit.source) : null;
  const kinds = [...new Set(run.sources.map((s) => s.kind))];
  return (
    <article aria-label={`Birdwatch run: ${run.name}`} className={CARD}>
      <Head name={run.name} meta={run.meta} href={run.href} live={run.live} />
      <RunFacts run={run} />
      <div className="grid min-w-0 gap-1.5 rounded-[10px] bg-(--ui-tile) p-2">
        <ResearchGraph run={run} lit={lit} onPoint={setPoint} onPick={pick} />
        <p className={cx(SMALL, "m-0 flex min-h-[18px] min-w-0 items-center gap-1.5 px-1")}>
          {at ? (
            <>
              <b className="min-w-0 font-semibold text-(--ui-ink) wrap-anywhere">{at.name}</b>
              <span className="flex-none">{sourceLine(at, claims)}</span>
            </>
          ) : claims ? (
            `A circle is one source. Its solid centre is what a claim uses: ${t.used} of ${t.kept.toLocaleString("en-US")} kept findings.`
          ) : (
            "A circle is one source. A larger circle kept more findings."
          )}
        </p>
      </div>
      {picked && "source" in picked ? (
        <SourceDetail run={run} id={picked.source} hold={hold} close={() => setPicked(null)} />
      ) : null}
      {claims ? (
        <ol aria-label="Claims" className="m-0 -mx-2 grid list-none gap-0.5 p-0">
          {run.claims.map((c) => (
            <li key={c.n}>
              <ClaimRow run={run} claim={c} on={same(lit, { claim: c.n })} hold={hold} />
              {same(picked, { claim: c.n }) ? <Evidence run={run} claim={c.n} /> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className={cx(SMALL, "m-0 flex items-center gap-2.5")}>
          <span
            aria-hidden="true"
            className="size-[22px] flex-none rounded-full border border-dashed border-(--ui-ink-3)"
          />
          {run.live ? "Claims form after the review." : "No claims yet."}
        </p>
      )}
      <details className="group min-w-0">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12.5px] font-semibold text-(--ui-ink-2) hover:text-(--ui-ink) [&::-webkit-details-marker]:hidden">
          {count(run.sources.length, "source")}
          <Icon name="down" size={12} className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-2 grid min-w-0 gap-3">
          {kinds.map((k) => (
            <div key={k} className="grid min-w-0 gap-0.5">
              <span className="text-[12px] font-semibold text-(--ui-ink-3)">{k}</span>
              <ul aria-label={k} className="m-0 -mx-2 grid list-none gap-0.5 p-0">
                {run.sources
                  .filter((s) => s.kind === k)
                  .map((s) => (
                    <li key={s.id}>
                      <SourceRow
                        source={s}
                        claims={claims}
                        on={same(lit, { source: s.id })}
                        hold={hold}
                      />
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
      <Asks asks={run.asks} onAsk={onAsk} />
    </article>
  );
}

/** One source read on its own: no run, no claims. `asks` = the wider jobs it can start. */
export interface SourceRead {
  source: ResearchSource;
  /** Who made it, what it is, how long. */
  by: string;
  meta: string;
  asks?: readonly NextAsk[] | undefined;
  /** The run that holds it, when one does. */
  href?: string | undefined;
}

export function SourceCard({ read, onAsk }: { read: SourceRead; onAsk?: OnAsk }) {
  const s = read.source;
  return (
    <article aria-label={`Birdwatch source: ${s.name}`} className={CARD}>
      <Head name={s.name} meta={`${read.by} · ${read.meta}`} href={read.href} />
      <div className="flex min-w-0 items-center gap-2.5">
        <SourceMark kept={s.findings.length} used={0} />
        <p className="m-0 flex flex-wrap gap-x-3.5 gap-y-0.5 text-[12.5px] text-(--ui-ink-2)">
          <span>
            <b className="font-semibold text-(--ui-ink) tabular-nums">{s.findings.length}</b>{" "}
            {s.findings.length === 1 ? "finding kept" : "findings kept"}
          </span>
          <span>
            <b className="font-semibold text-(--ui-ink) tabular-nums">{s.cut}</b> cut
          </span>
          <span>{read.href ? "In no claim." : "No run. In no claim."}</span>
        </p>
      </div>
      <ul aria-label="Findings" className={LIST}>
        {s.findings.map((f) => (
          <FindingLine key={f.text} text={f.text} at={f.at} />
        ))}
      </ul>
      <Asks asks={read.asks} onAsk={onAsk} />
    </article>
  );
}
