/** A rule as text: printed, read back, the same rule; and why bad text won't read. */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { type Condition, compileRule, type Rule, readRule, ruleWords } from "./segments.js";
import { parseRule, ruleText } from "./segments-text.js";

const NOW = new Date("2026-10-14T15:00:00Z");
const all = (...of: Rule["of"]): Rule => ({ kind: "group", match: "all", of });
const ok = (text: string, names?: Map<string, number>): Rule => {
  const got = parseRule(text, names);
  if ("problems" in got) throw new Error(got.problems.join("; "));
  return got.rule;
};
const problems = (text: string) => {
  const got = parseRule(text);
  return "problems" in got ? got.problems.join("; ") : "";
};

describe("parseRule", () => {
  it("reads the bead's example", () => {
    const rule = ok(`all(
      trait stage is "cold",   # from the people rollup
      trait persona is "agency owner",
      step saw on reddit in 30d,
      not message opened on email
    )`);
    expect(rule).toEqual(
      all(
        { kind: "trait", key: "stage", op: "is", value: "cold" },
        { kind: "trait", key: "persona", op: "is", value: "agency owner" },
        { kind: "step", step: "saw", channel: "reddit", days: 30 },
        { kind: "message", state: "opened", channel: "email", atLeast: 1, days: null, not: true },
      ),
    );
  });

  it("reads counts, matches and anchors", () => {
    const rule = ok(
      `event email_received on email matching "pricing" 2..5 in 90d after email_sent on email before booking`,
    );
    expect(rule.of[0]).toEqual({
      kind: "event",
      event: "email_received",
      channel: "email",
      match: "pricing",
      atLeast: 2,
      atMost: 5,
      days: 90,
      after: { event: "email_sent", channel: "email" },
      before: { event: "booking" },
    });
    expect(ok("event form never").of[0]).toMatchObject({ atLeast: 0, atMost: 0 });
    expect(ok("event form <= 2").of[0]).toMatchObject({ atLeast: 0, atMost: 2 });
    expect(ok("event form >= 3").of[0]).toMatchObject({ atLeast: 3 });
  });

  it("reads trait ops, numbers and segments by name", () => {
    const rule = ok(
      'any(trait seats > 10, trait plan one_of "pro, team", trait renewal_date in_next 30, trait email exists, group "Warm leads", segment 4)',
      new Map([["warm leads", 7]]),
    );
    expect(rule.match).toBe("any");
    expect(rule.of).toEqual([
      { kind: "trait", key: "seats", op: "gt", value: 10 },
      { kind: "trait", key: "plan", op: "one_of", value: "pro, team" },
      { kind: "trait", key: "renewal_date", op: "in_next", value: 30 },
      { kind: "trait", key: "email", op: "exists" },
      { kind: "segment", segment: 7 },
      { kind: "segment", segment: 4 },
    ]);
  });

  it("says why text won't read", () => {
    expect(problems("")).toMatch(/empty/);
    expect(problems("all(trait plan is)")).toMatch(/value/);
    expect(problems('all(trait plan is "pro"')).toMatch(/ended/);
    expect(problems('trait plan is "pro')).toMatch(/never closes/);
    expect(problems("wish for money")).toMatch(/isn't a condition/);
    expect(problems("step clicked")).toMatch(/step/);
    expect(problems('group "Nope"')).toMatch(/no group called/);
    expect(problems("event form in 30")).toMatch(/30d/);
    expect(problems("event form 5..2")).toMatch(/at most is under/);
    expect(problems('trait plan one_of " , "')).toMatch(/needs values/);
    expect(problems("event form) extra")).toMatch(/unexpected/);
  });
});

describe("ruleText", () => {
  const RULES: Rule[] = [
    all({ kind: "trait", key: "plan", op: "is", value: 'say "pro"' }),
    all(
      { kind: "trait", key: "seats", op: "lt", value: 3, not: true },
      {
        kind: "group",
        match: "any",
        not: true,
        of: [
          { kind: "event", event: "touch", channel: "reddit", atLeast: 1, days: 30 },
          { kind: "event", event: "booking", atLeast: 0, atMost: 0, days: null },
        ],
      },
      {
        kind: "message",
        state: "replied",
        channel: "linkedin",
        campaign: "agency q4",
        atLeast: 0,
        atMost: 2,
        days: 14,
      },
      { kind: "step", step: "booked", channel: "email", source: "recruiting", days: 60 },
      { kind: "consent", channel: "sms", state: "opted_out", not: true },
      { kind: "segment", segment: 3 },
      {
        kind: "journey",
        node: "booked",
        reached: true,
        status: "open",
        entry: "mail",
        window: "opened",
        days: 30,
        not: true,
      },
      { kind: "journey", node: "engaged", days: null },
      { kind: "journey", status: "dropped", days: 7 },
      { kind: "journey", days: null },
      {
        kind: "event",
        event: "email_received",
        match: "pricing",
        atLeast: 2,
        atMost: 5,
        days: 90,
        after: { event: "email_sent", channel: "email" },
        before: { event: "booking" },
      },
    ),
  ];

  it("round trips: text to rule to text", () => {
    for (const raw of RULES) {
      const rule = (readRule(raw) as { rule: Rule }).rule;
      expect(rule).toBeTruthy();
      const text = ruleText(rule);
      expect(ok(text)).toEqual(rule);
      expect(ruleText(ok(text))).toBe(text);
    }
  });

  it("prints short rules on one line, long ones one item a line, segments by name", () => {
    expect(ruleText(RULES[0] as Rule)).toBe('all(trait plan is "say \\"pro\\"")');
    const long = ruleText(RULES[1] as Rule, new Map([[3, "Warm leads"]]));
    expect(long.split("\n")[0]).toBe("all(");
    expect(long).toContain('  group "Warm leads"');
    expect(long).toContain("  not any(event touch on reddit in 30d, event booking never)");
  });
});

describe("new conditions", () => {
  const pg = new PgDialect();
  const sqlOf = (c: Condition) => pg.sqlToQuery(compileRule(all(c), NOW));

  it("compiles step, anchors, at most and one_of", () => {
    const step = sqlOf({ kind: "step", step: "booked", channel: "reddit", days: 30 });
    expect(step.sql).toContain("profile_steps");
    expect(step.sql).toContain("r.step = 'reached'");
    const never = sqlOf({ kind: "event", event: "booking", atLeast: 0, atMost: 0, days: null });
    expect(never.sql).toContain("p.id not in");
    const anchored = sqlOf({
      kind: "event",
      event: "email_sent",
      atLeast: 1,
      days: null,
      before: { event: "booking" },
    });
    expect(anchored.sql).toContain("'infinity'");
    const list = sqlOf({ kind: "trait", key: "plan", op: "one_of", value: "Pro, team" });
    expect(list.params).toEqual(expect.arrayContaining(["pro", "team"]));
  });

  it("puts them in words", () => {
    const words = ruleWords(
      all(
        { kind: "step", step: "saw", channel: "reddit", days: 30 },
        { kind: "event", event: "booking", atLeast: 0, atMost: 0, days: null },
        {
          kind: "message",
          state: "opened",
          channel: "email",
          campaign: "q4",
          atLeast: 1,
          days: null,
        },
      ),
    );
    expect(words).toBe(
      'all of: saw on reddit in the last 30 days, booking never, email opened in campaign "q4" ever',
    );
  });
});

describe("journey condition", () => {
  const pg = new PgDialect();
  const sqlOf = (c: Condition) => pg.sqlToQuery(compileRule(all(c), NOW));

  it("reads and prints the grammar", () => {
    expect(ok("journey reached booked open entry mail opened in 30d").of[0]).toEqual({
      kind: "journey",
      node: "booked",
      reached: true,
      status: "open",
      entry: "mail",
      window: "opened",
      days: 30,
    });
    expect(ok("not journey at engaged in 7d").of[0]).toEqual({
      kind: "journey",
      node: "engaged",
      days: 7,
      not: true,
    });
    expect(ok("journey").of[0]).toEqual({ kind: "journey", days: null });
    expect(ruleText(ok("journey done in 30d"))).toBe("all(journey done in 30d)");
    expect(ruleText(ok("journey reached booked"))).toBe("all(journey reached booked)");
  });

  it("reads older text that named a funnel, and drops the funnel", () => {
    expect(ok("journey funnel organic at engaged in 7d").of[0]).toEqual({
      kind: "journey",
      node: "engaged",
      days: 7,
    });
    expect(ruleText(ok("journey funnel organic done in 30d"))).toBe("all(journey done in 30d)");
  });

  it("reads an older saved rule: the stage is the node, the funnel is ignored", () => {
    const old = { kind: "journey", funnel: "organic", stage: "booked", reached: true, days: null };
    const got = readRule({ kind: "group", match: "all", of: [old] });
    expect("rule" in got && got.rule.of[0]).toEqual({
      kind: "journey",
      node: "booked",
      reached: true,
      days: null,
    });
    // A rule that names both keeps the node.
    const both = readRule({
      kind: "group",
      match: "all",
      of: [{ kind: "journey", node: "signed", stage: "booked", days: null }],
    });
    expect("rule" in both && both.rule.of[0]).toMatchObject({ node: "signed" });
  });

  it("says why bad text won't read", () => {
    expect(problems("journey reached")).toMatch(/node id/);
    expect(problems("journey opened")).toMatch(/needs days/);
    expect(problems("journey at Booked")).toMatch(/node or source id/);
  });

  it("compiles to pipeline.instances, with the trail only for reached", () => {
    const at = sqlOf({ kind: "journey", node: "booked", status: "open", days: 7 });
    expect(at.sql).toContain("from pipeline.instances j");
    expect(at.sql).toContain("j.node = $1");
    expect(at.sql).not.toContain("trail");
    expect(at.sql).toContain("j.moved_at >=");
    expect(at.params).toEqual(["booked", "open", "2026-10-07T15:00:00.000Z", NOW.toISOString()]);
    const past = sqlOf({
      kind: "journey",
      node: "booked",
      reached: true,
      window: "opened",
      days: 7,
    });
    expect(past.sql).toContain("j.trail @>");
    expect(past.sql).not.toContain("funnel");
    expect(past.params).toContain('[{"to":"booked"}]');
    expect(past.sql).toContain("j.opened_at >=");
    const none = pg.sqlToQuery(compileRule({ kind: "journey", days: null, not: true }, NOW));
    expect(none.sql.replace(/\s+/g, " ")).toMatch(
      /^not p\.id in \(select j\.profile_id from pipeline\.instances j where true ?\)$/,
    );
  });

  it("puts it in words", () => {
    expect(
      ruleWords(
        all({
          kind: "journey",
          node: "booked",
          reached: true,
          status: "open",
          days: 30,
          not: true,
        }),
      ),
    ).toBe("no open journey through booked moved in the last 30 days");
  });
});
