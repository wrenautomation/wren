/**
 * An enrollment plan: which sequence a company gets, decided by its facts. Rules run in
 * order and each one enrolls the companies that pass its gate, so a rule without a gate
 * takes everyone still unenrolled and belongs last. The plan is niche data; compose and
 * the queue-keeper read it, nothing else branches on it.
 */
export interface EnrollmentRule {
  readonly sequence: string;
  /** Fact gate, in compose's `where` form: every `key=value` must hold on the facts row. */
  readonly where?: Readonly<Record<string, string>>;
}

/** Ordered rules, checked: each sequence known, at most one ungated rule and it is last. */
export function enrollmentPlan(
  rules: readonly EnrollmentRule[],
  known: ReadonlySet<string>,
  where: string,
): readonly EnrollmentRule[] {
  if (rules.length === 0) throw new Error(`${where}: an enrollment plan needs at least one rule`);
  rules.forEach((rule, i) => {
    if (!known.has(rule.sequence)) {
      throw new Error(`${where}: plan rule ${i} names unknown sequence '${rule.sequence}'`);
    }
    const ungated = rule.where === undefined || Object.keys(rule.where).length === 0;
    if (ungated && i !== rules.length - 1) {
      throw new Error(
        `${where}: plan rule ${i} ('${rule.sequence}') has no gate, so nothing after it could enroll`,
      );
    }
  });
  return [...rules];
}
