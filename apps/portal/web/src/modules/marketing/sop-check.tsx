/**
 * One of our pieces beside its SOP (designs/2026-10-25-competitor-analyzer.md, Use): each
 * standard number with ours, each closed set with ours, the patterns he kept or dropped, his calls
 * judged, and up to 3 changes. A post draft (Write) and a Studio film share it. The server's shape
 * is content `DraftCheck` and learn `PieceCheck`.
 */
import { cx, Tag } from "@wren/ui";
import type { ReactNode } from "react";
import { QUIET } from "../work/bits.js";

type Where = "below" | "inside" | "above";
export interface SopCheck {
  kind: string;
  n: number;
  numbers: {
    label: string;
    ours: number | null;
    median: number;
    p25: number;
    p75: number;
    where: Where | null;
  }[];
  shares: { label: string; ours: string | null; n: number; of: [string, number][] }[];
  patterns: {
    label: string;
    ours: string | null;
    kept: string[];
    dropped: string[];
    verdict: "meets" | "breaks" | "off";
  }[];
  rules?: { call: string; say: string; cite: string; verdict: "meets" | "breaks" | "n/a" }[];
  changes?: string[];
  sop?: string | null;
  why?: string | null;
  stale?: boolean;
  at?: string;
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const WHERE: Record<Where, string> = { below: "Under", inside: "Inside", above: "Over" };
const things = (kind: string, n: number) =>
  `${n} ${kind === "film" ? "film" : kind === "post" ? "post" : "piece"}${n === 1 ? "" : "s"}`;

/** A row: a short tag, then the words. Same shape as the video page's checks. */
const Row = ({
  tag,
  tone,
  children,
}: {
  tag: string;
  tone: "green" | "warn" | "neutral";
  children: ReactNode;
}) => (
  <li className="flex min-w-0 items-baseline gap-2">
    <Tag tone={tone} className="shrink-0">
      {tag}
    </Tag>
    <span className="min-w-0 break-words">{children}</span>
  </li>
);

export function SopCheckList({ check }: { check: SopCheck }) {
  if (check.why) return <p className={cx("text-[14px]", QUIET)}>{check.why}</p>;
  const rules = (check.rules ?? []).filter((r) => r.verdict !== "n/a");
  return (
    <div className="grid gap-2 text-[14px]">
      <p className={cx("text-[13px]", QUIET)}>
        {check.n ? `Against the best ${things(check.kind, check.n)}` : "No standard yet"}
        {check.sop ? ` and the ${check.sop} SOP` : ""}
        {check.stale ? ". The words changed since this check." : "."}
      </p>
      <ul className="grid list-none gap-1.5 p-0">
        {check.numbers.map((x) => (
          <Row key={x.label} tag={x.where ? WHERE[x.where] : "None"} tone="neutral">
            {x.label}: ours {x.ours === null ? "none" : num(x.ours)}, median {num(x.median)}, middle
            half {num(x.p25)} to {num(x.p75)}
          </Row>
        ))}
        {check.shares.map((s) => (
          <Row key={s.label} tag={s.ours ?? "None"} tone="neutral">
            {s.label}: {s.of.map(([v, c]) => `${v} ${c}`).join(", ")} (of {s.n})
          </Row>
        ))}
        {check.patterns.map((p) => (
          <Row
            key={p.label}
            tag={p.verdict === "breaks" ? "Breaks" : p.verdict === "meets" ? "Meets" : "Off"}
            tone={p.verdict === "breaks" ? "warn" : p.verdict === "meets" ? "green" : "neutral"}
          >
            {p.label}: ours {p.ours ?? "none"}
            {p.kept.length ? `. You kept ${p.kept.join(", ")}` : ""}
            {p.dropped.length ? `. You dropped ${p.dropped.join(", ")}` : ""}
          </Row>
        ))}
        {rules.map((r) => (
          <Row
            key={`${r.cite}:${r.say}`}
            tag={r.verdict === "breaks" ? "Breaks" : "Meets"}
            tone={r.verdict === "breaks" ? "warn" : "green"}
          >
            {r.say}
          </Row>
        ))}
      </ul>
      {check.changes?.length ? (
        <div className="grid gap-1">
          <span className="text-[13px] font-semibold">Changes to make</span>
          <ol className="m-0 grid gap-1 pl-5">
            {check.changes.map((c) => (
              <li key={c} className="break-words">
                {c}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
