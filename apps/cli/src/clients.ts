/**
 * `wren clients …`: the client registry. Always runs on the main database;
 * `--client` scopes other commands to a client's own database.
 */
import type { Settings } from "@wren/config";
import {
  addClient,
  type Client,
  listClients,
  sharedAccounts,
  updateClient,
} from "@wren/core/clients";
import type { Db } from "@wren/db";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const collect = (v: string, prev: string[] = []) => [...prev, v];

/** "site=account" pairs -> { site: account }. An empty account turns the site off. */
function accountPairs(pairs: string[] = []): Record<string, string> {
  return Object.fromEntries(pairs.map((p) => split(p, "--account")));
}

/** "name=n" pairs -> { name: n }. A negative n removes the cap. */
function capPairs(pairs: string[] = []): Record<string, number> {
  return Object.fromEntries(
    pairs.map((p) => {
      const [name, raw] = split(p, "--cap");
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new Error(`--cap ${p}: the value must be a whole number`);
      return [name, n];
    }),
  );
}

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
  const caps =
    Object.entries(c.caps)
      .map(([k, n]) => `${k}=${n}`)
      .join(" ") || "-";
  return [
    c.id.padEnd(16),
    c.demo ? "demo" : "    ",
    c.database.padEnd(28),
    `accounts: ${accounts}`,
    `caps: ${caps}`,
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
    .option("--cap <name=n>", "per-run limit, repeatable", collect)
    .option("--portal-email <email>", "who may log in to the portal, repeatable", collect)
    .option("--demo", "the demo: masked, no login, no writes, no sends")
    .action(
      async (
        id: string,
        opts: {
          name: string;
          account?: string[];
          cap?: string[];
          portalEmail?: string[];
          demo?: boolean;
        },
      ) => {
        const client = await withMainDb((db) =>
          addClient(db, settings.databaseUrl, {
            id,
            name: opts.name,
            accounts: accountPairs(opts.account),
            caps: capPairs(opts.cap),
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
    .description("Change a client's name, accounts, caps or portal emails")
    .option("--name <name>")
    .option("--account <site=account>", "merged in; site= turns it off", collect)
    .option("--cap <name=n>", "merged in; a negative n removes it", collect)
    .option("--portal-email <email>", "replaces the list, repeatable", collect)
    .action(
      async (
        id: string,
        opts: { name?: string; account?: string[]; cap?: string[]; portalEmail?: string[] },
      ) => {
        const client = await withMainDb((db) =>
          updateClient(db, id, {
            ...(opts.name ? { name: opts.name } : {}),
            ...(opts.account ? { accounts: accountPairs(opts.account) } : {}),
            ...(opts.cap ? { caps: capPairs(opts.cap) } : {}),
            ...(opts.portalEmail ? { portalEmails: opts.portalEmail } : {}),
          }),
        );
        console.log(show(client));
        await warnShared(withMainDb);
      },
    );
}
