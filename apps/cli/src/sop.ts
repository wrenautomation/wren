/**
 * `wren sop …`: SOPs built from videos, Drive Docs and files, kept in the knowledge repo
 * (`knowledgeDir`): a guide per SOP, its sources and points as records (one commit per write, with a
 * by and a why), `topics/<name>/` for `notes.md`, `calls.md`, `standard.md`, refs. `add` ingests
 * a source, `sync` writes the numbers and your calls from Learn, `build` writes the next guide
 * on Claude Code (sync first), `ls` shows what is there, `push` hands the SOP to the content loop
 * as a platform's playbook. Iterate by editing notes.md (your rules, top priority), calling on
 * pieces, and building again. Drive reads go through autobrowse's `drive` site on this machine.
 */
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, symlink, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { Settings } from "@wren/config";
import { WREN } from "@wren/core/access";
import { PLATFORMS, type Platform } from "@wren/core/autobrowse";
import type { Db } from "@wren/db";
import { scopeOf, writeSopFiles } from "@wren/learn";
import { modelLlm } from "@wren/llm";
import {
  addSource,
  buildSop,
  DEFAULT_PRIORITY,
  type DriveGet,
  driveSources,
  extractPoints,
  fileSource,
  readSopDir,
  renumberGuide,
  type Source,
  sopText,
  topicDir,
  videoSource,
  writeSkill,
  youtubeSource,
} from "@wren/research/sops";
import { learnBack, pushPlaybook } from "@wren/starling-inbound";
import { claudeCode } from "@wrenautomation/models/command";
import type { Command } from "commander";
import { learnReaders } from "./learn-readers.js";
import { geminiModel, watchEyes, watchModels } from "./video-watch.js";

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
  const root = resolve(rootDir, settings.knowledgeDir);
  // every record wren writes says it came from here; the why names the command
  const BY = "wren-sop";
  const topics = async () =>
    (await readdir(join(root, "topics"), { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
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
        const dir = topicDir(root, name);
        const priority = opts.priority ?? DEFAULT_PRIORITY;
        let sources: Source[];
        if (YOUTUBE.test(what)) {
          // Gemini (the llm.env fleet) reads what the video shows on screen.
          const video = opts.screen === false ? null : await geminiModel(settings, rootDir);
          if (opts.screen !== false && !video)
            console.warn(
              "no working GEMINI key in llm.env: captions only, on-screen content skipped",
            );
          const { ear, ffmpeg } = watchEyes(settings, rootDir);
          sources = [await youtubeSource(what, settings.ytDlp, priority, { video, ear, ffmpeg })];
        } else if (/^https?:\/\//.test(what)) {
          // Reels, TikTok, X: no captions, so the watch core hears and reads the download.
          sources = [
            await videoSource(what, settings.ytDlp, priority, await watchModels(settings, rootDir)),
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
        for (const s of sources)
          console.log(await addSource(root, name, s, { by: BY, why: `sop add ${what}` }));
      },
    );

  sop
    .command("cite [name]")
    .description("number the guide's citations ([1 12:03]), one cites list; every SOP when no name")
    .action(async (name?: string) => {
      const names = name ? [name] : await topics();
      for (const n of names) {
        const changed = await renumberGuide(root, n, { by: BY, why: "sop cite: renumbered" });
        console.log(`${n}${changed ? "" : " (same)"}`);
      }
    });

  /** `standard.md` and `calls.md` from the pieces the SOP's front matter names; false when it names none. */
  const sync = async (name: string) => {
    const dir = topicDir(root, name);
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
    .command("learn-back <name>")
    .description(
      "learn back: our posted pieces in this SOP's scope into Learn, read and broken down like anyone's, then each pattern you kept held to their real numbers (a reel's 3 s hook, a video's share watched, a post's engagement); a kept pattern ours do worse with comes back on Competitors → Check this",
    )
    .option("--model <name>", "the reading and breakdown model", "cohere")
    .action(async (name: string, o: { model: string }) => {
      const notes = await readFile(join(topicDir(root, name), "notes.md"), "utf8").catch(() => "");
      const scope = scopeOf(notes, name);
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
      "write the next guide from notes.md, your calls, the standard and the sources, on Claude Code (prod numbers: node scripts/prod-wren.mjs sop sync <name> first)",
    )
    .option("--model <model>", "Claude Code model", "opus")
    .option("--no-sync", "skip the standard.md and calls.md rewrite first")
    .action(async (name: string, opts: { model: string; sync: boolean }) => {
      // No database here (the Mac with Postgres down): build from the two files as they are on disk.
      if (opts.sync)
        await sync(name).catch((err: unknown) =>
          console.warn(
            `sync skipped: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}; building from standard.md and calls.md on disk`,
          ),
        );
      const llm = modelLlm(claudeCode(opts.model, { timeoutMs: 1_800_000 }));
      const text = await buildSop(root, name, llm, { by: BY });
      console.log(`${join(root, "guides", `${name}.md`)} (${text.split(/\s+/).length} words)`);
    });

  sop
    .command("extract <name> [source]")
    .description(
      "list every point a source makes as findings tagged with the SOP (generated; your calls decide what is in); build then reads points instead of the raw source. Naming a source extracts it again",
    )
    .option("--model <model>", "Claude Code model", "opus")
    .action(async (name: string, source: string | undefined, opts: { model: string }) => {
      const llm = modelLlm(claudeCode(opts.model, { timeoutMs: 1_800_000 }));
      for (const f of await extractPoints(root, name, llm, { by: BY }, source)) console.log(f);
    });

  sop
    .command("link <name>")
    .description(
      "expose the SOP as the Claude Code skill `sop-<name>` (topics/<name>/, symlinked in ~/.claude/skills)",
    )
    .action(async (name: string) => {
      await writeSkill(root, name);
      const to = join(homedir(), ".claude", "skills", `sop-${name}`);
      await unlink(to).catch(() => {});
      await symlink(topicDir(root, name), to, "dir");
      console.log(to);
    });

  sop
    .command("push <name>")
    .description(
      "hand the SOP (the guide, rendered) to the content loop: every draft for the platform reads it (prod: node scripts/prod-wren.mjs sop push …)",
    )
    .requiredOption("--platform <platform>", PLATFORMS.join(" | "))
    .action(async (name: string, opts: { platform: string }) => {
      if (!(PLATFORMS as readonly string[]).includes(opts.platform))
        throw new Error(`platform must be one of ${PLATFORMS.join(", ")}`);
      const platform = opts.platform as Platform;
      const text = sopText(root, name);
      // What it governs rides along, so a draft reads the SOP's set live (designs/2026-10-25-competitor-analyzer.md, Use).
      const notes = await readFile(join(topicDir(root, name), "notes.md"), "utf8").catch(() => "");
      const scope = scopeOf(notes, name);
      const { playbook, changed } = await withDb((db) =>
        pushPlaybook(db, { platform, sop: name, text, scope }),
      );
      console.log(
        `${platform}: ${name} ${changed ? "pushed" : "unchanged"} (${playbook.id}, ${text.length} chars)`,
      );
    });

  sop
    .command("ls")
    .description("every SOP: sources by priority, whether a guide, calls.md and standard.md exist")
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
}
