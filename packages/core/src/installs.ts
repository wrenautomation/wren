/**
 * The Shop's install check, one path for a part on its own and for each part a template
 * installs (designs/2026-10-07-template-install.md). Pure: the caller writes the block.
 */
import type { Queryable } from "@wren/db";
import { and, eq } from "drizzle-orm";
import type { Client } from "./clients/index.js";
import { ACCOUNT_SITES, type Component } from "./components.js";
import { PortalRefusal } from "./portal.js";
import { clientAccounts } from "./setup-schema.js";

export const has = (client: Pick<Client, "products">, id: string) =>
  Object.hasOwn(client.products, id);

/**
 * The client as the Shop reads its accounts: a social account it connected by signing in
 * (`client_accounts` site `social`, role the platform: a TikTok, a YouTube channel) counts as that
 * site's account, under any value typed in on the Shop. Read only: never written back to
 * `clients.accounts`, which holds the logins autobrowse posts with.
 */
export async function withConnected<C extends Pick<Client, "id" | "accounts">>(
  main: Queryable,
  client: C,
): Promise<C> {
  const rows = await main
    .select({ role: clientAccounts.role, ref: clientAccounts.ref })
    .from(clientAccounts)
    .where(and(eq(clientAccounts.client, client.id), eq(clientAccounts.site, "social")));
  const sites = rows.filter((r) => (ACCOUNT_SITES as readonly string[]).includes(r.role));
  if (!sites.length) return client;
  return {
    ...client,
    accounts: { ...Object.fromEntries(sites.map((r) => [r.role, r.ref])), ...client.accounts },
  };
}

/** The accounts `client` hasn't connected for `c`: each one it needs, then one of its any. */
export const accountsLacking = (c: Component, client: Pick<Client, "accounts">): string[] => {
  const any = c.requires.anyAccount;
  return [
    ...c.requires.accounts.filter((site) => !client.accounts[site]),
    ...(any.length && !any.some((site) => client.accounts[site])
      ? [`one of ${any.join(", ")}`]
      : []),
  ];
};

/** What `client` still lacks for `c`: components not installed, then accounts not set. */
export const lacking = (c: Component, client: Pick<Client, "products" | "accounts">): string[] => [
  ...c.requires.components.filter((id) => !has(client, id)),
  ...accountsLacking(c, client),
];

/** A block that parses as `c`'s settings, or a 400 that says where it doesn't. */
export function blockOf(c: Component, block: unknown): Record<string, unknown> {
  if (block === undefined) return {};
  if (!block || typeof block !== "object" || Array.isArray(block))
    throw new PortalRefusal("settings are an object", 400);
  const out = c.settings.safeParse(block);
  if (!out.success)
    throw new PortalRefusal(
      `settings: ${out.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
      400,
    );
  return block as Record<string, unknown>;
}

/**
 * A part onto a client: ready, for clients, not there yet, what it needs already there, settings
 * that parse, and an id typed in when it has effects. On its own, that's its id and its accounts
 * must be connected; as a template's step (`template`), the template's id, and a missing account
 * leaves it waiting ("Needs your account") instead of refusing. A part that comes with a template
 * installs only through it.
 */
export function installCheck(
  c: Component,
  client: Pick<Client, "products" | "accounts">,
  ask: { settings?: unknown; confirm?: unknown; template?: string },
): Record<string, unknown> {
  if (c.for === "wren") throw new PortalRefusal("that runs Wren's own business", 409);
  if (!c.ready) throw new PortalRefusal(`not ready for a client: ${c.missing.join("; ")}`, 409);
  if (has(client, c.id)) throw new PortalRefusal("already installed: configure it", 409);
  if (c.comesWith && ask.template !== c.comesWith)
    throw new PortalRefusal(`it comes with the ${c.comesWith} template: install that`, 409);
  const lacks = ask.template
    ? c.requires.components.filter((id) => !has(client, id))
    : lacking(c, client);
  if (lacks.length) throw new PortalRefusal(`needs first: ${lacks.join(", ")}`, 409);
  const typed = ask.template ?? c.id;
  if (c.effects.length && ask.confirm !== typed)
    throw new PortalRefusal(`it ${c.effects.join(" and ")}: type ${typed} to confirm`, 400);
  return blockOf(c, ask.settings);
}
