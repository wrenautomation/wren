/**
 * Workflows from the canvas: a draft saved, published, switched, discarded or deleted, its
 * doors, a live one kept as a template, the builder and Ask on the graph, and the dry test.
 */
import { randomUUID } from "node:crypto";
import { atomic, type Tx } from "@wren/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { WREN } from "../../access.js";
import { type Component, EVENT_KINDS, type LoopKey, type Port } from "../../components.js";
import { leadOf } from "../../door.js";
import { type Door, doorsFor, ensureDoors, revealDoor, rotateDoor } from "../../doors.js";
import { type DryResult, dryStep, dryWalk, sampleEvent } from "../../dry.js";
import { ASK_COMMAND, ASK_MESSAGE_MAX } from "../../edits.js";
import {
  clocksOf,
  dropMade,
  type ExecutorEvent,
  hookEvent,
  lockWorkflowSaves,
  MadeLive,
  type MadeWorkflow,
  madeWorkflows,
  savedWorkflows,
  workflowHistory,
} from "../../executor.js";
import { doorOf, UNTILS } from "../../logic.js";
import {
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  type SignedViewer,
  teamCan,
} from "../../portal.js";
import { staleRefusal } from "../../refusal.js";
import { openRun } from "../../runs.js";
import { runs, workflowSaves } from "../../schema.js";
import { askTemplate, installOnWorkflow } from "../../template-install.js";
import { patchOf, WORKFLOW_ASK, workflowAskPrompt } from "../../workflow-ask.js";
import { deleteWorkflowTemplate, saveWorkflowTemplate } from "../../workflow-templates.js";
import {
  effectsIn,
  flowsWith,
  isMade,
  type Made,
  madeBase,
  madeIdOf,
  portsOf,
  type Workflow,
  type WorkflowEdits,
  withEdits,
} from "../../workflows.js";
import type { ConsoleContext } from "./context.js";
import type { DoorRequest, WorkflowSaveRequest, WorkflowTestRequest } from "./requests.js";

/** The editor's base, checked against the newest save under the lock. */
async function checkWorkflowBase(
  tx: Tx,
  client: string | null,
  workflow: string,
  expect: unknown,
): Promise<void> {
  const newest = await lockWorkflowSaves(tx, client, workflow);
  if (expect === undefined || expect === null) return;
  if (typeof expect !== "number" || !Number.isInteger(expect))
    throw new PortalRefusal("expect is a save's number", 400, "expect");
  if (newest !== expect) throw staleRefusal("workflow");
}

/**
 * What a workflow does outside Wren once live: every effect of its parts and logic nodes, nested
 * ones too. Publishing one with any is William's yes (designs/2026-10-06-workflow-editor.md).
 */
export function workflowEffects(
  id: string,
  flows: readonly Workflow[],
  components: readonly Component[],
): string[] {
  return effectsIn(id, flows, components);
}

const NAME = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "is no id")
  .max(40);

const PORT = z.object({
  id: NAME,
  label: z.string().trim().min(1).max(60),
  kind: z.enum(Object.keys(EVENT_KINDS) as [string, ...string[]]),
});

/** A setting's most characters: a Send webhook's body and headers run long. */
const SETTING_MAX = 2000;

/** What the canvas sends; unknown fields (a drawn wire's label and count) are dropped. */
const EDITS = z.object({
  wires: z
    .array(
      z.object({
        from: z.string().max(200),
        to: z.string().max(200),
        via: z.enum(["code", "events"]),
        when: z.string().trim().min(1).max(300).optional(),
        wait: z.string().trim().min(1).max(40).optional(),
      }),
    )
    .max(200),
  steps: z
    .array(
      z
        .object({
          id: NAME,
          note: z.string().trim().max(200).optional(),
          /** A logic node, a trigger, or a part or workflow from the catalog. */
          uses: z.string().max(80).optional(),
          with: z
            .record(z.string().max(40), z.union([z.string().max(SETTING_MAX), z.number()]))
            .refine((w) => Object.keys(w).length <= 12, "has too many settings")
            .optional(),
          own: z
            .object({
              name: z.string().trim().min(1).max(60),
              blurb: z.string().trim().max(200),
              icon: z.string().max(40),
              in: z.array(PORT).max(8),
              out: z.array(PORT).max(8),
              run: z.string().max(500),
            })
            .optional(),
        })
        .refine((s) => !s.uses !== !s.own, "is a custom step or uses one thing"),
    )
    .max(40),
  settings: z
    .record(
      NAME,
      z
        .record(z.string().max(40), z.union([z.string().max(SETTING_MAX), z.number()]))
        .refine((w) => Object.keys(w).length <= 12, "has too many settings"),
    )
    .refine((s) => Object.keys(s).length <= 40, "has too many nodes")
    .optional(),
  /** Auto-retry: a failed step tries again on its own, 0 (off) to 5 times. */
  retry: z.number().int().min(0).max(5).optional(),
});

