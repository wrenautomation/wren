/**
 * `wren creator add | list | remove | refresh | pictures | rescore | promote` and `wren feed`: the creator index
 * (designs/2026-11-12-eden-method.md §3, option A). Reads go through `weaver posts` (the key-gate
 * shim); rows land in `tracked_creators`, `creator_posts` and the day tables; promote writes Canon.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHandle } from "@wren/core/touches";
import type { Db } from "@wren/db";
import {
  avatarsToCopy,
  type CreatorRead,
  creatorSource,
  dueCreators,
  FEED_PRESETS,
  type FeedFilter,
  type FeedPreset,
  type FeedRow,
  type FeedSort,
  feedPosts,
  HandleError,
  keepCreatorRead,
  linkAccounts,
  listCreators,
  markCreatorPromoted,
  markPostPromoted,
  markReadFailed,
  newPerson,
  POST_KINDS,
  personNamed,
  pictureKeyOf,
  postsToCopy,
  rescore,
  setAvatar,
  setPicture,
  smallKeyOf,
  smallsToMake,
  trackCreator,
  untrackCreator,
} from "@wren/research/creators";
import { getKey, type MediaStoreOptions, putKey } from "@wren/starling-inbound";
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

/**
 * `--account x=x@wren`: the reading account per platform; none means the site refuses.
 * Labeled only: a bare login is the site's default, and a default may be William's own.
 * Except `CLEARED_BARE`: bare logins William cleared for creator reads.
 */
const CLEARED_BARE: Record<string, string> = {
  instagram: "instagram", // @itswilljin, William 11-13
  threads: "instagram", // Threads reads sign in through Instagram
};
const accountsOf = (pairs: string[] = []) =>
  Object.fromEntries(
    pairs.map((p) => {
      const [k, v] = p.split("=");
      if (!k || !v) throw new Error(`--account takes platform=site@label: ${p}`);
      if (CLEARED_BARE[k] !== v && !/^[^@\s]+@[^@\s]+$/.test(v))
        throw new Error(
          `--account ${p}: name the login with its label (x@wren); a bare login may be William's own`,
        );
      return [k, v];
    }),
  );

/** signed-out yt-dlp reads (TikTok) leave through the key gate's read relay */
const YT_DLP = process.env.WEAVER_YTDLP ?? "yt-dlp --proxy http://127.0.0.1:4776";

/** One creator through `weaver posts` (the key-gate shim); accounts ride `WEAVER_ACCOUNTS`. */
function readCreator(url: string, n: number, accounts: Record<string, string>): CreatorRead {
  const args = ["posts", url, "-n", String(n), "--yt-dlp", YT_DLP];
  const r = spawnSync("weaver", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: {
      ...process.env,
      WEAVER_ACCOUNTS: Object.entries(accounts)
        .map(([site, name]) => `${site}=${name}`)
        .join(","),
    },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`weaver posts ${url}: ${(r.stderr || r.stdout).trim()}`);
  return JSON.parse(r.stdout) as CreatorRead;
}

const short = new Intl.NumberFormat("en", { notation: "compact" });
/** views, likes, comments where read (D10: shown whenever there) */
const countsOf = (c: FeedRow["counts"]) =>
  (["views", "likes", "comments"] as const)
    .filter((k) => c[k] != null)
    .map((k) => `${short.format(c[k] as number)} ${k}`)
    .join(" · ");

const feedLine = (p: FeedRow) =>
  [
    `${(p.multiple ?? 0).toFixed(1)}x`.padStart(7),
    (p.scoreCount ?? "").padEnd(5),
    p.platform.padEnd(9),
    p.kind.padEnd(5),
    `@${p.handle}`,
    countsOf(p.counts),
    p.postedAt?.slice(0, 10) ?? "",
    p.url,
    p.title ?? p.text?.replace(/\s+/g, " ").slice(0, 100) ?? "",
  ].join("  ");

/**
 * Each post's picture and each profile picture into the media bucket, once (studio-suite D8 B,
 * D10): IG's links expire in days. A link the platform refuses (4xx) marks the row `''`, so no run
 * asks again. A fresh read (`creatorIds`) copies its profile picture again: the link may change.
 */
/**
 * The small copy a tile or a face shows (WA-1390): webp, its short side 640 px (a 250 px tile at
 * 2x, landscape too) or 192 for a face; never larger than the full one. Named by its hash, so
 * kept for good. `''`: the picture would not decode.
 */
