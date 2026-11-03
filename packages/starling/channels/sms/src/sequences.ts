/**
 * Core SMS sequences, registered next to every niche's (niches/src/index.ts): the site
 * applicant's (inbound's form.ts) and speed to lead (delivery's speed.ts). Copy lives here, low,
 * so the niche registry reads it without a product above.
 */
import { SPEED } from "./components.js";
import { checkSequence, type SmsSequence } from "./templates.js";

export { SPEED };

const FIRST_GOES =
  "Two minutes after they apply on the site with the texts box ticked, in texting hours on their clock; none if they booked a call by then";

export const FORM_FIT = "form-fit";
export const FORM_NOT_FIT = "form-not-fit";

/** After the first text: the Follow-up's two texts, on day 1 and day 3. */
const FOLLOW_STEPS = [
  { step: 2, afterDays: 1, template: "follow-up#1" },
  { step: 3, afterDays: 2, template: "follow-up#2" },
] as const;

/** Core sequences, registered next to every niche's (niches/src/index.ts). */
export const FORM_SEQUENCES: readonly SmsSequence[] = [
  {
    name: FORM_FIT,
    label: "Applicant who fits",
    steps: [{ step: 1, afterDays: 0 }, ...FOLLOW_STEPS],
    firstGoes: FIRST_GOES,
    fields: ["first_name", "sender", "booking_link"],
  },
  {
    name: FORM_NOT_FIT,
    label: "Applicant who doesn't fit",
    steps: [{ step: 1, afterDays: 0 }, ...FOLLOW_STEPS],
    firstGoes: FIRST_GOES,
    fields: ["first_name", "sender", "booking_link"],
  },
];

/** The first text, then day 1, 3 and 7 after it. Empty until the client's words are in. */
export const SPEED_SEQUENCE: SmsSequence = checkSequence({
  name: SPEED,
  label: "Speed to lead",
  steps: [
    { step: 1, afterDays: 0 },
    { step: 2, afterDays: 1 },
    { step: 3, afterDays: 2 },
    { step: 4, afterDays: 4 },
  ],
  firstGoes: "Within a minute of the form, in texting hours on their clock",
  fields: ["first_name", "sender", "booking_link"],
  namesSender: true,
});

/** Core sequences, registered next to every niche's (niches/src/index.ts). */
export const SPEED_SEQUENCES: readonly SmsSequence[] = [SPEED_SEQUENCE];
