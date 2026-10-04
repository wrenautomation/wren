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
  type Queryable,
  setAuditActor,
} from "@wren/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { date, defineRecord, number, status, text } from "../records.js";
import {
  type Client,
  type ClientMember,
  clientMembers,
  clients,
  type MemberRole,
  operators,
} from "./schema.js";

export * from "./schema.js";

export interface NewClient {
  id: string;
  name: string;
  accounts?: Record<string, string>;
  products?: Record<string, unknown>;
  demo?: boolean;
}

/**
 * Create the client's database, migrate it, then register it. The row is written
 * last, so a registered client always has a ready database. Safe to retry: a
 * registered client comes back as it is, a database already made is kept and
 * migrated again (idempotent), and the insert skips a row a racing add wrote.
 * The caller refuses an id that's taken. `by` names who in the audit log.
 */
export async function addClient(
  main: Db,
  mainUrl: string,
  input: NewClient,
  by?: string,
): Promise<Client> {
  const found = await findClient(main, input.id);
  if (found) return found;
  const database = clientDatabaseName(input.id);
  await createDatabase(main, database);
  await migrateClient(mainUrl, database);
  await main.transaction(async (tx) => {
    if (by) await setAuditActor(tx, by);
    await tx
      .insert(clients)
      .values({
        id: input.id,
        name: input.name,
        database,
        accounts: input.accounts ?? {},
        products: input.products ?? {},
        demo: input.demo ?? false,
      })
      .onConflictDoNothing();
  });
  return getClient(main, input.id);
}

export async function listClients(main: Db): Promise<Client[]> {
  return main.select().from(clients).orderBy(asc(clients.id));
}

export async function findClient(main: Queryable, id: string): Promise<Client | null> {
  const [row] = await main.select().from(clients).where(eq(clients.id, id));
  return row ?? null;
}

export async function getClient(main: Queryable, id: string): Promise<Client> {
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

/** Emails are compared lowercase everywhere: the sign-in, the registry, the token. */
export const normalEmail = (email: string) => email.trim().toLowerCase();

/** Add someone to a client, or change their role. */
export async function addMember(
  main: Queryable,
  clientId: string,
  email: string,
  opts: { role?: MemberRole; invitedBy?: string } = {},
): Promise<ClientMember> {
  await getClient(main, clientId);
  const role = opts.role ?? "member";
  const [row] = await main
    .insert(clientMembers)
    .values({ clientId, email: normalEmail(email), role, invitedBy: opts.invitedBy ?? null })
    .onConflictDoUpdate({ target: [clientMembers.clientId, clientMembers.email], set: { role } })
    .returning();
  if (!row) throw new Error(`client ${clientId}: member insert returned nothing`);
  return row;
}

export async function removeMember(
  main: Queryable,
  clientId: string,
  email: string,
): Promise<boolean> {
  const gone = await main
    .delete(clientMembers)
    .where(and(eq(clientMembers.clientId, clientId), eq(clientMembers.email, normalEmail(email))))
    .returning();
  return gone.length > 0;
}

export async function listMembers(main: Queryable, clientId: string): Promise<ClientMember[]> {
  return main
    .select()
    .from(clientMembers)
    .where(eq(clientMembers.clientId, clientId))
    .orderBy(asc(clientMembers.email));
}

export const isOwner = async (main: Queryable, clientId: string, email: string) =>
  (await listMembers(main, clientId)).some(
    (m) => m.email === normalEmail(email) && m.role === "owner",
  );

export async function addOperator(main: Db, email: string): Promise<void> {
  await main
    .insert(operators)
    .values({ email: normalEmail(email) })
    .onConflictDoNothing();
}

export async function removeOperator(main: Db, email: string): Promise<boolean> {
  return (
    (
      await main
        .delete(operators)
        .where(eq(operators.email, normalEmail(email)))
        .returning()
    ).length > 0
  );
}

export async function listOperators(main: Db): Promise<string[]> {
  return (await main.select().from(operators).orderBy(asc(operators.email))).map((o) => o.email);
}

export async function isOperator(main: Db, email: string): Promise<boolean> {
  const [row] = await main
    .select()
    .from(operators)
    .where(eq(operators.email, normalEmail(email)));
  return row !== undefined;
}

/** May this email have a Wren account? An operator, or a member of any client. Sign-in asks this. */
export async function mayHaveAccount(main: Db, email: string): Promise<boolean> {
  const e = normalEmail(email);
  const [row] = await main.execute<{ ok: boolean }>(
    sql`select exists (select 1 from ${operators} where ${operators.email} = ${e})
        or exists (select 1 from ${clientMembers} where ${clientMembers.email} = ${e}) as ok`,
  );
  return row?.ok === true;
}

/** Mark that someone opened the portal. Best effort: a missed stamp is harmless. */
export async function touchMember(main: Db, email: string): Promise<void> {
  await main
    .update(clientMembers)
    .set({ lastSeenAt: new Date() })
    .where(eq(clientMembers.email, normalEmail(email)));
}

/** Wren's clients as a console record, over `client_records`. */
export const clientRecord = defineRecord({
  id: "console.client",
  name: { one: "client", many: "clients" },
  view: "client_records",
  key: "id",
  title: "name",
  subtitle: "products",
  fields: {
    name: text("Client"),
    kind: status({
      client: { label: "Client", tone: "good" },
      demo: { label: "Demo", tone: "neutral" },
    }),
    products: text(),
    members: number(),
    lastSeen: date("Last sign-in"),
    added: date(),
  },
  views: [
    { id: "clients", label: "Clients", where: { kind: "client" }, sort: "-added", at: "added" },
    { id: "all", label: "All", sort: "-added", at: "added" },
  ],
  // addClient takes `{id, name}`; invite takes `{client, email, role}` (DeliveryPortal).
  actions: ["console.addClient", "delivery.invite"],
});
