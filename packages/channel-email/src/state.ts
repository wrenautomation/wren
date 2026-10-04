import { type TransitionTable, transition } from "@wren/core";
import type { CandidateState, EnrollmentState, MessageState } from "./schema.js";

const set = <S extends string>(...s: S[]): ReadonlySet<S> => new Set(s);

export const MESSAGE_TRANSITIONS: TransitionTable<MessageState> = {
  // draft -> approved is review sign-off (or send_mode=auto at compose);
  // draft -> skipped happens when the enrollment stops first.
  draft: set("approved", "rejected", "skipped"),
  // approved -> sending is the outbox walk committing intent before the act.
  // There is deliberately no approved -> sent edge: no code path can reach `sent`
  // without first committing a `sending` row carrying our Message-ID.
  // Back to draft only by an undo, before any send took the row (unapproveDrafts locks it).
  approved: set("draft", "sending", "skipped", "failed", "rejected"),
  // The transport has our message: landed (sent), refused before the request left
  // (failed, re-armable by approve), or answered nothing we can trust (unknown).
  // A sending row is an attempt on the record; it never goes back to approved.
  sending: set("sent", "unknown", "failed"),
  // Only reconcile may move these: it asks the mailbox for our Message-ID.
  // A human re-arming an unknown row is exactly the double send this prevents.
  unknown: set("sent", "failed"),
  // failed -> approved is the manual retry; failed -> skipped is stop cleanup.
  failed: set("approved", "skipped"),
  // Sent is irrevocable; what happened next lives in enrollment stops and suppressions.
  sent: set(),
  rejected: set(),
  skipped: set(),
};

export const ENROLLMENT_TRANSITIONS: TransitionTable<EnrollmentState> = {
  active: set("finished", "stopped"),
  finished: set(),
  stopped: set(),
};

export const CANDIDATE_TRANSITIONS: TransitionTable<CandidateState> = {
  // queued -> candidate is the operator dequeue; nothing else re-opens.
  // candidate -> verified/rejected: the verdict on the lead it already holds (a listed contact).
  candidate: set("queued", "verified", "rejected"),
  queued: set("verified", "rejected", "candidate"),
  // Terminal: a verdict was paid for; a re-check is a new verification row.
  verified: set(),
  rejected: set(),
};

export const transitionMessage = (current: MessageState, next: MessageState) =>
  transition("message", MESSAGE_TRANSITIONS, current, next);
export const transitionEnrollment = (current: EnrollmentState, next: EnrollmentState) =>
  transition("enrollment", ENROLLMENT_TRANSITIONS, current, next);
export const transitionCandidate = (current: CandidateState, next: CandidateState) =>
  transition("contact_candidate", CANDIDATE_TRANSITIONS, current, next);