/** A made workflow's name, as the builder or the name field gives it. */
const MADE_NAME = z.string().trim().min(1).max(60);

/** What the builder is asked, at most. */
const BUILD_MAX = 1000;

export function workflowsHandlers(ctx: ConsoleContext) {
  const { main, components, workflows, soldNow, team, teamWriter } = ctx;
  /** The workflow a canvas call names, for Wren or a client it may write, and who's asking. */
  const workflowFor = async (req: WorkflowSaveRequest) => {
    team(req);
    if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
    // No client is Wren's own, as the catalog reads it.
    const client = req.client ? (await pickForWrite(main, req)).client.id : null;
    const w = await workflowOf(req.workflow, client);
    if (!w) throw new PortalRefusal("no such workflow", 404);
    if (client && w.for === "wren") throw new PortalRefusal("that runs Wren's own business", 409);
    return { w, client, by: (req.viewer as SignedViewer).email };
  };
  /**
   * A workflow by id: the code's, else one made in the portal for this owner, as its newest save
   * names it (designs/2026-10-09-workflow-builder.md).
   */
  const workflowOf = async (id: unknown, client: string | null) => {
    if (typeof id !== "string") return undefined;
    const w = workflows.find((x) => x.id === id);
    if (w || !isMade(id)) return w;
    const m = (await madeWorkflows(main, client)).find((x) => x.id === id);
    return m ? madeBase(id, m.made) : undefined;
  };
  /**
   * The run row holding an ask on `w`'s draft, for `Ask/edit` to answer with the next draft. A
   * made workflow with nothing in it is asked to start from a trigger.
   */
  const askGraph = async (
    w: Workflow,
    client: string | null,
    by: string,
    draft: WorkflowEdits,
    message: string,
  ): Promise<string> => {
    const flows = workflows.filter(
      (x) => x.id !== w.id && (w.for === "wren" || x.for === "client"),
    );
    const prompt = workflowAskPrompt({
      w: withEdits(w, draft),
      draft,
      parts: components.filter((c) => !c.planned && (w.for === "wren" || c.for === "client")),
      flows,
      message,
    });
    const argv = { record: WORKFLOW_ASK, id: `${client ?? ""}:${w.id}`, by, message, ...prompt };
    return (await openRun(main, { command: ASK_COMMAND, argv, model: "claude-code:sonnet" })).id;
  };
  /** A made workflow's name on its saves; nothing for the code's. */
  const madeOf = (w: Workflow): { made?: Made } =>
    isMade(w.id) ? { made: { name: w.name, blurb: w.blurb, for: w.for } } : {};
  return {
    /**
     * A workflow's draft from the canvas, for Wren or a client: kept as it reads, whether or not
     * it would run, with what won't. It runs nowhere until Publish. A client gets only workflows
     * for clients.
     */
    async workflowSave(req: WorkflowSaveRequest): Promise<{ id: number; problems: string[] }> {
      const { w, client, by } = await workflowFor(req);
      if (req.reset && isMade(w.id))
        throw new PortalRefusal("a made workflow has no built-in", 400);
      let edits: WorkflowEdits | null = null;
      if (!req.reset) {
        const got = EDITS.safeParse({
          wires: req.wires,
          steps: req.steps,
          settings: req.settings,
          retry: req.retry,
        });
        if (!got.success) {
          const i = got.error.issues[0];
          throw new PortalRefusal(`that doesn't read: ${i?.path.join(".")} ${i?.message}`, 400);
        }
        edits = got.data as WorkflowEdits;
        if (isMade(w.id)) {
          const named = req.name === undefined ? null : MADE_NAME.safeParse(req.name);
          if (named && !named.success) throw new PortalRefusal("give it a name under 60", 400);
          const m = madeOf(w).made as Made;
          edits = { ...edits, made: named ? { ...m, name: named.data } : m };
        }
      }
      const problems = edits
        ? (flowsWith(workflows, { [w.id]: edits }, components).broken[w.id] ?? [])
        : [];
      const id = await atomic(main, async (tx) => {
        await checkWorkflowBase(tx, client, w.id, req.expect);
        // One draft at a time: the newer one replaces it.
        await tx.execute(sql`DELETE FROM workflow_saves WHERE NOT live AND workflow = ${w.id}
          AND client IS NOT DISTINCT FROM ${client}`);
        const [row] = await tx
          .insert(workflowSaves)
          .values({ client, workflow: w.id, edits, live: false, by })
          .returning({ id: workflowSaves.id });
        return row?.id ?? 0;
      });
      return { id, problems };
    },
    /**
     * Publish: the draft goes live, checked as the executor would run it. A workflow with a part that
     * sends needs `effect`, one that spends `money`, and either needs its id typed back. Subjects
     * already in it keep the wiring they entered on.
     */
    async workflowPublish(req: WorkflowSaveRequest): Promise<{
      id: number;
      asked?: string;
      doors?: Array<{ node: string; id: string; token: string }>;
      /** Its Schedule nodes' clocks, which the handler starts. */
      start?: LoopKey[];
    }> {
      const { w, client, by } = await workflowFor(req);
      // A client's template: publishing asks in To approve; a person's yes makes it live.
      const row = client ? await installOnWorkflow(main, client, w.id) : null;
      const t = row ? (await soldNow()).find((x) => x.id === row.template) : undefined;
      if (t && client && row) {
        const asked = await askTemplate(main, t, { client, by });
        return { id: 0, asked: asked.id };
      }
      // The draft read under the lock, so a save landing meanwhile is never published stale.
      return atomic(main, async (tx) => {
        await checkWorkflowBase(tx, client, w.id, req.expect);
        const { draft } = await workflowHistory(tx, client, w.id);
        if (!draft) throw new PortalRefusal("there's no draft to publish", 409);
        const next = flowsWith(workflows, draft.edits ? { [w.id]: draft.edits } : {}, components);
        const bad = next.broken[w.id];
        if (bad) throw new PortalRefusal(bad.join("; "), 400);
        const effects = workflowEffects(w.id, next.flows, components);
        if (effects.some((e) => e !== "spends") && !teamCan(req, "effect", WREN))
          throw new PortalRefusal("it sends: only an admin can make it live", 403);
        if (effects.includes("spends") && !teamCan(req, "money", WREN))
          throw new PortalRefusal("it spends: only an admin can make it live", 403);
        if (effects.length && req.confirm !== w.id)
          throw new PortalRefusal(`it ${effects.join(" and ")}: type ${w.id} to confirm`, 400);
        // Publishing keeps the switch where it was: an off workflow stays off.
        const wasOff = (await savedWorkflows(tx, client))[w.id]?.edits?.off === true;
        const edits = wasOff && draft.edits ? { ...draft.edits, off: true } : draft.edits;
        const [row] = await tx
          .insert(workflowSaves)
          .values({ client, workflow: w.id, edits, live: true, by })
          .returning({ id: workflowSaves.id });
        await tx.execute(sql`DELETE FROM workflow_saves WHERE NOT live AND workflow = ${w.id}
          AND client IS NOT DISTINCT FROM ${client}`);
        // Each Webhook or Form node's door, made once and kept across publishes.
        const flow = next.flows.find((f) => f.id === w.id) as Workflow;
        const made = await ensureDoors(tx, { client, flow, open: true });
        return { id: row?.id ?? 0, doors: made, start: wasOff ? [] : clocksOf(client, flow) };
      });
    },
    /**
     * A made workflow on or off (designs/2026-10-14-automations.md): a new live save of the same
     * graph with `off` set or cleared. Off, its triggers hear nothing, its doors shut and its
     * clocks stop; subjects already inside finish. On needs what Publish needs, bar the typed id.
     */
    async workflowSwitch(req: WorkflowSaveRequest & { on?: unknown }): Promise<{
      id: number;
      on: boolean;
      start: LoopKey[];
      stop: LoopKey[];
    }> {
      const { w, client, by } = await workflowFor(req);
      if (typeof req.on !== "boolean") throw new PortalRefusal("say on or off", 400);
      const on = req.on;
      if (!isMade(w.id))
        throw new PortalRefusal("a built-in workflow runs by its loops: switch those", 409);
      // Under the lock: a publish landing meanwhile is switched, never reverted to the old graph.
      return atomic(main, async (tx) => {
        await lockWorkflowSaves(tx, client, w.id);
        const live = (await savedWorkflows(tx, client))[w.id];
        if (!live?.edits) throw new PortalRefusal("it isn't live yet: publish it first", 409);
        const next = flowsWith(workflows, { [w.id]: live.edits }, components);
        const flow = next.flows.find((f) => f.id === w.id) as Workflow;
        if (on) {
          const effects = workflowEffects(w.id, next.flows, components);
          if (effects.some((e) => e !== "spends") && !teamCan(req, "effect", WREN))
            throw new PortalRefusal("it sends: only an admin can switch it on", 403);
          if (effects.includes("spends") && !teamCan(req, "money", WREN))
            throw new PortalRefusal("it spends: only an admin can switch it on", 403);
        }
        if ((live.edits.off === true) === !on) return { id: live.id, on, start: [], stop: [] };
        const { off: _, ...rest } = live.edits;
        const edits: WorkflowEdits = on ? rest : { ...rest, off: true };
        const [row] = await tx
          .insert(workflowSaves)
          .values({ client, workflow: w.id, edits, live: true, by })
          .returning({ id: workflowSaves.id });
        const clocks = clocksOf(client, flow);
        return { id: row?.id ?? 0, on, start: on ? clocks : [], stop: on ? [] : clocks };
      });
    },
    /** The doors into a workflow, for its node panel: masked, with their calls. */
    async workflowDoors(req: DoorRequest): Promise<Door[]> {
      team(req);
      const client = req.client ? (await pickClient(main, req)).id : null;
      const w = await workflowOf(req.workflow, client);
      if (!w) throw new PortalRefusal("no such workflow", 404);
      return doorsFor(main, client, w.id);
    },
    /** A door's whole token: a teammate with `manage`, never the demo. */
    async doorReveal(req: DoorRequest): Promise<{ token: string }> {
      const { client } = await workflowFor({ ...req, workflow: String(req.workflow ?? "") });
      return revealDoor(main, req.id, client);
    },
    /** A new token for a door: the old one stops at once. */
    async doorRotate(req: DoorRequest): Promise<{ token: string }> {
      const { client } = await workflowFor({ ...req, workflow: String(req.workflow ?? "") });
      return rotateDoor(main, req.id, client);
    },
    /**
     * The live workflow kept as a template under a name: sold in the Shop and listed in the
     * Library, installed on a client the Shop's way. Saving the name again moves it.
     */
    async workflowTemplateSave(
      req: WorkflowSaveRequest & { name?: unknown; blurb?: unknown },
    ): Promise<{ id: string; name: string; updated: boolean }> {
      const { w, client, by } = await workflowFor(req);
      if (isMade(w.id))
        throw new PortalRefusal("a made workflow can't be a template yet: in development", 409);
      return saveWorkflowTemplate(
        main,
        { client, workflow: w.id, name: req.name, blurb: req.blurb, by },
        { workflows, components },
      );
    },
    /** A saved template deleted: refused while any client runs it live, by how many. */
    async workflowTemplateDelete(
      req: PortalRequest & { template?: unknown },
    ): Promise<{ id: string; name: string }> {
      return deleteWorkflowTemplate(main, { template: req.template, by: teamWriter(req) });
    },
    /** The draft dropped: the live wiring stays as it is. */
    async workflowDiscard(req: WorkflowSaveRequest): Promise<{ done: number }> {
      const { w, client } = await workflowFor(req);
      if (isMade(w.id) && !(await savedWorkflows(main, client))[w.id])
        throw new PortalRefusal("it was never published: delete it instead", 409);
      return atomic(main, async (tx) => {
        await checkWorkflowBase(tx, client, w.id, req.expect);
        const gone = (await tx.execute(sql`DELETE FROM workflow_saves WHERE NOT live
          AND workflow = ${w.id} AND client IS NOT DISTINCT FROM ${client}
          RETURNING id`)) as unknown as unknown[];
        return { done: gone.length };
      });
    },
    /**
     * Ask Claude on the graph: the run row holding the prompt, for `Ask/edit` to answer with the
     * next draft. Nothing changes until he accepts it and publishes.
     */
    async workflowAskOpen(req: WorkflowSaveRequest & { message?: unknown }): Promise<string> {
      const { w, client, by } = await workflowFor(req);
      const message = typeof req.message === "string" ? req.message.trim() : "";
      if (!message) throw new PortalRefusal("say what to change", 400);
      if (message.length > ASK_MESSAGE_MAX)
        throw new PortalRefusal(`keep it under ${ASK_MESSAGE_MAX} characters`, 400);
      const got = EDITS.safeParse({
        wires: req.wires ?? [],
        steps: req.steps ?? [],
        settings: req.settings,
      });
      const draft = got.success ? (got.data as WorkflowEdits) : { wires: [], steps: [] };
      return askGraph(w, client, by, draft, message);
    },
    /**
     * The builder (designs/2026-10-09-workflow-builder.md): a new made workflow, its empty draft
     * saved, and, with a message, Claude asked to draw it. Nothing runs until Publish.
     */
    async workflowBuild(
      req: PortalRequest & { message?: unknown; name?: unknown },
    ): Promise<{ workflow: string; ask: string | null }> {
      team(req);
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      const client = req.client ? (await pickForWrite(main, req)).client.id : null;
      const by = (req.viewer as SignedViewer).email;
      const message = typeof req.message === "string" ? req.message.trim() : "";
      if (message.length > BUILD_MAX)
        throw new PortalRefusal(`keep it under ${BUILD_MAX} characters`, 400);
      const named = MADE_NAME.safeParse(
        typeof req.name === "string" && req.name.trim()
          ? req.name
          : message
            ? message.split(/[.;:,\n]/)[0]?.slice(0, 60)
            : "New workflow",
      );
      if (!named.success) throw new PortalRefusal("give it a name under 60", 400);
      const made: Made = {
        name: named.data,
        blurb: message.slice(0, 200),
        for: client ? "client" : "wren",
      };
      const id = madeIdOf(named.data, randomUUID().slice(0, 4));
      const draft: WorkflowEdits = { wires: [], steps: [], made };
      await main
        .insert(workflowSaves)
        .values({ client, workflow: id, edits: draft, live: false, by });
      const ask = message ? await askGraph(madeBase(id, made), client, by, draft, message) : null;
      return { workflow: id, ask };
    },
    /** The made workflows here, newest first: Wren's, or the client's named. */
    async workflowsMade(req: PortalRequest): Promise<MadeWorkflow[]> {
      team(req);
      const client = req.client ? (await pickClient(main, req)).id : null;
      return madeWorkflows(main, client);
    },
    /** A made workflow deleted: refused while live. */
    async workflowDelete(req: WorkflowSaveRequest): Promise<{ done: number }> {
      const { w, client } = await workflowFor(req);
      if (!isMade(w.id)) throw new PortalRefusal("only a made workflow can be deleted", 409);
      try {
        return await dropMade(main, client, w.id);
      } catch (err) {
        if (err instanceof MadeLive) throw new PortalRefusal(err.message, 409);
        throw err;
      }
    },
    /** Claude's answer on the graph, while the canvas waits: thinking, or its reply and draft. */
    async workflowAnswer(req: PortalRequest & { id?: unknown }) {
      team(req);
      const id = typeof req.id === "string" && /^[0-9a-f-]{36}$/.test(req.id) ? req.id : "";
      if (!id) throw new PortalRefusal("no such ask", 404);
      const [row] = await main
        .select({ argv: runs.argv, stats: runs.stats, finishedAt: runs.finishedAt })
        .from(runs)
        .where(
          and(
            eq(runs.id, id),
            eq(runs.command, ASK_COMMAND),
            sql`${runs.argv}->>'record' = ${WORKFLOW_ASK}`,
          ),
        );
      if (!row) throw new PortalRefusal("no such ask", 404);
      const stats = (row.stats ?? {}) as { reply?: string; patch?: unknown; error?: string };
      if (!row.finishedAt) return { state: "thinking" as const };
      if (stats.error) return { state: "failed" as const, error: stats.error };
      return {
        state: "done" as const,
        reply: stats.reply ?? "",
        patch: patchOf(stats.patch),
      };
    },

    /**
     * Test the draft, dry (`./dry.ts`): the whole workflow from an input, or one node. On a
     * sample event, or a real arrival's data read from `events`. Nothing is claimed or sent.
     */
    async workflowTest(req: WorkflowTestRequest): Promise<DryResult & { entered?: ExecutorEvent }> {
      team(req);
      const w = await workflowOf(
        req.workflow,
        req.client ? (await pickClient(main, req)).id : null,
      );
      if (!w) throw new PortalRefusal("no such workflow", 404);
      const got = EDITS.safeParse({
        wires: req.wires ?? [],
        steps: req.steps ?? [],
        settings: req.settings,
      });
      if (!got.success) throw new PortalRefusal("that draft doesn't read", 400);
      const { flows, broken } = flowsWith(
        workflows,
        { [w.id]: { ...(got.data as WorkflowEdits), ...madeOf(w) } },
        components,
      );
      if (broken[w.id]) throw new PortalRefusal(`it won't run: ${broken[w.id]?.join("; ")}`, 400);
      const map = new Map(flows.map((f) => [f.id, f]));
      const flow = map.get(w.id) as Workflow;
      const node = typeof req.node === "string" ? req.node : null;
      // Where a whole test enters: one of its inputs, or a trigger's output ("node.port").
      const from = node
        ? null
        : typeof req.from === "string"
          ? req.from
          : flow.in[0]
            ? `in.${flow.in[0].id}`
            : null;
      const [head = "", out = ""] = from?.split(".") ?? [];
      const source = flow.nodes.find((n) => n.id === head);
      const entry = from
        ? (head === "in"
            ? flow.in
            : source
              ? (portsOf(source, new Map(components.map((c) => [c.id, c])), map)?.out ?? [])
              : []
          ).find((p) => p.id === out)
        : undefined;
      if (from && !entry) throw new PortalRefusal("no such input", 400);
      const port = node ? (typeof req.port === "string" ? req.port : undefined) : out;
      if (!port) throw new PortalRefusal("say which input", 400);
      const kindIn =
        entry?.kind ??
        (typeof req.kind === "string" && req.kind in EVENT_KINDS
          ? (req.kind as Port["kind"])
          : "lead");
      const data =
        req.data && typeof req.data === "object" && !Array.isArray(req.data)
          ? (req.data as Record<string, unknown>)
          : {};
      let event = sampleEvent(kindIn, data);
      // A door node: the payload enters as the door would take it, its lead read by its map.
      const door = source && !node ? doorOf(source) : null;
      if (door && source) {
        const at = hookEvent(
          { workflow: w.id, input: source.id, subject: door.subject },
          map,
          data,
        );
        if ("error" in at) throw new PortalRefusal(at.error, 400);
        event = { ...at.event, data: { ...at.event.data, lead: leadOf(data, door.fields) } };
      }
      // A real arrival's data, pinned: read only, on the team's main database.
      if (typeof req.event === "string") {
        if (!/^[0-9a-f-]{36}$/.test(req.event)) throw new PortalRefusal("no such event", 404);
        const [row] = (await main.execute(sql`SELECT subject, kind, data FROM events
          WHERE id = ${req.event}::uuid`)) as unknown as Array<typeof event>;
        if (!row) throw new PortalRefusal("no such event", 404);
        event = row;
      }
      const base = {
        flows: map,
        parts: new Map(components.map((c) => [c.id, c])),
        workflow: w.id,
        client: null,
        rules: req.rules !== false,
        heard: Array.isArray(req.heard)
          ? UNTILS.filter((u) => (req.heard as unknown[]).includes(u))
          : [],
      };
      if (node) return dryStep({ ...base, node, port, event });
      const walked = await dryWalk({ ...base, from: from as string, events: [event] });
      // A door's test says what it read, wired on or not.
      return door ? { ...walked, entered: event } : walked;
    },
  };
}
