/**
 * `wren app-reviews`: the platform reviews Wren's social apps wait on (designs/2026-10-09-app-reviews.md).
 * A packet per review (fields, permission text, screencast, open items) with live checks of the
 * pages, callbacks, keys and icon it points at. Filing stays a person's act on the platform.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSsmEnv } from "@wren/config/ssm";
import {
  type Check,
  type CheckDeps,
  checkReview,
  ICON,
  packetOf,
  REVIEWS,
  reviewOf,
} from "@wren/content/connect/app-reviews";
import {
  listReviews,
  logReview,
  type ReviewView,
  reviewHistory,
} from "@wren/content/connect/review-log";
import { REVIEW_EVENTS, type ReviewEvent } from "@wren/content/connect/reviews-schema";
import { WREN } from "@wren/core/access";
import type { Db } from "@wren/db";
import { type Command, InvalidArgumentError } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const stateOf = (v: ReviewView | undefined) =>
  v
    ? [
        v.state,
        v.filedAt && `filed ${day(v.filedAt)}`,
        v.decidedAt && `decided ${day(v.decidedAt)}`,
        v.ticket && `ticket ${v.ticket}`,
      ]
        .filter(Boolean)
        .join(", ")
    : null;
const dateArg = (v: string) => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new InvalidArgumentError(`not a date: ${v}`);
  return d;
};

const PROD_PARAMS = "/wren/prod/env,/wren/prod/env-2";

export function registerAppReviews(program: Command, withMainDb: WithDb, rootDir: string): void {
  let names: Promise<Set<string> | null> | null = null;
  // Prod's key names from SSM; the values stay in this object and are never printed. Null when
  // AWS isn't reachable from here.
  const prodNames = () => {
    names ??= (async () => {
      const held: NodeJS.ProcessEnv = {};
      try {
        await loadSsmEnv(PROD_PARAMS, { env: held, log: () => {} });
        return new Set(Object.keys(held));
      } catch {
        return null;
      }
    })();
    return names;
  };
  const deps = async (): Promise<CheckDeps> => {
    const prod = await prodNames();
    return {
      fetch: (url) => fetch(url, { headers: { "user-agent": "wren-reviews/1" } }),
      hasKey: (name) => (prod ? prod.has(name) : null),
      icon: () => readFile(join(rootDir, ICON)).catch(() => null),
    };
  };
  const mark = (checks: readonly Check[]) => {
    const todo = checks.filter((c) => !c.ok).length;
    return todo ? `${todo} ${todo === 1 ? "check" : "checks"} to do` : "checks pass";
  };

  const reviews = program
    .command("app-reviews")
    .description(
      "Platform access reviews (Wren's and each client's): state, history, packets, checks",
    )
    .option("--client <id>", "whose reviews", WREN);
  const client = () => reviews.opts<{ client: string }>().client;
  reviews
    .command("list", { isDefault: true })
    .description("Each review: its state from the log, what it waits on, its checks")
    .option("--all", "every client's logged reviews")
    .action(async (o: { all?: boolean }) => {
      const logged = await withMainDb((db) => listReviews(db, o.all ? undefined : client()));
      if (o.all) {
        for (const v of logged)
          console.log(`${v.client.padEnd(24)} ${v.kind.padEnd(22)} ${stateOf(v)}`);
        return;
      }
      const byKind = new Map(logged.map((v) => [v.kind, v]));
      const d = await deps();
      const wide = Math.max(...REVIEWS.map((r) => r.name.length));
      for (const r of REVIEWS) {
        const v = byKind.get(r.id);
        byKind.delete(r.id);
        const checks = await checkReview(r, d);
        const open = r.open.length ? `, ${r.open.length} open` : "";
        const state =
          stateOf(v) ?? `not filed: ${checks.length ? mark(checks) : "no checks"}${open}`;
        const after = r.after.length && !v ? `  after ${r.after.join(", ")}` : "";
        console.log(`${r.id.padEnd(22)} ${r.name.padEnd(wide)} ${state}${after}`);
      }
      for (const v of byKind.values())
        console.log(`${v.kind.padEnd(22)} ${v.title.padEnd(wide)} ${stateOf(v)}`);
    });
  reviews
    .command("log <kind> <event> [note...]")
    .description(`Record a step: ${REVIEW_EVENTS.join(", ")}. It moves the state and is kept`)
    .option("--ticket <ref>", "the platform's ticket or case id")
    .option("--at <date>", "when it happened (default now)", dateArg)
    .option("--next <date>", "when to look again", dateArg)
    .option("--never", "nothing to look again for")
    .option("--name <text>", "a review not in the catalog: what it is")
    .option("--where <url>", "a review not in the catalog: where it's filed")
    .option("--by <who>", "who did it", "cli")
    .action(
      async (
        kind: string,
        event: string,
        note: string[],
        o: {
          ticket?: string;
          at?: Date;
          next?: Date;
          never?: boolean;
          name?: string;
          where?: string;
          by: string;
        },
      ) => {
        if (!REVIEW_EVENTS.includes(event as ReviewEvent))
          throw new Error(`no event ${event}: ${REVIEW_EVENTS.join(", ")}`);
        if (!reviewOf(kind) && !o.name)
          throw new Error(`${kind} isn't in the catalog: give --name (and --where)`);
        const row = await withMainDb((db) =>
          logReview(db, {
            client: client(),
            kind,
            event: event as ReviewEvent,
            by: o.by,
            note: note.length ? note.join(" ") : null,
            ticket: o.ticket ?? null,
            at: o.at,
            name: o.name ?? null,
            where: o.where ?? null,
            nextCheckAt: o.never ? null : o.next,
          }),
        );
        console.log(
          `${row.client} ${row.kind}: ${row.state}${row.nextCheckAt ? `, look again ${day(row.nextCheckAt)}` : ""}`,
        );
      },
    );
  reviews
    .command("history <kind>")
    .description("Every step of one review, oldest first")
    .action(async (kind: string) => {
      const h = await withMainDb((db) => reviewHistory(db, client(), kind));
      if (!h) {
        console.log(`${client()} ${kind}: nothing logged`);
        return;
      }
      console.log(`${h.review.client} ${h.review.kind}: ${h.review.state}`);
      if (h.review.reason) console.log(`  reason: ${h.review.reason}`);
      for (const e of h.events)
        console.log(
          `  ${day(e.at)} ${e.kind.padEnd(10)} ${e.by.padEnd(8)} ${[e.ticket && `[${e.ticket}]`, e.note].filter(Boolean).join(" ")}`,
        );
    });
  reviews
    .command("due")
    .description("Every client's reviews due a look: past their check date, or asked something")
    .action(async () => {
      const now = Date.now();
      const due = (await withMainDb((db) => listReviews(db))).filter(
        (v) => v.nextCheckAt && v.nextCheckAt.getTime() <= now,
      );
      for (const v of due)
        console.log(
          `${v.client.padEnd(24)} ${v.kind.padEnd(22)} ${v.state} since ${day(v.updatedAt)}`,
        );
      if (!due.length) console.log("none due");
    });
  reviews
    .command("packet <id>")
    .description("A review's packet as Markdown, with its checks run now")
    .option("--out <file>", "write it here instead of printing it")
    .option("--no-check", "skip the live checks")
    .action(async (id: string, o: { out?: string; check: boolean }) => {
      const r = reviewOf(id);
      if (!r) throw new Error(`no review ${id}: ${REVIEWS.map((x) => x.id).join(", ")}`);
      const logged = await withMainDb((db) => listReviews(db, client()));
      const text = packetOf(
        r,
        o.check ? await checkReview(r, await deps()) : null,
        stateOf(logged.find((v) => v.kind === id)),
      );
      if (!o.out) {
        process.stdout.write(text);
        return;
      }
      await writeFile(o.out, text);
      console.log(`wrote ${o.out}`);
    });
  reviews
    .command("check [id]")
    .description("Only the checks: pages, callbacks, prod keys, icon; exits 1 while any is to do")
    .action(async (id: string | undefined) => {
      const one = id ? reviewOf(id) : null;
      if (id && !one) throw new Error(`no review ${id}: ${REVIEWS.map((x) => x.id).join(", ")}`);
      const d = await deps();
      let todo = 0;
      for (const r of one ? [one] : REVIEWS) {
        const checks = await checkReview(r, d);
        if (!checks.length) continue;
        console.log(`${r.id}: ${mark(checks)}`);
        for (const c of checks) {
          if (!c.ok) todo++;
          console.log(`  ${c.ok ? "ok  " : "TODO"} ${c.need}: ${c.detail}`);
        }
      }
      if (todo) process.exitCode = 1;
    });
}
