/**
 * Template install (designs/2026-10-07-template-install.md): a workflow marked as a template
 * goes onto a client in one go. Its parts through the Shop's own install check, its copy into
 * the client's database following Wren's defaults, the workflow as a draft, and its door, shut.
 * Nothing starts, sends or spends until a person approves it in To approve.
 *
 * Installing again changes nothing. After the template moved, the plan says what would change and
 * an install needs `update`. A client's own copy, settings and wiring are never overwritten.
 * Uninstall takes off the parts it added and shuts the door; data, copy and saves stay.
 */
import { createHash } from "node:crypto";
import { type Queryable, serializable, setAuditActor } from "@wren/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { type Client, getClient, updateClient } from "./clients/index.js";
import { clients } from "./clients/schema.js";
import {
  ACCOUNTS,
  type AccountSite,
  type Component,
  type Effect,
  type LoopKey,
} from "./components.js";
import { accountsLacking, blockOf, has, installCheck } from "./installs.js";
import { PortalRefusal } from "./portal.js";
import {
  hooks,
  type InstallApplied,
  type InstallState,
  type WorkflowInstall,
  workflowInstalls,
  workflowSaves,
} from "./schema.js";
import { factsHeld, factsLacking, type Setup, setupOf } from "./setup.js";
import { makeHook } from "./spine.js";
import { covers, type DefaultFile, installDefaults, loadDefaults } from "./template-defaults.js";
import { nameLabel } from "./template-labels.js";
import { refText } from "./templates.js";
import {
  flowsWith,
  type TemplateSpec,
  templateIdOf,
  type Workflow,
  type WorkflowEdits,
} from "./workflows.js";

/** A template as the Shop sells it. */
export interface Template {
  /** The Shop's id: the part whose inside it is, else the workflow's own. */
  id: string;
  name: string;
  blurb: string;
  icon: string;
  workflow: Workflow;
  spec: TemplateSpec;
  /** Its parts in install order, each with the settings the template gives it. */
  parts: { part: Component; settings: Record<string, unknown> }[];
  /** Copy refs and prefixes: the parts' `provides.templates`, then the template's own. */
  copy: string[];
  effects: Effect[];
  /** A hash of what it installs and its wiring: a newer one is an update. */
  version: string;
}

const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

/** Every workflow marked as a template, as the Shop sells it. */
export function templatesOf(
  workflows: readonly Workflow[],
  components: readonly Component[],
): Template[] {
  return workflows.flatMap((w) => {
    const spec = w.template;
    if (!spec) return [];
    const id = templateIdOf(w, components);
    const shown = components.find((c) => c.id === id) ?? w;
    const parts = Object.entries(spec.parts).flatMap(([pid, settings]) => {
      const part = components.find((c) => c.id === pid);
      return part ? [{ part, settings }] : [];
    });
    const copy = [
      ...new Set([...parts.flatMap((p) => p.part.provides.templates), ...(spec.copy ?? [])]),
    ];
    return [
      {
        id,
        name: shown.name,
        blurb: shown.blurb,
        icon: shown.icon,
        workflow: w,
        spec,
        parts,
        copy,
        effects: [...new Set(parts.flatMap((p) => p.part.effects))],
        version: hash({ parts: spec.parts, copy, door: spec.door ?? null, w: [w.nodes, w.wires] }),
      },
    ];
  });
}

/** One template by its id or its workflow's, or a 404. */
export function templateNamed(all: readonly Template[], id: unknown): Template {
  const t = all.find((x) => x.id === id || x.workflow.id === id);
  if (!t) throw new PortalRefusal("no such template", 404);
  return t;
}

// ---- The plan: what an install would do, read before anything is written ----

/**
 * A part's step. add: goes on now. back: goes on again with the settings it had. have: the client
 * had it before, untouched. same: the template's, as it says. update: the template's, its new
 * settings go on. kept: the client changed it, so it stays. development: not built per client.
 */
