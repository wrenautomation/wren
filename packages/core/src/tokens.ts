/**
 * Access tokens for AI tools, the `wren` CLI and its skill (designs/2026-10-09-ai-tools.md). A token is `wren_` and 32
 * random bytes; main keeps its SHA-256, never the token. It acts as its email: the Worker reads
 * it here, then every call passes the portal's guards as that viewer, so it never holds more than
 * its person does now. A pin keeps it to one client the person belongs to.
 */
import { createHash, randomBytes } from "node:crypto";
import * as restate from "@restatedev/restate-sdk";
import type { Db, Queryable } from "@wren/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { accessTokens, clientMembers, operators } from "./clients/schema.js";
import { PortalRefusal } from "./portal.js";
import { serviceHandler } from "./restate/form.js";

export const TOKEN_PREFIX = "wren_";
const TOKEN = /^wren_[A-Za-z0-9_-]{43}$/;
/** A person's live tokens at most. */
export const TOKENS_MAX = 20;
/** Last used is written once a minute at most. */
const TOUCH_MS = 60_000;

export const tokenHash = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  client: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

const COLUMNS = {
  id: accessTokens.id,
  name: accessTokens.name,
  prefix: accessTokens.prefix,
  client: accessTokens.client,
  createdAt: accessTokens.createdAt,
  lastUsedAt: accessTokens.lastUsedAt,
  expiresAt: accessTokens.expiresAt,
};

/** A person's live tokens, newest first. */
export const listTokens = (main: Queryable, email: string): Promise<TokenRow[]> =>
  main
    .select(COLUMNS)
    .from(accessTokens)
    .where(and(eq(accessTokens.email, email), isNull(accessTokens.revokedAt)))
    .orderBy(desc(accessTokens.createdAt));

/** May this person pin a token to this client: an operator, or one of its members. */
async function mayPin(main: Queryable, email: string, client: string): Promise<boolean> {
  const [op] = await main
    .select({ email: operators.email })
    .from(operators)
    .where(eq(operators.email, email));
  if (op) return true;
  const [m] = await main
    .select({ email: clientMembers.email })
    .from(clientMembers)
    .where(and(eq(clientMembers.email, email), eq(clientMembers.clientId, client)));
  return !!m;
}

/** A new token for this person. The token comes back once; only its hash is kept. */
export async function makeToken(
  main: Queryable,
  email: string,
  ask: { name: string; client?: string | null; days?: number | null },
): Promise<TokenRow & { token: string }> {
  const name = ask.name.trim().slice(0, 80);
  if (!name) throw new PortalRefusal("Name the token, so you know which tool holds it.", 400);
  const client = ask.client?.trim() || null;
  if (client && !(await mayPin(main, email, client)))
    throw new PortalRefusal("You aren't in that workspace.", 403);
  const days = ask.days ?? null;
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365))
    throw new PortalRefusal("A token lasts 1 to 365 days, or until removed.", 400);
  if ((await listTokens(main, email)).length >= TOKENS_MAX)
    throw new PortalRefusal(`You have ${TOKENS_MAX} tokens. Remove one first.`, 409);
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const [row] = await main
    .insert(accessTokens)
    .values({
      email,
      name,
      hash: tokenHash(token),
      prefix: token.slice(0, 9),
      client,
      expiresAt: days === null ? null : sql`now() + make_interval(days => ${days})`,
    })
    .returning(COLUMNS);
  if (!row) throw new Error("token insert returned nothing");
  return { ...row, token };
}

/** Removes one of this person's tokens; it stops working at once. */
export async function revokeToken(main: Queryable, email: string, id: string): Promise<void> {
  const done = await main
    .update(accessTokens)
    .set({ revokedAt: sql`now()` })
    .where(
      and(eq(accessTokens.id, id), eq(accessTokens.email, email), isNull(accessTokens.revokedAt)),
    )
    .returning({ id: accessTokens.id });
  if (!done.length) throw new PortalRefusal("No such token.", 404);
}

export interface TokenViewer {
  email: string;
  operator: boolean;
  /** The client it's pinned to, if any. */
  client: string | null;
}

/** Who a token acts as, or null: unknown, removed or expired. Marks it used. */
export async function checkToken(main: Queryable, token: string): Promise<TokenViewer | null> {
  if (!TOKEN.test(token)) return null;
  const [row] = await main
    .select({
      id: accessTokens.id,
      email: accessTokens.email,
      client: accessTokens.client,
      lastUsedAt: accessTokens.lastUsedAt,
      // Qualified by hand: drizzle prints a bare "email" here, which reads as the operator's own.
      operator: sql<boolean>`exists (select 1 from operators o
        where o.email = access_tokens.email)`,
    })
    .from(accessTokens)
    .where(
      and(
        eq(accessTokens.hash, tokenHash(token)),
        isNull(accessTokens.revokedAt),
        sql`(${accessTokens.expiresAt} is null or ${accessTokens.expiresAt} > now())`,
      ),
    );
  if (!row) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_MS)
    await main
      .update(accessTokens)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(accessTokens.id, row.id));
  return { email: row.email, operator: row.operator, client: row.client };
}

/**
 * `Tokens/check`: who a token acts as, for the portal Worker's `/api/agent`. Not a portal route, so a
 * browser can't reach it; the Worker holds the ingress token.
 */
export function makeTokens(main: Db) {
  return restate.service({
    name: "Tokens",
    handlers: {
      check: serviceHandler(
        { input: z.object({ token: z.string().max(64) }) },
        (ctx: restate.Context, req: { token: string }) =>
          ctx.run("check", () => checkToken(main, req.token)),
      ),
    },
  });
}
