/**
 * Reactivation → Keep (designs/2026-10-07-health.md, "Keep"): accounts placed with in the last
 * two years, ranked by the risk they go quiet. Signals not fed yet say "In development".
 */
import type { Row } from "@wren/core/records/serve";
import { StateMark } from "@wren/ui";
import type { ReactNode } from "react";
import { LIST, QUIET, SPLIT } from "../work/bits.js";
import { REACTIVATION } from "./nav.js";

const SIGNALS: { label: string; reads: string | null }[] = [
  { label: "Champion left", reads: "Where the person behind the last placement works now." },
  {
    label: "Past the usual reorder",
    reads: "Days since the last placement against the usual gap.",
  },
  { label: "Hiring again", reads: "The company's own news about hiring or growth." },
  { label: "Visits to your site", reads: null },
  { label: "Open job orders in your ATS", reads: null },
];

/** Under the title: what Keep reads now, and what it doesn't yet. */
export function KeepHead() {
  return (
    <p className="text-[13px] text-(--ui-ink-2)">
      Ranked by the risk an account goes quiet. Site visits and job orders: in development.
    </p>
  );
}

function Signals() {
  return (
    <ul className={LIST} aria-label="Signals">
      {SIGNALS.map((s) => (
        <li key={s.label} className="grid gap-1">
          <span className={SPLIT}>
            <span className="font-medium">{s.label}</span>
            {s.reads ? (
              <StateMark state={{ label: "Live", tone: "good" }} />
            ) : (
              <StateMark state={{ label: "In development", tone: "neutral" }} />
            )}
          </span>
          {s.reads ? <span className={QUIET}>{s.reads}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** An account's detail: its people, and the signals Keep reads. */
export const keepExtras = (_: unknown, { row }: { row: Row }) => {
  const facts: [string, ReactNode][] = row.company
    ? [
        [
          "People",
          <a
            key="people"
            href={`/${REACTIVATION}/people?view=all&q=${encodeURIComponent(String(row.company))}`}
          >
            Everyone there
          </a>,
        ],
      ]
    : [];
  const sections: [string, ReactNode][] = [["Signals", <Signals key="signals" />]];
  return { facts, sections };
};
