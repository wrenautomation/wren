/**
 * `wren clients …`: the client registry. Always runs on the main database;
 * `--client` scopes other commands to a client's own database.
 */
import type { Settings } from "@wren/config";
import {
  addClient,
  addMember,
  addOperator,
  type Client,
  getClient,
  listClients,
  listMembers,
  listOperators,
  MEMBER_ROLES,
  type MemberRole,
  removeMember,
  removeOperator,
  sharedAccounts,
  updateClient,
} from "@wren/core/clients";
import type { Db } from "@wren/db";
import type { Command } from "commander";
import { changeProducts, parseAssignment, pathOf } from "./products.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const collect = (v: string, prev: string[] = []) => [...prev, v];

/** "site=account" pairs -> { site: account }. An empty account turns the site off. */
function accountPairs(pairs: string[] = []): Record<string, string> {
  return Object.fromEntries(pairs.map((p) => split(p, "--account")));
}

/** `--set` and `--unset` against a client's product blocks: only the blocks touched. */
const productChange = (
  current: Record<string, unknown>,
  set: string[] = [],
  unset: string[] = [],
) => changeProducts(current, set.map(parseAssignment), unset.map(pathOf));

function split(pair: string, flag: string): [string, string] {
  const at = pair.indexOf("=");
  if (at <= 0) throw new Error(`${flag} expects name=value, got ${JSON.stringify(pair)}`);
  return [pair.slice(0, at), pair.slice(at + 1)];
}

/** Say so when an account now serves two clients. */
async function warnShared(withMainDb: WithDb): Promise<void> {
  for (const w of sharedAccounts(await withMainDb((db) => listClients(db))))
    console.warn(`warning: ${w}`);
}

function show(c: Client): string {
  const accounts =
    Object.entries(c.accounts)
      .map(([s, a]) => `${s}=${a}`)
      .join(" ") || "-";
  return [
    c.id.padEnd(16),
    c.demo ? "demo" : "    ",
    c.database.padEnd(28),
    `accounts: ${accounts}`,
    `products: ${Object.keys(c.products).join(",") || "-"}`,
    `(${c.name})`,
  ].join("  ");
}

export function registerClients(program: Command, withMainDb: WithDb, settings: Settings): void {
  const cmd = program
    .command("clients")
    .description(
      "the client registry: one database per client (use --client <id> on other commands)",
    );

  cmd
    .command("add <id>")
    .description("Create the client's database, migrate it, register it")
    .requiredOption("--name <name>", "the firm's name (stays in the database, never in git)")
    .option("--account <site=account>", "autobrowse account per site, repeatable", collect)
    .option("--set <product.path=value>", "a product setting (JSON or text), repeatable", collect)
    .option("--demo", "the demo: masked, no login, no writes, no sends")
    .action(
      async (
        id: string,
        opts: {
          name: string;
          account?: string[];
          set?: string[];
          demo?: boolean;
        },
      ) => {
        const client = await withMainDb((db) =>
          addClient(db, settings.databaseUrl, {
            id,
            name: opts.name,
            accounts: accountPairs(opts.account),
            products: Object.fromEntries(
              Object.entries(productChange({}, opts.set)).filter(([, b]) => b !== null),
            ),
            demo: opts.demo ?? false,
          }),
        );
        console.log(show(client));
        await warnShared(withMainDb);
      },
    );

  cmd.command("list").action(async () => {
    for (const c of await withMainDb((db) => listClients(db))) console.log(show(c));
    await warnShared(withMainDb);
  });

  cmd
    .command("set <id>")
    .description("Change a client's name, accounts or product settings")
    .option("--name <name>")
    .option("--account <site=account>", "merged in; site= turns it off", collect)
    .option("--set <product.path=value>", "a product setting (JSON or text), repeatable", collect)
    .option("--unset <product.path>", "back to the default, repeatable", collect)
    .action(
      async (
        id: string,
        opts: {
          name?: string;
          account?: string[];
          set?: string[];
          unset?: string[];
        },
      ) => {
        const client = await withMainDb(async (db) => {
          const current = await getClient(db, id);
          const products =
            opts.set || opts.unset ? productChange(current.products, opts.set, opts.unset) : null;
          return updateClient(db, id, {
            ...(opts.name ? { name: opts.name } : {}),
            ...(opts.account ? { accounts: accountPairs(opts.account) } : {}),
            ...(products ? { products } : {}),
          });
        });
        console.log(show(client));
        await warnShared(withMainDb);
      },
    );

  const members = cmd
    .command("members")
    .description("who sees a client in the portal (app.wrenautomation.com), by sign-in email");

  members.command("list <id>").action(async (id: string) => {
    for (const m of await withMainDb((db) => listMembers(db, id)))
      console.log(
        [
          m.email.padEnd(36),
          m.role.padEnd(6),
          `seen: ${m.lastSeenAt?.toISOString() ?? "never"}`,
        ].join("  "),
      );
  });

  members
    .command("add <id> <email>")
    .description("Let this email sign in and see the client; again changes the role")
    .option("--role <role>", `${MEMBER_ROLES.join(" | ")}; an owner invites teammates`, "member")
    .action(async (id: string, email: string, opts: { role: string }) => {
      if (!MEMBER_ROLES.includes(opts.role as MemberRole))
        throw new Error(`--role is one of ${MEMBER_ROLES.join(", ")}`);
      const m = await withMainDb((db) =>
        addMember(db, id, email, { role: opts.role as MemberRole }),
      );
      console.log(
        `${m.email} is a ${m.role} of ${id}; they sign in at https://app.wrenautomation.com`,
      );
    });

  members.command("remove <id> <email>").action(async (id: string, email: string) => {
    const gone = await withMainDb((db) => removeMember(db, id, email));
    console.log(gone ? `${email} no longer sees ${id}` : `${email} was not a member of ${id}`);
  });

  const ops = program
    .command("operators")
    .description("Wren's own people: they see every client and the operator tools");
  ops.command("list").action(async () => {
    for (const e of await withMainDb((db) => listOperators(db))) console.log(e);
  });
  ops.command("add <email>").action(async (email: string) => {
    await withMainDb((db) => addOperator(db, email));
    console.log(`${email} is an operator (takes effect on their next token, within 15 minutes)`);
  });
  ops.command("remove <email>").action(async (email: string) => {
    const gone = await withMainDb((db) => removeOperator(db, email));
    console.log(
      gone
        ? `${email} is no longer an operator (within 15 minutes)`
        : `${email} was not an operator`,
    );
  });
}
