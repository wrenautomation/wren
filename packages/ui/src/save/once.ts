/**
 * A page's own button, by key (Accounts, AI tools): a press in `WRITES`. A second press while
 * the first call is out gets the first's answer, and the request id stays the same until the
 * server answered, so a retry after a lost answer is one action, not two.
 */
import { type PressOptions, WRITES } from "./writes.js";

export const ACTIONS = {
  run: <R>(
    key: string,
    fn: (requestId: string) => Promise<R>,
    press: Omit<PressOptions, "key"> = {},
  ): Promise<R> => WRITES.press({ key, ...press }, fn),
  busy: (key: string) => WRITES.busy(key),
};
