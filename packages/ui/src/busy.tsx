/**
 * The busy state of a button or chip, one shared part. `on` says it is at work; the slot is
 * always there once a part can go busy, so the width never changes. The look is a variant.
 * "ring" is the default: the plain ring of section 14 ("Ring, bird ways", option 0), 14 px after a
 * label, 40 px in a modal. "dots" stays as an option. William picks the final look later (flight,
 * feathers, clutch, nest). To add one: add it to `VARIANTS` with its markup and its CSS in
 * tailwind.css, then change `BUSY` below. Nothing else changes. The bar, the sweep and the edge
 * pulse are out.
 */
import type { ReactNode } from "react";

/** Each busy look: its markup. `on` is true while at work. */
const VARIANTS = {
  ring: () => (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="15" />
    </svg>
  ),
  dots: () => (
    <>
      <i />
      <i />
      <i />
    </>
  ),
} satisfies Record<string, () => ReactNode>;

export type BusyVariant = keyof typeof VARIANTS;

/** The look every busy button and chip wears. One line to change. */
export const BUSY: BusyVariant = "ring";

/** `big` is the 40 px ring of a modal; the default is the 14 px one after a label. */
export function Busy({
  on,
  variant = BUSY,
  big = false,
}: {
  on: boolean;
  variant?: BusyVariant;
  big?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      data-busy={variant}
      data-on={on ? "" : undefined}
      data-big={big ? "" : undefined}
      className="ui-busy"
    >
      {VARIANTS[variant]()}
    </span>
  );
}
