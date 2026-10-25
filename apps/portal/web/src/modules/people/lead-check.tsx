/**
 * People > a person: the lead check (designs/2026-10-17-people-depth.md). Jev reads what we know
 * about them and picks Lead, Unsure or Not a lead. The page shows the pick as a chip with the
 * chance and one line why, built by code from what Jev saw. William calls it himself with Lead
 * or Not a lead; a call against the pick says so. Wren's own People only.
 */
import type { State } from "@wren/core/records";
import type { Action } from "@wren/ui";
import { type RecordExtras, StateMark } from "@wren/ui";
import { createElement, type ReactNode, useSyncExternalStore } from "react";

/** The chip's data, as `leadFitView` (core) answers it. */
interface LeadFit {
  pick: {
    label: string;
    name: string;
    tone: State["tone"];
    percent: number | null;
    why: string;
    at: string;
  } | null;
  call: { label: string; name: string; at: string; overrode: boolean } | null;
  lastAt: string | null;
  failed: string | null;
}

/** How long "Checking" waits for an answer that does not come (the same state is bought once). */
const CHECKING_MS = 90_000;
/** How often the page reads again while a check is out. */
const CHECKING_POLL_MS = 4_000;

/** Profiles asked about in this tab, by the time of the ask. Gone on a reload: the answer still lands. */
const asked = new Map<string, number>();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** Remember that Jev was asked about these profiles just now. */
function markAsked(ids: readonly (string | number)[], now = Date.now()) {
  for (const id of ids) asked.set(String(id), now);
  for (const fn of listeners) fn();
}

/**
 * An ask is out: made in this tab, not older than `CHECKING_MS`, with no decision kept since.
 * The server's clock and this one differ a little, so an answer within 2 seconds before the
 * ask counts as before it.
 */
export function checking(
  id: string | number,
  lastAt: string | null | undefined,
  now = Date.now(),
): boolean {
  const t = asked.get(String(id));
  if (t === undefined || now - t > CHECKING_MS) return false;
  return !(lastAt && Date.parse(lastAt) >= t - 2_000);
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

function Chip({ id, fit }: { id: string; fit: LeadFit }) {
  const out = useSyncExternalStore(
    subscribe,
    () => checking(id, fit.lastAt),
    () => false,
  );
  const { pick, call } = fit;
  return (
    <div className="grid gap-2">
      {out ? <p className="text-(--ui-ink-2)">Checking with Jev...</p> : null}
      {pick ? (
        <div className="grid gap-1">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">
              <StateMark state={{ label: pick.name, tone: pick.tone }} />
            </span>
            {pick.percent !== null ? (
              <span className="text-(--ui-ink-2)">{pick.percent}% sure</span>
            ) : null}
            <span className="text-(--ui-ink-2)">Jev, {day(pick.at)}</span>
          </p>
          <p>{pick.why}</p>
        </div>
      ) : out ? null : fit.failed ? (
        <p className="text-(--ui-ink-2)">Jev could not answer: {fit.failed}</p>
      ) : (
        <p className="text-(--ui-ink-2)">Jev has not said yet.</p>
      )}
      {call ? (
        <p className="text-(--ui-ink-2)">
          You called them: {call.name}, {day(call.at)}.{call.overrode ? " You overrode Jev." : ""}
        </p>
      ) : null}
    </div>
  );
}

/** Whether the section shows: something was asked or called, or an ask is out. */
const worth = (fit: LeadFit | null | undefined, id: string | number): fit is LeadFit =>
  !!fit && (!!fit.pick || !!fit.call || !!fit.failed || checking(id, fit.lastAt));

/**
 * The profile page's Lead check section and, while a check is out, how often to read the page
 * again. Nothing for a client's People (it asks nothing) or a person never asked about.
 */
function leadCheckExtras(
  fit: LeadFit | null | undefined,
  id: string | number,
): { sections: [string, ReactNode][]; poll?: number } {
  if (!worth(fit, id)) return { sections: [] };
  return {
    sections: [["Lead check", createElement(Chip, { id: String(id), fit })]],
    ...(checking(id, fit.lastAt) ? { poll: CHECKING_POLL_MS } : {}),
  };
}

/**
 * `base` (the profile page's other extras) with the Lead check section first, and the page read
 * again while a check is out. `detail` is the record's detail (`leadFit` in it).
 */
export function withLeadCheck(
  base: RecordExtras,
  detail: unknown,
  id: string | number,
): RecordExtras {
  const fit = (detail as { leadFit?: LeadFit | null } | null)?.leadFit;
  const lead = leadCheckExtras(fit, id);
  if (!lead.sections.length) return base;
  return {
    ...base,
    sections: [...lead.sections, ...(base.sections ?? [])],
    ...(lead.poll ? { poll: lead.poll } : {}),
  };
}

/** "Check with Jev": ask now. The answer lands on the profile within a minute. */
const checkWithJev: Action = {
  id: "people.leadCheck",
  label: "Check with Jev",
  handler: "people/leadCheck",
  bulk: true,
  confirm: "Ask Jev if they are a lead? It costs a few cents.",
  done: (answer) => {
    markAsked((answer as { done?: (string | number)[] } | null)?.done ?? []);
    return "Asked Jev";
  },
};

/** William's own call: a lead. */
const callLead: Action = {
  id: "people.leadFit",
  label: "Lead",
  handler: "people/leadFit",
  bulk: true,
  confirm: "Call them a lead?",
  done: () => "Called a lead",
};

/** William's own call: not a lead. */
const callNotLead: Action = {
  id: "people.leadNot",
  label: "Not a lead",
  handler: "people/leadNot",
  bulk: true,
  confirm: "Call them not a lead?",
  done: () => "Called not a lead",
};

/** The three, on Wren's People only. */
export const LEAD_ACTIONS: Action[] = [checkWithJev, callLead, callNotLead];
