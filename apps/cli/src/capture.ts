/**
 * `wren capture pull | file | run | status`: a person's saves into Canon as their own sources
 * (designs/2026-11-12-eden-method.md §2). Reads go through autobrowse on this Mac, as that person's
 * signed-in accounts; rows land in `captures`; `file` adds 50 a source a run to Canon and pushes.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { Settings } from "@wren/config";
import type { Db } from "@wren/db";
import {
  CAPTURE_SOURCES,
  type CaptureRow,
  type CaptureSource,
  captureCounts,
  instagramSaved,
  keepSaved,
  linkedinSaved,
  linkedinSource,
  markFailed,
  markFiled,
  type Saved,
  unfiled,
  xBookmarks,
  xHasVideo,
  xSource,
  youtubeVideos,
} from "@wren/research/captures";
import type { Command } from "commander";
import type { AddOpts, CanonWrites } from "./canon.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/** autobrowse accounts (profile names); YouTube has none until the person's read-only consent */
const ACCOUNTS = { instagram: "instagram", x: "x", linkedin: "linkedin" } as const;
/** rows filed per source per run */
const FILE_LIMIT = 50;

interface CaptureOpts {
  person: string;
  source?: CaptureSource[];
  youtubeAccount?: string;
  limit?: number;
  model: string;
  json?: boolean;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function registerCapture(
  program: Command,
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
  canon: CanonWrites,
): void {
  const site = (name: string, path: string, account: string, body: Record<string, unknown>) => {
    const args = ["-s", "autobrowse", "site", "call", name, "GET", path, "--account", account];
    args.push("--body", JSON.stringify(body));
    const r = spawnSync("pnpm", args, {
      cwd: resolve(rootDir, settings.autobrowseDir),
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (r.status !== 0)
      throw new Error(`autobrowse ${name} ${path}: ${(r.stderr || r.stdout).trim()}`);
    return JSON.parse(r.stdout) as unknown;
  };

  /** Every page of a YouTube list, or the first only. */
  const youtubeAll = (
    account: string,
    path: string,
    q: Record<string, unknown>,
    all: boolean,
  ): unknown[] => {
    const pages: unknown[] = [];
    let pageToken: string | undefined;
    do {
      const page = site("youtube", path, account, {
        ...q,
        maxResults: 50,
        ...(pageToken ? { pageToken } : {}),
      }) as { nextPageToken?: string };
      pages.push(page);
      pageToken = page.nextPageToken;
    } while (all && pageToken && pages.length < 40);
    return pages;
  };

  /** One source's saves; `first`: no rows yet, so read deep. */
  const read = (source: CaptureSource, first: boolean, o: CaptureOpts): Saved[] => {
    switch (source) {
      case "instagram-saved":
        return instagramSaved(
          site("instagram", "/web/saved", ACCOUNTS.instagram, { max: first ? 1000 : 200 }),
        );
      case "x-bookmarks":
        return xBookmarks(site("x", "/web/bookmarks", ACCOUNTS.x, { max: first ? 500 : 100 }));
      case "linkedin-saved":
        return linkedinSaved(
          site("linkedin", "/web/saved", ACCOUNTS.linkedin, { max: first ? 1000 : 100 }),
        );
      case "youtube-liked": {
        if (!o.youtubeAccount) throw new Error("needs --youtube-account (the person's consent)");
        return youtubeAll(
          o.youtubeAccount,
          "/youtube/v3/videos",
          { myRating: "like", part: "snippet,statistics,contentDetails" },
          first,
        ).flatMap((p) => youtubeVideos(p, null));
      }
      case "youtube-playlists": {
        const account = o.youtubeAccount;
        if (!account) throw new Error("needs --youtube-account (the person's consent)");
        const lists = youtubeAll(
          account,
          "/youtube/v3/playlists",
          { mine: true, part: "snippet" },
          true,
        ).flatMap(
          (p) =>
            (p as { items?: Array<{ id?: string; snippet?: { title?: string } }> }).items ?? [],
        );
        return lists.flatMap((l) =>
          l.id
            ? youtubeAll(
                account,
                "/youtube/v3/playlistItems",
                { playlistId: l.id, part: "snippet,contentDetails" },
                first,
              ).flatMap((p) => youtubeVideos(p, l.snippet?.title ?? l.id ?? null))
            : [],
        );
      }
    }
  };

  const sourcesOf = (o: CaptureOpts) =>
    (o.source?.length ? o.source : CAPTURE_SOURCES).filter(
      (s) => o.youtubeAccount || !s.startsWith("youtube-"),
    );

  const pull = (db: Db, o: CaptureOpts) => async () => {
    const counts = new Map((await captureCounts(db, o.person)).map((c) => [c.source, c.read]));
    const out: Record<string, unknown>[] = [];
    for (const source of sourcesOf(o)) {
      try {
        const items = read(source, !counts.get(source), o);
        out.push({ source, ...(await keepSaved(db, o.person, source, items)) });
      } catch (e) {
        // a cap or a sign-in wall: the next run reads again; the saves stay on the site
        out.push({ source, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  };

  /** One row into Canon: a link we read (reels, videos), or a source built from the row. */
  const fileRow = (row: CaptureRow, o: CaptureOpts): Promise<string[]> => {
    const opts: AddOpts = {
      from: o.person,
      model: o.model,
      tags: ["capture", ...row.lists.map((l) => `saved-${slug(l)}`).filter((t) => t !== "saved-")],
    };
    const why = `capture ${row.sources.join(",")}: ${row.url}`;
    const day = row.firstSeen.toISOString().slice(0, 10);
    if (row.platform === "x" && !xHasVideo(row.raw))
      return canon.addOne(row.url, { ...opts, made: xSource(row.raw, row.url, day) }, why);
    if (row.platform === "linkedin")
      return canon.addOne(row.url, { ...opts, made: linkedinSource(row.raw, row.url, day) }, why);
    return canon.addOne(row.url, opts, why);
  };

  const file = (db: Db, o: CaptureOpts) => async () => {
    const out: Record<string, unknown>[] = [];
    canon.pull();
    try {
      for (const source of sourcesOf(o)) {
        for (const row of await unfiled(db, o.person, source, o.limit ?? FILE_LIMIT)) {
          try {
            const records = await fileRow(row, o);
            await markFiled(db, row.id, records);
            out.push({ source, url: row.url, records });
          } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            await markFailed(db, row.id, error);
            out.push({ source, url: row.url, error });
          }
        }
      }
    } finally {
      canon.share();
    }
    return out;
  };

  const print = (o: CaptureOpts, rows: Record<string, unknown>[]) => {
    if (o.json) console.log(JSON.stringify(rows, null, 2));
    else for (const r of rows) console.log(JSON.stringify(r));
  };

  const capture = program
    .command("capture")
    .description(
      "a person's saves (IG saved, X bookmarks, LinkedIn saved, YouTube likes and playlists) into Canon as their own sources",
    );
  const common = (c: Command) =>
    c
      .option("--person <name>", "whose saves, as Canon names them", "william")
      .option(
        "--source <name...>",
        `only these: ${CAPTURE_SOURCES.join(", ")}`,
        (v: string, acc: CaptureSource[] = []) => {
          if (!(CAPTURE_SOURCES as readonly string[]).includes(v))
            throw new Error(`unknown source ${v}`);
          return [...acc, v as CaptureSource];
        },
      )
      .option(
        "--youtube-account <address>",
        "the autobrowse account whose YouTube likes and playlists to read (its own read-only consent); without it YouTube is skipped",
      )
      .option("--json", "JSON out");
  const fileOpts = (c: Command) =>
    c
      .option("--limit <n>", `rows a source a run (default ${FILE_LIMIT})`, (v) =>
        Number.parseInt(v, 10),
      )
      .option("--model <name>", "the breakdown model", "cohere");

  common(capture.command("pull"))
    .description("read each source through autobrowse and keep new saves in `captures`")
    .action((o: CaptureOpts) => withDb(async (db) => print(o, await pull(db, o)())));
  fileOpts(common(capture.command("file")))
    .description("file unfiled saves into Canon (50 a source), push Canon, mark them filed")
    .action((o: CaptureOpts) => withDb(async (db) => print(o, await file(db, o)())));
  fileOpts(common(capture.command("run")))
    .description("pull, then file: the daily job")
    .action((o: CaptureOpts) =>
      withDb(async (db) => print(o, [...(await pull(db, o)()), ...(await file(db, o)())])),
    );
  common(capture.command("status"))
    .description("per source: read, filed, waiting, failed (3 failures: waits for a person)")
    .action((o: CaptureOpts) =>
      withDb(async (db) => {
        const rows = await captureCounts(db, o.person);
        if (o.json) console.log(JSON.stringify(rows, null, 2));
        else
          for (const r of rows)
            console.log(
              `${r.source.padEnd(18)} read ${r.read}  filed ${r.filed}  waiting ${r.waiting}  failed ${r.failed}`,
            );
      }),
    );
}
