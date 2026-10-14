/**
 * Marketing → Today (designs/2026-10-13-primitives-first.md): what to make, by what he makes, not
 * by platform. One vertical clip feeds Shorts, Reels and TikTok, so a piece's row says what its
 * most lacking goal still needs and shows every platform it feeds. Then the pieces waiting on his
 * yes, then what went out. Each goal still edits in place under Goals (`recordsEdit`).
 */

import { PLATFORM_SPECS } from "@wren/content/write";
import type { Edited } from "@wren/core/edits";
import {
  Button,
  ButtonLink,
  cx,
  Icon,
  Input,
  LoadFailed,
  Loading,
  PageHeader,
  PlatformMark,
  Section,
  say,
  Tag,
  tipProps,
} from "@wren/ui";
import { useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { wrenRecords } from "../../records.js";
import { QUIET } from "../work/bits.js";
import { allWaiting, happenings, PieceCard, usePieces, WhatHappened } from "./pieces.js";

export interface Goal {
  id: string;
  platform: string;
  label: string;
  name: string;
  goal: number;
  upTo: number | null;
  pace: string;
  how: string;
  piece: string;
  pieceName: string;
  starts: "words" | "video" | "thread";
  daily: number | null;
  done: number | null;
  today: number | null;
  queued: number | null;
  write: number | null;
}

const RECORD = "marketing.cadence";
const OTHER: Record<string, string> = { newsletter: "Blog" };
const placeName = (p: string) =>
  OTHER[p] ?? PLATFORM_SPECS[p as keyof typeof PLATFORM_SPECS]?.name ?? p;

/** Where the next one of a piece gets made: one place per piece, whatever platform. */
const makeAt = (piece: string, gs: readonly Goal[]): { href: string; label: string } => {
  const g = gs[0];
  if (piece === "story")
    return {
      href: `/marketing/write?platform=${g?.platform ?? "instagram"}&story=1`,
      label: "Make a story",
    };
  if (piece === "newsletter") return { href: "/marketing/write?blog=1", label: "Write a post" };
  if (piece === "replies") return { href: "/marketing/engage", label: "Answer threads" };
  if (g?.starts === "video")
    return { href: "/marketing/videos", label: piece === "long" ? "Open Studio" : "Cut clips" };
  return { href: "/marketing/write", label: "Write" };
};

const counted = (gs: readonly Goal[]) => gs.filter((g) => g.done !== null);
/** One piece covers each of its goals: what it still lacks is its most lacking goal. */
const toMake = (gs: readonly Goal[]) => Math.max(0, ...counted(gs).map((g) => g.write ?? 0));
/** The goal that sets the piece's numbers: its most lacking, else its first counted. */
const leadOf = (gs: readonly Goal[]) =>
  [...counted(gs)].sort(
    (a, b) => (b.write ?? 0) - (a.write ?? 0) || (b.daily ?? 0) - (a.daily ?? 0),
  )[0];

/** Goals by piece, in plan order. */
function byPiece(goals: readonly Goal[]): { piece: string; name: string; goals: Goal[] }[] {
  const out = new Map<string, { piece: string; name: string; goals: Goal[] }>();
  for (const g of goals) {
    const at = out.get(g.piece) ?? { piece: g.piece, name: g.pieceName, goals: [] };
    at.goals.push(g);
    out.set(g.piece, at);
  }
  return [...out.values()];
}

export const usePlan = () =>
  useCall("marketing-plan", () =>
    wrenRecords("marketing").list({ record: RECORD, view: "week", limit: 100 }),
  );
export const goalsOf = (rows: unknown[] | undefined) => (rows ?? []) as unknown as Goal[];

/** Make: one row per piece with the platforms it feeds; its goals open under it. */
export function MakeList({ goals, reload }: { goals: Goal[]; reload: () => void }) {
  const pieces = byPiece(goals);
  return (
    <ul className="m-0 grid list-none gap-0 p-0">
      {pieces.map((p) => (
        <PieceGoals key={p.piece} piece={p.piece} name={p.name} goals={p.goals} reload={reload} />
      ))}
    </ul>
  );
}

function PieceGoals({
  piece,
  name,
  goals,
  reload,
}: {
  piece: string;
  name: string;
  goals: Goal[];
  reload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const n = toMake(goals);
  const lead = leadOf(goals);
  const make = makeAt(piece, counted(goals).length ? counted(goals) : goals);
  const week = lead ? (lead.upTo ? `${lead.goal} to ${lead.upTo}` : String(lead.goal)) : "";
  return (
    <li className="border-(--ui-hair) border-t py-3.5 first:border-t-0 first:pt-0">
      <div className="grid items-center gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto]">
        <div className="min-w-0">
          <p className="m-0 font-semibold text-[15px]">{name}</p>
          <p className={cx("m-0 mt-1 flex flex-wrap items-center gap-2 text-[13px]", QUIET)}>
            {goals.length > 1 ? `Feeds ${goals.length}` : "Goes to"}
            {goals.map((g) => (
              <span
                key={g.id}
                className={cx("inline-flex", g.done === null && "opacity-35")}
                {...tipProps(
                  `${placeName(g.platform)}: ${g.done === null ? "can't post yet" : `${g.done} of ${g.goal} this week`}`,
                )}
              >
                <PlatformMark
                  mark={g.platform === "newsletter" ? "web" : g.platform}
                  size={15}
                  label={placeName(g.platform)}
                />
              </span>
            ))}
          </p>
        </div>
        {lead ? (
          <div className="grid gap-1.5">
            <Bar done={lead.done ?? 0} queued={lead.queued ?? 0} goal={lead.goal} />
            <p className={cx("m-0 text-[13px] tabular-nums", QUIET)}>
              {lead.daily ? (
                <>
                  Today <span className="font-semibold text-(--ui-ink)">{lead.today ?? 0}</span> of{" "}
                  {lead.daily} ·{" "}
                </>
              ) : null}
              This week <span className="font-semibold text-(--ui-ink)">{lead.done}</span> of {week}
              {lead.queued ? `, ${lead.queued} queued` : ""}
            </p>
          </div>
        ) : (
          <p className={cx("m-0 text-[13px]", QUIET)}>
            <Tag>Can't post yet</Tag>
          </p>
        )}
        <div className="flex items-center gap-3 sm:justify-end">
          {lead ? (
            n ? (
              <span className="font-semibold text-[13px] text-(--ui-warn-ink) tabular-nums">
                {n} to make
              </span>
            ) : (
              <span className={cx("text-[13px]", QUIET)}>On track</span>
            )
          ) : null}
          <Button size="dense" tone="quiet" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Goals <Icon name={open ? "down" : "right"} />
          </Button>
          {lead ? (
            <ButtonLink size="dense" tone="secondary" href={make.href}>
              {make.label}
            </ButtonLink>
          ) : null}
        </div>
      </div>
      {open ? (
        <ul className="mt-3 ml-0 list-none rounded-(--ui-radius) border border-(--ui-hair) px-3 pt-3 pb-0">
          {goals.map((g) => (
            <GoalRow key={g.id} g={g} reload={reload} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function PlanPage(_props: PageProps) {
  const load = usePlan();
  const work = usePieces();
  const goals = goalsOf(load.data?.rows);
  const pieces = work.data?.pieces ?? [];
  const waiting = pieces.filter((p) => allWaiting(p).length);
  const drafts = waiting.flatMap(allWaiting).length;
  const left = byPiece(goals)
    .map((p) => ({ name: p.name, n: toMake(p.goals) }))
    .filter((p) => p.n > 0);
  const lede = [
    load.data
      ? left.length
        ? `To make this week: ${left.map((p) => `${p.n} ${p.name.toLowerCase()}`).join(", ")}.`
        : "Every goal is on track."
      : null,
    work.data ? (drafts ? `${drafts} drafts wait on you.` : "Nothing waits on you.") : null,
  ]
    .filter(Boolean)
    .join(" ");
  const SHOWN = 4;
  return (
    <>
      <PageHeader title="Today" lede={lede || "What to make, what waits on you, what went out."} />
      <Section title="Make" note="By what you make. Each one goes to every platform it fits.">
        {load.error && !load.data ? (
          <LoadFailed error={load.error} onRetry={load.retry} />
        ) : !load.data ? (
          <Loading lines={5} />
        ) : (
          <MakeList goals={goals} reload={load.retry} />
        )}
      </Section>
      <Section
        title="Waiting on you"
        note={waiting.length ? `${waiting.length} pieces, ${drafts} drafts` : undefined}
        actions={
          waiting.length > SHOWN ? (
            <a className={cx("text-[13px] underline", QUIET)} href="/marketing/pieces?show=waiting">
              All {waiting.length}
            </a>
          ) : null
        }
      >
        {work.error && !work.data ? (
          <LoadFailed error={work.error} onRetry={work.retry} />
        ) : !work.data ? (
          <Loading lines={4} />
        ) : waiting.length ? (
          <div className="grid grid-cols-1 gap-3">
            {waiting.slice(0, SHOWN).map((p) => (
              <PieceCard key={p.id} piece={p} reload={work.retry} />
            ))}
          </div>
        ) : (
          <p className="m-0 flex items-center gap-2.5 text-[14.5px] text-(--ui-ink-2)">
            <Icon name="check" className="text-(--ui-good)" />
            No draft waits on you.
          </p>
        )}
      </Section>
      {work.data ? <WhatHappened items={happenings(pieces)} /> : null}
    </>
  );
}

function GoalRow({ g, reload }: { g: Goal; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const week = g.upTo ? `${g.goal} to ${g.upTo}` : String(g.goal);
  return (
    <li className="border-(--ui-hair) border-t py-3.5 first:border-t-0 first:pt-0">
      <div className="grid items-center gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 shrink-0">
            <PlatformMark mark={g.platform} size={16} />
          </span>
          <div className="min-w-0">
            <p className="m-0 font-semibold text-[14.5px]">{g.name}</p>
            <p className={cx("m-0 text-[13px]", QUIET)}>
              {g.pace} · {g.how}
            </p>
          </div>
        </div>
        {g.done === null ? (
          <p className={cx("m-0 text-[13px]", QUIET)}>
            <Tag>Can't post yet</Tag> Goal {week} a week
          </p>
        ) : (
          <div className="grid gap-1.5">
            <Bar done={g.done} queued={g.queued ?? 0} goal={g.goal} />
            <p className={cx("m-0 text-[13px] tabular-nums", QUIET)}>
              <span className="font-semibold text-(--ui-ink)">{g.done}</span> of {week}
              {g.queued ? `, ${g.queued} queued` : ""}
              {g.daily ? ` · today ${g.today ?? 0} of ${g.daily}` : ""}
            </p>
          </div>
        )}
        <div className="flex items-center gap-3 sm:justify-end">
          {g.write ? (
            <span className="font-semibold text-[13px] text-(--ui-warn-ink) tabular-nums">
              {g.write} to go
            </span>
          ) : g.done !== null ? (
            <span className={cx("text-[13px]", QUIET)}>On track</span>
          ) : null}
          <Button size="dense" tone="quiet" onClick={() => setEditing((e) => !e)}>
            {editing ? "Close" : "Edit"}
          </Button>
        </div>
      </div>
      {editing ? (
        <GoalEdit
          g={g}
          done={() => {
            setEditing(false);
            reload();
          }}
        />
      ) : null}
    </li>
  );
}

const PIECES = ["long", "vertical", "written", "story", "replies", "newsletter"];

/** A goal's numbers and words, saved through the record's edits path. */
function GoalEdit({ g, done }: { g: Goal; done: () => void }) {
  const [v, setV] = useState({
    goal: String(g.goal),
    upTo: g.upTo == null ? "" : String(g.upTo),
    daily: g.daily == null ? "" : String(g.daily),
    pace: g.pace,
    how: g.how,
    piece: g.piece,
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((x) => ({ ...x, [k]: e.target.value }));
  const int = (s: string) => (s.trim() === "" ? null : Number.parseInt(s, 10));
  const save = async () => {
    setBusy(true);
    try {
      await call<Edited>("console/recordsEdit", {
        record: RECORD,
        id: g.id,
        patch: {
          goal: int(v.goal) ?? 0,
          upTo: int(v.upTo),
          daily: int(v.daily),
          pace: v.pace.trim(),
          how: v.how.trim(),
          piece: v.piece,
        },
      });
      say.done("Saved. Plan counts against it now.");
      done();
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(false);
    }
  };
  const box = "grid gap-1 text-[12.5px]";
  return (
    <form
      className="mt-3 grid gap-3 rounded-(--ui-radius) bg-(--ui-fill) p-3 sm:grid-cols-[repeat(3,minmax(0,6rem))_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,9rem)_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className={box}>
        A week
        <Input inputMode="numeric" value={v.goal} onChange={set("goal")} />
      </label>
      <label className={box}>
        Up to
        <Input inputMode="numeric" value={v.upTo} onChange={set("upTo")} placeholder="none" />
      </label>
      <label className={box}>
        A day
        <Input inputMode="numeric" value={v.daily} onChange={set("daily")} placeholder="none" />
      </label>
      <label className={box}>
        How often
        <Input value={v.pace} onChange={set("pace")} />
      </label>
      <label className={box}>
        How
        <Input value={v.how} onChange={set("how")} />
      </label>
      <label className={box}>
        Piece
        <select
          className="h-9 rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-bg) px-2 text-[13px]"
          value={v.piece}
          onChange={set("piece")}
        >
          {[...new Set([...PIECES, g.piece])].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <Button size="dense" tone="primary" type="submit" disabled={busy}>
        Save
      </Button>
    </form>
  );
}

/** Posted, then queued, against the week's goal. */
function Bar({ done, queued, goal }: { done: number; queued: number; goal: number }) {
  const pct = (n: number) => `${Math.min(100, (n / Math.max(goal, 1)) * 100)}%`;
  return (
    <div
      className="relative h-1.5 overflow-hidden rounded-full bg-(--ui-fill)"
      role="img"
      aria-label={`${done} posted and ${queued} queued of ${goal}`}
    >
      <div
        className="absolute inset-y-0 left-0 bg-(--ui-ink) opacity-25"
        style={{ width: pct(done + queued) }}
      />
      <div className="absolute inset-y-0 left-0 bg-(--ui-ink)" style={{ width: pct(done) }} />
    </div>
  );
}
