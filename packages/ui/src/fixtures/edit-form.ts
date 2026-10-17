/** Fixtures for `edit-form.tsx`: one contact form with every field kind, and its schema. */
import type { AccountPick } from "@wren/core/record-accounts";
import { z } from "zod";
import { WORST } from "./worst.js";

export const CONTACT = z.object({
  name: z.string().min(1, "Say a name."),
  email: z.string().regex(/^[^@\s]*(@[^@\s]+\.[^@\s]+)?$/, "That is not an email."),
  note: z.string(),
  stage: z.string(),
  follow: z.string(),
  budget: z.string().regex(/^[\d.,$\s]*$/, "Use digits, like 1,250.50."),
  vip: z.boolean(),
  channels: z.array(z.string()),
  tone: z.string(),
  account: z.string().nullable(),
});
export type ContactValues = z.infer<typeof CONTACT>;

/** A contact as the server holds it. */
export const CONTACT_DEFAULTS: ContactValues = {
  name: "Sam Example",
  email: "sam@example.com",
  note: "Met at the spring meetup. Wants a short call.",
  stage: "talking",
  follow: "2026-10-23",
  budget: "1,250.50",
  vip: false,
  channels: ["email"],
  tone: "warm",
  account: null,
};

/** A new contact: blanks. */
export const CONTACT_BLANK: ContactValues = {
  name: "",
  email: "",
  note: "",
  stage: "new",
  follow: "",
  budget: "",
  vip: false,
  channels: [],
  tone: "warm",
  account: null,
};

/** The same form with the worst values in every text box, one of them invalid. */
export const CONTACT_WORST: ContactValues = {
  ...CONTACT_DEFAULTS,
  name: WORST.longName,
  email: WORST.email,
  note: WORST.longText,
  budget: "ten dollars",
};

export const STAGES = [
  ["new", "New"],
  ["talking", "Talking"],
  ["won", "Won"],
  ["lost", "Lost (closed)", true],
] as const;
export const CHANNELS = [
  ["email", "Email"],
  ["sms", "Text"],
  ["dm", "Direct message"],
] as const;
export const TONES = [
  ["warm", "Warm"],
  ["plain", "Plain"],
] as const;

/** Two accounts on one platform; the form's field holds the pick. */
export const FORM_ACCOUNTS: Omit<AccountPick, "current" | "picked"> = {
  platform: "reddit",
  fallback: "reddit@one",
  options: [
    { key: "reddit@one", label: "u/synthetic_one", state: "active", warn: null },
    { key: "reddit@two", label: "u/synthetic_two", state: "warming", warn: null },
  ],
};
