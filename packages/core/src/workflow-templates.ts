/**
 * Save as template (designs/2026-10-06-workflow-editor.md, step 5): a published workflow's live
 * wiring kept under a name in `workflow_templates`, sold beside the code's templates and installed
 * on a client through the same path (`template-install.ts`). Saving the same name again moves it:
 * a client that has it reads the change as an update. Saving starts, sends and spends nothing.
 */
import { type Queryable, serializable, setAuditActor } from "@wren/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Component } from "./components.js";
import { PortalRefusal } from "./portal.js";
import { workflowSaves, workflowTemplates } from "./schema.js";
import { type Template, templatesOf } from "./template-install.js";
import { flowsWith, type Workflow } from "./workflows.js";

export const SAVED_PREFIX = "saved_";
const NAME_MAX = 80;
const BLURB_MAX = 300;

/** A saved template's id from its name: `Win back, fast` is `saved_win_back_fast`. */
export function savedIdOf(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${SAVED_PREFIX}${slug}`.slice(0, 64).replace(/_+$/, "");
}

export interface SaveTemplateAsk {
  /** Whose live workflow; null is Wren's. */
  client: string | null;
  workflow: string;
  name: unknown;
  blurb?: unknown;
  by: string;
}

/**
 * The workflow's newest live save, kept as a template. Refused when it isn't published, runs for
 * Wren only, or the name is another workflow's template or the code's.
 */
export async function saveWorkflowTemplate(
  db: Queryable,
  ask: SaveTemplateAsk,
  deps: { workflows: readonly Workflow[]; components: readonly Component[] },
): Promise<{ id: string; name: string; updated: boolean }> {
  const name = typeof ask.name === "string" ? ask.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2) throw new PortalRefusal("it needs a name", 400);
  if (name.length > NAME_MAX) throw new PortalRefusal(`a name fits ${NAME_MAX} characters`, 400);
  const blurb = typeof ask.blurb === "string" ? ask.blurb.trim().slice(0, BLURB_MAX) : "";
  const id = savedIdOf(name);
  if (id === SAVED_PREFIX.slice(0, -1)) throw new PortalRefusal("a name needs letters", 400);
  const w = deps.workflows.find((x) => x.id === ask.workflow);
  if (!w || w.kind === "setup") throw new PortalRefusal("no such workflow", 404);
  if (w.for !== "client")
    throw new PortalRefusal("it runs for Wren only, so no client can install it", 409);
  if (templatesOf(deps.workflows, deps.components).some((t) => t.id === id || t.name === name))
    throw new PortalRefusal(`${name} is a built-in template: pick another name`, 409);
  return serializable(db, async (tx) => {
    await setAuditActor(tx, ask.by);
    const [live] = await tx
      .select({ edits: workflowSaves.edits })
      .from(workflowSaves)
      .where(
        and(
          ask.client === null ? isNull(workflowSaves.client) : eq(workflowSaves.client, ask.client),
          eq(workflowSaves.workflow, w.id),
          eq(workflowSaves.live, true),
        ),
      )
      .orderBy(desc(workflowSaves.id))
      .limit(1);
    if (!live) throw new PortalRefusal("publish it first: a template is its live wiring", 409);
    const edits = live.edits ?? null;
    const bad = flowsWith(deps.workflows, edits ? { [w.id]: edits } : {}, deps.components).broken[
      w.id
    ];
    if (bad) throw new PortalRefusal(`its live wiring won't run: ${bad.join("; ")}`, 409);
    const [had] = await tx
      .select({ workflow: workflowTemplates.workflow })
      .from(workflowTemplates)
      .where(eq(workflowTemplates.id, id))
      .for("update");
    if (had && had.workflow !== w.id)
      throw new PortalRefusal(`${name} is another workflow's template: pick another name`, 409);
    const row = { name, blurb, edits, fromClient: ask.client, by: ask.by, at: new Date() };
    await tx
      .insert(workflowTemplates)
      .values({ id, workflow: w.id, ...row })
      .onConflictDoUpdate({ target: workflowTemplates.id, set: row });
    return { id, name, updated: !!had };
  });
}

/** The saved templates made from one workflow, by name: the editor lists them. */
export async function savedFrom(
  db: Queryable,
  workflow: string,
): Promise<Array<Pick<Template, "id" | "name"> & { by: string; at: string }>> {
  const rows = await db
    .select({
      id: workflowTemplates.id,
      name: workflowTemplates.name,
      by: workflowTemplates.by,
      at: workflowTemplates.at,
    })
    .from(workflowTemplates)
    .where(eq(workflowTemplates.workflow, workflow))
    .orderBy(workflowTemplates.name);
  return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
}
