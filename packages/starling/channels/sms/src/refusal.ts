/** A request we answer "no" to (bad input, an opted-out number): terminal on Restate, never retried. */
export class SmsRefusal extends Error {
  override name = "SmsRefusal";
}
