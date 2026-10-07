/**
 * Two texts compared line by line: side by side on a wide screen, one column (unified) on a
 * phone. The line diff is core's (`@wren/core/line-diff`), the one the CLI prints.
 */
import { type DiffLine, lineDiff } from "@wren/core/line-diff";
import { type ReactNode, useMemo } from "react";
import { cx } from "./format.js";

/** One row side by side: a line on the left, the right, or both. */
interface Pair {
  left: DiffLine | null;
  right: DiffLine | null;
}

/** Side by side: unchanged lines on both sides; within a changed run, removed beside added. */
export function pairsOf(lines: readonly DiffLine[]): Pair[] {
  const out: Pair[] = [];
  let gone: DiffLine[] = [];
  let added: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(gone.length, added.length); i++)
      out.push({ left: gone[i] ?? null, right: added[i] ?? null });
    gone = [];
    added = [];
  };
  for (const l of lines) {
    if (l.op === " ") {
      flush();
      out.push({ left: l, right: l });
    } else if (l.op === "-") {
      if (added.length) flush();
      gone.push(l);
    } else added.push(l);
  }
  flush();
  return out;
}

const NUM = "w-9 shrink-0 select-none pr-2 text-right text-(--ui-ink-3) tabular-nums";
const TEXT = "min-w-0 flex-1 whitespace-pre-wrap break-words";
const TONE = {
  " ": "",
  "-": "bg-(--ui-bad-tint)",
  "+": "bg-(--ui-good-tint)",
} as const;

function Side({ line, side }: { line: DiffLine | null; side: "a" | "b" }) {
  if (!line) return <div className="flex min-w-0 bg-(--ui-fill)" aria-hidden />;
  const tone = line.op === " " ? "" : TONE[line.op];
  return (
    <div className={cx("flex min-w-0 py-px", tone)}>
      <span className={NUM}>{line[side]}</span>
      <span className={TEXT}>{line.text || " "}</span>
    </div>
  );
}

/**
 * `a` (older, left) against `b` (newer, right). `layout` "auto" is side by side from 768px and
 * unified under it; "split" and "unified" pin one.
 */
export function Diff({
  a,
  b,
  names,
  layout = "auto",
  className,
}: {
  a: string;
  b: string;
  names: [ReactNode, ReactNode];
  layout?: "auto" | "split" | "unified";
  className?: string | undefined;
}) {
  const lines = useMemo(() => lineDiff(a, b), [a, b]);
  if (!lines.some((l) => l.op !== " "))
    return (
      <p className={cx("text-[14px] text-(--ui-ink-2)", className)}>The words are the same.</p>
    );
  const pairs = pairsOf(lines);
  const split = (
    <div
      className={cx(
        "border border-(--ui-hair) font-mono text-[12.5px]/[1.55]",
        layout === "auto" && "hidden md:block",
      )}
    >
      <div className="grid grid-cols-2 border-b border-(--ui-hair) bg-(--ui-fill) text-[12px] font-sans text-(--ui-ink-2)">
        <div className="px-2 py-1">{names[0]}</div>
        <div className="border-l border-(--ui-hair) px-2 py-1">{names[1]}</div>
      </div>
      {pairs.map((p, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a diff's rows are positional
          key={i}
          className="grid grid-cols-2"
        >
          <Side line={p.left} side="a" />
          <div className="min-w-0 border-l border-(--ui-hair)">
            <Side line={p.right} side="b" />
          </div>
        </div>
      ))}
    </div>
  );
  const unified = (
    <div
      className={cx(
        "border border-(--ui-hair) font-mono text-[12.5px]/[1.55]",
        layout === "auto" && "md:hidden",
      )}
    >
      <div className="grid gap-0.5 border-b border-(--ui-hair) bg-(--ui-fill) px-2 py-1 font-sans text-[12px] text-(--ui-ink-2)">
        <span>
          <span className="text-(--ui-bad)">−</span> {names[0]}
        </span>
        <span>
          <span className="text-(--ui-good-ink)">+</span> {names[1]}
        </span>
      </div>
      {lines.map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a diff's rows are positional
        <div key={i} className={cx("flex min-w-0 py-px", TONE[l.op])}>
          <span className="w-5 shrink-0 select-none text-center text-(--ui-ink-3)">
            {l.op === " " ? "" : l.op === "-" ? "−" : "+"}
          </span>
          <span className={NUM}>{l.op === "-" ? l.a : l.b}</span>
          <span className={TEXT}>{l.text || " "}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className={className}>
      {layout === "unified" ? null : split}
      {layout === "split" ? null : unified}
    </div>
  );
}
