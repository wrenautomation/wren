/**
 * A tick per read and per save answer, in this tab. A read stamped before a save answered left
 * before the server held that save, so it can't say anything newer about the value.
 */
let now = 0;

/** The next tick: call it when a read leaves, and when a save's answer lands. */
export const tick = (): number => {
  now += 1;
  return now;
};
