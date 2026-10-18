/**
 * Fixture reads for stories and unit tests: the states a `useLoad` read can be in, with no
 * `/api`. Pass one where a component takes its read (`fn`, `load`, `deps`).
 */

/** Answers on their way. The story tests wait for none before a screenshot. */
let open = 0;
export const answering = () => open;

/** A copy of `data` after `ms` (0: next tick), counted while on its way. */
export function later<T>(data: T, ms = 0): Promise<T> {
  open++;
  return new Promise((ok) =>
    setTimeout(() => {
      open--;
      ok(structuredClone(data));
    }, ms),
  );
}

/** Answers `data` after `ms` (0: next tick). */
export const answer =
  <T>(data: T, ms = 0) =>
  (): Promise<T> =>
    later(data, ms);

/** Never answers: the loading state, held. */
export const pending =
  <T>() =>
  (): Promise<T> =>
    new Promise<T>(() => {});

/** Fails the way a down server does (a 500), which the data layer shows as an error. */
export const fails =
  <T>(message = "The server could not answer.", status = 500) =>
  (): Promise<T> =>
    Promise.reject(Object.assign(new Error(message), { status }));
