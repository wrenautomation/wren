import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import { defineComponent } from "./components.js";
import { logicSteps } from "./logic.js";
import {
  type Arrival,
  aboutsOf,
  clockKey,
  clockOfKey,
  clocksOf,
  hearersOf,
  hookEvent,
  passOn,
  replyFired,
  resume,
  retry,
  type SpineEvent,
  type SpineStore,
  type Step,
  sentOf,
  slotEvent,
  type Walk,
  waitMs,
  walk,
} from "./spine.js";
import { cadenceWorkflow, defineWorkflow, type Workflow } from "./workflows.js";

const hypothesis = { from: "a test", guesses: [{ is: "fixed" as const, says: "x" }] };
const part = (id: string) =>
  defineComponent({
    id,
    name: id,
    blurb: id,
    icon: "mail",
    for: "client",
    stage: "reach",
    ready: true,
    hypothesis,
    in: [{ id: "leads", label: "leads", kind: "lead" }],
    out: [{ id: "replied", label: "replies", kind: "reply" }],
  });
const ports = {
  in: [{ id: "leads", label: "leads", kind: "lead" as const }],
  out: [{ id: "replied", label: "replies", kind: "reply" as const }],
};
const base = { blurb: "", icon: "mail", for: "client" as const, stage: "reach" as const, ...ports };
const FLOWS: Workflow[] = [
  defineWorkflow({
    ...base,
    id: "inner",
    name: "inner",
    nodes: [{ id: "a", uses: "answer" }],
    wires: [
      { from: "in.leads", to: "a.leads", via: "events" },
      { from: "a.replied", to: "out.replied", via: "events" },
    ],
  }),
  defineWorkflow({
    ...base,
    id: "top",
    name: "top",
    nodes: [
      { id: "x", uses: "inner" },
      { id: "vip", uses: "planned" },
      { id: "old", uses: "planned" },
    ],
    wires: [
      { from: "in.leads", to: "x.leads", via: "events" },
      { from: "in.leads", to: "vip.leads", via: "events", when: "only vips" },
      { from: "in.leads", to: "old.leads", via: "code" },
      { from: "x.replied", to: "out.replied", via: "events", wait: "2 days" },
    ],
  }),
  // A part whose inside is a workflow of touches, as Follow-up's is.
  defineWorkflow({
    ...base,
    id: "wrapper.inside",
    name: "wrapper inside",
    nodes: [{ id: "t", uses: "touch", template: { kind: "sms", system: "t", name: "w#1" } }],
    wires: [
      { from: "in.leads", to: "t.lead", via: "events" },
      { from: "t.replied", to: "out.replied", via: "events" },
    ],
  }),
  defineWorkflow({
    ...base,
    id: "top2",
    name: "top2",
    nodes: [{ id: "f", uses: "wrapper" }],
    wires: [
      { from: "in.leads", to: "f.leads", via: "events" },
      { from: "f.replied", to: "out.replied", via: "events" },
    ],
  }),
  cadenceWorkflow({
    name: "t",
    label: "t",
    blurb: "",
    for: "client",
    steps: [
      { touch: "touch", template: { kind: "sms", system: "t", name: "t#1" }, with: { step: 1 } },
      {
        touch: "touch",
        template: { kind: "sms", system: "t", name: "t#2" },
        with: { step: 2 },
        after: "2 days",
      },
    ],
  }),
];
const TOUCH = defineComponent({
  ...part("touch"),
  in: [{ id: "lead", label: "lead", kind: "lead" }],
  out: [
    { id: "sent", label: "sent", kind: "lead" },
    { id: "replied", label: "replies", kind: "reply" },
  ],
});

