import { motion, useReducedMotion } from "motion/react";
import { MOVE } from "./motion.js";

/**
 * The lit pill behind the tab on screen (the artifact's `.tl button.on`: the accent's tint, a leaf
 * of 4 and 10). Draw it inside the tab that is on; the tab is `relative isolate` (`TAB` in
 * list-bar), so the pill paints over the tab's ground and under its words. Motion's `layoutId`
 * slides it from the last tab to the next on the spring, also when the page draws the row afresh.
 * `row` names the row, so two rows on one page slide apart. Reduced motion: it moves at once.
 */
export function TabBar({ row }: { row: string }) {
  const still = useReducedMotion() ?? false;
  return (
    <motion.span
      layoutId={`tab-pill:${row}`}
      aria-hidden="true"
      transition={still ? { duration: 0 } : MOVE}
      className="pointer-events-none absolute inset-0 -z-1 rounded-[4px_10px_4px_10px] bg-(--ui-accent-tint)"
    />
  );
}
