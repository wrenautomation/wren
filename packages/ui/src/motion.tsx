/**
 * Motion (motion.dev) in the artifact's values: one place for the curves, the timings and the
 * parts that grow and shrink. A part that changes size uses these, never its own numbers.
 * Source: designs/2026-10-20-design-language/design-language.src.html, `--spring`, `--ease`.
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useRef } from "react";
import { type BusySize, Ring } from "./busy.js";
import { cx } from "./format.js";

/** `--ui-spring`: things you press or open. It overshoots a little. */
export const SPRING = [0.2, 0.9, 0.25, 1.12] as const;
/** `--ui-ease`: things that arrive. */
export const EASE = [0.16, 1, 0.3, 1] as const;
/** Things that leave: ease-out, quicker than they came (Vaul's drawer curve); ease-in reads as lag. */
export const LEAVE = [0.32, 0.72, 0, 1] as const;
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

/**
 * A list whose items leave and come back in place (an answer held for undo, a push): one going
 * fades and shrinks a hair, quicker than it came (MO-7); the rest close the gap by transform
 * (FLIP, `layout`), never by height (MO-26). An item back mid-exit turns around from where it is
 * (MO-29). The first items show at once. Reduced motion: fades only.
 */
export function Leaves<T>({
  items,
  keyOf,
  children,
  className,
  itemClassName,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  children: (item: T) => ReactNode;
  className?: string;
  itemClassName?: string;
}) {
  const still = useReducedMotion() ?? false;
  const shrink = (s: number) => (still ? {} : { scale: s });
  return (
    // popLayout lifts a leaving item out of flow, so its parent holds it: `relative`; `isolate` keeps
    // the leaving one (z -1) under the items that close its gap, inside the list
    <ul className={cx("relative isolate m-0 list-none p-0", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        {items.map((item) => (
          <motion.li
            key={keyOf(item)}
            layout={still ? false : "position"}
            initial={{ opacity: 0, ...shrink(0.97) }}
            animate={{ opacity: 1, ...shrink(1) }}
            exit={{
              opacity: 0,
              zIndex: -1,
              ...shrink(0.98),
              transition: { duration: 0.15, ease: LEAVE, zIndex: { duration: 0 } },
            }}
            transition={{ duration: 0.2, ease: EASE }}
            className={itemClassName}
          >
            {children(item)}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/**
 * A count that changes: the new number rises in once (`ui-rise` keyframes), never on the first
 * draw (MO-3). Board lanes, the Decisions head.
 */
export function RisingNumber({ n, className }: { n: number; className?: string | undefined }) {
  const first = useRef(n);
  const moved = useRef(false);
  if (n !== first.current) moved.current = true;
  return (
    <b
      key={n}
      className={cx(
        "inline-block tabular-nums",
        // 200 ms: a routine change stays under 300 (MV-9); `ui-rise` is 350 for Steps
        moved.current && "animate-[ui-rise_200ms_var(--ui-ease)_both] motion-reduce:animate-none",
        className,
      )}
    >
      {n}
    </b>
  );
}
