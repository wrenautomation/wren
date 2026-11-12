/**
 * The agent's risky acts at the CLI (designs/2026-11-11-agent-panel.md, D2): each command in
 * `RISKY` calls `gate` before its action; `confirm` is a person's Yes from a terminal; `autonomy`
 * shows and sets the dial. An agent can neither answer its own ask nor move its own dial.
 */
import { WREN } from "@wren/core/access";
import {
  AUTONOMY,
  type Autonomy,
  autonomyOf,
  decideConfirm,
  gate,
  guardAutonomyChange,
  isAgent,
  NeedsConfirm,
  type Runner,
  setAutonomy,
} from "@wren/core/agent-gate";
import { RISKY_ACTS, type RiskyAct } from "@wren/core/confirms-schema";
import type { Db } from "@wren/db";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/**
 * Command path → its act. A new command that sends, spends, deletes or publishes goes here.
 * Loop start and sync commands are out: they carry out what a person already approved.
 */
export const RISKY: Readonly<Record<string, RiskyAct>> = {
  // send: an approval the worker then mails, or a message straight out
  "crm approve": "send",
  "email approve": "send",
  "email answers approve": "send",
  "sms reply": "send",
  "sms enroll": "send",
  "sms templates set": "send",
  "reach enroll": "send",
  "reach invites approve": "send",
  "reach invites set": "send",
  "reach posts comment": "send",
  "reach posts set": "send",
  "reach schedule": "send",
  "reach reply": "send",
  "newsletter send": "send",
  "delivery comment": "send",
  "delivery post": "send",
  "delivery deliver": "send",
  "delivery ask": "send",
  // spend: bills, and paid lookups per call
  "delivery invoice": "spend",
  "delivery onboard": "spend",
  "crm run": "spend",
  "crm lookup": "spend",
  "enrich profiles": "spend",
  "enrich signals": "spend",
  "people research": "spend",
  // delete: rows gone for good
  "clients remove": "delete",
  "clients members remove": "delete",
  "team remove": "delete",
  "keys remove": "delete",
  "features remove": "delete",
  "limits unset": "delete",
  "webhooks remove": "delete",
  "workflows remove-template": "delete",
  "folders remove": "delete",
  "templates prune": "delete",
  // publish: live to the public
  "sites approve": "publish",
  "content approve": "publish",
  "content respread": "publish",
  "content planner start": "publish",
  "video approve": "publish",
  "video demo render": "publish",
};

/** Every command's path, from the root: `["crm", "approve"]`. */
const pathOf = (cmd: Command, root: Command): string[] => {
  const path: string[] = [];
  for (let c: Command | null = cmd; c && c !== root; c = c.parent) path.unshift(c.name());
  return path;
};

/** What the card says: the command as typed, cut to a line. */
const whatOf = (path: string, argv: readonly string[]) =>
  `wren ${[path, ...argv].join(" ")}`.slice(0, 300);

export function registerGate(program: Command, withMainDb: WithDb, runner: Runner): void {
  program.hook("preAction", async (_root, action) => {
    const path = pathOf(action, program).join(" ");
    if (path === "clients set") {
      const o = action.opts<{ set?: string[]; unset?: string[] }>();
      guardAutonomyChange(runner.actor, [
        ...(o.set ?? []).map((a) => a.split("=")[0] ?? ""),
        ...(o.unset ?? []),
      ]);
    }
    const act = RISKY[path];
    if (!act || !isAgent(runner.actor)) return;
    const client = program.opts<{ client?: string }>().client ?? WREN;
    // the args after the command path: the same command, run again, matches its Yes
    const argv = process.argv.slice(2);
    try {
      await withMainDb((db) =>
        gate(db, runner, { act, client, what: whatOf(path, action.args), command: path, argv }),
      );
    } catch (err) {
      if (!(err instanceof NeedsConfirm)) throw err;
      console.log(JSON.stringify({ needsConfirm: err.id, act: err.act, what: err.what }));
      console.error(err.message);
      process.exit(3);
    }
  });

  program
    .command("confirm <id>")
    .description("A person's Yes (or --no) to an agent's ask. Never from the agent itself.")
    .option("--refuse", "say no")
    .action(async (id: string, opts: { refuse?: boolean }) => {
      if (isAgent(runner.actor) || process.env.CLAUDECODE)
        throw new Error("the agent can't answer its own ask; a person says Yes in the chat");
      // the terminal is the Mac owner's: an admin
      const row = await withMainDb((db) =>
        decideConfirm(db, { id, yes: !opts.refuse, by: runner.actor, admin: true }),
      );
      console.log(JSON.stringify(row));
    });

  const dial = program
    .command("autonomy")
    .description("What the agent may do on its own: per act, auto, approve (ask first) or off");
  dial
    .command("show")
    .description("Each act's level here, set or by default")
    .option("--as <actor>", "for this agent actor (default: claude-code:<you>)")
    .action(async (opts: { as?: string }) => {
      const client = program.opts<{ client?: string }>().client ?? WREN;
      const actor = opts.as ?? runner.actor;
      const out = await withMainDb(async (db) =>
        Object.fromEntries(
          await Promise.all(
            RISKY_ACTS.map(async (a) => [a, await autonomyOf(db, actor, a, client)] as const),
          ),
        ),
      );
      console.log(JSON.stringify({ client, actor, ...out }));
    });
  dial
    .command("check")
    .description(
      "Exit 1 when a gated command in the list is missing from the CLI (renamed or moved)",
    )
    .action(() => {
      const have = new Set<string>();
      const walk = (c: Command) => {
        for (const sub of c.commands) {
          have.add(pathOf(sub, program).join(" "));
          walk(sub);
        }
      };
      walk(program);
      const missing = Object.keys(RISKY).filter((p) => !have.has(p));
      console.log(JSON.stringify({ gated: Object.keys(RISKY).length, missing }));
      if (missing.length) process.exitCode = 1;
    });
  dial
    .command("set <pairs...>")
    .description("send=approve spend=off …; `act=default` clears it")
    .action(async (pairs: string[]) => {
      guardAutonomyChange(runner.actor, [AUTONOMY]);
      const client = program.opts<{ client?: string }>().client ?? WREN;
      const change: Partial<Record<RiskyAct, Autonomy | null>> = {};
      for (const p of pairs) {
        const [act, level] = p.split("=");
        if (!(RISKY_ACTS as readonly string[]).includes(act ?? ""))
          throw new Error(`act is one of ${RISKY_ACTS.join(", ")}`);
        if (!["auto", "approve", "off", "default"].includes(level ?? ""))
          throw new Error("level is auto, approve, off or default");
        change[act as RiskyAct] = level === "default" ? null : (level as Autonomy);
      }
      const block = await withMainDb((db) => setAutonomy(db, client, change, runner.actor));
      console.log(JSON.stringify({ client, [AUTONOMY]: block }));
    });
}