/** The Postgres store's rules: one row per arrival, owned by the call that kept it. */
function memStore() {
  const rows = new Map<
    string,
    {
      id: string;
      a: Arrival;
      by: string;
      due: Date | null;
      error?: string;
      sent?: Array<{ port: string; event: SpineEvent }>;
    }
  >();
  const key = (a: Arrival) => [a.workflow, a.node, a.port, a.event.subject].join("|");
  const store: SpineStore = {
    async claim(a, by, due) {
      const r = rows.get(key(a));
      if (!r) {
        const id = String(rows.size + 1);
        rows.set(key(a), { id, a, by, due: due ?? null });
        return id;
      }
      return r.by === by ? r.id : null;
    },
    async release(id, by) {
      const r = [...rows.values()].find((x) => x.id === id);
      if (!r || !(r.due || r.by === by)) return null;
      r.due = null;
      r.by = by;
      return r.a;
    },
    async fail(a, error) {
      const r = rows.get(key(a));
      if (r) r.error = error;
      return r?.id ?? null;
    },
    async retry(id, by) {
      const r = [...rows.values()].find((x) => x.id === id);
      if (!r || !(r.error !== undefined || r.by === by)) return null;
      delete r.error;
      r.by = by;
      return r.a;
    },
    async sent(id, outs) {
      const r = [...rows.values()].find((x) => x.id === id);
      if (r) r.sent = outs;
    },
  };
  return { store, rows };
}

const touched: unknown[] = [];
/** Queues its step (nothing leaves now: the sender sends `sent` later), or answers a reply. */
const touch: Step = async (_port, e, at) => {
  touched.push(at);
  return e.data.replied ? [{ port: "replied", event: { ...e, kind: "reply" } }] : [];
};
const lead = (n: string): SpineEvent => ({ subject: `lead:${n}`, kind: "lead", data: { n } });
let modelDown = true;
const answer: Step = async (_port, e) => {
  if (e.subject === "lead:bad" && modelDown) throw new Error("the model is down");
  return [{ port: "replied", event: { ...e, kind: "reply" } }];
};

function walkWith(store: SpineStore, by: string, rule = async () => false) {
  const later: Array<{ id: string; ms: number }> = [];
  const w: Walk = {
    flows: new Map(FLOWS.map((f) => [f.id, f])),
    parts: new Map(
      [
        part("answer"),
        part("planned"),
        TOUCH,
        { ...part("wrapper"), inside: "wrapper.inside" },
      ].map((c) => [c.id, c]),
    ),
    steps: { answer, touch },
    store,
    client: null,
    by,
    // A capped run gives up at once here, as ctx.run does after its retries.
    run: async (_name, fn, capped) => {
      try {
        return await fn();
      } catch (err) {
        if (capped) throw new restate.TerminalError((err as Error).message);
        throw err;
      }
    },
    later: (id, ms) => later.push({ id, ms }),
    rule,
  };
  return { w, later };
}

