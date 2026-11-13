/**
 * `wren source …` and `wren topic …`: Canon (`canonDir`) from wren. Records carry a by and a why,
 * one commit per write. `source add` ingests a video, Drive Doc or file and breaks a reel or video
 * down; `source breakdown | call | ads` in source-pieces.ts. A topic: a guide, its sources and
 * points, `topics/<name>/` for `notes.md`, `calls.md`, `standard.md`, refs. `topic sync` writes the
 * numbers and your calls, `topic build` the next guide on Claude Code (sync first), `topic list`
 * what is there, `topic push` hands it to the content loop as a platform's playbook. Drive reads go
 * through autobrowse's `drive` site on this machine.
 */
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, unlink } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { ingressOf, type Settings } from "@wren/config";
import { playbookStandard, scopeOf, writeSopFiles } from "@wren/content-standard";
import { PLATFORMS, type Platform } from "@wren/core/autobrowse";
import { tellLive } from "@wren/core/live";
import { createDb, type Db } from "@wren/db";
import { modelLlm } from "@wren/llm";
import {
  type CanonAddRequest,
  claimAdd,
  failAdd,
  finishAdd,
  renewAdd,
  whatOf,
} from "@wren/research/canon-adds";
import { type CanonIndexSync, syncCanonIndex } from "@wren/research/canon-index";
import {
  addSource,
  buildSop,
  DEFAULT_PRIORITY,
  type DriveGet,
  driveSources,
  extractPoints,
  fileSource,
  pageSource,
  readSopDir,
  renumberGuide,
  type Source,
  sopText,
  topicDir,
  VIDEO_HOST,
  videoSource,
  writeSkill,
  youtubeSource,
} from "@wren/research/sops";
import * as clients from "@wren/runtime/clients";
import { getKey, parseStored, pushPlaybook } from "@wren/starling-inbound";
import { loadWorking, type SourceFile, write } from "@wrenautomation/knowledge";
import { claudeCode } from "@wrenautomation/models/command";
import { PoliteFetcher, userAgent } from "@wrenautomation/read/fetch";
import { s3MediaStore } from "@wrenautomation/read/s3";
import type { Command } from "commander";
import {
  fileSourceOf,
  POST_LINK,
  posterOf,
  postFiles,
  postSource,
  putCanonFile,
  reelVideoOf,
} from "./canon-files.js";
import { breakdownLlm, breakdownSource, registerSourcePieces } from "./source-pieces.js";
import { watchEyes } from "./video-watch.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/** This Mac's own database: a sync from the local Canon clone is safe only here. */
export const isLoopback = (url: string) =>
  ["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(url).hostname);

/** Schema `canon` from this machine's Canon clone at its main (git is the truth: not the working tree). */
export async function syncHere(settings: Settings, rootDir: string, full = false) {
  if (!isLoopback(settings.databaseUrl))
    throw new Error(
      "canon sync --here writes the database it reads: loopback only (prod syncs on the box)",
    );
  const h = createDb(settings.databaseUrl, { max: 1, app: "wren-canon-here" });
  try {
    return await syncCanonIndex(
      h.db,
      settings.databaseUrl,
      "canon",
      {
        dir: join(homedir(), ".cache", "wren", "canon-index"),
        remote: resolve(rootDir, settings.canonDir),
        token: null,
      },
      { full },
    );
  } finally {
    await h.close();
  }
}

export interface AddOpts {
  topic?: string;
  from?: string;
  note?: string;
  title?: string;
  account?: string;
  priority?: number;
  screen?: boolean;
  breakdown?: boolean;
  model: string;
  /** plain tags beside the topic's; never a topic folder */
  tags?: string[];
  /** a source already built (a capture's item): no fetch */
  made?: Source;
}

const YOUTUBE = /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//;

/** autobrowse's CLI in its checkout: the Drive token lives in its .env, not ours. */
export function autobrowseDrive(dir: string, account: string): DriveGet {
  return async (path, body) => {
    const args = ["-s", "autobrowse", "site", "call", "drive", "GET", path, "--account", account];
    args.push("--body", JSON.stringify(body));
    const r = spawnSync("pnpm", args, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0)
      throw new Error(`autobrowse drive ${path}: ${(r.stderr || r.stdout).trim()}`);
    return JSON.parse(r.stdout) as unknown;
  };
}

/** What `wren capture` borrows: one source in, and Canon's git. */
export interface CanonWrites {
  addOne: (what: string, opts: AddOpts, why?: string) => Promise<string[]>;
  /** Canon's main into this clone */
  pull: () => void;
  /** pull, then push ours */
  share: () => void;
}

export function registerCanon(
  program: Command,
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
): CanonWrites {
  const root = resolve(rootDir, settings.canonDir);
  // every record wren writes says it came from here; the why names the command
  const BY = "wren-sop";
  const bucketOf = (what: string) => {
    if (!settings.mediaBucket)
      throw new Error(`${what} needs WREN_MEDIA_BUCKET: its files go there`);
    return { bucket: settings.mediaBucket };
  };
  const topics = async () =>
    (await readdir(join(root, "topics"), { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  const source = program
    .command("source")
    .description(
      "Canon sources: add a video, Drive Doc or file, break it down, call on its pieces, competitor ads",
    );
  const topic = program
    .command("topic")
    .description(
      "Canon topics (guide, rule sets, references): `source add --topic`, then `topic build`",
    );

  // the prod index (designs/2026-11-12-canon-references.md D1): the box fetches and syncs; this asks it
  const indexOf = () =>
    clients
      .connect(ingressOf(settings))
      .objectClient<CanonIndexSync>({ name: "CanonIndexSync" }, "canon");
  const canon = program.command("canon").description("Canon's prod index, on the box");
  canon
    .command("sync")
    .description("Fetch Canon's main on the box and bring schema canon up to it (a push does this)")
    .option("--full", "reread every file at main: after a force push, or to repair")
    .option(
      "--here",
      "sync this Mac's database from the local Canon clone's main instead (loopback only)",
    )
    .action(async (o: { full?: boolean; here?: boolean }) => {
      if (o.here) {
        console.log(JSON.stringify(await syncHere(settings, rootDir, o.full), null, 2));
        return;
      }
      const out = o.full ? await indexOf().rebuild() : await indexOf().sync();
      console.log(JSON.stringify(out, null, 2));
    });
  canon
    .command("start")
    .description("Start the hourly fetch, the backstop for a missed push")
    .action(async () => console.log(JSON.stringify(await indexOf().start(), null, 2)));

  /** One source in: a link, a Drive folder, a text file, a picture or PDF. Answers the record ids. */
  const addOne = async (
    what: string,
    opts: AddOpts,
    why = `source add ${what}`,
  ): Promise<string[]> => {
    // a note is a person's own words: it names them
    if (opts.note && !opts.from) throw new Error("--note needs --from <person>");
    const name = opts.topic ?? null;
    const priority = opts.priority ?? DEFAULT_PRIORITY;
    let sources: Source[];
    // files per source name: a post's slides, a picture
    const filesOf = new Map<string, SourceFile[]>();
    const store = settings.mediaBucket ? s3MediaStore(settings.mediaBucket) : undefined;
    // a kind the record name cannot tell: an X video is a reel
    const kinds = new Map<string, string>();
    if (opts.made) sources = [opts.made];
    else if (YOUTUBE.test(what)) {
      // the frames, read by the eye, carry what the captions don't: what is on screen
      const { eye, ear, ffmpeg } = watchEyes(settings, rootDir);
      sources = [
        await youtubeSource(what, settings.ytDlp, priority, {
          ...(opts.screen === false ? {} : { eye }),
          ear,
          ffmpeg,
        }),
      ];
    } else if (/^https?:\/\//.test(what) && !VIDEO_HOST.test(what)) {
      // a page or repo: its text (a repo: the README)
      const fetcher = new PoliteFetcher(
        userAgent(settings.fetchContact ?? "https://wrenautomation.com"),
        { retries: 2 },
      );
      sources = [await pageSource(what, fetcher, priority)];
    } else if (/^https?:\/\//.test(what)) {
      // Reels, TikTok, X: no captions, so the watch core hears and reads the download.
      const { eye, ...rest } = watchEyes(settings, rootDir);
      const post = POST_LINK.test(what)
        ? await postSource(what, {
            ...bucketOf("a post"),
            ytDlp: settings.ytDlp,
            eye,
            watch: rest,
            priority,
          })
        : null;
      if (post) filesOf.set(post.source.name, post.files);
      const video = post
        ? null
        : await videoSource(what, settings.ytDlp, priority, {
            eye,
            ...rest,
            ...(store ? { store } : {}),
          });
      // yt-dlp names X `twitter`; Canon's X records are `x-<id>`
      if (video?.name.startsWith("twitter-")) {
        video.name = video.name.replace(/^twitter-/, "x-");
        kinds.set(video.name, "reel");
      }
      sources = post ? [post.source] : video ? [video] : [];
    } else if (what.startsWith("drive:")) {
      if (!opts.account) throw new Error("drive: needs --account <address>");
      const drive = autobrowseDrive(resolve(rootDir, settings.autobrowseDir), opts.account);
      sources = await driveSources(what.slice("drive:".length), drive, priority);
    } else if (/\.(md|txt)$/i.test(what)) sources = [await fileSource(resolve(what), priority)];
    else if (!name) {
      // a picture or PDF of its own: the bytes to the bucket, the record lists them
      if (!opts.title) throw new Error("a picture or PDF needs --title <words>");
      const made = await fileSourceOf(resolve(what), {
        ...bucketOf("a picture or PDF"),
        eye: watchEyes(settings, rootDir).eye,
        title: opts.title,
        priority,
      });
      filesOf.set(made.source.name, made.files);
      sources = [made.source];
    } else {
      // Not text (PDF, image, design export): kept as a reference file, not a source.
      const dir = topicDir(root, name);
      await mkdir(join(dir, "refs"), { recursive: true });
      const to = join(dir, "refs", basename(what));
      await copyFile(resolve(what), to);
      console.log(to);
      return [];
    }
    const who = { by: BY, why };
    const extra = {
      ...(opts.from ? { provider: { kind: "human", who: opts.from } } : {}),
      ...(opts.note
        ? {
            note: { text: opts.note, by: opts.from, at: new Date().toISOString().slice(0, 10) },
          }
        : {}),
    };
    const ids: string[] = [];
    const llm = opts.breakdown === false ? null : breakdownLlm(settings, rootDir, opts.model);
    for (const s of sources) {
      const files = filesOf.get(s.name);
      const path = await addSource(root, name, s, who, {
        ...extra,
        ...(files ? { files } : {}),
        ...(opts.tags?.length ? { tags: opts.tags } : {}),
        ...(kinds.has(s.name) ? { kind: kinds.get(s.name) } : {}),
      });
      console.log(path);
      const id = basename(path, ".md");
      ids.push(id);
      const kind = loadWorking(root).docs.find((l) => l.doc.fm.id === id)?.doc.fm.kind;
      if (store && kind === "reel" && id.startsWith("instagram-"))
        console.log(
          `  poster: ${await posterOf(id, { ...bucketOf("a poster"), ffmpeg: settings.ffmpeg })}`,
        );
      if (llm && (kind === "reel" || kind === "video")) {
        const b = await breakdownSource(root, id, llm, who);
        console.log(
          b ? `  broken down: ${b.hookStyle}, ${b.beats.length} beats` : "  no breakdown",
        );
      }
    }
    return ids;
  };

  source
    .command("add <what>")
    .description(
      "ingest a source: a YouTube URL, another video URL (Instagram reel, TikTok, X), an Instagram post (`/p/`: every slide kept), a web page or GitHub repo (its README), `drive:<folderId>` (every Doc under it), a text file, or a picture or PDF (kept in the bucket; with --topic, a topic's reference file instead). A reel or video is broken down",
    )
    .option("--topic <name>", "tag it with this topic (makes the topic folder and a notes.md stub)")
    .option(
      "--from <person>",
      "who gave it (a person's sources outrank an agent's): the provider; raises an agent's",
    )
    .option("--note <words>", "the giver's own note on it, whole; added under any note there")
    .option("--title <words>", "a picture or PDF: its title")
    .option("--account <address>", "whose Drive (an autobrowse `drive` consent)")
    .option("--priority <n>", "higher wins when sources disagree (notes.md always wins)", (v) =>
      Number.parseInt(v, 10),
    )
    .option("--no-screen", "YouTube: captions only, skip the frames read of what is on screen")
    .option("--no-breakdown", "skip the breakdown of a reel or video")
    .option("--model <name>", "the breakdown model", "cohere")
    .action((what: string, opts: AddOpts) => addOne(what, opts).then(() => undefined));

  // the portal's Add box (designs/2026-11-12-canon-references.md D4): asks in canon_add_requests,
  // filed here. Any machine with the database, yt-dlp, the bucket and Canon push rights drains.
  const git = (...args: string[]) => {
    const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args[0]}: ${(r.stderr || r.stdout).trim()}`);
  };
  /** Canon's main into this clone, then ours out; a push that lost the race pulls once more. */
  const shareCanon = () => {
    git("pull", "--rebase", "--autostash", "-q");
    try {
      git("push", "-q");
    } catch {
      git("pull", "--rebase", "--autostash", "-q");
      git("push", "-q");
    }
  };
  const fileOf = async (
    uri: string,
    fileName: string | null,
  ): Promise<{ path: string; dir: string }> => {
    const at = parseStored(uri);
    if (!at) throw new Error(`not a stored file: ${uri}`);
    const dir = await mkdtemp(join(tmpdir(), "canon-add-"));
    const safe = (fileName ?? basename(at.key)).replace(/[^\w. -]+/g, "-").slice(-120);
    const path = join(dir, safe.includes(".") ? safe : `${safe}${extname(at.key)}`);
    await getKey(at.key, path, { bucket: at.bucket });
    return { path, dir };
  };
  /** One ask, filed. Answers the record ids; throws what the person should read. */
  const fileAsk = async (a: CanonAddRequest): Promise<string[]> => {
    const opts: AddOpts = {
      from: a.person,
      ...(a.note ? { note: a.note } : {}),
      model: "cohere",
    };
    if (whatOf(a.what) === "link") return addOne(a.what, opts, `add box #${a.id}: ${a.what}`);
    const { path, dir } = await fileOf(a.what, a.fileName);
    try {
      const title = basename(path, extname(path)).replace(/[-_]+/g, " ").trim() || "File";
      return await addOne(path, { ...opts, title }, `add box #${a.id}: ${basename(path)}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  source
    .command("drain")
    .description(
      "file the portal's Add box asks (canon_add_requests): claim one, add it to Canon, push, mark it done",
    )
    .option("--watch", "keep going: look again every 30 s when the queue is empty")
    .option("--worker <name>", "this machine's name on its claims", hostname())
    .option("--limit <n>", "stop after this many", (v) => Number.parseInt(v, 10))
    .action((o: { watch?: boolean; worker: string; limit?: number }) =>
      withDb(async (db) => {
        let n = 0;
        for (;;) {
          if (o.limit && n >= o.limit) return;
          const a = await claimAdd(db, o.worker);
          if (!a) {
            if (!o.watch) return;
            await new Promise((r) => setTimeout(r, 30_000));
            continue;
          }
          n++;
          // a long breakdown keeps its lease
          const beat = setInterval(
            () => void renewAdd(db, a.id, o.worker).catch(() => {}),
            5 * 60_000,
          );
          try {
            git("pull", "--rebase", "--autostash", "-q");
            const ids = await fileAsk(a);
            shareCanon();
            await finishAdd(db, a.id, o.worker, ids);
            console.log(JSON.stringify({ id: a.id, what: a.what, records: ids }));
          } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            await failAdd(db, a.id, o.worker, error);
            console.error(JSON.stringify({ id: a.id, what: a.what, error }));
          } finally {
            clearInterval(beat);
          }
          // open References tabs read the adds again
          await tellLive(["canon-adds"]);
        }
      }),
    );

  source
    .command("files <id> [paths...]")
    .description(
      "keep files on a source already in Canon, its body untouched: the paths given, or with none an Instagram post's slides (from its url)",
    )
    .option("--role <role>", "what the paths are: image, slide, page or file", "image")
    .action(async (id: string, paths: string[], o: { role: SourceFile["role"] }) => {
      const fm = loadWorking(root).docs.find((l) => l.doc.fm.id === id)?.doc.fm as
        | { url?: string; files?: SourceFile[] }
        | undefined;
      if (!fm) throw new Error(`no source ${id}`);
      const at = bucketOf("files");
      const added: SourceFile[] = [];
      if (paths.length)
        for (const [i, p] of paths.entries()) {
          const { bytes: _, ...file } = await putCanonFile(resolve(p), at, o.role, {
            ...(paths.length > 1 ? { at: String(i + 1) } : {}),
            name: basename(p),
          });
          added.push(file);
        }
      else if (fm.url && POST_LINK.test(fm.url))
        added.push(...(await postFiles(fm.url, { ...at, ytDlp: settings.ytDlp })));
      else throw new Error(`${id}: give paths, or it needs an Instagram post url`);
      const kept = fm.files ?? [];
      const files = [...kept, ...added.filter((a) => !kept.some((k) => k.key === a.key))];
      await write(root, [{ op: "edit", id, files }], {
        by: BY,
        why: `source files: ${added.length} kept`,
      });
      console.log(JSON.stringify({ id, files: files.length, added: files.length - kept.length }));
    });

  source
    .command("posters")
    .description(
      "a poster (one frame) beside each stored Instagram reel's video in the bucket, for every Canon reel without one",
    )
    .option("--limit <n>", "stop after this many made", (v) => Number.parseInt(v, 10))
    .option("--fetch", "a reel with no stored video: download it (yt-dlp) into the bucket first")
    .action(async (o: { limit?: number; fetch?: boolean }) => {
      const at = { ...bucketOf("posters"), ffmpeg: settings.ffmpeg };
      const reels = loadWorking(root)
        .docs.map((l) => l.doc.fm)
        .filter((f) => f.type === "source" && f.id.startsWith("instagram-"));
      const tally: Record<string, number> = {
        made: 0,
        had: 0,
        "no video": 0,
        unavailable: 0,
        failed: 0,
      };
      // Instagram is a third-party page: 2 blocks in a row stop the run; one reel's own verdict is no block
      const UNAVAILABLE = /isn't available|not available|No video formats|private|removed/i;
      let blocksInRow = 0;
      for (const r of reels) {
        if (o.limit !== undefined && (tally.made ?? 0) >= o.limit) break;
        if (blocksInRow >= 2) {
          console.error("2 fetch blocks in a row: stopped");
          break;
        }
        const poster = async (): Promise<string> => {
          const first = await posterOf(r.id, at);
          const url = typeof r.url === "string" ? r.url : undefined;
          // a post's slides are its picture already
          if (first !== "no video" || !o.fetch || !url || POST_LINK.test(url)) return first;
          try {
            await reelVideoOf(url, { ...at, ytDlp: settings.ytDlp });
            blocksInRow = 0;
          } catch (err) {
            const why = err instanceof Error ? err.message : String(err);
            if (!UNAVAILABLE.test(why)) {
              blocksInRow++;
              throw err;
            }
            blocksInRow = 0;
            console.error(`${r.id}: unavailable, ${why.split("\n").at(-2) ?? why}`);
            return "unavailable";
          }
          return posterOf(r.id, at);
        };
        const done = await poster().catch((err: unknown) => {
          console.error(`${r.id}: ${err instanceof Error ? err.message : err}`);
          return "failed" as const;
        });
        tally[done] = (tally[done] ?? 0) + 1;
        if (done === "made") console.log(r.id);
      }
      console.log(JSON.stringify(tally));
    });

  topic
    .command("cite [name]")
    .description(
      "number the guide's citations ([1 12:03]), one cites list; every topic when no name",
    )
    .action(async (name?: string) => {
      const names = name ? [name] : await topics();
      for (const n of names) {
        const changed = await renumberGuide(root, n, { by: BY, why: "topic cite: renumbered" });
        console.log(`${n}${changed ? "" : " (same)"}`);
      }
    });

  /** `standard.md` and `calls.md` from the pieces the SOP's front matter names; false when it names none. */
  const sync = async (name: string) => {
    const dir = topicDir(root, name);
    const notes = await readFile(join(dir, "notes.md"), "utf8").catch(() => "");
    const r = await writeSopFiles(root, dir, name, notes);
    if (!r) return false;
    console.log(
      `${name}: ${r.pieces} piece${r.pieces === 1 ? "" : "s"} (${r.scope.kinds.join(", ")}), ${r.calls} call${r.calls === 1 ? "" : "s"} → standard.md, calls.md`,
    );
    return true;
  };

  topic
    .command("sync <name>")
    .description(
      "write standard.md (the numbers) and calls.md (your keep / tune / drop calls) from the Canon pieces notes.md's front matter names (kinds, platforms, set)",
    )
    .action(async (name: string) => {
      if (!(await sync(name)))
        console.log(`${name}: notes.md names no kinds in its front matter; nothing to measure`);
    });

  topic
    .command("build <name>")
    .description(
      "write the next guide from notes.md, your calls, the standard and the sources, on Claude Code",
    )
    .option("--model <model>", "Claude Code model", "opus")
    .option("--no-sync", "skip the standard.md and calls.md rewrite first")
    .option("--ask <text>", "one instruction for this build only (it goes in the commit's why)")
    .action(async (name: string, opts: { model: string; sync: boolean; ask?: string }) => {
      if (opts.sync)
        await sync(name).catch((err: unknown) =>
          console.warn(
            `sync skipped: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}; building from standard.md and calls.md on disk`,
          ),
        );
      const llm = modelLlm(claudeCode(opts.model, { timeoutMs: 1_800_000 }));
      const text = await buildSop(root, name, llm, { by: BY }, opts.ask);
      console.log(`${join(root, "guides", `${name}.md`)} (${text.split(/\s+/).length} words)`);
    });

  topic
    .command("extract <name> [source]")
    .description(
      "list every point a source makes as findings tagged with the topic (generated; your calls decide what is in); build then reads points instead of the raw source. Naming a source extracts it again",
    )
    .option("--model <model>", "Claude Code model", "opus")
    .action(async (name: string, source: string | undefined, opts: { model: string }) => {
      const llm = modelLlm(claudeCode(opts.model, { timeoutMs: 1_800_000 }));
      for (const f of await extractPoints(root, name, llm, { by: BY }, source)) console.log(f);
    });

  topic
    .command("link <name>")
    .description(
      "expose the topic as the Claude Code skill `sop-<name>` (topics/<name>/, symlinked in ~/.claude/skills)",
    )
    .action(async (name: string) => {
      await writeSkill(root, name);
      const to = join(homedir(), ".claude", "skills", `sop-${name}`);
      await unlink(to).catch(() => {});
      await symlink(topicDir(root, name), to, "dir");
      console.log(to);
    });

  topic
    .command("push <name>")
    .description(
      "hand the topic (the guide, rendered) and its standard and calls from Canon to the content loop: every draft for the platform reads them (prod: node scripts/prod-wren.mjs topic push …)",
    )
    .requiredOption("--platform <platform>", PLATFORMS.join(" | "))
    .action(async (name: string, opts: { platform: string }) => {
      if (!(PLATFORMS as readonly string[]).includes(opts.platform))
        throw new Error(`platform must be one of ${PLATFORMS.join(", ")}`);
      const platform = opts.platform as Platform;
      const text = await sopText(root, name);
      // prod cannot read Canon: the standard and his calls ride the push (WA-1317)
      const notes = await readFile(join(topicDir(root, name), "notes.md"), "utf8").catch(() => "");
      const scope = scopeOf(notes, name);
      const standard = playbookStandard(root, name, scope, platform);
      const { playbook, changed } = await withDb((db) =>
        pushPlaybook(db, { platform, sop: name, text, scope, standard }),
      );
      const pieces = standard.kinds.map((k) => `${k.kind} ${k.n}`).join(", ") || "no pieces";
      console.log(
        `${platform}: ${name} ${changed ? "pushed" : "unchanged"} (${playbook.id}, ${text.length} chars; ${pieces}; ${standard.calls.length} calls)`,
      );
    });

  registerSourcePieces(source, { root, settings, rootDir, by: BY });

  topic
    .command("list")
    .description(
      "every topic: sources by priority, whether a guide, calls.md and standard.md exist",
    )
    .action(async () => {
      for (const name of await topics()) {
        const d = await readSopDir(root, name);
        const files = [
          d.current ? "guide" : "no guide",
          d.calls ? "calls.md" : null,
          d.standard ? "standard.md" : null,
        ].filter(Boolean);
        console.log(`${name}: ${files.join(", ")}, notes ${d.notes.trim().length} chars`);
        for (const s of d.sources) console.log(`  ${s.priority}  ${s.name}`);
      }
    });
  return { addOne, pull: () => git("pull", "--rebase", "--autostash", "-q"), share: shareCanon };
}
