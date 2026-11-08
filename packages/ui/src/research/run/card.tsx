/**
 * Birdwatch in the chat (WA-1123): a run as the Research page's own graph, one read source as its
 * findings. One model with the page: `RunGraphData`.
 */
import type { ReactNode } from "react";
import { Button, Tag } from "../../controls.js";
import { Icon } from "../../icons.js";
import { RunGraph } from "./graph.js";
import { pl, type RunGraphData } from "./model.js";

/** an agent's next ask; `why` rides as the tip */
export interface NextAsk {
  ask: string;
  why?: string | undefined;
}

type OnAsk = ((text: string) => void) | undefined;

const CARD =
  "ui-rise grid w-full max-w-[44rem] min-w-0 gap-3 rounded-[12px] bg-(--ui-paper) p-3.5 shadow-[inset_0_0_0_1px_var(--ui-hair)]";
const SMALL = "text-[12px]/[1.45] text-(--ui-ink-3)";

function Head({
  name,
  meta,
  href,
  live,
}: {
  name: ReactNode;
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
        <span className={`${SMALL} flex flex-wrap items-center gap-x-3`}>
          {meta}
          {href ? (
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

export interface RunCardProps {
  /** undefined while it loads */
  run?: RunGraphData | undefined;
  failed?: ReactNode;
  /** the run's Research page */
  href?: string | undefined;
  live?: boolean | undefined;
  asks?: readonly NextAsk[] | undefined;
  onAsk?: OnAsk;
}

/** A run: its head, the page's graph in card mode, the agent's next asks. */
export function RunCard({ run, failed, href, live, asks, onAsk }: RunCardProps) {
  const f = run?.funnel;
  const meta = f
    ? [
        run.meta,
        pl(run.searches.length, "search"),
        `${f.read} read`,
        pl(f.findings, "finding"),
        pl(f.claims, "claim"),
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  return (
    <article aria-label={`Birdwatch run: ${run?.t ?? "loading"}`} className={CARD}>
      {run ? <Head name={run.t} meta={meta} href={href} live={live} /> : null}
      {run?.note ? <p className="m-0 text-[13px]/[1.5] text-(--ui-ink-2)">{run.note}</p> : null}
      <RunGraph run={run} failed={failed} card />
      <Asks asks={asks} onAsk={onAsk} />
    </article>
  );
}

/** One source read on its own: no run, no claims. `asks` = the wider jobs it can start. */
export interface SourceRead {
  name: string;
  /** who made it */
  by: string;
  /** what it is, how long */
  meta: string;
  findings: readonly { text: string; at?: string | undefined }[];
  cut: number;
  asks?: readonly NextAsk[] | undefined;
  /** the run that holds it */
  href?: string | undefined;
}

export function SourceCard({ read, onAsk }: { read: SourceRead; onAsk?: OnAsk }) {
  const n = read.findings.length;
  return (
    <article aria-label={`Birdwatch source: ${read.name}`} className={CARD}>
      <Head name={read.name} meta={`${read.by} · ${read.meta}`} href={read.href} />
      <p className="m-0 flex flex-wrap gap-x-3.5 gap-y-0.5 text-[12.5px] text-(--ui-ink-2)">
        <span>
          <b className="font-semibold text-(--ui-ink) tabular-nums">{n}</b>{" "}
          {n === 1 ? "finding kept" : "findings kept"}
        </span>
        <span>
          <b className="font-semibold text-(--ui-ink) tabular-nums">{read.cut}</b> cut
        </span>
      </p>
      <ul aria-label="Findings" className="m-0 grid list-none gap-1.5 p-0">
        {read.findings.map((x) => (
          <li
            key={`${x.at ?? ""}${x.text}`}
            className="flex min-w-0 gap-2.5 text-[13px]/[1.5] text-(--ui-ink-2)"
          >
            {x.at ? (
              <span className="w-9 flex-none pt-px font-mono text-[11.5px] text-(--ui-ink-3) tabular-nums">
                {x.at}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 wrap-anywhere">{x.text}</span>
          </li>
        ))}
      </ul>
      <Asks asks={read.asks} onAsk={onAsk} />
    </article>
  );
}
