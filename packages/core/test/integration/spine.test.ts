/** The spine's store on Postgres: an arrival is kept once, owned by its call; waits release once. */
import { env } from "node:process";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineComponent } from "../../src/components.js";
import { consoleApi, executionSteps, workflowEffects } from "../../src/console.js";
import type { PortalRequest } from "../../src/portal.js";
import { events, hooks, workflowSaves } from "../../src/schema.js";
import { addHook, pgSpineStore, savedWorkflows } from "../../src/spine.js";
import { defineWorkflow } from "../../src/workflows.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const a = {
  workflow: "top",
  node: "x.a",
  port: "leads",
  event: { subject: "lead:1", kind: "lead" as const, data: { cut: "half \uD83D" } },
};

describe("pgSpineStore", () => {
  it("keeps an arrival once, gives it back to the call that owns it, and records a failure", async () => {
    const store = pgSpineStore(pg.db);
    const id = await store.claim(a, "inv1");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await store.claim(a, "inv1")).toBe(id);
    expect(await store.claim(a, "inv2")).toBeNull();
    await store.fail(a, "the model is down");
    const [row] = await pg.db
      .select()
      .from(events)
      .where(eq(events.id, id as string));
    expect(row).toMatchObject({ by: "inv1", error: "the model is down", data: { cut: "half " } });
    const listed = () =>
      pg.db.execute<{ state: string }>(sql`select state from spine_events where id = ${id}`);
    expect(await listed()).toEqual([{ state: "failed" }]);

    // Retry: one call takes it, its error cleared; nobody else, and only while it's failed.
    expect(await store.retry(id as string, "inv2")).toMatchObject({ node: "x.a", port: "leads" });
    expect(await store.retry(id as string, "inv2")).not.toBeNull();
    expect(await store.retry(id as string, "inv3")).toBeNull();
    const [after] = await pg.db
      .select()
      .from(events)
      .where(eq(events.id, id as string));
    expect(after).toMatchObject({ by: "inv2", error: null });
    expect(await listed()).toEqual([{ state: "passed" }]);
  });

  it("releases a waiting arrival to one call, and again to that call only", async () => {
    const store = pgSpineStore(pg.db);
    const w = { ...a, node: "out", port: "replied", version: 3 };
    const id = (await store.claim(w, "inv1", new Date(Date.now() + 60_000))) as string;
    expect(await store.release(id, "inv2")).toEqual({
      ...w,
      event: { ...w.event, data: { cut: "half " } },
      until: null,
    });
    expect(await store.release(id, "inv2")).not.toBeNull();
    expect(await store.release(id, "inv3")).toBeNull();
    expect(await store.claim(w, "inv2")).toBe(id);
  });
  it("keeps what a step sent on, and lists each subject's walk as one execution", async () => {
    const store = pgSpineStore(pg.db);
    const one = { ...a, workflow: "runs", node: "a", event: { ...a.event, subject: "lead:9" } };
    const first = (await store.claim(one, "inv1")) as string;
    await store.sent?.(first, [{ port: "replied", event: { ...one.event, kind: "reply" } }]);
    const two = { ...one, node: "b", port: "replies" };
    await store.claim(two, "inv1", new Date(Date.now() + 60_000));
    const [row] = await pg.db.select().from(events).where(eq(events.id, first));
    expect(row?.sent).toEqual([
      { port: "replied", subject: "lead:9", kind: "reply", data: { cut: "half " } },
    ]);
    expect(row?.sentAt).toBeInstanceOf(Date);
    const runs = await pg.db.execute<{ id: string; state: string; node: string; steps: number }>(
      sql`select id, state, node, steps from spine_executions where workflow = 'runs'`,
    );
    expect(runs).toEqual([{ id: "runs/lead:9", state: "waiting", node: "b", steps: 2 }]);
    const steps = await executionSteps(pg.db, "runs/lead:9");
    expect(steps.map((s) => [s.node, s.port, !!s.sent, !!s.due])).toEqual([
      ["a", "leads", true, false],
      ["b", "replies", false, true],
    ]);
    await store.fail(two, "it broke");
    const [failed] = await pg.db.execute<{ state: string; error: string }>(
      sql`select state, error from spine_executions where id = 'runs/lead:9'`,
    );
    expect(failed).toEqual({ state: "failed", error: "it broke" });
  });
});

