/**
 * `wren accounts` (designs/2026-10-15-accounts-first-class.md): every account we speak as, the
 * same rows as Outreach → Accounts; one in full; a subreddit moved to another account; and the
 * account a draft goes out as, as the draft box's picker sets it. API keys are accounts too:
 * `keys` lists the operator's and each client's, `key rotate|revoke|spend` act on the operator's.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import { ingressOf, type Settings } from "@wren/config";
import { dollars, keyAccounts, VAULT_KEYS_KEY, type VaultKeys } from "@wren/core/vault-keys";
import type { Db } from "@wren/db";
import { movePlace, pickAccount, policyFrom } from "@wren/outreach";
import { accountRecordOf } from "@wren/outreach/records";
import type { Command } from "commander";
import { sql } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
type Row = Record<string, unknown>;

const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Keep a draft's account pick (`<kind>:<id>`); "default" or "" clears it. */
export async function pickFor(db: Db, item: string, account: string, by = "cli") {
  const key = account === "default" ? "" : account;
  return pickAccount(db, { item, account: key, by });
}

export function registerAccounts(program: Command, withDb: WithDb, settings: Settings): void {
  const rowsOf = (db: Db) =>
    accountRecordOf(policyFrom(settings)).rows?.(db) ?? Promise.resolve([] as Row[]);
  const cmd = program
    .command("accounts")
    .description(
      "Every account we post and reply as: health, warm-up, today's sends, places (Outreach → Accounts)",
    );
  cmd
    .command("list", { isDefault: true })
    .description("One line each: key, site, state, health, sent today, places")
    .option("--platform <p>", "only this site (reddit, linkedin, x)")
    .action(async (o: { platform?: string }) => {
      const rows = (await withDb(rowsOf)) as Row[];
      const shown = rows.filter((r) => !o.platform || r.platform === o.platform);
      if (!shown.length) console.log("no accounts");
      for (const r of shown)
        console.log(
          [r.account, r.platform, r.name, r.state, r.health, r.today, r.places]
            .map(cell)
            .join("\t"),
        );
    });
  cmd
    .command("show <key>")
    .description("One account in full, with its last 10 sends")
    .action(async (key: string) =>
      withDb(async (db) => {
        const row = ((await rowsOf(db)) as Row[]).find((r) => r.account === key);
        if (!row) throw new Error(`no account ${key}: see wren accounts list`);
        const sends = await db.execute(sql`
          select kind, at, what from (
            select 'dm' kind, m.sent_at at, left(m.body, 80) what from reach_messages m
              join reach_accounts a on a.id = m.account_id
              where a.account = ${key} and m.direction = 'out' and m.sent_at is not null
            union all select 'comment', c.answered_at, left(c.answer, 80) from comments c
              join reach_accounts a on a.id = c.account_id
              where a.account = ${key} and c.answered_at is not null
            union all select 'thread', t.answered_at, 'r/' || t.subreddit || ': ' || left(t.title, 60)
              from reddit_threads t join reach_accounts a on a.id = t.account_id
              where a.account = ${key} and t.answered_at is not null
            union all select 'onpost', commented_at, left(text, 80) from reach_posts
              where account = ${key} and commented_at is not null
          ) s order by at desc limit 10`);
        json({ ...row, recent: sends });
      }),
    );
  cmd
    .command("assign <subreddit> <account>")
    .description("Move a subreddit to another of our Reddit accounts (reddit@alt or its handle)")
    .action(async (subreddit: string, account: string) => {
      const sub = subreddit.replace(/^r\//i, "");
      await withDb((db) => movePlace(db, sub, account));
      console.log(`r/${sub} now comments as ${account}`);
    });
  cmd
    .command("pick <item> <account>")
    .description(
      "Send a draft as this account: item is thread:<id>, comment:<id>, dm:<id>, invite:<id>, onpost:<id> or draft:<id>; account `default` clears it",
    )
    .action(async (item: string, account: string) => {
      const pick = await withDb((db) => pickFor(db, item, account));
      console.log(
        pick
          ? `${item}: sends as ${pick.current ?? "the default"}${pick.options.find((x) => x.key === pick.current)?.warn ? ` (warning: ${pick.options.find((x) => x.key === pick.current)?.warn})` : ""}`
          : `${item}: its site has one account, nothing to pick`,
      );
    });
  cmd
    .command("keys")
    .description(
      "Every API key, the operator's and each client's: address, owner, purposes, state, spend this month, last used",
    )
    .option("--vendor <v>", "only this vendor (exa, youtube, ...)")
    .option("--client <id>", "only this client's own keys")
    .action(async (o: { vendor?: string; client?: string }) => {
      const keys = await withDb((db) =>
        keyAccounts(db, {
          ...(o.vendor ? { vendor: o.vendor } : {}),
          ...(o.client ? { client: o.client } : {}),
        }),
      );
      if (!keys.length) console.log("no keys");
      for (const k of keys)
        console.log(
          [
            k.address,
            k.origin === "vault" ? "operator" : "client",
            k.owner,
            k.purposes.join(",") || "-",
            k.until ? `${k.state} until ${k.until.toISOString().slice(0, 10)}` : k.state,
            k.spendMicros === null ? "-" : `$${dollars(k.spendMicros).toFixed(2)}`,
            k.lastUsedAt ? k.lastUsedAt.toISOString() : "never",
          ].join("\t"),
        );
    });
  const vault = () =>
    clients
      .connect(ingressOf(settings))
      .objectClient<VaultKeys>({ name: "VaultKeys" }, VAULT_KEYS_KEY);
  const key = cmd
    .command("key")
    .description("Act on an operator API key (a client's is rotated in Account → Vendors)");
  key
    .command("rotate <address>")
    .description("Start the vendor's mint flow on the Mac; the run asks in To approve")
    .action(async (address: string) => {
      const out = await vault().rotate({ address });
      console.log(`Rotation started: approve it in To approve (run ${out.run})`);
    });
  key
    .command("revoke <address>")
    .description("Out of use for good, in the vault; revoke the vendor's own copy by hand")
    .action(async (address: string) => json(await vault().revoke({ address })));
  key
    .command("spend <address>")
    .description("Mark out of credit until a date (the 1st of next month when none)")
    .option("--until <date>", "an ISO date")
    .action(async (address: string, o: { until?: string }) =>
      json(await vault().spend({ address, ...(o.until ? { until: o.until } : {}) })),
    );
}
