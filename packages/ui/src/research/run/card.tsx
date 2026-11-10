/**
 * Weaver in the chat (WA-1123): a run as the Research page's own graph, one read source as its
 * findings. One model with the page: `RunGraphData`.
 */
import type { ReactNode } from "react";
import { ProductCard, BusyTag, type NextAsk, type OnAsk } from "../../agent-product-card.js";
import { RunGraph } from "./graph.js";
import { pl, type RunGraphData } from "./model.js";

export type { NextAsk } from "../../agent-product-card.js";

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
    <ProductCard
      product="Weaver"
      what="Weaver run"
      name={run?.t}
      meta={meta}
      href={href}
      open="Open in Research"
      status={live ? <BusyTag>Reading</BusyTag> : null}
      asks={asks}
      onAsk={onAsk}
    >
      {run?.note ? <p className="m-0 text-[13px]/[1.5] text-(--ui-ink-2)">{run.note}</p> : null}
      <RunGraph run={run} failed={failed} card />
    </ProductCard>
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
    <ProductCard
      product="Weaver"
      what="Weaver source"
      name={read.name}
      meta={`${read.by} · ${read.meta}`}
      href={read.href}
      open="Open in Research"
      asks={read.asks}
      onAsk={onAsk}
    >
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
    </ProductCard>
  );
}