export type PartStatus = "add" | "back" | "have" | "same" | "update" | "kept" | "development";
/** add: Wren's words go in. have: follows Wren's. own: the client's words, kept. none: no words yet. */
export type CopyStatus = "add" | "have" | "own" | "none";

export interface PlanPart {
  id: string;
  name: string;
  blurb: string;
  status: PartStatus;
  effects: Effect[];
  /** The block it lands with; null when none is written. */
  settings: Record<string, unknown> | null;
  /**
   * Accounts the client hasn't connected: it installs and waits on them. A setup's step names its
   * setup apart (`setup`), so a list can group by it and each step reads as itself.
   */
  accounts: {
    site: AccountSite | string;
    label: string;
    how: string;
    waits: string | null;
    setup?: string;
  }[];
  missing: string[];
}

export interface Plan {
  template: string;
  name: string;
  client: string;
  workflow: string;
  /** Its install now: null when never installed. */
  state: InstallState | null;
  version: string;
  /** The version installed; differs from `version` when the template moved. */
  installed: string | null;
  /** new: never installed. same: nothing to do. update: the template moved. back: after uninstall. */
  kind: "new" | "same" | "update" | "back";
  parts: PlanPart[];
  copy: { ref: string; status: CopyStatus }[];
  /** add: a draft is saved. have: one is there. edited: the client's draft, kept. live: it runs. */
  draft: "add" | "have" | "edited" | "live";
  door: { status: "add" | "have"; input: string; subject: string } | null;
  effects: Effect[];
  /** What to type to install it: the template's name, when it has effects and work to do. Its id
   * also passes, and case never matters (`confirmed`). */
  confirm: string | null;
  /** How many things it would change. */
  changes: number;
}

/** One template row in a client's database, as the plan reads it. */
export interface CopyRow {
  ref: string;
  followsDefault: boolean;
  live: boolean;
}

