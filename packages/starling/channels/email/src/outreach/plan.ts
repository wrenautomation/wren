/**
 * An enrollment plan: which sequence a company gets, decided by its facts and whether
 * it is new or coming back. Rules run in order and each one enrolls the companies that
 * pass its gate, so a rule without a gate takes everyone still unenrolled in its
 * audience and belongs last among that audience's rules. The plan is niche data;
 * compose and the queue-keeper read it, nothing else branches on it.
 */
import { AUDIENCES, type Audience } from "../recontact.js";

export interface EnrollmentRule {
  readonly sequence: string;
  /** Fact gate, in compose's `where` form: every `key=value` must hold on the facts row. */
  readonly where?: Readonly<Record<string, string>>;
  /**
   * Who the rule writes to: companies never enrolled, or companies coming back for a
   * new sequence (lead recycling). Absent = both; a returning-only rule gives recycled
   * companies their own copy.
   */
  readonly audience?: Audience;
}

/** Whether `rule` writes to `audience`. */
export const ruleCovers = (rule: EnrollmentRule, audience: Audience): boolean =>
  rule.audience === undefined || rule.audience === audience;

/**
 * Ordered rules, checked: each sequence known, and per audience at most one ungated
 * rule, last among that audience's rules.
 */
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
    if (rule.audience !== undefined && !AUDIENCES.includes(rule.audience)) {
      throw new Error(`${where}: plan rule ${i} names unknown audience '${rule.audience}'`);
    }
    const ungated = rule.where === undefined || Object.keys(rule.where).length === 0;
    if (!ungated) return;
    for (const audience of AUDIENCES) {
      if (!ruleCovers(rule, audience)) continue;
      const later = rules.findIndex((r, j) => j > i && ruleCovers(r, audience));
      if (later !== -1) {
        throw new Error(
          `${where}: plan rule ${i} ('${rule.sequence}') has no gate, so ${audience} rule ${later} after it could never enroll`,
        );
      }
    }
  });
  return [...rules];
}