async function putSmall(file: string, key: string, media: MediaStoreOptions): Promise<string> {
  const side = key.startsWith("cache/creators/") ? 192 : 640;
  let bytes: Buffer;
  try {
    // native: loaded only here, never by the rest of the CLI
    const { default: sharp } = await import("sharp");
    bytes = await sharp(file)
      .rotate()
      .resize({ width: side, height: side, fit: "outside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
  } catch {
    return "";
  }
  const small = smallKeyOf(key, createHash("sha256").update(bytes).digest("hex"));
  const out = `${file}.small.webp`;
  await writeFile(out, bytes);
  await putKey(out, small, media, "public, max-age=31536000, immutable");
  return small;
}

/** Small copies of the pictures copied before WA-1390. */
async function makeSmalls(
  db: Db,
  media: MediaStoreOptions,
  o: { limit?: number } = {},
): Promise<{ made: number; failed: number }> {
  const todo = await smallsToMake(db, o);
  const out = { made: 0, failed: 0 };
  if (!todo.length) return out;
  const dir = await mkdtemp(join(tmpdir(), "creator-smalls-"));
  try {
    for (const t of todo) {
      try {
        const file = join(dir, "p.jpg");
        await getKey(t.key, file, media);
        await t.mark(await putSmall(file, t.key, media));
        out.made++;
      } catch {
        // S3 refused or timed out: the next run asks again
        out.failed++;
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return out;
}

async function copyPictures(
  db: Db,
  media: MediaStoreOptions,
  o: { creatorIds?: number[]; limit?: number } = {},
): Promise<{ copied: number; gone: number; failed: number }> {
  const todo: {
    link: string;
    key: string;
    mark: (key: string, small?: string) => Promise<void>;
  }[] = [
    ...(await avatarsToCopy(db, o.creatorIds ? { creatorIds: o.creatorIds } : {})).map((a) => ({
      link: a.link,
      key: a.key,
      mark: (key: string, small?: string) => setAvatar(db, a.id, key, small ?? null),
    })),
    ...(await postsToCopy(db, o)).map((p) => ({
      link: p.link,
      key: pictureKeyOf(p.platform, p.ref),
      mark: (key: string, small?: string) => setPicture(db, p.platform, p.ref, key, small ?? null),
    })),
  ];
  const out = { copied: 0, gone: 0, failed: 0 };
  if (!todo.length) return out;
  const dir = await mkdtemp(join(tmpdir(), "creator-pictures-"));
  try {
    for (const t of todo) {
      try {
        const res = await fetch(t.link, { signal: AbortSignal.timeout(20_000) });
        if (res.status >= 400 && res.status < 500) {
          await t.mark("");
          out.gone++;
          continue;
        }
        if (!res.ok || !res.headers.get("content-type")?.startsWith("image/"))
          throw new Error(`${res.status} ${res.headers.get("content-type")}`);
        const file = join(dir, "p.jpg");
        await writeFile(file, Buffer.from(await res.arrayBuffer()));
        // a face's key is rewritten on a fresh read: a day, not for good
        await putKey(file, t.key, media, "public, max-age=86400");
        await t.mark(t.key, await putSmall(file, t.key, media));
        out.copied++;
      } catch {
        // a 5xx or a timeout: the next run asks again
        out.failed++;
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return out;
}

export function registerCreator(
  program: Command,
  withDb: WithDb,
  canon: CanonWrites,
  media: MediaStoreOptions | null,
): void {
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
    .option(
      "--person <id or name>",
      "the creator these accounts belong to: a person id or name (a new name makes the person)",
    )
    .option("--by <name>", "who added them", "william")
    .option("--json", "JSON out")
    .action(
      (
        profiles: string[],
        o: {
          platform?: string;
          niche: string[];
          note?: string;
          person?: string;
          by: string;
          json?: boolean;
        },
      ) =>
        withDb(async (db) => {
          const out: Record<string, unknown>[] = [];
          const personId = o.person
            ? /^\d+$/.test(o.person)
              ? int(o.person)
              : (
                  (await personNamed(db, o.person)) ??
                  (await newPerson(db, { name: o.person, addedBy: o.by }))
                ).id
            : undefined;
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
                ...(personId ? { personId } : {}),
                addedBy: o.by,
              });
              out.push({
                id: c.id,
                personId: c.personId,
                platform,
                handle: c.handle,
                niches: c.niches,
                added: c.added,
              });
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
              `p${r.personId}${r.person ? ` ${r.person}` : ""}`.padEnd(18),
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
    .command("link <ids...>")
    .description("join tracked accounts into one creator person: the first account's person")
    .option("--name <name>", "the person's name")
    .action((ids: string[], o: { name?: string }) =>
      withDb(async (db) => {
        try {
          const r = await linkAccounts(db, ids.map(int), o.name ? { name: o.name } : {});
          console.log(JSON.stringify(r));
        } catch (e) {
          if (!(e instanceof HandleError)) throw e;
          console.log(JSON.stringify({ error: e.message }));
          process.exitCode = 1;
        }
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
      "the labeled autobrowse login that reads a site (x=x@wren, linkedin=linkedin@wren; bare instagram=instagram is cleared); a site that needs one and has none refuses",
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
              const kept = await keepCreatorRead(db, c.id, read, day);
              // right after the read: IG's picture links are freshest now
              const pictures = media ? await copyPictures(db, media, { creatorIds: [c.id] }) : null;
              out.push({ id: c.id, handle: c.handle, ...kept, ...(pictures ? { pictures } : {}) });
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
    .command("pictures")
    .description(
      "copy post and profile pictures into the media bucket (cache/posts/, cache/creators/) with their small copies; refresh does it per creator, this catches up",
    )
    .option("--id <n...>", "only these creators", (v, acc: number[] = []) => [...acc, int(v)])
    .option("--limit <n>", "posts a run (default 500)", int)
    .action((o: { id?: number[]; limit?: number }) =>
      withDb(async (db) => {
        if (!media) throw new Error("creator pictures needs WREN_MEDIA_BUCKET");
        console.log(
          JSON.stringify({
            ...(await copyPictures(db, media, {
              ...(o.id?.length ? { creatorIds: o.id } : {}),
              ...(o.limit ? { limit: o.limit } : {}),
            })),
            smalls: await makeSmalls(db, media, o.limit ? { limit: o.limit } : {}),
          }),
        );
      }),
    );

  creator
    .command("rescore")
    .description(
      "score every creator's stored posts again (no reads): multiples, ranks, usual draws",
    )
    .option("--id <n...>", "only these creators", (v, acc: number[] = []) => [...acc, int(v)])
    .action((o: { id?: number[] }) =>
      withDb(async (db) => {
        const all = await listCreators(db, { all: true, ...(o.id?.length ? { ids: o.id } : {}) });
        let scored = 0;
        for (const c of all) scored += await rescore(db, c.id);
        console.log(JSON.stringify({ creators: all.length, scored }));
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
    .option("--on <score>", "count (the post's own: views, or likes) or likes", /^(count|likes)$/)
    .option("--since <days>", "posted in the last N days", int)
    .option("--platform <name...>", "platforms", many)
    .option("--kind <name...>", `kinds: ${POST_KINDS.join(", ")}`, many)
    .option("--min-followers <n>", "creators at or over N followers", int)
    .option("--max-followers <n>", "creators under N followers", int)
    .option(
      "--sort <order>",
      "new, multiple (default), views, likes, reach (views per follower)",
      /^(new|multiple|views|likes|reach)$/,
    )
    .option("--limit <n>", "rows (default 50)", int)
    .option("--json", "JSON out")
    .action(
      (o: {
        preset?: string;
        niche?: string;
        min?: number;
        on?: "count" | "likes";
        since?: number;
        platform?: string[];
        kind?: string[];
        minFollowers?: number;
        maxFollowers?: number;
        sort?: FeedSort;
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
            ...(o.on ? { on: o.on } : {}),
            ...(o.since !== undefined ? { days: o.since } : {}),
            ...(o.platform ? { platforms: o.platform } : {}),
            ...(o.kind ? { kinds: o.kind } : {}),
            ...(o.minFollowers !== undefined ? { minFollowers: o.minFollowers } : {}),
            ...(o.maxFollowers !== undefined ? { maxFollowers: o.maxFollowers } : {}),
            ...(o.sort ? { sort: o.sort } : {}),
            ...(o.limit !== undefined ? { limit: o.limit } : {}),
          };
          const rows = await feedPosts(db, f);
          if (o.json) return void console.log(JSON.stringify(rows, null, 2));
          for (const r of rows) console.log(feedLine(r));
        }),
    );
}
