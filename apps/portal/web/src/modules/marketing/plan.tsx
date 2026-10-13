/**
 * Marketing → Plan: William's posting plan by platform (`marketing.cadence`). Each format's last 7
 * days against its week, today against its day, what's queued, and the way to make the next one.
 * The platform chips on top narrow it to one platform.
 */

import { PLATFORM_SPECS } from "@wren/content/write";
import {
  ButtonLink,
  cx,
  Empty,
  LoadFailed,
  Loading,
  PageHeader,
  PlatformMark,
  Section,
  Tag,
} from "@wren/ui";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { wrenRecords } from "../../records.js";
import { QUIET } from "../work/bits.js";

interface Goal {
  id: string;
  platform: string;
  label: string;
  goal: number;
  upTo: number | null;
  pace: string;
  how: string;
  starts: "words" | "video" | "thread";
  daily: number | null;
  done: number | null;
  today: number | null;
  queued: number | null;
  write: number | null;
}

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

export function PlanPage(props: PageProps) {
  const pick = props.params.get("platform");
  const load = useCall("marketing-plan", () =>
    wrenRecords("marketing").list({ record: "marketing.cadence", view: "week", limit: 100 }),
  );
  const all = (load.data?.rows ?? []) as unknown as Goal[];
  const goals = all.filter((g) => !pick || g.platform === pick);
  const places = [...new Set(goals.map((g) => g.platform))];
  const counted = goals.filter((g) => g.done !== null);
  const sum = (k: "done" | "goal" | "queued" | "write") =>
    counted.reduce((a, g) => a + (g[k] ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Plan"
        lede={
          load.data && counted.length
            ? `Last 7 days: ${sum("done")} of ${sum("goal")} posted, ${sum("queued")} queued, ${sum("write")} still to make.`
            : "Your week on each platform: what went out, what's queued, what's left."
        }
      />
      {load.error && !load.data ? (
        <LoadFailed error={load.error} onRetry={load.retry} />
      ) : !load.data ? (
        <Loading lines={6} />
      ) : !goals.length ? (
        <Empty>No goal on {placeName(pick ?? "")} yet.</Empty>
      ) : (
        places.map((p) => {
          const mine = goals.filter((g) => g.platform === p);
          const done = mine.filter((g) => g.done !== null);
          return (
            <Section
              key={p}
              title={placeName(p)}
              cue={<PlatformMark mark={p} size={16} />}
              note={
                done.length
                  ? `${done.reduce((a, g) => a + (g.done ?? 0), 0)} of ${done.reduce((a, g) => a + g.goal, 0)} this week`
                  : undefined
              }
            >
              <ul className="m-0 grid list-none gap-0 p-0">
                {mine.map((g) => (
                  <GoalRow key={g.id} g={g} />
                ))}
              </ul>
            </Section>
          );
        })
      )}
    </>
  );
}

function GoalRow({ g }: { g: Goal }) {
  const make = makeAt(g);
  const week = g.upTo ? `${g.goal} to ${g.upTo}` : String(g.goal);
  return (
    <li className="grid items-center gap-x-6 gap-y-2 border-(--ui-hair) border-t py-3.5 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="m-0 font-semibold text-[14.5px]">{g.label}</p>
        <p className={cx("m-0 text-[13px]", QUIET)}>
          {g.pace} · {g.how}
        </p>
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
            {g.write} to make
          </span>
        ) : g.done !== null ? (
          <span className={cx("text-[13px]", QUIET)}>On track</span>
        ) : null}
        {g.done !== null ? (
          <ButtonLink size="dense" tone={g.write ? "primary" : "secondary"} href={make.href}>
            {make.label}
          </ButtonLink>
        ) : null}
      </div>
    </li>
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
