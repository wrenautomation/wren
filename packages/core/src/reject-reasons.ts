/** Why he turned a draft down, as quick picks; a note says the rest. Plain data: the portal reads it. */
export const REJECT_REASONS = [
  "voice",
  "facts",
  "length",
  "salesy",
  "topic",
  "timing",
  "repeat",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

/** The quick picks as he reads them. */
export const REJECT_LABELS: Readonly<Record<RejectReason, string>> = {
  voice: "Not my voice",
  facts: "Wrong facts",
  length: "Too long",
  salesy: "Too salesy",
  topic: "Off topic",
  timing: "Bad timing",
  repeat: "Said before",
};
export const REJECT_NOTE_MAX = 280;
