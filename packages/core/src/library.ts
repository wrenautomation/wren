/**
 * The Library's own records (designs/2026-10-06-library-and-views.md, 3): snippets, saved
 * replies and blocks the team inserts from any draft or reply box, and the workflows, each a
 * link into the Workflows app. Templates and Sequences are `./template-records.ts`'s.
 */
import type { Queryable } from "@wren/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { WREN } from "./access.js";
import type { Component } from "./components.js";
import { PortalRefusal } from "./portal.js";
import {
  actor,
  date,
  defineRecord,
  number,
  prose,
  type RecordType,
  type State,
  status,
  tags,
  text,
  type Values,
} from "./records.js";
import { snippets } from "./schema.js";
import type { Workflow } from "./workflows.js";

export const SNIPPET = "library.snippet";
export const CHANNELS = ["any", "email", "sms", "dm", "comment"] as const;
export type SnippetChannel = (typeof CHANNELS)[number];
const CHANNEL: Record<SnippetChannel, State> = {
  any: { label: "Anywhere", tone: "neutral" },
  email: { label: "Email", tone: "neutral" },
  sms: { label: "Text", tone: "neutral" },
  dm: { label: "DM", tone: "neutral" },
  comment: { label: "Comment", tone: "neutral" },
};

const TITLE_MAX = 120;
const BODY_MAX = 8000;
const TAG_MAX = 40;
const TAGS_MAX = 12;

/** Tags as the team types them: trimmed, lowercased, no commas (a row joins them with one). */
export function tagsOf(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const out = list
    .map((t) => String(t).replace(/,/g, " ").trim().toLowerCase().slice(0, TAG_MAX))
    .filter(Boolean);
  return [...new Set(out)].slice(0, TAGS_MAX);
}

const SnippetIn = z
  .object({
    title: z.string().trim().min(1, "it needs a title").max(TITLE_MAX),
    body: z.string().min(1, "it needs words").max(BODY_MAX),
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    channel: z.enum(CHANNELS).optional(),
  })
  .strict();
export type SnippetInput = z.input<typeof SnippetIn>;

/** One snippet as the Insert picker reads it. */
export interface SnippetLine {
  id: number;
  title: string;
  body: string;
  tags: string[];
  channel: SnippetChannel;
}

const lineOf = (r: typeof snippets.$inferSelect): SnippetLine => ({
  id: r.id,
  title: r.title,
  body: r.body,
  tags: r.tags,
  channel: (r.channel as SnippetChannel | null) ?? "any",
});

const parsed = <T>(got: z.ZodSafeParseResult<T>): T => {
  if (got.success) return got.data;
  const i = got.error.issues[0];
  throw new PortalRefusal(
    i ? `${i.path.join(".") || "snippet"}: ${i.message}` : "bad snippet",
    400,
  );
};

/** A workspace's snippets, by title: the picker's list. */
export async function snippetsOf(db: Queryable, workspace = WREN): Promise<SnippetLine[]> {
  const rows = await db
    .select()
    .from(snippets)
    .where(eq(snippets.workspace, workspace))
    .orderBy(asc(snippets.title), asc(snippets.id));
  return rows.map(lineOf);
}

