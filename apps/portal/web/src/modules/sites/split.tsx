/**
 * A page's A/B split in its detail (designs/2026-10-07-sites.md, "A/B splits"): the call in
 * plain words, each version's numbers, the weights, stop, and "Make B the page", which waits on
 * a yes like any version. With no split running, start one against the owner's live pages.
 */

import type { Row } from "@wren/core/records/serve";
import type { PageDetail } from "@wren/sites/detail";
import type { SplitResult } from "@wren/sites/split";
import { Button, Input, num, type RecordAct, Tag, type TagTone } from "@wren/ui";
import { useState } from "react";
import { QUIET } from "../work/bits.js";
import { Said, Table, useRun } from "./detail.js";

const LABEL = "text-[13px] font-medium text-(--ui-ink-2)";
const HINT = "text-[12px] text-(--ui-ink-3)";
const SELECT =
  "min-h-[38px] border border-(--ui-hair) bg-(--ui-paper) px-3 py-2 text-[14.5px] text-(--ui-ink) focus:border-(--ui-accent) focus:outline-none";

const GOALS = { forms: "Forms sent", books: "Booking clicks", won: "Won deals" } as const;
type Goal = keyof typeof GOALS;
const TONE: Record<string, TagTone> = {
  settled: "green",
  leading: "accent",
  too_early: "neutral",
  no_goals: "neutral",
};
const day = (at: unknown) => new Date(String(at)).toLocaleDateString("en-CA");
const pct = (n: number) => `${Math.min(99, Math.floor(n * 100))}%`;
const goalOf = (s: SplitResult, a: SplitResult["arms"][number]) =>
  s.split.goal === "books" ? a.books : s.split.goal === "won" ? a.won : a.forms;

/** The running split: the call, each version's numbers, weights, stop and ship. */
function Running({ id, s, act }: { id: string; s: SplitResult; act: RecordAct }) {
  const { said, busy, run } = useRun(act);
  const [weights, setWeights] = useState(() => s.split.arms.map((a) => String(a.weight)));
  const shipping = s.split.state === "shipping";
  const goal = s.split.goal as Goal;
  const total = s.split.arms.reduce((n, a) => n + a.weight, 0);
  const valid = weights.every((w) => /^\d{1,3}$/.test(w) && +w >= 1 && +w <= 100);
  const changed = weights.some((w, i) => +w !== s.split.arms[i]?.weight);
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="flex flex-wrap items-center gap-2 text-[18px] font-medium">
          {s.call.words}
          <Tag tone={TONE[s.call.kind] ?? "neutral"}>
            {s.call.kind === "settled"
              ? "Settled"
              : s.call.kind === "leading"
                ? "Ahead"
                : "Waiting"}
          </Tag>
        </p>
        <p className={`text-[13px] ${QUIET}`}>
          Judged on {GOALS[goal].toLowerCase()}. Started {day(s.split.startedAt)} by{" "}
          {s.split.startedBy}. Bots see A and aren't counted.
        </p>
      </div>
      <Table
        stack
        head={[
          "Version",
          ["Share", "r"],
          ["Visits", "r"],
          ["Forms", "r"],
          ["Bookings", "r"],
          ...(goal === "won" ? [["Won", "r"] as [string, "r"]] : []),
          ["Rate", "r"],
          ["Chance best", "r"],
        ]}
        rows={s.arms.map((a, i) => {
          const g = goalOf(s, a);
          return [
            <span key="v" className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{a.label}</span>
              <a className="underline" href={`/sites/pages/${a.page}`}>
                {a.title}
              </a>
              {a.label === s.call.leader ? <Tag tone="accent">Leads</Tag> : null}
            </span>,
            `${Math.round((a.weight / total) * 100)}%`,
            num(a.visits),
            num(a.forms),
            num(a.books),
            ...(goal === "won" ? [num(a.won)] : []),
            a.visits ? `${((g / a.visits) * 100).toFixed(1)}%` : "",
            s.call.kind === "too_early" ? "" : pct(s.call.sure[i] ?? 0),
          ];
        })}
      />
      {shipping ? (
        <p className="text-[14px]">
          {s.split.winner} waits for a yes to become the page. The split runs until then.
        </p>
      ) : null}
      <div className="grid gap-2">
        <span className={LABEL}>Weights</span>
        <div className="flex flex-wrap items-end gap-3">
          {s.split.arms.map((a, i) => (
            <label key={a.label} className="grid gap-1 text-[13px]">
              {a.label}
              <Input
                className="w-[72px]"
                inputMode="numeric"
                value={weights[i] ?? ""}
                onChange={(e) =>
                  setWeights((w) => w.map((x, j) => (j === i ? e.target.value.trim() : x)))
                }
              />
            </label>
          ))}
          <Button
            disabled={!valid || !changed}
            busy={busy === "weights"}
            onClick={() =>
              void run(
                "weights",
                "sites.splitWeights",
                { id, weights: weights.map(Number) },
                "Weights saved. New visitors get them; others keep their version.",
              )
            }
          >
            Save weights
          </Button>
        </div>
        <span className={HINT}>1 to 100 each. Even is 1 and 1.</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-(--ui-hair) pt-4">
        {s.split.arms
          .filter((a) => a.label !== "A")
          .map((a) => (
            <Button
              key={a.label}
              tone={a.label === s.call.leader ? "primary" : undefined}
              disabled={shipping}
              busy={busy === `ship-${a.label}`}
              onClick={() =>
                void run(
                  `ship-${a.label}`,
                  "sites.splitShip",
                  { id, label: a.label },
                  `Asked. ${a.label}'s copy waits for a yes; then it's the page.`,
                )
              }
            >
              Make {a.label} the page
            </Button>
          ))}
        <Button
          tone="quiet"
          busy={busy === "stop"}
          onClick={() => void run("stop", "sites.splitStop", { id }, "Stopped. Everyone sees A.")}
        >
          Stop split
        </Button>
        <Said said={said} />
      </div>
    </div>
  );
}