describe("walk", () => {
  it("walks into a nested workflow, runs its step, and waits on a timed wire", async () => {
    const { store, rows } = memStore();
    const { w, later } = walkWith(store, "inv1");
    expect(await walk(w, "top", "in.leads", [lead("1")])).toEqual({
      arrived: 1,
      seen: 0,
      waiting: 1,
      failed: 0,
      out: 0,
    });
    expect([...rows.values()].map((r) => [r.a.node, r.a.port, r.a.event.kind, !!r.due])).toEqual([
      ["x.a", "leads", "lead", false],
      ["out", "replied", "reply", true],
    ]);
    expect(later).toEqual([{ id: "2", ms: 2 * 86_400_000 }]);

    const done = walkWith(store, "inv2");
    expect(await resume(done.w, "2")).toMatchObject({ out: 1 });
    expect(await resume(walkWith(store, "inv3").w, "2")).toBeNull();
  });

  it("keeps what each step sent on, for its execution", async () => {
    const { store, rows } = memStore();
    await walk(walkWith(store, "inv1").w, "top", "in.leads", [lead("1")]);
    const step = [...rows.values()].find((r) => r.a.node === "x.a");
    expect(step?.sent).toEqual([
      { port: "replied", event: { subject: "lead:1", kind: "reply", data: { n: "1" } } },
    ]);
  });

  it("cuts a step's outputs that are too big to keep", () => {
    const big = { subject: "lead:1", kind: "lead" as const, data: { x: "y".repeat(40_000) } };
    expect(sentOf([{ port: "a", event: big }])).toEqual([
      { port: "a", subject: "lead:1", kind: "lead", data: { cut: "too big to keep" } },
    ]);
    expect(sentOf([{ port: "a", event: lead("2") }])[0]?.data).toEqual({ n: "2" });
    const follow = { part: "nurture", did: "queued" };
    expect(
      sentOf([{ port: "a", event: { ...big, data: { ...big.data, follow } } }])[0]?.data,
    ).toEqual({ cut: "too big to keep", follow });
  });

  it("lets nothing enter twice, but a retry of the same call steps again", async () => {
    const { store } = memStore();
    await walk(walkWith(store, "inv1").w, "top", "in.leads", [lead("1")]);
    expect(await walk(walkWith(store, "inv2").w, "top", "in.leads", [lead("1")])).toMatchObject({
      arrived: 0,
      seen: 1,
    });
    expect(await walk(walkWith(store, "inv1").w, "top", "in.leads", [lead("1")])).toMatchObject({
      arrived: 1,
      waiting: 1,
    });
  });

  it("passes a rule's wire only when the rule holds, and never walks a code wire", async () => {
    const { store, rows } = memStore();
    const { w } = walkWith(store, "inv1", async () => true);
    await walk(w, "top", "in.leads", [lead("1")]);
    expect([...rows.values()].map((r) => r.a.node).sort()).toEqual(["out", "vip", "x.a"]);
  });

  it("stops a failing step's event with why, and walks the rest", async () => {
    const { store, rows } = memStore();
    const { w } = walkWith(store, "inv1");
    expect(await walk(w, "top", "in.leads", [lead("bad"), lead("2")])).toMatchObject({
      arrived: 1,
      failed: 1,
      waiting: 1,
    });
    const bad = [...rows.values()].find((r) => r.a.event.subject === "lead:bad");
    expect(bad?.error).toBe("the model is down");

    // The model's back: Retry runs that step again, once, for the call that took it.
    modelDown = false;
    const again = walkWith(store, "inv2").w;
    expect(await retry(again, bad?.id as string)).toMatchObject({ arrived: 1, failed: 0 });
    expect(bad?.error).toBeUndefined();
    expect(await retry(walkWith(store, "inv3").w, bad?.id as string)).toBeNull();
    modelDown = true;
  });

  it("hands each failed step to auto-retry, by its id and top workflow", async () => {
    const { store, rows } = memStore();
    const { w } = walkWith(store, "auto1");
    const failed: Array<[string, string]> = [];
    w.failed = (id, workflow) => failed.push([id, workflow]);
    await walk(w, "top", "in.leads", [lead("bad"), lead("3")]);
    const bad = [...rows.values()].find((r) => r.a.event.subject === "lead:bad");
    expect(failed).toEqual([[bad?.id, "top"]]);
  });

  it("tells a step inside a part which part it runs in, and its node's copy", async () => {
    const { store } = memStore();
    await walk(walkWith(store, "p1").w, "top2", "in.leads", [lead("p")]);
    expect(touched.at(-1)).toEqual({
      client: null,
      workflow: "top2",
      node: "f.t",
      with: {},
      template: { kind: "sms", system: "t", name: "w#1" },
      part: "wrapper",
    });
    touched.length = 0;
  });

  it("runs a cadence: each touch gets its node, the next waits on the sender's sent", async () => {
    const { store } = memStore();
    const { w, later } = walkWith(store, "c1");
    const at = (step: number) => ({
      client: null,
      workflow: "follow_up.t",
      node: `s${step}`,
      with: { step },
      // Each touch's own copy, and no part around it: a cadence is a workflow of its own.
      template: { kind: "sms", system: "t", name: `t#${step}` },
      part: null,
    });
    expect(await walk(w, "follow_up.t", "in.leads", [lead("1")])).toMatchObject({ arrived: 1 });
    expect(touched).toEqual([at(1)]);
    expect(await walk(w, "follow_up.t", "s1.sent", [lead("1")])).toMatchObject({ waiting: 1 });
    expect(later).toEqual([{ id: expect.any(String), ms: 2 * 86_400_000 }]);
    expect(await resume(w, later[0]?.id as string)).toMatchObject({ arrived: 1 });
    expect(touched).toEqual([at(1), at(2)]);
    expect(await walk(w, "follow_up.t", "s2.sent", [lead("1")])).toMatchObject({ out: 1 });

    const replied = { ...lead("2"), data: { replied: true } };
    await walk(w, "follow_up.t", "s1.sent", [replied]);
    expect(await resume(w, later[1]?.id as string)).toMatchObject({ arrived: 1, out: 1 });
  });

  it("keeps a subject on the wiring it entered on; a new one takes the live wiring", async () => {
    const { store, rows } = memStore();
    store.entered = async (workflow, subject) => {
      const r = [...rows.values()].find(
        (x) => x.a.workflow === workflow && x.a.event.subject === subject,
      );
      return r ? (r.a.version ?? null) : undefined;
    };
    let live = 1;
    const asked: number[] = [];
    const pin = (w: Walk): Walk => ({
      ...w,
      liveOf: () => live,
      flowsAt: async (_workflow, v) => {
        asked.push(v);
        return w.flows;
      },
    });
    await walk(pin(walkWith(store, "i1").w), "top", "in.leads", [lead("1")]);
    // Version 2 goes live: lead 1 stays on 1, lead 2 enters on 2.
    live = 2;
    await walk(pin(walkWith(store, "i2").w), "top", "in.leads", [lead("2"), lead("1")]);
    expect(await resume(pin(walkWith(store, "i3").w), "2")).toMatchObject({ out: 1 });
    const on = (s: string) =>
      [...rows.values()].filter((r) => r.a.event.subject === s).map((r) => r.a.version);
    expect(on("lead:1")).toEqual([1, 1]);
    expect(on("lead:2")).toEqual([2, 2]);
    expect(asked).toEqual([1, 1]);
  });

  it("knows timed waits; a wire never waits until an event", () => {
    expect(waitMs("2 minutes")).toBe(120_000);
    expect(waitMs("1 week")).toBe(604_800_000);
    expect(() => waitMs("until reply")).toThrow("isn't built yet");
  });
});