export async function addSnippet(
  db: Queryable,
  input: SnippetInput,
  by: string,
  workspace = WREN,
): Promise<SnippetLine> {
  const s = parsed(SnippetIn.safeParse(input));
  const [row] = await db
    .insert(snippets)
    .values({
      workspace,
      title: s.title,
      body: s.body,
      tags: tagsOf(s.tags),
      channel: !s.channel || s.channel === "any" ? null : s.channel,
      createdBy: by,
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return lineOf(row);
}

export async function removeSnippet(db: Queryable, id: number, workspace = WREN): Promise<void> {
  const gone = await db
    .delete(snippets)
    .where(and(eq(snippets.id, id), eq(snippets.workspace, workspace)))
    .returning({ id: snippets.id });
  if (!gone.length) throw new PortalRefusal("no such snippet", 404);
}

const one = async (db: Queryable, id: string) => {
  const n = Number(id);
  if (!Number.isSafeInteger(n)) return null;
  const [row] = await db
    .select()
    .from(snippets)
    .where(and(eq(snippets.id, n), eq(snippets.workspace, WREN)))
    .limit(1);
  return row ?? null;
};

const SnippetPatch = z
  .object({
    title: z.string().trim().min(1, "it needs a title").max(TITLE_MAX),
    body: z.string().min(1, "it needs words").max(BODY_MAX),
    tags: z.union([z.string(), z.array(z.string())]),
    channel: z.enum(CHANNELS),
  })
  .partial()
  .strict();

/**
 * Wren's snippets as records: words, tags and where each fits, edited in place with History,
 * Undo and Ask Claude. `seen` are the tags in use, so each is a facet; none passed, no facets.
 */
export function snippetRecord(seen: readonly string[] = []): RecordType {
  const tagStates = Object.fromEntries(
    seen.map((t) => [t, { label: t, tone: "neutral" as const }]),
  );
  return defineRecord({
    id: SNIPPET,
    app: "library",
    channel: null,
    name: { one: "snippet", many: "snippets" },
    rows: async (db) => {
      const rows = await db
        .select()
        .from(snippets)
        .where(eq(snippets.workspace, WREN))
        .orderBy(asc(snippets.title));
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        tags: r.tags.join(","),
        channel: r.channel ?? "any",
        created_by: r.createdBy,
        updated_at: r.updatedAt.toISOString(),
      }));
    },
    key: "id",
    title: "title",
    subtitle: "channel",
    fields: {
      title: text("Title"),
      body: prose("Words"),
      // None in use yet (or not read): plain words, since a tags field needs its states.
      tags: seen.length ? tags(tagStates, "Tags") : text("Tags"),
      channel: status(CHANNEL, "Fits"),
      createdBy: actor("Made by"),
      updatedAt: date("Changed"),
    },
    views: [{ id: "all", label: "All", sort: "title", at: "updatedAt" }],
    actions: ["library.snippetAdd", "library.snippetRemove"],
    edits: {
      fields: ["title", "body", "tags", "channel"],
      patch: SnippetPatch as unknown as z.ZodType<Values>,
      about:
        "a saved reply or block the team inserts into drafts and replies; plain words, no slots",
      read: async (db, id) => {
        const r = await one(db, id);
        if (!r) return null;
        return { title: r.title, body: r.body, tags: r.tags, channel: r.channel ?? "any" };
      },
      write: async (db, id, patch) => {
        const r = await one(db, id);
        if (!r) throw new PortalRefusal("no such snippet", 404);
        const set: Partial<typeof snippets.$inferInsert> = { updatedAt: new Date() };
        if (typeof patch.title === "string") set.title = patch.title.trim();
        if (typeof patch.body === "string") set.body = patch.body;
        if (patch.tags !== undefined) set.tags = tagsOf(patch.tags);
        if (typeof patch.channel === "string")
          set.channel = patch.channel === "any" ? null : patch.channel;
        await db.update(snippets).set(set).where(eq(snippets.id, r.id));
      },
    },
  });
}

/** The tags in use on Wren's snippets, for the facets. */
export async function snippetTags(db: Queryable): Promise<string[]> {
  const rows = (await db.execute(
    sql`SELECT DISTINCT unnest(tags) tag FROM snippets WHERE workspace = ${WREN} ORDER BY 1`,
  )) as unknown as { tag: string }[];
  return rows.map((r) => r.tag);
}

const FOR: Record<Workflow["for"], State> = {
  wren: { label: "Wren", tone: "neutral" },
  client: { label: "Clients", tone: "neutral" },
};

/**
 * Every workflow, read only: what it does, its steps, and a link to it on the Workflows canvas
 * (a workflow that is a part's inside opens as that part, as the canvas names it).
 */
export function workflowRecord(
  workflows: readonly Workflow[],
  parts: readonly Component[],
): RecordType {
  return defineRecord({
    id: "library.workflow",
    app: "library",
    channel: null,
    name: { one: "workflow", many: "workflows" },
    // A setup runs from a client's Accounts page, not the Library.
    rows: async () =>
      workflows
        .filter((w) => w.kind !== "setup")
        .map((w) => ({
          id: w.id,
          name: w.name,
          blurb: w.blurb,
          for: w.for,
          steps: w.nodes.length,
        })),
    key: "id",
    title: "name",
    subtitle: "blurb",
    fields: {
      name: text("Name"),
      blurb: text("What it does"),
      for: status(FOR, "Runs for"),
      steps: number("Steps"),
    },
    views: [{ id: "all", label: "All", sort: "name" }],
    /** Its steps in order, and its address on the canvas. */
    load: async (_db, id) => {
      const w = workflows.find((x) => x.id === id);
      if (!w) return null;
      const named = (uses: string | undefined) =>
        parts.find((c) => c.id === uses)?.name ?? workflows.find((x) => x.id === uses)?.name;
      const as = parts.find((c) => c.inside === w.id)?.id ?? w.id;
      return {
        open: `/workflows/canvas?path=${encodeURIComponent(as)}`,
        steps: w.nodes.map((n) => ({
          id: n.id,
          name: named(n.uses) ?? n.own?.name ?? n.id,
          note: n.note ?? null,
        })),
      };
    },
  });
}
