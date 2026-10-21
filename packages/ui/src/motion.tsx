/**
 * Motion (motion.dev) in the artifact's values: one place for the curves, the timings and the
 * parts that grow and shrink. A part that changes size uses these, never its own numbers.
 * Source: designs/2026-10-20-design-language/design-language.src.html, `--spring`, `--ease`.
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type BusySize, Ring } from "./busy.js";

/** `--ui-spring`: things you press or open. It overshoots a little. */
export const SPRING = [0.2, 0.9, 0.25, 1.12] as const;
/** `--ui-ease`: things that arrive. */
export const EASE = [0.16, 1, 0.3, 1] as const;
/** A size or place change: 0.3 s on the spring. */
export const MOVE = { duration: 0.3, ease: SPRING };
/** A fade: 0.2 s. */
export const FADE = { duration: 0.2, ease: "linear" } as const;

/**
 * The busy ring where it takes room (a chip, a tab): its place grows from nothing on the spring
 * while the ring fades in, and shrinks back when the work ends. A fast toggle turns back from
 * where it is. Reduced motion: the room comes and goes at once, and the ring only fades. In a
 * flex row with a gap, set `--ui-gap` to that gap so the gap grows with the room.
 */
export function RingSlot({ on, size }: { on: boolean; size?: BusySize }) {
  const still = useReducedMotion() ?? false;
  const width = still ? { duration: 0 } : MOVE;
  return (
    <AnimatePresence initial={false}>
      {on ? (
        <motion.span
          key="ring"
          className="ui-ring-slot"
          aria-hidden="true"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: "auto", opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ width, opacity: FADE }}
        >
          <Ring {...(size ? { size } : {})} />
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}
