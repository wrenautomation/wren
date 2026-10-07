/**
 * `wren clients …`: the client registry. Always runs on the main database;
 * `--client` scopes other commands to a client's own database.
 */
import type { Settings } from "@wren/config";
import {
  APPROVERS,
  type Approver,
  addClient,
  addMember,
  type Client,
  endSessions,
  findClient,
  getClient,
  listClients,
  listMembers,
  MEMBER_ROLES,
  type MemberRole,
  operators,
  removeMember,
  removeTeamSeat,
  setTeamSeat,
  sharedAccounts,
  TEAM_ROLES,
  type TeamRole,
  updateClient,
} from "@wren/core/clients";
import type { Db } from "@wren/db";
import { COMPONENTS } from "@wren/worker/components";
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
    `approver: ${c.approver}`,
    `sends: ${c.sends.join(",") || "off"}`,
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
        const client = await withMainDb(async (db) => {
          if (await findClient(db, id)) throw new Error(`client ${id} exists`);
          return addClient(db, settings.databaseUrl, {
            id,
            name: opts.name,
            accounts: accountPairs(opts.account),
            products: Object.fromEntries(
              Object.entries(productChange({}, opts.set)).filter(([, b]) => b !== null),
            ),
            demo: opts.demo ?? false,
          });
        });
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
    .description("Change a client's name, accounts, approver or product settings")
    .option("--name <name>")
    .option("--approver <who>", "who approves its emails: wren, client or either")
    .option("--account <site=account>", "merged in; site= turns it off", collect)
    .option("--set <product.path=value>", "a product setting (JSON or text), repeatable", collect)
    .option("--unset <product.path>", "back to the default, repeatable", collect)
    .option("--live <part>", "turn a part's sends on for this client (admin), repeatable", collect)
    .option("--live-off <part>", "turn a part's sends off for this client, repeatable", collect)
    .action(
      async (
        id: string,
        opts: {
          name?: string;
          approver?: string;
          account?: string[];
          set?: string[];
          unset?: string[];
          live?: string[];
          liveOff?: string[];
        },
      ) => {
        const switches = COMPONENTS.filter((c) => c.liveSwitch).map((c) => c.id);
        for (const part of [...(opts.live ?? []), ...(opts.liveOff ?? [])])
          if (!switches.includes(part))
            throw new Error(`--live takes a part with sends: ${switches.join(", ")}`);
        const approver = opts.approver;
        if (approver !== undefined && !(APPROVERS as readonly string[]).includes(approver))
          throw new Error(`--approver is one of ${APPROVERS.join(", ")}`);
        const client = await withMainDb(async (db) => {
          const current = await getClient(db, id);
          const products =
            opts.set || opts.unset ? productChange(current.products, opts.set, opts.unset) : null;
          return updateClient(db, id, {
            ...(opts.name ? { name: opts.name } : {}),
            ...(approver ? { approver: approver as Approver } : {}),
            ...(opts.account ? { accounts: accountPairs(opts.account) } : {}),
            ...(products ? { products } : {}),
            ...(opts.live || opts.liveOff
              ? {
                  // The whole list: what was on, plus --live, minus --live-off. Audited by the row trigger.
                  sends: [...current.sends, ...(opts.live ?? [])].filter(
                    (p) => !opts.liveOff?.includes(p),
                  ),
                }
              : {}),
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
    const gone = await withMainDb(async (db) => {
      const out = await removeMember(db, id, email);
      if (out) await endSessions(db, email);
      return out;
    });
    console.log(
      gone ? `${email} no longer sees ${id}, signed out` : `${email} was not a member of ${id}`,
    );
  });

  const team = program
    .command("team")
    .description(
      "Wren's own people: admin (everything), operator (no money, effects, installs or team), viewer (reads)",
    );
  team.command("ls").action(async () => {
    const seats = await withMainDb((db) => db.select().from(operators).orderBy(operators.email));
    for (const o of seats)
      console.log([o.email.padEnd(36), o.role.padEnd(8), o.clients?.join(",") ?? "all"].join("  "));
  });
  const seat = (opts: { role?: string; clients?: string }) => {
    if (opts.role !== undefined && !TEAM_ROLES.includes(opts.role as TeamRole))
      throw new Error(`--role is one of ${TEAM_ROLES.join(", ")}`);
    return {
      ...(opts.role ? { role: opts.role as TeamRole } : {}),
      ...(opts.clients === undefined
        ? {}
        : {
            clients: opts.clients === "all" ? null : opts.clients.split(",").map((c) => c.trim()),
          }),
    };
  };
  for (const [name, what] of [
    ["add", "Put this email on the team (an operator unless --role)"],
    ["set", "Change a seat: --role, --clients; a narrower seat signs them out"],
  ] as const)
    team
      .command(`${name} <email>`)
      .description(what)
      .option("--role <role>", TEAM_ROLES.join(" | "))
      .option("--clients <ids>", "client ids split by commas, wren for Wren's apps, or all")
      .action(async (email: string, opts: { role?: string; clients?: string }) => {
        const s = await withMainDb((db) => setTeamSeat(db, email, seat(opts)));
        console.log(`${s.email} is ${s.role} over ${s.clients?.join(", ") ?? "every client"}`);
      });
  team
    .command("rm <email>")
    .description("Take them off the team and sign them out; the last admin stays")
    .action(async (email: string) => {
      const gone = await withMainDb((db) => removeTeamSeat(db, email));
      console.log(gone ? `${email} is off the team, signed out` : `${email} was not on the team`);
    });
}
