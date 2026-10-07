/**
 * A trigger node's door (designs/2026-10-06-workflow-editor.md, step 5): the hook a Webhook or a
 * Form node enters by. Publish makes it once per client, workflow and node; publishing again only
 * moves its subject and field map. The door finds a token by its hash; the token is also sealed
 * with `WREN_HOOK_KEY` (AES-256-GCM), so a teammate with `manage` can see it again. Without the
 * key it is shown once, and Rotate makes a new one.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "node:process";
import type { Queryable } from "@wren/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { doorOf } from "./logic.js";
import { PortalRefusal } from "./portal.js";
import { hooks } from "./schema.js";
import type { Workflow } from "./workflows.js";

const keyOf = (raw: string | undefined) =>
  raw ? createHash("sha256").update(`wren-hook:${raw}`).digest() : null;

/** The token sealed for showing again; null without a key. */
export function sealToken(token: string, raw = env.WREN_HOOK_KEY): string | null {
  const key = keyOf(raw);
  if (!key) return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return ["v1", iv, body, c.getAuthTag()]
    .map((x) => (typeof x === "string" ? x : x.toString("base64url")))
    .join(".");
}

/** The sealed token, opened; null without the key, or when it doesn't open. */
export function openToken(sealed: string | null, raw = env.WREN_HOOK_KEY): string | null {
  const key = keyOf(raw);
  const [v, iv, body, tag] = sealed?.split(".") ?? [];
  if (!key || v !== "v1" || !iv || !body || !tag) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Enough of a token to tell two apart, never enough to post with. */
export const maskToken = (token: string) => `${token.slice(0, 4)}${"•".repeat(10)}`;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new token: what the door is posted with, its hash, and its seal. */
export function newToken(): { token: string; tokenHash: string; sealed: string | null } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token), sealed: sealToken(token) };
}

/** One door a workflow's node enters by, as the node panel lists it. */
export interface Door {
  id: string;
  /** The node it enters at. */
  node: string;
  name: string;
  subject: string;
  open: boolean;
  calls: number;
  lastAt: string | null;
  createdAt: string;
  /** The token's first letters; null when it was shown once and isn't kept. */
  masked: string | null;
}

const whose = (client: string | null) =>
  client === null ? isNull(hooks.client) : eq(hooks.client, client);

/** The doors into `workflow` for `client`, newest first. */
export async function doorsFor(
  db: Queryable,
  client: string | null,
  workflow: string,
): Promise<Door[]> {
  const rows = await db
    .select()
    .from(hooks)
    .where(and(whose(client), eq(hooks.workflow, workflow)))
    .orderBy(desc(hooks.createdAt));
  return rows.map((r) => {
    const token = openToken(r.sealed);
    return {
      id: r.id,
      node: r.input,
      name: r.name,
      subject: r.subject,
      open: r.open,
      calls: r.calls,
      lastAt: r.lastAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      masked: token ? maskToken(token) : null,
    };
  });
}

/**
 * The doors a published flow's Webhook and Form nodes need, made or brought up to date: one per
 * node, kept across publishes, so the URL a form posts to never moves. Returns each one made now
 * with its token, which is shown once when there's no key to seal it.
 */
export async function ensureDoors(
  tx: Queryable,
  at: { client: string | null; flow: Workflow; open: boolean },
): Promise<Array<{ node: string; id: string; token: string }>> {
  const made: Array<{ node: string; id: string; token: string }> = [];
  for (const n of at.flow.nodes) {
    const d = doorOf(n);
    if (!d) continue;
    // Two publishes at once make one door.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`door:${at.client ?? ""}:${at.flow.id}:${n.id}`}))`,
    );
    const [row] = await tx
      .select({ id: hooks.id, open: hooks.open })
      .from(hooks)
      .where(and(whose(at.client), eq(hooks.workflow, at.flow.id), eq(hooks.input, n.id)))
      .orderBy(desc(hooks.createdAt))
      .limit(1);
    if (row) {
      await tx
        .update(hooks)
        .set({ subject: d.subject, fields: d.fields, ...(at.open ? { open: true } : {}) })
        .where(eq(hooks.id, row.id));
      continue;
    }
    const t = newToken();
    const [got] = await tx
      .insert(hooks)
      .values({
        name: `${at.flow.name}: ${n.id}`.slice(0, 200),
        client: at.client,
        workflow: at.flow.id,
        input: n.id,
        subject: d.subject,
        fields: d.fields,
        open: at.open,
        tokenHash: t.tokenHash,
        sealed: t.sealed,
      })
      .returning({ id: hooks.id });
    if (got) made.push({ node: n.id, id: got.id, token: t.token });
  }
  return made;
}

async function doorRow(db: Queryable, id: unknown, client: string | null) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id))
    throw new PortalRefusal("no such door", 404);
  const [row] = await db
    .select()
    .from(hooks)
    .where(and(eq(hooks.id, id), whose(client)));
  if (!row) throw new PortalRefusal("no such door", 404);
  return row;
}

/** A door's whole token, for a teammate who may see it. */
export async function revealDoor(
  db: Queryable,
  id: unknown,
  client: string | null,
): Promise<{ token: string }> {
  const token = openToken((await doorRow(db, id, client)).sealed);
  if (!token) throw new PortalRefusal("it was shown once: rotate it for a new one", 409);
  return { token };
}

/** A new token for a door: the old one stops at once. */
export async function rotateDoor(
  db: Queryable,
  id: unknown,
  client: string | null,
): Promise<{ token: string }> {
  const row = await doorRow(db, id, client);
  const t = newToken();
  await db
    .update(hooks)
    .set({ tokenHash: t.tokenHash, sealed: t.sealed })
    .where(eq(hooks.id, row.id));
  return { token: t.token };
}
