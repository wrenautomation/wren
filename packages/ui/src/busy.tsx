/**
 * The busy state of a button or chip, one shared part. `on` says it is at work; the slot is
 * always there once a part can go busy, so the width never changes. The look is a variant.
 * Today only "dots" is built: three dots step after the label. William picks the final look
 * later (section 14, "Busy, Wren ways": ring, trace, corner ink, leaf turn, shuttle, wren hop).
 * To add one: add it to `VARIANTS` with its markup and its CSS in tailwind.css, then change
 * `BUSY` below. Nothing else changes. The bar, the sweep and the edge pulse are out.
 */
import type { ReactNode } from "react";

/** Each busy look: its markup. `on` is true while at work. */
const VARIANTS = {
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
export const BUSY: BusyVariant = "dots";

export function Busy({ on, variant = BUSY }: { on: boolean; variant?: BusyVariant }) {
  return (
    <span aria-hidden="true" data-busy={variant} data-on={on ? "" : undefined} className="ui-busy">
      {VARIANTS[variant]()}
    </span>
  );
}
