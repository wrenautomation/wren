/**
 * A write the rules refuse. `errors` holds every reason, in plain English. It lives apart from the
 * store so pure files can throw it without importing the database. `store.ts` re-exports it.
 */
export class Refused extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "Refused";
  }
}