describe("passOn", () => {
  it("passes another channel's lead on as sent, and leaves a touch its own", () => {
    const email: SpineEvent = { subject: "lead:email:7", kind: "lead", data: { enrollmentId: 7 } };
    expect(passOn(email, "sms")).toEqual([{ port: "sent", event: email }]);
    // A DM contact's id is no text contact's: same data key, other channel.
    const dm: SpineEvent = { subject: "lead:reach:7", kind: "lead", data: { contactId: 7 } };
    expect(passOn(dm, "sms")).toEqual([{ port: "sent", event: dm }]);
    expect(passOn(email, "email")).toBeNull();
  });
});

describe("hookEvent", () => {
  const flows = new Map(FLOWS.map((f) => [f.id, f]));
  const h = { workflow: "top", input: "leads", subject: "contact.email" };

  it("turns a payload into its input's event, about the named field", () => {
    expect(hookEvent(h, flows, { contact: { email: " jane@example.com " } })).toEqual({
      from: "in.leads",
      event: {
        subject: "lead:jane@example.com",
        kind: "lead",
        data: { contact: { email: " jane@example.com " } },
      },
    });
  });

  it("answers why when it can't", () => {
    expect(hookEvent({ ...h, input: "gone" }, flows, {})).toMatchObject({ status: 410 });
    expect(hookEvent(h, flows, { contact: {} })).toMatchObject({ status: 422 });
    expect(hookEvent(h, flows, { contact: { email: "x" }, pad: "y".repeat(70_000) })).toMatchObject(
      {
        status: 413,
      },
    );
  });
});