/** No split running: pick the pages to test against and what wins. */
function Start({ id, d, row, act }: { id: string; d: PageDetail; row: Row; act: RecordAct }) {
  const { said, busy, run } = useRun(act);
  const [arms, setArms] = useState<string[]>([]);
  const [goal, setGoal] = useState<Goal>("forms");
  const wren = String(row.owner ?? "wren") === "wren";
  if (row.source !== "data" || row.status !== "live")
    return <p className={`text-[13.5px] ${QUIET}`}>A live data page can be split.</p>;
  if (!d.splitWith.length)
    return (
      <p className={`text-[13.5px] ${QUIET}`}>
        Nothing to split it with. Duplicate it as a variant, change the copy, and publish it.
      </p>
    );
  const pick = (page: string, on: boolean) =>
    setArms((a) => (on ? [...a, page].slice(0, 4) : a.filter((x) => x !== page)));
  return (
    <div className="grid gap-3">
      <p className="text-[13.5px]">
        This page is A. Visitors to its address are shared evenly between it and the pages you pick,
        and each keeps the one they saw.
      </p>
      <fieldset className="grid gap-1.5">
        <legend className={LABEL}>Split it with</legend>
        {d.splitWith.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-[14px]">
            <input
              type="checkbox"
              checked={arms.includes(p.id)}
              disabled={!arms.includes(p.id) && arms.length >= 4}
              onChange={(e) => pick(p.id, e.target.checked)}
            />
            {p.title}
            <span className={HINT}>/o/{p.slug}</span>
            {p.variant ? <Tag tone="neutral">Variant</Tag> : null}
          </label>
        ))}
      </fieldset>
      <label className="grid max-w-[260px] gap-1">
        <span className={LABEL}>What wins</span>
        <select className={SELECT} value={goal} onChange={(e) => setGoal(e.target.value as Goal)}>
          {(Object.keys(GOALS) as Goal[])
            .filter((g) => wren || g !== "won")
            .map((g) => (
              <option key={g} value={g}>
                {GOALS[g]}
              </option>
            ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          tone="primary"
          disabled={!arms.length}
          busy={busy === "start"}
          onClick={() =>
            void run(
              "start",
              "sites.splitStart",
              { id, arms, goal },
              "Split started. New visitors get a version.",
            )
          }
        >
          Start split
        </Button>
        <Said said={said} />
      </div>
    </div>
  );
}

/**
 * A split that ended: its B to E pages, each with Retire. Retire asks: the page waits in To
 * approve (or the client's yes), then answers gone at its address and keeps its numbers.
 */
function Ended({ s, act }: { s: SplitResult; act: RecordAct }) {
  const { said, busy, run } = useRun(act);
  const others = s.split.arms.filter((a) => a.label !== "A");
  return (
    <div className="grid gap-3">
      <p className="text-[13.5px]">
        Last split: {s.call.words}.{" "}
        {s.split.state === "shipped"
          ? `${s.split.winner} became the page on ${day(s.split.endedAt)}.`
          : `Stopped on ${day(s.split.endedAt)}.`}
      </p>
      {others.length ? (
        <ul className="grid gap-2">
          {others.map((a) => (
            <li
              key={a.label}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-(--ui-hair) pb-2 text-[14px]"
            >
              <span className="font-medium">{a.label}</span>
              <span className="grid min-w-0">
                <a className="truncate underline" href={`/sites/pages/${a.page}`}>
                  {a.title}
                </a>
                <span className={`truncate ${HINT}`}>/o/{a.slug}</span>
              </span>
              <span>
                {a.status === "retired" ? (
                  <Tag tone="neutral">Retired</Tag>
                ) : a.retiring ? (
                  <Tag tone="accent">Waiting to retire</Tag>
                ) : (
                  <Button
                    size="sm"
                    tone="secondary"
                    busy={busy === a.page}
                    onClick={() =>
                      void run(
                        a.page,
                        "sites.retireAsk",
                        { id: a.page },
                        `Asked. ${a.label} comes down on a yes in To approve.`,
                      )
                    }
                  >
                    Retire {a.label}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <span className={HINT}>
        A retired page answers gone at its address. Its numbers stay here.
      </span>
      <Said said={said} />
    </div>
  );
}

export function Split({
  id,
  d,
  row,
  act,
}: {
  id: string;
  d: PageDetail;
  row: Row;
  act: RecordAct;
}) {
  const s = d.split;
  if (s && (s.split.state === "running" || s.split.state === "shipping"))
    return <Running key={`${s.split.id}:${s.split.updatedAt}`} id={id} s={s} act={act} />;
  return (
    <div className="grid gap-5">
      {s ? <Ended key={`${s.split.id}:${s.split.updatedAt}`} s={s} act={act} /> : null}
      <Start id={id} d={d} row={row} act={act} />
    </div>
  );
}
