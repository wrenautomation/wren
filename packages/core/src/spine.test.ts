import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import { defineComponent } from "./components.js";
import {
  type Arrival,
  hookEvent,
  resume,
  retry,
  type SpineEvent,
  type SpineStore,
  type Step,
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
  cadenceWorkflow({
    name: "t",
    label: "t",
    blurb: "",
    for: "client",
    steps: [
      { touch: "touch", with: { step: 1 } },
      { touch: "touch", with: { step: 2 }, after: "2 days" },
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
    { id: string; a: Arrival; by: string; due: Date | null; error?: string }
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
    },
    async retry(id, by) {
      const r = [...rows.values()].find((x) => x.id === id);
      if (!r || !(r.error !== undefined || r.by === by)) return null;
      delete r.error;
      r.by = by;
      return r.a;
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
    parts: new Map([part("answer"), part("planned"), TOUCH].map((c) => [c.id, c])),
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

  it("runs a cadence: each touch gets its node, the next waits on the sender's sent", async () => {
    const { store } = memStore();
    const { w, later } = walkWith(store, "c1");
    const at = (step: number) => ({
      client: null,
      workflow: "follow_up.t",
      node: `s${step}`,
      with: { step },
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

  it("knows timed waits and refuses until waits", () => {
    expect(waitMs("2 minutes")).toBe(120_000);
    expect(waitMs("1 week")).toBe(604_800_000);
    expect(() => waitMs("until reply")).toThrow("isn't built yet");
  });
});

describe("hookEvent", () => {
  const flows = new Map(FLOWS.map((f) => [f.id, f]));
  const h = { workflow: "top", input: "leads", subject: "contact.email" };

  it("turns a payload into its input's event, about the named field", () => {
    expect(hookEvent(h, flows, { contact: { email: " jane@example.com " } })).toEqual({
      port: "leads",
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