describe("logic nodes", () => {
  const flow = defineWorkflow({
    ...base,
    id: "logic",
    name: "logic",
    nodes: [
      { id: "door", uses: "trigger.hook", with: { subject: "email", kind: "lead" } },
      { id: "vip", uses: "logic.if", with: { when: "a vip" } },
      { id: "hold", uses: "logic.wait", with: { for: "3 hours" } },
      { id: "join", uses: "logic.merge" },
      { id: "ab", uses: "logic.split", with: { a: 50 } },
    ],
    wires: [
      { from: "door.out", to: "vip.in", via: "events" },
      { from: "in.leads", to: "vip.in", via: "events" },
      { from: "vip.yes", to: "hold.in", via: "events" },
      { from: "vip.no", to: "join.a", via: "events" },
      { from: "hold.out", to: "join.b", via: "events" },
      { from: "join.out", to: "ab.in", via: "events" },
      { from: "ab.a", to: "out.replied", via: "events" },
      { from: "ab.b", to: "out.replied", via: "events" },
    ],
  });
  const logicWalk = (store: SpineStore, by: string, vip: boolean) => {
    const rule = async () => vip;
    const got = walkWith(store, by, rule);
    got.w = {
      ...got.w,
      flows: new Map([[flow.id, flow]]),
      steps: { ...logicSteps(rule), answer, touch },
    };
    return got;
  };

  it("sends by a rule, holds after a Wait, and a Merge passes a subject once", async () => {
    const { store, rows } = memStore();
    const no = logicWalk(store, "inv1", false);
    expect(await walk(no.w, "logic", "in.leads", [lead("1")])).toMatchObject({ out: 1 });
    const yes = logicWalk(store, "inv2", true);
    expect(await walk(yes.w, "logic", "in.leads", [lead("2")])).toMatchObject({ waiting: 1 });
    expect(yes.later).toEqual([{ id: expect.any(String), ms: 3 * 3_600_000 }]);
    const held = [...rows.values()].find((r) => r.due) as { id: string };
    expect(await resume(logicWalk(store, "inv3", true).w, held.id)).toMatchObject({ out: 1 });
    // Lead 2 again by the other side of the Merge: it passed there once already.
    const again = logicWalk(store, "inv4", false);
    expect(await walk(again.w, "logic", "vip.no", [lead("2")])).toMatchObject({ seen: 1, out: 0 });
    expect([...rows.values()].filter((r) => r.a.node === "join").map((r) => r.a.port)).toEqual([
      "in",
      "in",
    ]);
  });

  it("enters at a Webhook node", () => {
    const flows = new Map([[flow.id, flow]]);
    expect(
      hookEvent({ workflow: "logic", input: "door", subject: "email" }, flows, { email: "a@b.co" }),
    ).toEqual({
      from: "door.out",
      event: { subject: "lead:a@b.co", kind: "lead", data: { email: "a@b.co" } },
    });
    expect(
      hookEvent({ workflow: "logic", input: "vip", subject: "email" }, flows, { email: "a@b.co" }),
    ).toMatchObject({ status: 410 });
  });
});

