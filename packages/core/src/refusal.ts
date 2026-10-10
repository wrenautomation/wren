/**
 * A "no" said to the person asking, with the HTTP status the Worker answers. `answer` turns any
 * refusal into Restate's terminal error with that status, so it is never retried. A package's own
 * refusal extends this one; no dependencies, so the Worker's side can import it.
 */
export type RefusalStatus = 400 | 403 | 404 | 409 | 410 | 422 | 429 | 503;

export class PortalRefusal extends Error {
  constructor(
    message: string,
    readonly status: RefusalStatus = 400,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** A part of setup this place lacks (the key store, the portal's address): said as in development. */
export function setUp<T>(v: T | null | undefined, what: string): asserts v is T {
  if (v === null || v === undefined)
    throw new PortalRefusal(`In development: ${what} isn't set up here`, 503);
}
