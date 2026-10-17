/**
 * Fixture reads for stories and unit tests: the states a `useLoad` read can be in, with no
 * `/api`. Pass one where a component takes its read (`fn`, `load`, `deps`).
 */

/** Answers `data` after `ms` (0: next tick). */
export const answer =
  <T>(data: T, ms = 0) =>
  (): Promise<T> =>
    new Promise((ok) => setTimeout(() => ok(structuredClone(data)), ms));

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
