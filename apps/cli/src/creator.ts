/**
 * `wren creator add | list | remove | refresh | promote` and `wren feed`: the creator index
 * (designs/2026-11-12-eden-method.md §3, option A). Reads go through `weaver posts` (the key-gate
 * shim); rows land in `tracked_creators`, `creator_posts` and the day tables; promote writes Canon.
 */
import { spawnSync } from "node:child_process";
import { parseHandle } from "@wren/core/touches";
import type { Db } from "@wren/db";
import {
  type CreatorRead,
  creatorSource,
  dueCreators,
  FEED_PRESETS,
  type FeedFilter,
  type FeedPreset,
  type FeedRow,
  feedPosts,
  HandleError,
  keepCreatorRead,
  listCreators,
  markCreatorPromoted,
  markPostPromoted,
  markReadFailed,
  POST_KINDS,
  trackCreator,
  untrackCreator,
} from "@wren/research/creators";
import type { Command } from "commander";
import type { CanonWrites } from "./canon.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/** posts a read asks for */
const READ_POSTS = 60;
/** creators read per run */
const READ_LIMIT = 40;

const int = (v: string) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`);
  return n;
};
const many = (v: string, acc: string[] = []) => [...acc, ...v.split(",").filter(Boolean)];
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** `--account instagram=lana`: the reading account per platform; none means the site refuses */
const accountsOf = (pairs: string[] = []) =>
  Object.fromEntries(
    pairs.map((p) => {
      const [k, v] = p.split("=");
      if (!k || !v) throw new Error(`--account takes platform=name: ${p}`);
      return [k, v];
    }),
  );

/** One creator through `weaver posts <url> --json`. */
function readCreator(url: string, n: number, accounts: Record<string, string>): CreatorRead {
  const args = ["posts", url, "-n", String(n), "--json"];
  for (const [site, name] of Object.entries(accounts)) args.push("--account", `${site}=${name}`);
  const r = spawnSync("weaver", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`weaver posts ${url}: ${(r.stderr || r.stdout).trim()}`);
  return JSON.parse(r.stdout) as CreatorRead;
}

const feedLine = (p: FeedRow) =>
  [
    `${(p.multiple ?? 0).toFixed(1)}x`.padStart(7),
    (p.scoreCount ?? "").padEnd(5),
    p.platform.padEnd(9),
    p.kind.padEnd(5),
    `@${p.handle}`,
    p.postedAt?.slice(0, 10) ?? "",
    p.url,
    p.title ?? p.text?.replace(/\s+/g, " ").slice(0, 100) ?? "",
  ].join("  ");

export function registerCreator(program: Command, withDb: WithDb, canon: CanonWrites): void {
  const creator = program
    .command("creator")
    .description(
      "the creator index: tracked creators, their posts and counts per day, outlier scores",
    );

  creator
    .command("add <profiles...>")
    .description("track creators by profile URL, or by handle with --platform")
    .option("--platform <name>", "the platform of bare handles")
    .requiredOption("--niche <name...>", "niches (repeat or comma list)", many)
    .option("--note <text>", "why tracked, in the adder's words")
    .option("--by <name>", "who added them", "william")
    .option("--json", "JSON out")
    .action(
      (
        profiles: string[],
        o: { platform?: string; niche: string[]; note?: string; by: string; json?: boolean },
      ) =>
        withDb(async (db) => {
          const out: Record<string, unknown>[] = [];
          for (const p of profiles) {
            const platform = o.platform ?? parseHandle(p)?.platform;
            if (!platform) {
              out.push({ profile: p, error: "no platform: pass a profile URL or --platform" });
              continue;
            }
            try {
              const c = await trackCreator(db, {
                platform,
                handle: p,
                niches: o.niche,
                ...(o.note ? { note: o.note } : {}),
                addedBy: o.by,
              });
              out.push({ id: c.id, platform, handle: c.handle, niches: c.niches, added: c.added });
            } catch (e) {
              if (!(e instanceof HandleError)) throw e;
              out.push({ profile: p, error: e.message });
            }
          }
          for (const r of out) console.log(JSON.stringify(r));
          if (out.some((r) => r.error)) process.exitCode = 1;
        }),
    );

  creator
    .command("list")
    .description("tracked creators: followers, stored posts, last read, Canon record")
    .option("--niche <name>", "one niche")
    .option("--all", "with the removed ones")
    .option("--json", "JSON out")
    .action((o: { niche?: string; all?: boolean; json?: boolean }) =>
      withDb(async (db) => {
        const rows = await listCreators(db, o);
        if (o.json) return void console.log(JSON.stringify(rows, null, 2));
        for (const r of rows)
          console.log(
            [
              String(r.id).padStart(4),
              r.platform.padEnd(9),
              `@${r.handle}`.padEnd(24),
              `${r.followers ?? "?"} fol`.padEnd(12),
              `${r.posts} posts`.padEnd(10),
              r.readAt ? `read ${r.readAt.toISOString().slice(0, 16)}` : "never read",
              r.niches.join(","),
              r.active ? "" : "removed",
              r.readError ? `error: ${r.readError.slice(0, 80)}` : "",
              r.record ?? "",
            ]
              .filter(Boolean)
              .join("  "),
          );
      }),
    );

  creator
    .command("remove <ids...>")
    .description("stop reading creators; their rows stay")
    .action((ids: string[]) =>
      withDb(async (db) => {
        for (const id of ids.map(int))
          console.log(JSON.stringify({ id, removed: await untrackCreator(db, id) }));
      }),
    );

  creator
    .command("refresh")
    .description(
      `read due creators (not read for 20 hours, under 3 fails), ${READ_LIMIT} a run: posts, counts, followers; rescore`,
    )
    .option("--id <n...>", "only these creators, due or not", (v, acc: number[] = []) => [
      ...acc,
      int(v),
    ])
    .option("--limit <n>", `creators a run (default ${READ_LIMIT})`, int)
    .option("-n, --posts <n>", `posts a read (default ${READ_POSTS})`, int)
    .option(
      "--account <platform=name...>",
      "the autobrowse account that reads a site (instagram, tiktok, linkedin); a site with none refuses",
      many,
    )
    .option("--json", "JSON out")
    .action(
      (o: { id?: number[]; limit?: number; posts?: number; account?: string[]; json?: boolean }) =>
        withDb(async (db) => {
          const accounts = accountsOf(o.account);
          const day = new Date().toISOString().slice(0, 10);
          const due = o.id?.length
            ? (await listCreators(db, { ids: o.id, all: true })).map((c) => ({
                id: c.id,
                platform: c.platform,
                handle: c.handle,
                url: c.url,
              }))
            : await dueCreators(db, o.limit ?? READ_LIMIT);
          const out: Record<string, unknown>[] = [];
          for (const c of due) {
            if (!c.url) {
              out.push({ id: c.id, handle: c.handle, error: "no profile URL" });
              continue;
            }
            try {
              const read = readCreator(c.url, o.posts ?? READ_POSTS, accounts);
              out.push({
                id: c.id,
                handle: c.handle,
                ...(await keepCreatorRead(db, c.id, read, day)),
              });
            } catch (e) {
              const error = e instanceof Error ? e.message : String(e);
              await markReadFailed(db, c.id, error);
              out.push({ id: c.id, handle: c.handle, error });
            }
          }
          if (o.json) console.log(JSON.stringify(out, null, 2));
          else for (const r of out) console.log(JSON.stringify(r));
        }),
    );

  creator
    .command("promote <id>")
    .description(
      "a creator into Canon as a person record; --series also files their top posts as references",
    )
    .option("--series <name>", "file the top posts, tagged reference, series-<name> and the niches")
    .option("--top <n>", "top posts by multiple (default 10)", int)
    .option("--model <name>", "the breakdown model", "cohere")
    .option("--by <name>", "who promotes", "william")
    .action((id: string, o: { series?: string; top?: number; model: string; by: string }) =>
      withDb(async (db) => {
        const [c] = await listCreators(db, { ids: [int(id)], all: true });
        if (!c) throw new Error(`no creator ${id}`);
        const top = await feedPosts(db, { creatorIds: [c.id], limit: o.top ?? 10 });
        canon.pull();
        try {
          const made = creatorSource(c, top);
          const [record] = await canon.addOne(
            c.url ?? made.name,
            { from: o.by, model: o.model, tags: ["creator", ...c.niches], made },
            `promote creator ${c.platform} @${c.handle}`,
          );
          if (record) await markCreatorPromoted(db, c.id, record);
          console.log(JSON.stringify({ creator: c.id, record }));
          if (!o.series) return;
          const tags = ["reference", `series-${slug(o.series)}`, ...c.niches];
          for (const p of top) {
            try {
              const [r] = await canon.addOne(
                p.url,
                { from: o.by, model: o.model, tags },
                `series ${o.series}: @${c.handle} ${p.multiple?.toFixed(1)}x`,
              );
              if (r) await markPostPromoted(db, p.platform, p.ref, r);
              console.log(JSON.stringify({ url: p.url, record: r }));
            } catch (e) {
              console.log(
                JSON.stringify({ url: p.url, error: e instanceof Error ? e.message : String(e) }),
              );
              process.exitCode = 1;
            }
          }
        } finally {
          canon.share();
        }
      }),
    );

  program
    .command("feed")
    .description(
      `outlier posts of tracked creators, best multiple first. Presets: ${Object.keys(FEED_PRESETS).join(", ")}`,
    )
    .option("--preset <name>", "a preset; flags beside it override its values")
    .option("--niche <name>", "one niche")
    .option("--min <x>", "the least multiple over the creator's usual draw", Number.parseFloat)
    .option("--since <days>", "posted in the last N days", int)
    .option("--platform <name...>", "platforms", many)
    .option("--kind <name...>", `kinds: ${POST_KINDS.join(", ")}`, many)
    .option("--min-followers <n>", "creators at or over N followers", int)
    .option("--max-followers <n>", "creators under N followers", int)
    .option("--limit <n>", "rows (default 50)", int)
    .option("--json", "JSON out")
    .action(
      (o: {
        preset?: string;
        niche?: string;
        min?: number;
        since?: number;
        platform?: string[];
        kind?: string[];
        minFollowers?: number;
        maxFollowers?: number;
        limit?: number;
        json?: boolean;
      }) =>
        withDb(async (db) => {
          if (o.preset && !(o.preset in FEED_PRESETS))
            throw new Error(`unknown preset ${o.preset}`);
          const base: FeedFilter = o.preset ? { ...FEED_PRESETS[o.preset as FeedPreset] } : {};
          const f: FeedFilter = {
            ...base,
            ...(o.niche ? { niche: o.niche } : {}),
            ...(o.min !== undefined ? { min: o.min } : {}),
            ...(o.since !== undefined ? { days: o.since } : {}),
            ...(o.platform ? { platforms: o.platform } : {}),
            ...(o.kind ? { kinds: o.kind } : {}),
            ...(o.minFollowers !== undefined ? { minFollowers: o.minFollowers } : {}),
            ...(o.maxFollowers !== undefined ? { maxFollowers: o.maxFollowers } : {}),
            ...(o.limit !== undefined ? { limit: o.limit } : {}),
          };
          const rows = await feedPosts(db, f);
          if (o.json) return void console.log(JSON.stringify(rows, null, 2));
          for (const r of rows) console.log(feedLine(r));
        }),
    );
}
