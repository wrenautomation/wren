/**
 * `wren sop …`: SOPs built from videos, Drive Docs and files, kept as folders
 * under the SOPs directory (`SOP.md`, `notes.md`, `calls.md`, `standard.md`, `sources/`). `add` ingests
 * a source, `sync` writes the numbers and your calls from Learn, `build` writes the next SOP.md
 * on Claude Code (sync first), `ls` shows what is there, `push` hands SOP.md to the content loop
 * as a platform's playbook. Iterate by editing notes.md (your rules, top priority), calling on
 * pieces, and building again. Drive reads go through autobrowse's `drive` site on this machine.
 */
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { Settings } from "@wren/config";
import { learnBack, pushPlaybook } from "@wren/content";
import { WREN } from "@wren/core/access";
import { PLATFORMS, type Platform } from "@wren/core/content";
import type { Db } from "@wren/db";
import {
  breakdownItem,
  breakdowns,
  HUNT_CAP,
  HUNT_PER_QUERY,
  huntedIds,
  huntSop,
  readQueued,
  scopeOf,
  writeSopFiles,
  youtubeSearch,
} from "@wren/learn";
import { ClaudeCodeLlm, fleetKeys, loadLlmEnv } from "@wren/llm";
import {
  addSource,
  buildSop,
  DEFAULT_PRIORITY,
  type DriveGet,
  driveSources,
  expandCites,
  extractPoints,
  fileSource,
  numberCites,
  readSopDir,
  type Source,
  videoSource,
  writeSkill,
  youtubeSource,
} from "@wren/research/sops";
import type { Command } from "commander";
import { inArray } from "drizzle-orm";
import { learnReaders } from "./learn-readers.js";
import { watchKeys } from "./video-watch.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

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

