/**
 * A person's journey on their own page (WA-1114): the steps they reached as a rail, then owner,
 * dates and fit. No page of its own: the Map shows where everyone is, a person shows their own way.
 */
import type { ProfileJourney } from "@wren/core/profile-records";
import { Facts, RAIL_STATES, Rail, type RailState, type RailStep } from "@wren/ui";
import type { ReactNode } from "react";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** What a screen reader hears: a rail here is where a person is, not what runs. */
const STATES: Record<RailState, string> = {
  ...RAIL_STATES,
  done: "reached",
  next: "here now",
  waiting: "here past its limit",
  idle: "dropped here",
};

function stepsOf(j: ProfileJourney): RailStep[] {
  const last = j.trail.length - 1;
  return j.trail.map((s, i) => {
    const id = `${i}`;
    if (i < last || j.status === "done")
      return { id, label: s.name, note: day(s.at), state: "done" };
    if (j.status === "dropped")
      return { id, label: s.name, note: `Dropped ${day(j.closedAt ?? s.at)}`, state: "idle" };
    const here = j.days < 1 ? "Since today" : `${j.days} ${j.days === 1 ? "day" : "days"} here`;
    return j.stale
      ? {
          id,
          label: s.name,
          // amber: waits on you (DESIGN.md, meaning colors)
          note: <span className="text-(--ui-warn-ink)">{`${here}, past its limit`}</span>,
          state: "waiting",
        }
      : { id, label: s.name, note: here, state: "next" };
  });
}

export function Journey({ j }: { j: ProfileJourney }) {
  // Labels no longer than the fields' own, so the two lists' values start near one line.
  const facts: [string, ReactNode][] = [["Source", j.source]];
  if (j.owner) facts.push(["Owner", j.owner]);
  facts.push(["Started", day(j.openedAt)]);
  if (j.status === "done" && j.closedAt) facts.push(["Done", day(j.closedAt)]);
  if (j.reason) facts.push(["Reason", j.reason]);
  if (j.ghost) facts.push(["Map", "The map no longer has this step."]);
  if (j.fit) {
    facts.push(["Fit", `${j.fit.score} of 100`]);
    if (j.fit.reasons.length) facts.push(["Why", j.fit.reasons.join("; ")]);
    if (j.fit.unknown.length) facts.push(["Unknown", j.fit.unknown.join("; ")]);
  }
  if (j.earlier > 0)
    facts.push(["Earlier", `${j.earlier} ${j.earlier === 1 ? "journey" : "journeys"}`]);
  return (
    <div className="mb-3 grid gap-4">
      <Rail
        groups={[{ id: "path", label: "Journey", steps: stepsOf(j) }]}
        label="Steps reached"
        states={STATES}
        tail={j.status === "open"}
        className="mb-0"
      />
      <Facts items={facts} />
    </div>
  );
}
