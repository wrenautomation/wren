/** Segment rules (B5): parse and check, each condition kind as SQL, words, order, describe. */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { LOGIC, logicProblems, triggerHears } from "./logic.js";
import {
  type Condition,
  compileRule,
  conditionsOf,
  type DescribeContext,
  dataOf,
  describePrompt,
  describeSegment,
  jsonIn,
  matchingSql,
  pickGroup,
  type Rule,
  readRule,
  recomputeOrder,
  ruleWords,
  type SegmentModel,
  segmentsIn,
} from "./segments.js";
import { heard, workflowUses } from "./segments-pass.js";
import type { Workflow, WorkflowNode } from "./workflows.js";

/** A fixed moment: tests never read today. */
const NOW = new Date("2026-10-14T15:00:00Z");
const pg = new PgDialect();
const q = (c: Condition | Rule) => pg.sqlToQuery(compileRule(c, NOW));
const all = (...of: Rule["of"]): Rule => ({ kind: "group", match: "all", of });

describe("readRule", () => {
  it("fills defaults and keeps a sound rule", () => {
    const got = readRule(all({ kind: "event", event: "form" } as Condition));
    expect(got).toEqual({
      rule: all({ kind: "event", event: "form", atLeast: 1, days: null }),
    });
  });

  it("says why a rule won't run", () => {
    const bad = (raw: unknown) => {
      const r = readRule(raw);
      return "problems" in r ? r.problems.join("; ") : "ok";
    };
    expect(bad(all({ kind: "trait", key: "plan", op: "is" } as Condition))).toMatch(
      /needs a value/,
    );
    expect(bad(all({ kind: "trait", key: "seats", op: "gt", value: "lots" }))).toMatch(
      /needs a number/,
    );
    expect(bad(all({ kind: "trait", key: "renewal", op: "before", value: "soon" }))).toMatch(
      /date like/,
    );
    expect(bad(all({ kind: "trait", key: "plan", op: "exists", value: "x" }))).toMatch(
      /takes no value/,
    );
    expect(bad(all({ kind: "consent", channel: "email", state: "opted_out" }))).toMatch(
      /only a phone/,
    );
    expect(bad(all({ kind: "trait", key: "Bad Key", op: "exists" }))).toMatch(/trait key/);
    expect(bad({ kind: "group", match: "most", of: [] })).toMatch(/match/);
    expect(bad(all({ kind: "nope" } as unknown as Condition))).not.toBe("ok");
    const sixteen = () =>
      all(...Array.from({ length: 16 }, () => ({ kind: "event", event: "form" }) as Condition));
    const many = all(sixteen(), sixteen());
    expect(bad(many)).toMatch(/at most 30 conditions/);
    let deep: Rule = all({ kind: "event", event: "form" } as Condition);
    for (let i = 0; i < 4; i++) deep = all(deep);
    expect(bad(deep)).toMatch(/nest at most 4/);
  });
});

