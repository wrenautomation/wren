/**
 * Marketing → Plan: William's posting plan (`marketing.cadence`), grouped by the piece he makes.
 * One vertical clip feeds Shorts, Reels and TikTok, so a piece's work is what its most asking goal
 * still lacks, not the sum. Each goal's last 7 days against its week, today against its day,
 * what's queued, and the way to make the next one. A platform chip narrows it to that platform.
 * Every goal edits in place (`recordsEdit`, History and Undo on the record).
 */

import { PLATFORM_SPECS } from "@wren/content/write";
import type { Edited } from "@wren/core/edits";
import {
  Button,
  ButtonLink,
  cx,
  Empty,
  Input,
  LoadFailed,
  Loading,
  PageHeader,
  PlatformMark,
  Section,
  say,
  Tag,
} from "@wren/ui";
import { useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { wrenRecords } from "../../records.js";
import { QUIET } from "../work/bits.js";

interface Goal {
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
const OTHER: Record<string, string> = { threads: "Threads", newsletter: "Newsletter and Substack" };
const placeName = (p: string) =>
  OTHER[p] ?? PLATFORM_SPECS[p as keyof typeof PLATFORM_SPECS]?.name ?? p;

/** Where the next one gets made. */
const makeAt = (g: Goal): { href: string; label: string } =>
  g.starts === "video"
    ? { href: `/marketing/videos?platform=${g.platform}`, label: "Videos" }
    : g.starts === "thread"
      ? { href: `/marketing/engage?platform=${g.platform}`, label: "Answer" }
      : { href: `/marketing/write?platform=${g.platform}`, label: "Write" };

const counted = (gs: readonly Goal[]) => gs.filter((g) => g.done !== null);
/** One piece covers each of its goals: what it still lacks is its most lacking goal. */
const toMake = (gs: readonly Goal[]) => Math.max(0, ...counted(gs).map((g) => g.write ?? 0));

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

export function PlanPage(props: PageProps) {
  const pick = props.params.get("platform");
  const load = useCall("marketing-plan", () =>
    wrenRecords("marketing").list({ record: RECORD, view: "week", limit: 100 }),
  );
  const all = (load.data?.rows ?? []) as unknown as Goal[];
  const pieces = byPiece(all);
  const shown = pieces
    .map((p) => ({ ...p, goals: p.goals.filter((g) => !pick || g.platform === pick) }))
    .filter((p) => p.goals.length);
  const posted = counted(all).filter((g) => !pick || g.platform === pick);
  const sum = (k: "done" | "goal" | "queued") => posted.reduce((a, g) => a + (g[k] ?? 0), 0);
  const left = shown
    .map((p) => ({ name: p.name, n: toMake(p.goals) }))
    .filter((p) => p.n > 0)
    .map((p) => `${p.n} ${p.name.toLowerCase()}`);

  return (
    <>
      <PageHeader
        title="Plan"
        lede={
          load.data && posted.length
            ? `Last 7 days: ${sum("done")} of ${sum("goal")} posted, ${sum("queued")} queued. To make: ${left.length ? left.join(", ") : "nothing"}.`
            : "Your week by what you make: one piece feeds every platform it fits."
        }
      />
      {load.error && !load.data ? (
        <LoadFailed error={load.error} onRetry={load.retry} />
      ) : !load.data ? (
        <Loading lines={6} />
      ) : !shown.length ? (
        <Empty>No goal on {placeName(pick ?? "")} yet.</Empty>
      ) : (
        shown.map((p) => {
          // The whole piece, even under a chip: a clip made for TikTok still feeds Reels.
          const whole = pieces.find((x) => x.piece === p.piece)?.goals ?? p.goals;
          const n = toMake(whole);
          const feeds = [...new Set(whole.map((g) => placeName(g.platform)))];
          return (
            <Section
              key={p.piece}
              title={p.name}
              note={
                whole.length > 1
                  ? `One feeds ${whole.length}: ${feeds.join(", ")}${n ? `. ${n} to make` : ""}`
                  : n
                    ? `${n} to make`
                    : undefined
              }
            >
              <ul className="m-0 grid list-none gap-0 p-0">
                {p.goals.map((g) => (
                  <GoalRow key={g.id} g={g} reload={load.retry} />
                ))}
              </ul>
            </Section>
          );
        })
      )}
    </>
  );
}

function GoalRow({ g, reload }: { g: Goal; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const make = makeAt(g);
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
            <span className="font-semibold text-[13px] text-(--ui-accent) tabular-nums">
              {g.write} short
            </span>
          ) : g.done !== null ? (
            <span className={cx("text-[13px]", QUIET)}>On track</span>
          ) : null}
          <Button size="dense" tone="quiet" onClick={() => setEditing((e) => !e)}>
            {editing ? "Close" : "Edit"}
          </Button>
          {g.done !== null ? (
            <ButtonLink size="dense" tone={g.write ? "primary" : "secondary"} href={make.href}>
              {make.label}
            </ButtonLink>
          ) : null}
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
        className="absolute inset-y-0 left-0 bg-(--ui-accent) opacity-35"
        style={{ width: pct(done + queued) }}
      />
      <div className="absolute inset-y-0 left-0 bg-(--ui-accent)" style={{ width: pct(done) }} />
    </div>
  );
}
