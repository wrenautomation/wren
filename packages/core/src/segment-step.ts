/**
 * The spine's In segment step (designs/2026-10-15-channel-stats.md): is the person this event is
 * about in a People segment now? Yes or no; skip when no person is found. A client's workflow
 * checks the client's own database (`open`).
 */
import * as restate from "@restatedev/restate-sdk";
import type { Queryable } from "@wren/db";
import { personOf } from "./message-step.js";
import { profileOf } from "./profiles.js";
import { inSegment, segmentById } from "./segments.js";
import type { SpineEvent, Step, StepAt } from "./spine.js";

/** The profile an event is about: `data.profile`, a `profile:<id>` subject, else its email or phone. */
export async function profileOfEvent(db: Queryable, e: SpineEvent): Promise<number | null> {
  const named = Number(e.data?.profile ?? (/^profile:(\d+)$/.exec(e.subject)?.[1] || NaN));
  if (Number.isSafeInteger(named) && named > 0) return named;
  const p = personOf(e);
  if (p.email) {
    const id = await profileOf(db, { kind: "email", value: p.email });
    if (id) return id;
  }
  return p.phone ? profileOf(db, { kind: "phone", value: p.phone }) : null;
}

/** "Would check segment 4 for sam@example.com": what a dry test says. */
export function segmentWould(w: StepAt["with"], e: SpineEvent): string {
  const p = personOf(e);
  const who = p.email || p.phone || (e.data?.profile ? `profile ${e.data.profile}` : e.subject);
  return `Would check if ${who} is in segment ${String(w.segment ?? "?")}`;
}

export function segmentStep(main: Queryable, open: (client: string) => Queryable): Step {
  return async (_port, e, at) => {
    const db = at.client ? open(at.client) : main;
    const id = Number(at.with.segment);
    const seg = Number.isSafeInteger(id) ? await segmentById(db, id) : null;
    if (!seg) throw new restate.TerminalError(`In segment: no segment ${String(at.with.segment)}`);
    const profile = await profileOfEvent(db, e);
    if (!profile) return [{ port: "skip", event: e }];
    const yes = await inSegment(db, profile, seg, new Date());
    return [{ port: yes ? "yes" : "no", event: e }];
  };
}
