/**
 * The client registry: who the clients are and where their databases live.
 * Every function here runs on the main database.
 */
import {
  clientDatabaseName,
  clientDatabaseUrl,
  createDatabase,
  type Db,
  migrateClient,
} from "@wren/db";
import { asc, eq } from "drizzle-orm";
import { type Client, clients } from "./schema.js";

export * from "./schema.js";

export interface NewClient {
  id: string;
  name: string;
  accounts?: Record<string, string>;
  products?: Record<string, unknown>;
  portalEmails?: string[];
  demo?: boolean;
}

/**
 * Create the client's database, migrate it, then register it. The row is written
 * last, so a registered client always has a ready database. Re-running after a
 * half-done add picks up where it stopped.
 */
export async function addClient(main: Db, mainUrl: string, input: NewClient): Promise<Client> {
  const database = clientDatabaseName(input.id);
  if (await findClient(main, input.id)) throw new Error(`client ${input.id} exists`);
  await createDatabase(main, database);
  await migrateClient(mainUrl, database);
  const [row] = await main
    .insert(clients)
    .values({
      id: input.id,
      name: input.name,
      database,
      accounts: input.accounts ?? {},
      products: input.products ?? {},
      portalEmails: (input.portalEmails ?? []).map((e) => e.trim().toLowerCase()),
      demo: input.demo ?? false,
    })
    .returning();
  if (!row) throw new Error(`client ${input.id}: insert returned nothing`);
  return row;
}

export async function listClients(main: Db): Promise<Client[]> {
  return main.select().from(clients).orderBy(asc(clients.id));
}

export async function findClient(main: Db, id: string): Promise<Client | null> {
  const [row] = await main.select().from(clients).where(eq(clients.id, id));
  return row ?? null;
}

export async function getClient(main: Db, id: string): Promise<Client> {
  const row = await findClient(main, id);
  if (!row) throw new Error(`unknown client ${id}; see \`wren clients list\``);
  return row;
}

export interface ClientChange {
  name?: string;
  /** Merged in; an empty value turns that site off. */
  accounts?: Record<string, string>;
  /** Per product: a block replaces that product's settings, null removes them. The caller validates. */
  products?: Record<string, unknown>;
  /** Replaces the list. */
  portalEmails?: string[];
}

export async function updateClient(main: Db, id: string, change: ClientChange): Promise<Client> {
  const current = await getClient(main, id);
  const accounts = { ...current.accounts, ...change.accounts };
  for (const [site, account] of Object.entries(accounts)) if (!account) delete accounts[site];
  // null removes a product; undefined leaves it as it was.
  const products: Record<string, unknown> = { ...current.products };
  for (const [name, block] of Object.entries(change.products ?? {}))
    if (block === null) delete products[name];
    else if (block !== undefined) products[name] = block;
  const [row] = await main
    .update(clients)
    .set({
      name: change.name ?? current.name,
      accounts,
      products,
      portalEmails: change.portalEmails?.map((e) => e.trim().toLowerCase()) ?? current.portalEmails,
    })
    .where(eq(clients.id, id))
    .returning();
  if (!row) throw new Error(`client ${id}: update returned nothing`);
  return row;
}

/**
 * Accounts two clients share. Each client should research from its own account:
 * a shared one splits one daily cap and ties one client's use to another's.
 */
export function sharedAccounts(all: readonly Pick<Client, "id" | "accounts">[]): string[] {
  const users = new Map<string, string[]>();
  for (const c of all)
    for (const [site, account] of Object.entries(c.accounts)) {
      const k = `${site}=${account}`;
      users.set(k, [...(users.get(k) ?? []), c.id]);
    }
  return [...users]
    .filter(([, ids]) => ids.length > 1)
    .map(([k, ids]) => `${k} is shared by ${ids.join(", ")}: one daily cap between them`);
}

/** Where this client's data lives. */
export function clientUrl(mainUrl: string, client: Pick<Client, "database">): string {
  return clientDatabaseUrl(mainUrl, client.database);
}
