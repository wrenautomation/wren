/** Fixtures for `diff.tsx`: two versions of one email, and the worst texts. */
import { WORST } from "./worst.js";

export const DIFF_A = `Subject: Quick question

Hi Sam,

I saw your note on the spring plan.
We help small teams book more calls.
Open to a short chat this week?

Thanks,
Ada`;

export const DIFF_B = `Subject: Quick question about Q4

Hi Sam,

I saw your note on the spring plan.
We help small teams book more calls without hiring.
Most teams see the first booked call in two weeks.
Open to a short chat this week?

Thanks,
Ada Example`;

/** The same text twice: nothing changed. */
export const DIFF_SAME = DIFF_A;

/** Long lines, an address that never breaks, mixed scripts, blank lines, and a long run of changes. */
export const WORST_A = [
  WORST.longText,
  WORST.email,
  "",
  WORST.nonLatin,
  WORST.rtl,
  ...Array.from({ length: 20 }, (_, i) => `Line ${i}: ${WORST.longLabel}`),
].join("\n");

export const WORST_B = [
  WORST.longText.replace("runs long", "ran long"),
  WORST.url,
  "",
  WORST.emoji,
  WORST.rtl,
  ...Array.from({ length: 20 }, (_, i) =>
    i % 3 ? `Line ${i}: ${WORST.longLabel}` : `Line ${i}: ${WORST.longCompany}`,
  ),
  "A line added at the end.",
].join("\n");
