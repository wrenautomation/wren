/** Our own no (bad input, an opted-out person, an empty template): an answer, not an outage. */
export class ReachRefusal extends Error {
  override name = "ReachRefusal";
}