describe("addHook", () => {
  it("keeps only the token's hash", async () => {
    const token = await addHook(pg.db, {
      name: "test form",
      client: null,
      workflow: "top",
      input: "leads",
      subject: "email",
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await pg.db.select().from(hooks);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);
  });
});

describe("workflow saves", () => {
  const hypothesis = { from: "a test", guesses: [{ is: "fixed" as const, says: "x" }] };
  const part = defineComponent({
    id: "a",
    name: "A",
    blurb: "a",
    icon: "mail",
    for: "client",
    stage: "reach",
    ready: true,
    hypothesis,
    inside: null,
    in: [{ id: "leads", label: "leads", kind: "lead" }],
    out: [{ id: "replied", label: "replies", kind: "reply" }],
  });
  const flow = defineWorkflow({
    id: "f",
    name: "F",
    blurb: "f",
    icon: "mail",
    for: "wren",
    stage: "reach",
    in: [{ id: "leads", label: "leads", kind: "lead" }],
    out: [{ id: "replied", label: "replies", kind: "reply" }],
    nodes: [{ id: "n", uses: "a" }],
    wires: [
      { from: "in.leads", to: "n.leads", via: "code" },
      { from: "n.replied", to: "out.replied", via: "events" },
    ],
  });
  const operator = { viewer: { email: "op@example.test", operator: true } } as PortalRequest;
  it("keeps a draft as it reads, publishes it checked, and lists each version", async () => {
    const api = consoleApi({ main: pg.db, views: [], components: [part], workflows: [flow] });
    const wait = { from: "n.replied", to: "out.replied", via: "events", wait: "2 days" };
    await expect(
      api.workflowSave({ ...operator, workflow: "nope", wires: [], steps: [] }),
    ).rejects.toThrow("no such workflow");
    await expect(
      api.workflowSave({ viewer: { email: "x@client.example" }, workflow: "f" } as never),
    ).rejects.toThrow("that's for Wren's team");
    await expect(api.workflowPublish({ ...operator, workflow: "f" })).rejects.toThrow(
      "there's no draft to publish",
    );
    // A draft that won't run is kept, with why; publishing it is refused.
    expect(await api.workflowSave({ ...operator, workflow: "f", wires: [], steps: [] })).toEqual({
      id: expect.any(Number),
      problems: ["f: out.replied gets nothing"],
    });
    await expect(api.workflowPublish({ ...operator, workflow: "f" })).rejects.toThrow(
      "f: out.replied gets nothing",
    );
    expect(await savedWorkflows(pg.db, null)).toEqual({});
    // A newer draft replaces it; Publish makes it live and drops the draft.
    await api.workflowSave({
      ...operator,
      workflow: "f",
      wires: [{ ...wait, label: "replies" }],
      steps: [],
    });
    expect(await pg.db.select().from(workflowSaves)).toHaveLength(1);
    const { id } = await api.workflowPublish({ ...operator, workflow: "f" });
    expect((await savedWorkflows(pg.db, null)).f).toMatchObject({
      id,
      edits: { wires: [wait], steps: [] },
      by: "op@example.test",
    });
    const got = await api.recordsGet({ ...operator, record: "console.component", id: "f" });
    const detail = got.detail as {
      workflow: { wires: unknown[] };
      broken: string[];
      draft: unknown;
      versions: { id: number }[];
      code: { wires: unknown[] };
    };
    expect(detail.workflow.wires).toMatchObject([flow.wires[0], wait]);
    expect(detail.broken).toEqual([]);
    expect(detail.draft).toBeNull();
    expect(detail.versions.map((v) => v.id)).toEqual([id]);
    expect(detail.code.wires).toEqual([flow.wires[1]]);

    // Back to built-in is a draft too; Discard drops it and the live one stays.
    await api.workflowSave({ ...operator, workflow: "f", reset: true });
    const open = await api.recordsGet({ ...operator, record: "console.component", id: "f" });
    expect(open.detail).toMatchObject({ draft: { edits: null, problems: [] } });
    expect(await api.workflowDiscard({ ...operator, workflow: "f" })).toEqual({ done: 1 });
    expect((await savedWorkflows(pg.db, null)).f?.id).toBe(id);
    await api.workflowSave({ ...operator, workflow: "f", reset: true });
    await api.workflowPublish({ ...operator, workflow: "f" });
    expect((await savedWorkflows(pg.db, null)).f?.edits).toBeNull();
    expect(await savedWorkflows(pg.db, "someone")).toEqual({});
    expect(await pg.db.select().from(workflowSaves)).toHaveLength(2);
  });

  it("asks a sending workflow's id typed back before it goes live", async () => {
    const sends = defineComponent({ ...part, id: "s", effects: ["sends"] });
    const loud = defineWorkflow({ ...flow, id: "loud", nodes: [{ id: "n", uses: "s" }] });
    const api = consoleApi({ main: pg.db, views: [], components: [sends], workflows: [loud] });
    await api.workflowSave({ ...operator, workflow: "loud", wires: [flow.wires[1]], steps: [] });
    await expect(api.workflowPublish({ ...operator, workflow: "loud" })).rejects.toThrow(
      "it sends: type loud to confirm",
    );
    await expect(
      api.workflowPublish({ ...operator, workflow: "loud", confirm: "loud" }),
    ).resolves.toMatchObject({ id: expect.any(Number) });
  });

  it("asks it too when a Send webhook node is the only thing that sends", async () => {
    const quiet = defineWorkflow({ ...flow, id: "posts" });
    const api = consoleApi({ main: pg.db, views: [], components: [part], workflows: [quiet] });
    expect(workflowEffects("posts", [quiet], [part])).toEqual([]);
    const post = {
      id: "post",
      uses: "logic.webhook",
      with: { url: "https://api.example.com/x", kind: "reply" },
    };
    await api.workflowSave({
      ...operator,
      workflow: "posts",
      wires: [
        { from: "n.replied", to: "post.in", via: "events" },
        { from: "post.answered", to: "out.replied", via: "events" },
      ],
      steps: [post],
    });
    await expect(api.workflowPublish({ ...operator, workflow: "posts" })).rejects.toThrow(
      "it sends: type posts to confirm",
    );
    await expect(
      api.workflowPublish({ ...operator, workflow: "posts", confirm: "posts" }),
    ).resolves.toMatchObject({ id: expect.any(Number) });
  });

  it("makes a Webhook node's door on publish, once, and keeps its URL", async () => {
    env.WREN_HOOK_KEY = "test-key-not-a-secret";
    const api = consoleApi({ main: pg.db, views: [], components: [part], workflows: [flow] });
    const door = {
      id: "door",
      uses: "trigger.hook",
      with: { subject: "email", kind: "lead", "map.phone": "contact.tel" },
    };
    const draft = {
      ...operator,
      workflow: "f",
      wires: [flow.wires[1], { from: "door.out", to: "n.leads", via: "events" }],
      steps: [door],
    };
    // The test reads a post the way the door would, by its field map; nothing is made.
    const tried = await api.workflowTest({
      ...draft,
      from: "door.out",
      data: { email: "sam@example.com", contact: { tel: "+15555550100" } },
    });
    expect(tried.entered?.data.lead).toMatchObject({
      email: "sam@example.com",
      phone: "+15555550100",
    });
    expect(await api.workflowDoors({ ...operator, workflow: "f" })).toEqual([]);

    await api.workflowSave(draft);
    const first = await api.workflowPublish({ ...operator, workflow: "f" });
    expect(first.doors).toEqual([
      { node: "door", id: expect.any(String), token: expect.stringMatching(/^[\w-]{43}$/) },
    ]);
    const made = first.doors?.[0] as { id: string; token: string };
    await api.workflowSave({
      ...draft,
      steps: [{ ...door, with: { ...door.with, subject: "phone" } }],
    });
    expect((await api.workflowPublish({ ...operator, workflow: "f" })).doors).toEqual([]);
    const [listed] = await api.workflowDoors({ ...operator, workflow: "f" });
    expect(listed).toMatchObject({ id: made.id, node: "door", subject: "phone", open: true });
    expect(listed?.masked).toBe(`${made.token.slice(0, 4)}${"•".repeat(10)}`);
    const [row] = await pg.db.select().from(hooks).where(eq(hooks.id, made.id));
    expect(row?.fields).toEqual({ phone: "contact.tel" });
    expect(JSON.stringify(row)).not.toContain(made.token);

    const ask = { ...operator, workflow: "f", id: made.id };
    expect(await api.doorReveal(ask)).toEqual({ token: made.token });
    const rotated = await api.doorRotate(ask);
    expect(rotated.token).not.toBe(made.token);
    expect(await api.doorReveal(ask)).toEqual(rotated);
    // Without the key a token is shown once: Show says to rotate.
    delete env.WREN_HOOK_KEY;
    await expect(api.doorReveal(ask)).rejects.toThrow("rotate it for a new one");
  });

  it("keeps the wiring each subject entered on", async () => {
    const store = pgSpineStore(pg.db);
    const at = { ...a, workflow: "pinned", event: { ...a.event, subject: "lead:p" } };
    expect(await store.entered?.("pinned", "lead:p")).toBeUndefined();
    await store.claim({ ...at, version: 7 }, "inv1");
    await store.claim({ ...at, node: "y", version: 9 }, "inv1");
    expect(await store.entered?.("pinned", "lead:p")).toBe(7);
    // A row from before versions walks the live wiring.
    await store.claim({ ...at, workflow: "legacy" }, "inv1");
    expect(await store.entered?.("legacy", "lead:p")).toBeNull();
  });
});

describe("made workflows (designs/2026-10-09-workflow-builder.md)", () => {
  const hypothesis = { from: "a test", guesses: [{ is: "fixed" as const, says: "x" }] };
  const part = defineComponent({
    id: "a",
    name: "A",
    blurb: "a",
    icon: "mail",
    for: "client",
    stage: "reach",
    ready: true,
    hypothesis,
    inside: null,
    in: [{ id: "leads", label: "leads", kind: "lead" }],
    out: [{ id: "replied", label: "replies", kind: "reply" }],
  });
  const operator = { viewer: { email: "op@example.test", operator: true } } as PortalRequest;
  const api = () => consoleApi({ main: pg.db, views: [], components: [part], workflows: [] });
  const steps = [
    { id: "door", uses: "trigger.hook", with: { kind: "lead", subject: "email" } },
    { id: "n", uses: "a" },
  ];
  const wires = [{ from: "door.out", to: "n.leads", via: "events" }];

  it("starts blank, keeps its name on each save, goes live, and is listed", async () => {
    const { workflow, ask } = await api().workflowBuild({ ...operator, name: "Leads in" });
    expect(workflow).toMatch(/^made\.leads_in_[0-9a-f]{4}$/);
    expect(ask).toBeNull();
    expect(await api().workflowsMade(operator)).toMatchObject([
      { id: workflow, made: { name: "Leads in", for: "wren" }, live: false, draft: true, nodes: 0 },
    ]);
    const saved = await api().workflowSave({
      ...operator,
      workflow,
      wires,
      steps,
      name: "Hook in",
    });
    expect(saved.problems).toEqual([]);
    await expect(api().workflowSave({ ...operator, workflow, reset: true })).rejects.toThrow(
      /no built-in/,
    );
    await api().workflowPublish({ ...operator, workflow });
    const live = await savedWorkflows(pg.db, null);
    expect(live[workflow]?.edits).toMatchObject({ made: { name: "Hook in" } });
    expect(await api().workflowsMade(operator)).toMatchObject([
      { id: workflow, made: { name: "Hook in" }, live: true, draft: false, nodes: 2 },
    ]);
    await expect(api().workflowDelete({ ...operator, workflow })).rejects.toThrow(/it's live/);
    await expect(api().workflowTemplateSave({ ...operator, workflow, name: "T" })).rejects.toThrow(
      /in development/,
    );
  });

  it("asks Claude to draw it from words, and deletes a draft", async () => {
    const { workflow, ask } = await api().workflowBuild({
      ...operator,
      message: "When a lead posts in, send it to A. Then stop.",
    });
    expect(workflow).toMatch(/^made\.when_a_lead_posts_in_[0-9a-f]{4}$/);
    const [run] = await pg.db.execute<{ argv: { question: string; id: string } }>(
      sql`select argv from runs where id = ${ask}`,
    );
    expect(run?.argv.id).toBe(`:${workflow}`);
    expect(run?.argv.question).toContain("This workflow is new and empty");
    expect(await api().workflowDelete({ ...operator, workflow })).toEqual({ done: 1 });
    await expect(api().workflowDelete({ ...operator, workflow })).rejects.toThrow(
      /no such workflow/,
    );
    await expect(api().workflowDelete({ ...operator, workflow: "f" })).rejects.toThrow();
  });

  it("refuses the demo and a name too long", async () => {
    await expect(
      api().workflowBuild({ viewer: { email: "demo@example.test", demo: true } } as never),
    ).rejects.toThrow();
    await expect(api().workflowBuild({ ...operator, name: "x".repeat(61) })).rejects.toThrow(
      /under 60/,
    );
  });
});