export function registerSop(
  program: Command,
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
): void {
  const sopsDir = resolve(rootDir, settings.sopsDir);
  const sop = program
    .command("sop")
    .description("SOPs from videos, Drive Docs and files: `sop add`, then `sop build`");

  sop
    .command("add <name> <what>")
    .description(
      "ingest a source: a YouTube URL, another video URL (Instagram reel, TikTok, X), `drive:<folderId>` (every Doc under it), or a text file",
    )
    .option("--account <address>", "whose Drive (an autobrowse `drive` consent)")
    .option("--priority <n>", "higher wins when sources disagree (notes.md always wins)", (v) =>
      Number.parseInt(v, 10),
    )
    .option("--no-screen", "YouTube: captions only, skip the Gemini read of what is on screen")
    .action(
      async (
        name: string,
        what: string,
        opts: { account?: string; priority?: number; screen?: boolean },
      ) => {
        const dir = join(sopsDir, name);
        const priority = opts.priority ?? DEFAULT_PRIORITY;
        let sources: Source[];
        if (YOUTUBE.test(what)) {
          // Gemini keys (the llm.env fleet) read what the video shows on screen; never logged.
          if (opts.screen !== false) loadLlmEnv(settings.llmEnvPath, rootDir);
          const geminiKeys = opts.screen === false ? [] : fleetKeys(process.env, "gemini");
          if (opts.screen !== false && !geminiKeys.length)
            console.warn("no GEMINI keys in llm.env: captions only, on-screen content skipped");
          sources = [await youtubeSource(what, settings.ytDlp, priority, { geminiKeys })];
        } else if (/^https?:\/\//.test(what)) {
          // Reels, TikTok, X: no captions, so the watch core hears and reads the download.
          sources = [
            await videoSource(what, settings.ytDlp, priority, watchKeys(settings, rootDir)),
          ];
        } else if (what.startsWith("drive:")) {
          if (!opts.account) throw new Error("drive: needs --account <address>");
          const drive = autobrowseDrive(resolve(rootDir, settings.autobrowseDir), opts.account);
          sources = await driveSources(what.slice("drive:".length), drive, priority);
        } else if (/\.(md|txt)$/i.test(what)) sources = [await fileSource(resolve(what), priority)];
        else {
          // Not text (PDF, image, design export): kept as a reference file, not a source.
          await mkdir(join(dir, "refs"), { recursive: true });
          const to = join(dir, "refs", basename(what));
          await copyFile(resolve(what), to);
          console.log(to);
          return;
        }
        for (const s of sources) console.log(await addSource(dir, s));
      },
    );

  sop
    .command("cite [name]")
    .description(
      "number the citations in SOP.md ([1 12:03]) with one Sources list; every SOP when no name",
    )
    .action(async (name?: string) => {
      const names = name
        ? [name]
        : (await readdir(sopsDir, { withFileTypes: true }))
            .filter((e) => e.isDirectory() && e.name !== "shapes")
            .map((e) => e.name);
      for (const n of names) {
        const file = join(sopsDir, n, "SOP.md");
        const md = await readFile(file, "utf8").catch(() => "");
        if (!md) continue;
        const next = await numberCites(join(sopsDir, n), expandCites(md));
        if (next !== md) await writeFile(file, next);
        console.log(`${n}${next === md ? " (same)" : ""}`);
      }
    });

  /** `standard.md` and `calls.md` from the pieces the SOP's front matter names; false when it names none. */
  const sync = async (name: string) => {
    const dir = join(sopsDir, name);
    const notes = await readFile(join(dir, "notes.md"), "utf8").catch(() => "");
    const r = await withDb((db) => writeSopFiles(db, dir, name, notes));
    if (!r) return false;
    console.log(
      `${name}: ${r.pieces} piece${r.pieces === 1 ? "" : "s"} (${r.scope.kinds.join(", ")}), ${r.calls} call${r.calls === 1 ? "" : "s"} → standard.md, calls.md`,
    );
    return true;
  };

  sop
    .command("sync <name>")
    .description(
      "write standard.md (the numbers) and calls.md (your keep / tune / drop calls) from the pieces notes.md's front matter names (kinds, platforms, set)",
    )
    .action(async (name: string) => {
      if (!(await sync(name)))
        console.log(`${name}: notes.md names no kinds in its front matter; nothing to measure`);
    });

  sop
    .command("hunt <name>")
    .description(
      "seed Learn with candidates for this SOP: the set's followed creators, then the topic searched on YouTube (yt-dlp), most viewed first, up to --cap a day, each tagged with the SOP's name; then read, scored and broken down here, so they reach Competitors → To call",
    )
    .option("--cap <n>", "candidates a day for this SOP", (v) => Number.parseInt(v, 10), HUNT_CAP)
    .option(
      "--per-query <n>",
      "finds one search asks for",
      (v) => Number.parseInt(v, 10),
      HUNT_PER_QUERY,
    )
    .option("--model <name>", "the scoring and breakdown model", "cohere")
    .option("--no-read", "only queue them: the next `learn read` and `learn breakdown` take them")
    .action(
      async (name: string, o: { cap: number; perQuery: number; model: string; read: boolean }) => {
        const notes = await readFile(join(sopsDir, name, "notes.md"), "utf8").catch(() => "");
        const scope = scopeOf(notes);
        if (!scope)
          throw new Error(
            `${name}: notes.md names no kinds in its front matter (kinds, platforms, topic, set)`,
          );
        const { reader, judgeFor, catalogReader } = learnReaders(settings, rootDir);
        const say = (line: string) => console.error(line);
        const out = await withDb(async (db) => {
          const hunt = await huntSop(db, {
            client: WREN,
            name,
            scope,
            search: youtubeSearch(settings.ytDlp),
            catalog: catalogReader(),
            cap: o.cap,
            perQuery: o.perQuery,
          });
          say(
            `${name}: ${hunt.before} this day already, ${hunt.revived.length} taken back, ${hunt.saved.length} saved of ${hunt.found} found (${hunt.known} known)${hunt.unfollowed.length ? `; not followed: ${hunt.unfollowed.join(", ")}` : ""}; ${hunt.left} left under the cap`,
          );
          const ids = huntedIds(hunt);
          if (!o.read || !ids.length) return hunt;
          const judge = judgeFor(db, o.model);
          const { reads, stopped } = await readQueued(db, ids, {
            read: reader(),
            judge,
            onRead: (r, n, of) =>
              say(
                `[${n}/${of}] ${r.id} ${r.read ?? "gone"}${r.verdict ? ` ${r.verdict}` : ""}${r.why ? `: ${r.why}` : ""}`,
              ),
          });
          // Scoring breaks a piece down already; this catches one whose score failed.
          const read = reads.filter((r) => r.read === "read").map((r) => r.id);
          for (const id of read) await breakdownItem(db, judge, id);
          const broken = read.length
            ? (
                await db
                  .select({ id: breakdowns.itemId })
                  .from(breakdowns)
                  .where(inArray(breakdowns.itemId, read))
              ).map((b) => b.id)
            : [];
          say(`${broken.length} broken down${stopped ? `. Stopped: ${stopped}` : ""}`);
          return { ...hunt, read: reads, broken };
        });
        console.log(JSON.stringify(out, null, 2));
      },
    );

  sop
    .command("learn-back <name>")
    .description(
      "learn back: our posted pieces in this SOP's scope into Learn, read and broken down like anyone's, then each pattern you kept held to their real numbers (a reel's 3 s hook, a video's share watched, a post's engagement); a kept pattern ours do worse with comes back on Competitors → Check this",
    )
    .option("--model <name>", "the reading and breakdown model", "cohere")
    .action(async (name: string, o: { model: string }) => {
      const notes = await readFile(join(sopsDir, name, "notes.md"), "utf8").catch(() => "");
      const scope = scopeOf(notes);
      if (!scope)
        throw new Error(
          `${name}: notes.md names no kinds in its front matter (kinds, platforms, topic, set)`,
        );
      const { reader, judgeFor } = learnReaders(settings, rootDir);
      const out = await withDb((db) =>
        learnBack(db, {
          client: WREN,
          sop: name,
          scope,
          read: reader(),
          judge: judgeFor(db, o.model),
          say: (line) => console.error(line),
        }),
      );
      console.log(JSON.stringify(out, null, 2));
    });

  sop
    .command("build <name>")
    .description(
      "write the next SOP.md from notes.md, your calls, the standard and the sources, on Claude Code (prod numbers: node scripts/prod-wren.mjs sop sync <name> first)",
    )
    .option("--model <model>", "Claude Code model", "opus")
    .option("--no-sync", "skip the standard.md and calls.md rewrite first")
    .action(async (name: string, opts: { model: string; sync: boolean }) => {
      const dir = join(sopsDir, name);
      // No database here (the Mac with Postgres down): build from the two files as they are on disk.
      if (opts.sync)
        await sync(name).catch((err: unknown) =>
          console.warn(
            `sync skipped: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}; building from standard.md and calls.md on disk`,
          ),
        );
      const llm = new ClaudeCodeLlm(opts.model, { timeoutMs: 1_800_000 });
      const text = await buildSop(dir, llm);
      console.log(`${join(dir, "SOP.md")} (${text.split(/\s+/).length} words)`);
    });

  sop
    .command("extract <name> [source]")
    .description(
      "list every point a source makes into points/<source>.md (generated; your calls, not line edits, decide what is in); build then reads points instead of the raw source",
    )
    .option("--model <model>", "Claude Code model", "opus")
    .action(async (name: string, source: string | undefined, opts: { model: string }) => {
      const llm = new ClaudeCodeLlm(opts.model, { timeoutMs: 1_800_000 });
      for (const f of await extractPoints(join(sopsDir, name), llm, source)) console.log(f);
    });

  sop
    .command("link <name>")
    .description(
      "expose the SOP folder as the Claude Code skill `sop-<name>` (symlink in ~/.claude/skills)",
    )
    .action(async (name: string) => {
      await writeSkill(join(sopsDir, name));
      const to = join(homedir(), ".claude", "skills", `sop-${name}`);
      await unlink(to).catch(() => {});
      await symlink(join(sopsDir, name), to, "dir");
      console.log(to);
    });

  sop
    .command("push <name>")
    .description(
      "hand SOP.md to the content loop: every draft for the platform reads it (prod: node scripts/prod-wren.mjs sop push …)",
    )
    .requiredOption("--platform <platform>", PLATFORMS.join(" | "))
    .action(async (name: string, opts: { platform: string }) => {
      if (!(PLATFORMS as readonly string[]).includes(opts.platform))
        throw new Error(`platform must be one of ${PLATFORMS.join(", ")}`);
      const platform = opts.platform as Platform;
      const text = await readFile(join(sopsDir, name, "SOP.md"), "utf8");
      // What it governs rides along, so a draft reads the SOP's set live (designs/2026-10-25-competitor-analyzer.md, Use).
      const notes = await readFile(join(sopsDir, name, "notes.md"), "utf8").catch(() => "");
      const scope = scopeOf(notes);
      const { playbook, changed } = await withDb((db) =>
        pushPlaybook(db, { platform, sop: name, text, scope }),
      );
      console.log(
        `${platform}: ${name} ${changed ? "pushed" : "unchanged"} (${playbook.id}, ${text.length} chars)`,
      );
    });

  sop
    .command("ls")
    .description(
      "every SOP folder: sources by priority, whether SOP.md, calls.md and standard.md exist",
    )
    .action(async () => {
      const names = (await readdir(sopsDir, { withFileTypes: true }).catch(() => []))
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name);
      for (const name of names) {
        const d = await readSopDir(join(sopsDir, name));
        const files = [
          d.current ? "SOP.md" : "no SOP.md",
          d.calls ? "calls.md" : null,
          d.standard ? "standard.md" : null,
        ].filter(Boolean);
        console.log(`${name}: ${files.join(", ")}, notes ${d.notes.trim().length} chars`);
        for (const s of d.sources) console.log(`  ${s.priority}  ${s.name}`);
      }
    });
}