describe("compileRule: each condition kind", () => {
  it("trait: each comparison on profile_traits", () => {
    const t = (op: string, value?: string | number) =>
      q({ kind: "trait", key: "plan", op, value } as Condition);
    expect(t("is", "Pro").sql).toMatch(
      /from profile_traits t\s+where t\.key = \$1 and lower\(t\.value #>> '\{\}'\) = lower\(\$2\)/,
    );
    expect(t("is", "Pro").params).toEqual(["plan", "Pro"]);
    expect(t("contains", "pro").sql).toMatch(/strpos\(lower/);
    expect(t("exists").sql).toMatch(/and true\)/);
    expect(t("gt", 5).sql).toMatch(/segment_number\(t\.value\) > \$2::numeric/);
    expect(t("lt", 5).sql).toMatch(/segment_number\(t\.value\) < \$2::numeric/);
    expect(t("before", "2026-12-31").sql).toMatch(/segment_date\(t\.value\) < \$2::date/);
    expect(t("after", "2026-12-31").sql).toMatch(/segment_date\(t\.value\) > \$2::date/);
    const next = t("in_next", 7);
    expect(next.sql).toMatch(/between \$2::date and \$3::date \+ \$4::int/);
    expect(next.params).toEqual(["plan", "2026-10-14", "2026-10-14", 7]);
    expect(t("in_last", 7).sql).toMatch(/between \$2::date - \$3::int and \$4::date/);
  });

  it("event: counted on the timeline within its window", () => {
    const e = q({ kind: "event", event: "form", atLeast: 2, days: 30 });
    expect(e.sql).toMatch(/from profile_timeline l\s+where l\.kind = \$1/);
    expect(e.sql).toMatch(/having count\(\*\) >= \$4/);
    expect(e.params).toEqual(["form", NOW.toISOString(), "2026-09-14T15:00:00.000Z", 2]);
    const ever = q({ kind: "event", event: "booking", atLeast: 1, days: null });
    expect(ever.sql).not.toMatch(/l\.at >=/);
  });

  it("consent: by address and channel; a STOP from sms_contacts", () => {
    const c = q({ kind: "consent", channel: "sms", state: "confirmed" });
    expect(c.sql).toMatch(/join consents c on c\.address = k\.value and c\.channel = \$1/);
    expect(c.params).toEqual(["sms", "phone", "confirmed"]);
    const stop = q({ kind: "consent", channel: "sms", state: "opted_out" });
    expect(stop.sql).toMatch(/join sms_contacts s on s\.e164 = k\.value/);
    expect(stop.sql).toMatch(/s\.state = 'opted_out'/);
  });

  it("message: the sent log's ladder, a state counting those past it", () => {
    const m = q({ kind: "message", state: "opened", channel: "email", atLeast: 1, days: 7 });
    expect(m.sql).toMatch(
      /join sent_records s on s\.key_kind = k\.kind and s\.key_value = k\.value/,
    );
    expect(m.params).toEqual([
      "opened",
      "clicked",
      "replied",
      "email",
      "2026-10-07T15:00:00.000Z",
      1,
    ]);
    const any = q({ kind: "message", state: "bounced", channel: "any", atLeast: 1, days: null });
    expect(any.sql).not.toMatch(/s\.channel =/);
    expect(any.params).toEqual(["bounced", 1]);
  });

  it("segment: membership now", () => {
    const s = q({ kind: "segment", segment: 4 });
    expect(s.sql).toMatch(/from segment_members m\s+where m\.segment_id = \$1/);
    expect(s.params).toEqual([4]);
  });

  it("groups: and / or, not around anything", () => {
    const r = q({
      kind: "group",
      match: "any",
      not: true,
      of: [
        { kind: "segment", segment: 1 },
        all({ kind: "segment", segment: 2 }, { kind: "segment", segment: 3, not: true }),
      ],
    });
    expect(r.sql).toMatch(/^not \(p\.id in .* or \(p\.id in .* and not p\.id in .*\)\)$/s);
    const m = pg.sqlToQuery(matchingSql(all({ kind: "segment", segment: 1 }), NOW));
    expect(m.sql).toMatch(/^select p\.id from profiles p where p\.merged_into is null and/);
  });
});

describe("words and reads", () => {
  const rule: Rule = all(
    { kind: "trait", key: "plan", op: "is", value: "pro" },
    {
      kind: "group",
      match: "any",
      of: [
        { kind: "message", state: "opened", channel: "email", atLeast: 2, days: 30 },
        { kind: "event", event: "booking", atLeast: 1, days: null, not: true },
      ],
    },
    { kind: "consent", channel: "sms", state: "opted_out", not: true },
    { kind: "segment", segment: 7 },
  );

  it("says a rule in one line", () => {
    expect(ruleWords(rule, new Map([[7, "Trial"]]))).toBe(
      'all of: plan is "pro", (any of: email opened at least 2 times in the last 30 days, no booking ever), not opted out of texts, in "Trial"',
    );
    expect(ruleWords(all({ kind: "trait", key: "plan", op: "exists" }))).toBe("plan is set");
  });

  it("lists conditions, segments read and data points used", () => {
    expect(conditionsOf(rule)).toHaveLength(5);
    expect(segmentsIn(rule)).toEqual([7]);
    expect(conditionsOf(rule).flatMap(dataOf)).toEqual([
      "trait:plan",
      "event:email_sent",
      "event:booking",
      "event:consent",
    ]);
  });

  it("orders live segments so a segment counts after those it reads", () => {
    const seg = (id: number, ...reads: number[]) => ({
      id,
      rule: all(...reads.map((s) => ({ kind: "segment", segment: s }) as Condition)),
    });
    expect(recomputeOrder([seg(1, 3), seg(2), seg(3, 2)])).toEqual([2, 3, 1]);
    // A segment it reads that isn't live (manual, archived) just isn't waited on.
    expect(recomputeOrder([seg(5, 9), seg(4)])).toEqual([5, 4]);
  });
});

describe("describeSegment (golden, stub model)", () => {
  const ctx: DescribeContext = {
    traits: ["plan", "renewal_date"],
    segments: [{ id: 3, name: "Trial" }],
    today: "2026-10-14",
  };
  /** A model that answers each prompt from a table, keyed by the words asked. */
  const stub = (answers: Record<string, string>): SegmentModel & { asked: string[] } => {
    const asked: string[] = [];
    return {
      asked,
      complete: async (prompt) => {
        asked.push(prompt);
        const words = /Describe these people as a rule: (.*)/.exec(prompt)?.[1] ?? "";
        return { text: answers[words] ?? "no idea" };
      },
    };
  };
  const golden = {
    "pro customers who opened an email this month": `Here you go:
\`\`\`json
{"rule":{"kind":"group","match":"all","of":[{"kind":"trait","key":"plan","op":"is","value":"pro"},{"kind":"message","state":"opened","channel":"email","atLeast":1,"days":30}]},"name":"Engaged pro"}
\`\`\``,
    "renewing in two weeks, not in trial": `{"rule":{"kind":"group","match":"all","of":[{"kind":"trait","key":"renewal_date","op":"in_next","value":14},{"kind":"segment","segment":3,"not":true}]},"name":"Renewing soon"}`,
    "people with a gold badge": `{"rule":{"kind":"group","match":"all","of":[{"kind":"trait","key":"badge","op":"is","value":"gold"}]},"name":"Gold"}`,
    "people who like pizza": `{"error":"No condition says what someone likes."}`,
    "in the vip segment": `{"rule":{"kind":"group","match":"all","of":[{"kind":"segment","segment":99}]},"name":"VIP"}`,
    "bad shape": `{"rule":{"kind":"group","match":"all","of":[{"kind":"trait","key":"plan","op":"gt","value":"x"}]}}`,
  };

  it("turns words into a checked rule, read back in words", async () => {
    const m = stub(golden);
    expect(await describeSegment(m, "pro customers who opened an email this month", ctx)).toEqual({
      rule: all(
        { kind: "trait", key: "plan", op: "is", value: "pro" },
        { kind: "message", state: "opened", channel: "email", atLeast: 1, days: 30 },
      ),
      name: "Engaged pro",
      words: 'all of: plan is "pro", email opened in the last 30 days',
      unknownTraits: [],
    });
    expect(await describeSegment(m, "renewing in two weeks, not in trial", ctx)).toMatchObject({
      name: "Renewing soon",
      words: 'all of: renewal_date falls in the next (days) 14, not in "Trial"',
    });
  });

  it("names a trait nobody has yet, and refuses what won't check", async () => {
    const m = stub(golden);
    expect(await describeSegment(m, "people with a gold badge", ctx)).toMatchObject({
      unknownTraits: ["badge"],
    });
    expect(await describeSegment(m, "people who like pizza", ctx)).toEqual({
      error: "No condition says what someone likes.",
    });
    expect(await describeSegment(m, "in the vip segment", ctx)).toEqual({
      error: "the model named no group we have (99)",
    });
    expect(await describeSegment(m, "bad shape", ctx)).toMatchObject({
      error: expect.stringMatching(/didn't check: "plan is more than" needs a number/),
    });
    expect(await describeSegment(m, "something else", ctx)).toEqual({
      error: "the model's answer didn't read; try other words",
    });
    expect(await describeSegment(m, "   ", ctx)).toEqual({ error: "say who should be in it" });
    // Blank words never reach the model.
    expect(m.asked).toHaveLength(5);
  });

  it("tells the model what the workspace has", () => {
    const p = describePrompt("anyone", ctx);
    expect(p).toMatch(/Trait keys in this workspace: plan, renewal_date\./);
    expect(p).toMatch(/Segments: 3 = Trial\./);
    expect(p).toMatch(/Today is 2026-10-14\./);
    expect(jsonIn('text {"a":1} more')).toEqual({ a: 1 });
    expect(jsonIn("nothing")).toBeNull();
  });
});

describe("segment triggers", () => {
  const node = (uses: string, w: Record<string, string | number>): WorkflowNode =>
    ({ id: "t", uses, with: w }) as WorkflowNode;

  it("hears a segment's entries, exits or both", () => {
    const n = node("trigger.segment", { segment: 4 });
    expect(triggerHears(n, { trigger: "trigger.segment", segment: 4, change: "entered" })).toBe(
      true,
    );
    expect(triggerHears(n, { trigger: "trigger.segment", segment: 4, change: "left" })).toBe(false);
    expect(triggerHears(n, { trigger: "trigger.segment", segment: 5, change: "entered" })).toBe(
      false,
    );
    const both = node("trigger.segment", { segment: 4, on: "any" });
    expect(triggerHears(both, { trigger: "trigger.segment", segment: 4, change: "left" })).toBe(
      true,
    );
  });

  it("hears a trait change, or a change to one value", () => {
    const any = node("trigger.trait", { trait: "plan" });
    const to = node("trigger.trait", { trait: "plan", to: "Pro" });
    const f = (value: string | null) => ({ trigger: "trigger.trait" as const, key: "plan", value });
    expect(triggerHears(any, f("basic"))).toBe(true);
    expect(triggerHears(to, f("basic"))).toBe(false);
    expect(triggerHears(to, f("pro"))).toBe(true);
    expect(triggerHears(any, { trigger: "trigger.trait", key: "seats", value: "3" })).toBe(false);
  });

  it("hears a date trigger by its trait, offset and repeat", () => {
    const n = node("trigger.date", { trait: "renewal_date", offset: -7, every: "once" });
    const f = {
      trigger: "trigger.date" as const,
      key: "renewal_date",
      offset: -7,
      every: "once" as const,
    };
    expect(triggerHears(n, f)).toBe(true);
    expect(triggerHears(n, { ...f, offset: 0 })).toBe(false);
    expect(triggerHears(n, { ...f, every: "yearly" })).toBe(false);
  });

  it("checks the settings", () => {
    const part = (id: string) => LOGIC.find((l) => l.id === id);
    expect(part("trigger.segment")).toBeDefined();
    expect(part("trigger.trait")).toBeDefined();
    expect(part("trigger.date")).toBeDefined();
    const problems = (uses: string, w: Record<string, string | number>) =>
      logicProblems("t", node(uses, w)).join("; ");
    expect(problems("trigger.segment", {})).toMatch(/group's number/);
    expect(problems("trigger.trait", { trait: "Not A Key" })).toMatch(/trait key/);
    expect(problems("trigger.date", { trait: "renewal_date", offset: 400 })).toMatch(/-365 to 365/);
    expect(problems("trigger.date", { trait: "renewal_date", offset: -7 })).toBe("");
    expect(problems("logic.segment", {})).toMatch(/group's number/);
    expect(problems("logic.segment", { segment: 3 })).toBe("");
  });

  it("reads what flows hear and which use each segment", () => {
    const flows = [
      {
        id: "w1",
        name: "Welcome trial",
        nodes: [
          node("trigger.segment", { segment: 2 }),
          node("trigger.trait", { trait: "plan" }),
          node("trigger.date", { trait: "renewal_date", offset: -7 }),
        ],
        edges: [],
      },
      { id: "w2", name: "Nudge", nodes: [node("trigger.segment", { segment: 2 })], edges: [] },
      { id: "w3", name: "Check", nodes: [node("logic.segment", { segment: 5 })], edges: [] },
    ] as unknown as Workflow[];
    expect(workflowUses(flows).get(5)).toEqual([{ kind: "workflow", id: "w3", name: "Check" }]);
    expect(workflowUses(flows).get(2)).toEqual([
      { kind: "workflow", id: "w1", name: "Welcome trial" },
      { kind: "workflow", id: "w2", name: "Nudge" },
    ]);
    const h = heard(flows);
    expect([...h.segments]).toEqual([2]);
    expect([...h.traits]).toEqual(["plan"]);
    expect(h.dates).toEqual([{ key: "renewal_date", offset: -7, every: "once" }]);
  });
});

describe("pickGroup", () => {
  const groups = [
    { id: 3, name: "Warm leads", kind: "live" as const },
    { id: 4, name: "Met at the fair", kind: "manual" as const },
    { id: 5, name: "Frozen", kind: "snapshot" as const },
  ];

  it("takes a manual group by id or by name in any case", () => {
    expect(pickGroup(groups, 4)).toEqual({ group: groups[1] });
    expect(pickGroup(groups, "4")).toEqual({ group: groups[1] });
    expect(pickGroup(groups, "  met  AT the fair ")).toEqual({ group: groups[1] });
  });

  it("makes a new manual group from a name that matches none", () => {
    expect(pickGroup(groups, "  Fair   follow-ups ")).toEqual({ make: "Fair follow-ups" });
  });

  it("refuses a live or snapshot group in words", () => {
    expect(() => pickGroup(groups, "warm leads")).toThrow(
      "Warm leads follows a rule: only manual groups take people by hand",
    );
    expect(() => pickGroup(groups, 5)).toThrow(/Frozen follows a rule/);
  });

  it("refuses an empty pick", () => {
    expect(() => pickGroup(groups, "  ")).toThrow("pick a group or type a new name");
    expect(() => pickGroup(groups, undefined)).toThrow(/pick a group/);
  });
});
