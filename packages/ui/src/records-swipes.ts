/**
 * A phone row's swipes, as Mail's: right for the first action that moves a row on, left for the
 * ones that set it aside, and the page's Reply added when it has one.
 */

import type { Row } from "@wren/core/records/serve";
import { type Action, runs } from "./action.js";
import { type Swipes, toneOf } from "./phone.js";

/**
 * A row's swipes on a phone, as Mail's: right for the first action that moves it on (Approve),
 * left for the ones that set it aside (Skip, Archive), the far one run by a full swipe. Actions
 * that make a record, or run inside its detail, don't swipe.
 */
export function swipesOf(
  actions: readonly Action[],
  row: Row,
  run: (a: Action) => void,
): Swipes | null {
  const can = actions.filter((a) => !a.form && !a.inline && runs(a, row));
  if (!can.length) return null;
  const aside = (a: Action) => toneOf(a.label, false) === "bad";
  const lead = can.find((a) => !aside(a));
  const trail = [...can.filter(aside), ...can.filter((a) => !aside(a) && a !== lead)].slice(0, 2);
  const act = (a: Action, first: boolean) => ({
    id: a.id,
    label: a.label,
    tone: toneOf(a.label, first),
    run: () => run(a),
  });
  return {
    lead: lead ? act(lead, true) : undefined,
    trail: trail.map((a) => act(a, false)),
  };
}

/** A phone row's swipes with the page's Reply added on the left, when the page has one. */
export function withReply(swipes: Swipes | null, reply: (() => void) | null): Swipes | null {
  if (!reply) return swipes;
  const act = { id: "reply", label: "Reply", icon: "reply", tone: "ink" as const, run: reply };
  return { lead: swipes?.lead, trail: [...(swipes?.trail ?? []).slice(0, 1), act] };
}
