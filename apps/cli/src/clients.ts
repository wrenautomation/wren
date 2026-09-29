/**
 * `wren clients …`: the client registry. Always runs on the main database;
 * `--client` scopes other commands to a client's own database.
 */
import type { Settings } from "@wren/config";
import {
  addClient,
  type Client,
  getClient,
  listClients,
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
    `portal: ${c.portalEmails.join(",") || "-"}`,
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
    .option("--portal-email <email>", "who may log in to the portal, repeatable", collect)
    .option("--demo", "the demo: masked, no login, no writes, no sends")
    .action(
      async (
        id: string,
        opts: {
          name: string;
          account?: string[];
          set?: string[];
          portalEmail?: string[];
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
            portalEmails: opts.portalEmail ?? [],
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
    .description("Change a client's name, accounts, product settings or portal emails")
    .option("--name <name>")
    .option("--account <site=account>", "merged in; site= turns it off", collect)
    .option("--set <product.path=value>", "a product setting (JSON or text), repeatable", collect)
    .option("--unset <product.path>", "back to the default, repeatable", collect)
    .option("--portal-email <email>", "replaces the list, repeatable", collect)
    .action(
      async (
        id: string,
        opts: {
          name?: string;
          account?: string[];
          set?: string[];
          unset?: string[];
          portalEmail?: string[];
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
            ...(opts.portalEmail ? { portalEmails: opts.portalEmail } : {}),
          });
        });
        console.log(show(client));
        await warnShared(withMainDb);
      },
    );
}