/** Each ref a template's copy names: prefixes opened over the defaults, exact refs as they are. */
export function copyRefs(patterns: readonly string[], files: readonly DefaultFile[]) {
  const out = new Map<string, boolean>();
  for (const p of patterns) {
    const hit = files.filter((f) => covers(p, f.ref)).map((f) => refText(f.ref));
    for (const r of hit) out.set(r, true);
    if (!p.endsWith("/") && !hit.length) out.set(p, false);
  }
  return [...out].map(([ref, file]) => ({ ref, file }));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The plan, from what's there now. Pure. */
export function planOf(
  t: Template,
  now: {
    client: Pick<Client, "id" | "products" | "accounts">;
    row: WorkflowInstall | null;
    copy: readonly CopyRow[];
    saves: readonly { live: boolean; edits: WorkflowEdits | null }[];
    files: readonly DefaultFile[];
    /** Facts the client's accounts hold now; a part needing one it lacks installs and waits. */
    facts?: ReadonlySet<string>;
    /** The setups, to say how each missing fact is made true. */
    setups?: readonly Setup[];
  },
): Plan {
  const { client, row } = now;
  const applied = row?.applied ?? { added: [], blocks: {}, copy: [] };
  const off = row?.state === "off";
  const parts = t.parts.map(({ part: c, settings }): PlanPart => {
    const base: Omit<PlanPart, "status" | "settings"> = {
      id: c.id,
      name: c.name,
      blurb: c.blurb,
      effects: c.effects,
      missing: c.missing,
      accounts: accountsLacking(c, client).map((site) => {
        const how = ACCOUNTS[site as AccountSite];
        return how
          ? { site, label: how.label, how: how.how, waits: how.waits }
          : { site, label: site, how: "Connect one of them in the Shop.", waits: null };
      }),
    };
    // A fact a setup leaves on an account (a number's campaign approved): said like an account.
    if (now.facts)
      for (const fact of factsLacking(c, now.facts)) {
        const at = setupOf(fact, now.setups ?? []);
        base.accounts.push(
          at
            ? {
                site: fact,
                label: at.step.label,
                how: at.step.how,
                setup: at.setup.name,
                waits: at.step.who === "client" ? null : at.step.forYou,
              }
            : { site: fact, label: fact, how: "Wren's team sets it up.", waits: null },
        );
      }
    if (!c.ready) return { ...base, status: "development", settings: null };
    const ours = applied.added.includes(c.id);
    const block = client.products[c.id];
    if (!has(client, c.id))
      return off && ours
        ? { ...base, status: "back", settings: applied.kept?.[c.id] ?? settings }
        : { ...base, status: "add", settings };
    if (!ours) return { ...base, status: "have", settings: null };
    if (!same(block, applied.blocks[c.id])) return { ...base, status: "kept", settings: null };
    if (same(block, settings)) return { ...base, status: "same", settings: null };
    return { ...base, status: "update", settings };
  });
  const rows = new Map(now.copy.map((r) => [r.ref, r]));
  const copy = copyRefs(t.copy, now.files).map(({ ref, file }) => {
    const r = rows.get(ref);
    const status: CopyStatus = !r
      ? file
        ? "add"
        : "none"
      : r.followsDefault
        ? "have"
        : r.live
          ? "own"
          : file
            ? "add"
            : "none";
    return { ref, status };
  });
  const draft = now.saves.some((s) => s.live)
    ? "live"
    : now.saves.length
      ? now.saves.some((s) => s.edits)
        ? "edited"
        : "have"
      : "add";
  const door = t.spec.door
    ? { status: row?.hook ? ("have" as const) : ("add" as const), ...t.spec.door }
    : null;
  const changes =
    parts.filter((p) => ["add", "back", "update"].includes(p.status)).length +
    copy.filter((c) => c.status === "add").length +
    (draft === "add" ? 1 : 0) +
    (door?.status === "add" ? 1 : 0) +
    (row && !off && row.version !== t.version ? 1 : 0) +
    (off ? 1 : 0);
  const kind = !row ? "new" : off ? "back" : changes ? "update" : "same";
  return {
    template: t.id,
    name: t.name,
    client: client.id,
    workflow: t.workflow.id,
    state: row?.state ?? null,
    version: t.version,
    installed: row?.version ?? null,
    kind,
    parts,
    copy,
    draft,
    door,
    effects: t.effects,
    confirm: changes && t.effects.length ? t.name : null,
    changes,
  };
}

const typedForm = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();

/** Whether what a person typed names the template: its name or its id, case aside. */
export function confirmed(t: Pick<Template, "id" | "name">, typed: unknown): boolean {
  if (typeof typed !== "string") return false;
  const at = typedForm(typed);
  return at === typedForm(t.name) || at === typedForm(t.id);
}

/** How a template on a client reads, as a status field. */
export const INSTALL_STATE_LABELS = {
  draft: { label: "Not live yet", tone: "neutral" },
  waiting: { label: "Waiting on approval", tone: "warn" },
  live: { label: "Live", tone: "good" },
  off: { label: "Uninstalled", tone: "neutral" },
} as const satisfies Record<InstallState, { label: string; tone: string }>;

let defaults: DefaultFile[] | null = null;
/** The defaults tree, read once per process: a page reads it on every open. */
export const defaultsOnce = (): DefaultFile[] => {
  defaults ??= loadDefaults();
  return defaults;
};

const KIND_WORD: Readonly<Record<string, string>> = {
  sms: "text",
  email: "email",
  dm: "DM",
  post: "post",
  prompt: "prompt",
};

/** A copy ref as a person reads it: `sms:texts/speed-to-lead#2` is "Speed to lead text 2". */
export function copyLabel(ref: string): string {
  const colon = ref.indexOf(":");
  const kind = ref.slice(0, colon);
  const name = ref.slice(ref.indexOf("/") + 1);
  const [base = name, n] = name.split("#");
  return `${nameLabel(base)} ${KIND_WORD[kind] ?? kind}${n ? ` ${n}` : ""}`;
}

// ---- Reads ----

export async function installOf(
  db: Queryable,
  client: string,
  template: string,
): Promise<WorkflowInstall | null> {
  const [row] = await db
    .select()
    .from(workflowInstalls)
    .where(and(eq(workflowInstalls.client, client), eq(workflowInstalls.template, template)));
  return row ?? null;
}

/** The template rows in a client's database. */
export async function copyRows(db: Queryable): Promise<CopyRow[]> {
  const rows = (await db.execute(sql`SELECT kind, system, name, follows_default,
    live_version_id IS NOT NULL AS live FROM templates`)) as unknown as {
    kind: string;
    system: string;
    name: string;
    follows_default: boolean;
    live: boolean;
  }[];
  return rows.map((r) => ({
    ref: `${r.kind}:${r.system}/${r.name}`,
    followsDefault: r.follows_default,
    live: r.live,
  }));
}

const savesOf = (db: Queryable, client: string, workflow: string) =>
  db
    .select({ live: workflowSaves.live, edits: workflowSaves.edits })
    .from(workflowSaves)
    .where(and(eq(workflowSaves.client, client), eq(workflowSaves.workflow, workflow)));

/** Copy is in the client's database, the rest on main; no client database reads as no copy. */
export async function readPlan(
  main: Queryable,
  clientDb: Queryable | null,
  t: Template,
  client: string,
  files: readonly DefaultFile[] = defaultsOnce(),
  setups: readonly Setup[] = [],
): Promise<Plan> {
  const c = await getClient(main, client);
  return planOf(t, {
    client: c,
    row: await installOf(main, client, t.id),
    copy: clientDb ? await copyRows(clientDb) : [],
    saves: await savesOf(main, client, t.workflow.id),
    files,
    facts: await factsHeld(main, client),
    setups,
  });
}

// ---- Writes ----

export interface InstallAsk {
  client: string;
  by: string;
  /** The template's id, typed, when it has effects. */
  confirm?: unknown;
  /** True once the plan of an update was read. */
  update?: boolean;
  files?: readonly DefaultFile[];
  /** To say how each missing fact is set up, in the plan it answers. */
  setups?: readonly Setup[];
}

export interface Installed {
  plan: Plan;
  changed: boolean;
  /** The door's URL token, shown once when the door was made now. */
  token: string | null;
  state: InstallState;
}

/**
 * Install or update `t` on a client: the copy first (each its own write, safe to repeat), then
 * one transaction on main for the parts, the draft, the door and the install row. Starts nothing.
 */
export async function installTemplate(
  main: Queryable,
  clientDb: Queryable | null,
  t: Template,
  ask: InstallAsk,
): Promise<Installed> {
  const files = ask.files ?? defaultsOnce();
  const before = await readPlan(main, clientDb, t, ask.client, files, ask.setups);
  if (before.kind === "same")
    return { plan: before, changed: false, token: null, state: before.state ?? "draft" };
  if (before.kind === "update" && !ask.update)
    throw new PortalRefusal(
      "it's installed and the template moved: read the plan, then install with update",
      409,
    );
  if (before.confirm && !confirmed(t, ask.confirm))
    throw new PortalRefusal(
      `it ${t.effects.join(" and ")}: type ${before.confirm} to confirm`,
      400,
    );
  if (clientDb && t.copy.length) await installDefaults(clientDb, t.copy, { files, by: ask.by });
  const out = await serializable(main, async (tx) => {
    await setAuditActor(tx, ask.by);
    // Read again inside: a change since the plan is seen, never written over.
    const [client] = await tx
      .select()
      .from(clients)
      .where(eq(clients.id, ask.client))
      .for("update");
    if (!client) throw new PortalRefusal("no such client", 404);
    const row = await installOf(tx, client.id, t.id);
    const plan = planOf(t, {
      client,
      row,
      copy: [],
      saves: await savesOf(tx, client.id, t.workflow.id),
      files: [],
    });
    const applied: InstallApplied = {
      name: t.name,
      added: [...(row?.applied.added ?? [])],
      blocks: { ...(row?.applied.blocks ?? {}) },
      copy: [...new Set([...(row?.applied.copy ?? []), ...t.copy])],
      kept: { ...(row?.applied.kept ?? {}) },
    };
    // Each part through the Shop's check, against what the earlier ones already put on.
    const products: Record<string, unknown> = { ...client.products };
    const writes: Record<string, Record<string, unknown>> = {};
    for (const p of plan.parts) {
      const c = t.parts.find((x) => x.part.id === p.id)?.part as Component;
      const at = { products, accounts: client.accounts };
      if (p.status === "add" || p.status === "back") {
        // Confirmed above, by name: the part's check takes the template's id.
        const block = installCheck(c, at, {
          settings: p.settings,
          confirm: t.id,
          template: t.id,
        });
        writes[c.id] = block;
        products[c.id] = block;
        if (!applied.added.includes(c.id)) applied.added.push(c.id);
        if (p.status === "add") applied.blocks[c.id] = block;
        delete applied.kept?.[c.id];
      } else if (p.status === "update") {
        const block = blockOf(c, p.settings);
        writes[c.id] = block;
        products[c.id] = block;
        applied.blocks[c.id] = block;
      }
    }
    if (Object.keys(writes).length) await updateClient(tx, client.id, { products: writes });
    // The workflow as a draft, following the template's wiring, unless the client has one.
    if (plan.draft === "add")
      await tx.insert(workflowSaves).values({
        client: client.id,
        workflow: t.workflow.id,
        edits: null,
        live: false,
        by: ask.by,
      });
    // The door, shut until approved; its token shown once.
    let token: string | null = null;
    let hook = row?.hook ?? null;
    if (t.spec.door && !hook) {
      const made = await makeHook(tx, {
        name: `${t.name} (${client.id})`.slice(0, 200),
        client: client.id,
        workflow: t.workflow.id,
        input: t.spec.door.input,
        subject: t.spec.door.subject,
        open: false,
      });
      hook = made.id;
      token = made.token;
    }
    // Back after uninstall, or new: a draft. An update to a live one asks again, so its new parts
    // start only on a person's yes; the live wiring keeps running meanwhile.
    const state: InstallState =
      !row || row.state === "off" ? "draft" : row.state === "live" ? "waiting" : row.state;
    const asked = state === "waiting" && row?.state === "live";
    const values = {
      client: client.id,
      template: t.id,
      workflow: t.workflow.id,
      version: t.version,
      state,
      applied,
      hook,
      by: ask.by,
      at: new Date(),
      ...(asked ? { askedBy: ask.by, askedAt: new Date() } : {}),
      ...(row?.state === "off" ? { removedBy: null, removedAt: null } : {}),
    };
    if (row) await tx.update(workflowInstalls).set(values).where(eq(workflowInstalls.id, row.id));
    else await tx.insert(workflowInstalls).values(values);
    return { token, state };
  });
  return {
    plan: await readPlan(main, clientDb, t, ask.client, files, ask.setups),
    changed: true,
    ...out,
  };
}

/** The To approve item for an install. */
export const installApprovalId = (id: number) => `workflow:${id}`;
export function parseInstallApprovalId(id: unknown): number | null {
  const m = typeof id === "string" ? /^workflow:(\d+)$/.exec(id) : null;
  return m ? Number(m[1]) : null;
}

/**
 * Publish: the client's workflow goes to To approve. Nothing runs until a person's yes. Live, it
 * asks again only for a draft: the live wiring keeps running until the yes.
 */
export async function askTemplate(
  main: Queryable,
  t: Template,
  ask: { client: string; by: string },
): Promise<{ id: string; state: InstallState }> {
  return serializable(main, async (tx) => {
    const row = await installOf(tx, ask.client, t.id);
    if (!row || row.state === "off") throw new PortalRefusal("it isn't installed", 404);
    if (
      row.state === "live" &&
      !(await savesOf(tx, ask.client, t.workflow.id)).some((s) => !s.live)
    )
      throw new PortalRefusal("it's live: change the draft, then publish that", 409);
    if (row.state !== "waiting") {
      await setAuditActor(tx, ask.by);
      await tx
        .update(workflowInstalls)
        .set({ state: "waiting", askedBy: ask.by, askedAt: new Date() })
        .where(eq(workflowInstalls.id, row.id));
    }
    return { id: installApprovalId(row.id), state: "waiting" as const };
  });
}

/** The install a To approve item names, still waiting. */
async function waitingRow(db: Queryable, id: unknown): Promise<WorkflowInstall> {
  const n = parseInstallApprovalId(id);
  if (n === null) throw new PortalRefusal("no such item", 404);
  const [row] = await db
    .select()
    .from(workflowInstalls)
    .where(eq(workflowInstalls.id, n))
    .for("update");
  if (!row) throw new PortalRefusal("no such item", 404);
  if (row.state !== "waiting") throw new PortalRefusal("it isn't waiting now", 409);
  return row;
}

/** The loops each of `ids` runs for this client with its block now. */
export function loopsOf(
  components: readonly Component[],
  client: Pick<Client, "id" | "products">,
  ids: readonly string[],
): LoopKey[] {
  return ids.flatMap((id) => {
    const c = components.find((x) => x.id === id);
    const parsed = c?.settings.safeParse(client.products[id] ?? {});
    return c && parsed?.success
      ? c.clientLoops(client.id, parsed.data as Record<string, unknown>)
      : [];
  });
}

/**
 * A person's yes: the draft goes live (checked as the spine runs it), the door opens, and the
 * loops of its parts on the client come back to start. The caller checks who may.
 */
export async function approveInstall(
  main: Queryable,
  id: unknown,
  deps: { by: string; workflows: readonly Workflow[]; components: readonly Component[] },
): Promise<{ id: string; client: string; template: string; start: LoopKey[] }> {
  return serializable(main, async (tx) => {
    const row = await waitingRow(tx, id);
    await setAuditActor(tx, deps.by);
    const [draft] = await tx
      .select()
      .from(workflowSaves)
      .where(
        and(
          eq(workflowSaves.client, row.client),
          eq(workflowSaves.workflow, row.workflow),
          eq(workflowSaves.live, false),
        ),
      )
      .orderBy(desc(workflowSaves.id))
      .limit(1);
    if (draft) {
      const edits = draft.edits;
      const bad = edits
        ? flowsWith(deps.workflows, { [row.workflow]: edits }, deps.components).broken[row.workflow]
        : undefined;
      if (bad) throw new PortalRefusal(`its draft won't run: ${bad.join("; ")}`, 409);
      await tx
        .insert(workflowSaves)
        .values({ client: row.client, workflow: row.workflow, edits, live: true, by: deps.by });
      await tx.execute(sql`DELETE FROM workflow_saves WHERE NOT live AND client = ${row.client}
        AND workflow = ${row.workflow}`);
    }
    if (row.hook) await tx.update(hooks).set({ open: true }).where(eq(hooks.id, row.hook));
    await tx
      .update(workflowInstalls)
      .set({ state: "live", approvedBy: deps.by, approvedAt: new Date() })
      .where(eq(workflowInstalls.id, row.id));
    const client = await getClient(tx, row.client);
    const ids = Object.keys(
      templateNamed(templatesOf(deps.workflows, deps.components), row.template).spec.parts,
    ).filter((p) => has(client, p));
    return {
      id: installApprovalId(row.id),
      client: row.client,
      template: row.template,
      start: loopsOf(deps.components, client, ids),
    };
  });
}

/** A person's no: back to a draft; nothing ran. */
export async function declineInstall(
  main: Queryable,
  id: unknown,
  by: string,
): Promise<{ id: string }> {
  return serializable(main, async (tx) => {
    const row = await waitingRow(tx, id);
    await setAuditActor(tx, by);
    await tx
      .update(workflowInstalls)
      .set({ state: row.approvedAt ? "live" : "draft", askedBy: null, askedAt: null })
      .where(eq(workflowInstalls.id, row.id));
    return { id: installApprovalId(row.id) };
  });
}

/**
 * Uninstall: the parts it added come off, last first, unless another part or template on the
 * client still uses one; each block is kept for a reinstall. The door shuts. The client's data,
 * copy and saves stay. Their loops come back to stop.
 */
export async function uninstallTemplate(
  main: Queryable,
  t: Template,
  ask: { client: string; by: string },
  deps: { workflows: readonly Workflow[]; components: readonly Component[] },
): Promise<{ removed: string[]; kept: string[]; stop: LoopKey[] }> {
  return serializable(main, async (tx) => {
    const row = await installOf(tx, ask.client, t.id);
    if (!row || row.state === "off") throw new PortalRefusal("it isn't installed", 404);
    await setAuditActor(tx, ask.by);
    const client = await getClient(tx, ask.client);
    const others = (
      await tx
        .select({ template: workflowInstalls.template })
        .from(workflowInstalls)
        .where(
          and(
            eq(workflowInstalls.client, ask.client),
            sql`${workflowInstalls.state} <> 'off'`,
            sql`${workflowInstalls.template} <> ${t.id}`,
          ),
        )
    ).flatMap((r) => {
      const o = templatesOf(deps.workflows, deps.components).find((x) => x.id === r.template);
      return o ? Object.keys(o.spec.parts) : [];
    });
    const mine = row.applied.added.filter((id) => has(client, id));
    const products = { ...client.products };
    const removed: string[] = [];
    const kept: string[] = [];
    const blocks: Record<string, Record<string, unknown>> = { ...(row.applied.kept ?? {}) };
    for (const id of [...mine].reverse()) {
      const users = deps.components.filter(
        (c) => c.id !== id && Object.hasOwn(products, c.id) && c.requires.components.includes(id),
      );
      if (users.length || others.includes(id)) {
        kept.push(id);
        continue;
      }
      blocks[id] = products[id] as Record<string, unknown>;
      delete products[id];
      removed.push(id);
    }
    if (removed.length)
      await updateClient(tx, client.id, {
        products: Object.fromEntries(removed.map((id) => [id, null])),
      });
    if (row.hook) await tx.update(hooks).set({ open: false }).where(eq(hooks.id, row.hook));
    await tx
      .update(workflowInstalls)
      .set({
        state: "off",
        applied: { ...row.applied, kept: blocks },
        removedBy: ask.by,
        removedAt: new Date(),
        askedBy: null,
        askedAt: null,
      })
      .where(eq(workflowInstalls.id, row.id));
    return { removed, kept, stop: loopsOf(deps.components, client, removed) };
  });
}

/** A client's templates and where each stands, newest first. */
export async function installsOf(db: Queryable, client: string): Promise<WorkflowInstall[]> {
  return db
    .select()
    .from(workflowInstalls)
    .where(eq(workflowInstalls.client, client))
    .orderBy(desc(workflowInstalls.at));
}

/** Installs waiting on a person's yes, with their client's name: To approve's rows. */
export async function waitingInstalls(db: Queryable) {
  return db
    .select({
      id: workflowInstalls.id,
      client: workflowInstalls.client,
      clientName: clients.name,
      template: workflowInstalls.template,
      workflow: workflowInstalls.workflow,
      askedBy: workflowInstalls.askedBy,
      askedAt: workflowInstalls.askedAt,
      applied: workflowInstalls.applied,
    })
    .from(workflowInstalls)
    .innerJoin(clients, eq(clients.id, workflowInstalls.client))
    .where(eq(workflowInstalls.state, "waiting"));
}
