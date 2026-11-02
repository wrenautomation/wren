import { IllegalTransition, sourcesOf, type TransitionTable, transition } from "@wren/core";
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_STATES,
  ENROLLMENT_STATES,
  MESSAGE_STATES,
  type MessageState,
} from "./schema.js";
import { CANDIDATE_TRANSITIONS, ENROLLMENT_TRANSITIONS, MESSAGE_TRANSITIONS } from "./state.js";

const msg = (a: MessageState, b: MessageState) => transition("message", MESSAGE_TRANSITIONS, a, b);

describe.each([
  ["message", MESSAGE_TRANSITIONS as TransitionTable<string>, MESSAGE_STATES as readonly string[]],
  [
    "enrollment",
    ENROLLMENT_TRANSITIONS as TransitionTable<string>,
    ENROLLMENT_STATES as readonly string[],
  ],
  [
    "contact_candidate",
    CANDIDATE_TRANSITIONS as TransitionTable<string>,
    CANDIDATE_STATES as readonly string[],
  ],
])("%s machine", (name, table, states) => {
  it("has a row per state; exhaustive pairs", () => {
    expect(Object.keys(table).sort()).toEqual([...states].sort());
    for (const a of states) {
      for (const b of states) {
        if (table[a]?.has(b)) expect(transition(name, table, a, b)).toBe(b);
        else expect(() => transition(name, table, a, b)).toThrow(IllegalTransition);
      }
    }
  });
});

describe("message rules", () => {
  it("draft approves directly; approved can still be struck; failed re-arms", () => {
    msg("draft", "approved");
    msg("approved", "rejected");
    msg("failed", "approved");
  });
  it("sent, rejected, skipped are terminal", () => {
    for (const t of ["sent", "rejected", "skipped"] as const)
      expect(MESSAGE_TRANSITIONS[t].size).toBe(0);
  });
  it("only in-flight messages can send; approved never jumps to sent", () => {
    expect(sourcesOf(MESSAGE_TRANSITIONS, MESSAGE_STATES, "sent")).toEqual(["sending", "unknown"]);
    expect(() => msg("approved", "sent")).toThrow(IllegalTransition);
    expect([...MESSAGE_TRANSITIONS.approved].sort()).toEqual([
      "draft",
      "failed",
      "rejected",
      "sending",
      "skipped",
    ]);
  });
  it("stop cleanup can skip any unsent state, never unknown", () => {
    for (const s of ["draft", "approved", "failed"] as const) msg(s, "skipped");
    expect(() => msg("unknown", "skipped")).toThrow(IllegalTransition);
  });
  it("outbox: sending commits intent; it lands, fails or goes unknown; never back to approved", () => {
    msg("approved", "sending");
    for (const o of ["sent", "unknown", "failed"] as const) msg("sending", o);
    expect(() => msg("sending", "approved")).toThrow(IllegalTransition);
  });
  it("unknown moves only to sent or failed, never re-armed by hand", () => {
    expect([...MESSAGE_TRANSITIONS.unknown].sort()).toEqual(["failed", "sent"]);
    expect(() => msg("unknown", "approved")).toThrow(IllegalTransition);
  });
  it("names machine and states", () => {
    expect(() => msg("sent", "draft")).toThrow(/message.*sent.*draft/);
  });
});

describe("enrollment and candidate rules", () => {
  it("finished and stopped are terminal; active is the only live state", () => {
    expect(ENROLLMENT_TRANSITIONS.finished.size).toBe(0);
    expect(ENROLLMENT_TRANSITIONS.stopped.size).toBe(0);
    transition("enrollment", ENROLLMENT_TRANSITIONS, "active", "stopped");
    transition("enrollment", ENROLLMENT_TRANSITIONS, "active", "finished");
  });
  it("candidate verdicts are terminal; queued can be dequeued", () => {
    expect(CANDIDATE_TRANSITIONS.verified.size).toBe(0);
    expect(CANDIDATE_TRANSITIONS.rejected.size).toBe(0);
    transition("contact_candidate", CANDIDATE_TRANSITIONS, "queued", "candidate");
    expect(() =>
      transition("contact_candidate", CANDIDATE_TRANSITIONS, "verified", "queued"),
    ).toThrow(IllegalTransition);
  });
});