describe("a Wait until an event", () => {
  const out = (id: string) => ({ id, label: id, kind: "lead" as const });
  const flow = defineWorkflow({
    ...base,
    id: "until",
    name: "until",
    out: [out("heard"), out("quiet")],
    nodes: [
      { id: "hold", uses: "logic.wait", with: { mode: "until", until: "reply", most: "3 days" } },
    ],
    wires: [
      { from: "in.leads", to: "hold.in", via: "events" },
      { from: "hold.out", to: "out.heard", via: "events" },
      { from: "hold.timeout", to: "out.quiet", via: "events" },
    ],
  });
  const untilWalk = (store: SpineStore, by: string) => {
    const got = walkWith(store, by);
    got.w = { ...got.w, flows: new Map([[flow.id, flow]]) };
    return got;
  };
  const textLead = (n: number): SpineEvent => ({
    subject: `lead:sms:${n}`,
    kind: "lead",
    data: { contactId: n },
  });

  it("holds a subject at the node until its event, else its most, and lets it go once", async () => {
    const { store, rows } = memStore();
    const first = untilWalk(store, "inv1");
    expect(await walk(first.w, "until", "in.leads", [textLead(1), textLead(2)])).toMatchObject({
      waiting: 2,
    });
    expect(first.later.map((l) => l.ms)).toEqual([259_200_000, 259_200_000]);
    const [one, two] = [...rows.values()];
    expect(one?.a).toMatchObject({ node: "hold", port: "in", until: "reply" });

    // A reply about lead 1's thread: it leaves by `out`, carrying what happened.
    const reply = replyFired(null, "sms", 1);
    expect(aboutsOf(reply)).toEqual(["sms:1"]);
    expect(await resume(untilWalk(store, "inv2").w, one?.id as string, reply.event)).toMatchObject({
      out: 1,
    });
    expect(one?.sent?.[0]).toMatchObject({
      port: "out",
      event: { subject: "lead:sms:1", data: { happened: { subject: "reply:sms:1" } } },
    });
    // Its most comes later and finds it gone.
    expect(await resume(untilWalk(store, "inv3").w, one?.id as string)).toBeNull();

    // Lead 2 hears nothing: time runs out, it leaves by `timeout`, and a late reply does nothing.
    expect(await resume(untilWalk(store, "inv4").w, two?.id as string)).toMatchObject({ out: 1 });
    expect(two?.sent?.[0]?.port).toBe("timeout");
    const late = replyFired(null, "sms", 2).event;
    expect(await resume(untilWalk(store, "inv5").w, two?.id as string, late)).toBeNull();
    expect([...rows.values()].filter((r) => r.a.node === "out").map((r) => r.a.port)).toEqual([
      "heard",
      "quiet",
    ]);
  });

  it("finds a booking by the call, its email thread and who booked", () => {
    expect(
      aboutsOf({
        event: { subject: "call:5:2026-10-09T15:00:00.000Z", kind: "call", data: {} },
        about: ["email:12", "Sam@Example.com"],
      }),
    ).toEqual(["5:2026-10-09t15:00:00.000z", "email:12", "sam@example.com"]);
  });
});

describe("fired triggers", () => {
  const flow = defineWorkflow({
    ...base,
    id: "heard",
    name: "heard",
    nodes: [
      { id: "texts", uses: "trigger.reply", with: { channel: "sms" } },
      { id: "any", uses: "trigger.reply", with: { channel: "any" } },
      { id: "booked", uses: "trigger.booking", with: { on: "booked" } },
      { id: "daily", uses: "trigger.schedule", with: { every: "day", at: "09:00" } },
    ],
    wires: [],
  });

  it("send a reply to each node that hears it, about the thread", () => {
    const fired = replyFired("acme", "dm", 7);
    expect(fired.event).toEqual({
      subject: "reply:reach:7",
      kind: "reply",
      data: { channel: "dm", contactId: 7 },
    });
    expect(hearersOf([flow], fired.facts)).toEqual([{ workflow: "heard", from: "any.out" }]);
    expect(hearersOf([flow], replyFired(null, "sms", 1).facts).map((h) => h.from)).toEqual([
      "texts.out",
      "any.out",
    ]);
    expect(replyFired(null, "email", 3).event.data).toEqual({ channel: "email", enrollmentId: 3 });
  });

  it("keep one clock per Schedule node, and a slot enters once", () => {
    expect(clocksOf("acme", flow)).toEqual([{ service: "SpineClock", key: "acme|heard|daily" }]);
    expect(clockOfKey("acme|heard|daily")).toEqual({
      client: "acme",
      workflow: "heard",
      node: "daily",
    });
    expect(clockOfKey(clockKey(null, "heard", "daily"))).toMatchObject({ client: null });
    expect(clockOfKey("x|y")).toBeNull();
    expect(slotEvent("daily", new Date("2026-10-08T13:00:00Z")).subject).toBe(
      "item:schedule:daily@2026-10-08T13:00:00.000Z",
    );
  });
});
