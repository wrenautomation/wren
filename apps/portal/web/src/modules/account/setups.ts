/**
 * How Accounts and Vendors say things: a setup run's state and steps, a vendor's mode. Pure, so
 * they test without a browser.
 */
import type { AccountsView, VendorsView } from "@wren/core/accounts/console";
import type { RailGroup, RailState, TagTone } from "@wren/ui";

export type AccountRow = AccountsView["accounts"][number];
export type RunRow = AccountRow["runs"][number];
export type StepRow = RunRow["steps"][number];
export type VendorRow = VendorsView["vendors"][number];

/** A run's state as a tag: whose turn it is, said to whoever is looking. */
export function runTag(state: RunRow["state"], team: boolean): { label: string; tone: TagTone } {
  switch (state) {
    case "done":
      return { label: "Set up", tone: "green" };
    case "waiting_client":
      return team
        ? { label: "Waiting on the client", tone: "neutral" }
        : { label: "Your turn", tone: "accent" };
    case "waiting_wren":
      return team
        ? { label: "Your turn", tone: "accent" }
        : { label: "Waiting on Wren's team", tone: "neutral" };
    case "checking":
      return { label: "Checking", tone: "neutral" };
    case "stuck":
      return { label: "Stuck", tone: "warn" };
    case "lost":
      return { label: "Lost", tone: "warn" };
  }
}

/** Who does a step, in a word or two. */
export function whoText(step: Pick<StepRow, "who">, mode: RunRow["mode"], team: boolean): string {
  if (step.who === "auto") return "A check";
  if (step.who === "wren" || mode === "for_you") return team ? "Wren's team" : "Wren";
  return team ? "The client" : "You";
}

/** Whose turn a step on the rail is. */
function railState(step: StepRow, mode: RunRow["mode"], team: boolean): RailState {
  if (step.state === "done") return "done";
  if (step.state === "later") return "idle";
  if (step.state === "checking") return "next";
  const ours = step.who === "wren" || (mode === "for_you" && step.who === "client");
  if (step.state === "waiting_client" || step.state === "waiting_wren")
    return ours === team ? "yours" : "waiting";
  return "waiting";
}

/** A run's steps as one rail group; `id` unique on the page (an account can share a setup). */
export function railOf(run: RunRow, team: boolean, id: string = run.setup): RailGroup[] {
  return [
    {
      id,
      label: "Steps",
      steps: run.steps.map((s) => ({
        id: s.id,
        label: s.label,
        state: railState(s, run.mode, team),
        note: s.state === "done" ? "Done" : whoText(s, run.mode, team),
      })),
    },
  ];
}

/** The step a run waits on, or null once it's done. */
export const currentOf = (run: RunRow): StepRow | null =>
  run.step ? (run.steps.find((s) => s.id === run.step) ?? null) : null;

/** A mailbox's state on Account → Mail, as a tag (designs/2026-10-07-mail-access.md). */
export function mailTag(
  state: "not_set_up" | "waiting_admin" | "send_only" | "read_send" | "broken",
): { label: string; tone: TagTone } {
  switch (state) {
    case "not_set_up":
      return { label: "Not set up", tone: "neutral" };
    case "waiting_admin":
      return { label: "Waiting on admin", tone: "accent" };
    case "send_only":
      return { label: "Connected (send only)", tone: "green" };
    case "read_send":
      return { label: "Connected (read and send)", tone: "green" };
    case "broken":
      return { label: "Broken", tone: "warn" };
  }
}

/** A social account's state on Account → Social, as a tag (designs/2026-10-07-client-social.md). */
export function socialTag(state: "not_connected" | "waiting_review" | "connected" | "broken"): {
  label: string;
  tone: TagTone;
} {
  switch (state) {
    case "not_connected":
      return { label: "Not connected", tone: "neutral" };
    case "waiting_review":
      return { label: "Waiting on review", tone: "accent" };
    case "connected":
      return { label: "Connected", tone: "green" };
    case "broken":
      return { label: "Broken", tone: "warn" };
  }
}

/** A vendor's mode, as a tag. */
export function modeTag(
  v: Pick<VendorRow, "mode" | "own">,
  wren: boolean,
): {
  label: string;
  tone: TagTone;
} {
  if (v.mode === "managed") return { label: wren ? "Wren's key" : "On Wren's key", tone: "green" };
  if (v.mode === "own")
    return { label: v.own === "login" ? "Own login" : "Own key", tone: "green" };
  return { label: "Not set up", tone: "neutral" };
}

/** Micro-dollars as dollars: "$0.02", "$12.40". */
export const dollars = (micros: number) =>
  (micros / 1_000_000).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** "1,204 searches". */
export const unitsText = (n: number, units: string) => `${n.toLocaleString("en-US")} ${units}`;

/** Today's room on a vendor: what's left, or why nothing runs. */
export function roomText(v: Pick<VendorRow, "room" | "why" | "units" | "quota">): string {
  if (v.why) return v.why;
  if (v.room === null) return "No daily limit";
  return `${unitsText(v.room, v.units)} left today`;
}
