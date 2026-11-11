/**
 * `wren sop …`: SOPs built from videos, Drive Docs and files, kept in Canon
 * (`canonDir`): a guide per SOP, its sources and points as records (one commit per write, with a
 * by and a why), `topics/<name>/` for `notes.md`, `calls.md`, `standard.md`, refs. `add` ingests
 * a source and breaks a reel or video down, `sync` writes the numbers and your calls from Canon,
 * `build` writes the next guide on Claude Code (sync first), `ls` shows what is there, `push`
 * hands the SOP and its standard to the content loop as a platform's playbook. Iterate by editing
 * notes.md (your rules, top priority), calling on pieces (`call`), and building again. Drive
 * reads go through autobrowse's `drive` site on this machine.
 */
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, symlink, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { Settings } from "@wren/config";
import { playbookStandard, scopeOf, writeSopFiles } from "@wren/content-standard";
import { PLATFORMS, type Platform } from "@wren/core/autobrowse";
import type { Db } from "@wren/db";
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
import { pushPlaybook } from "@wren/starling-inbound";
import { loadWorking } from "@wrenautomation/knowledge";
import { claudeCode } from "@wrenautomation/models/command";
import type { Command } from "commander";
import { breakdownLlm, breakdownSource, registerSopPieces } from "./sop-pieces.js";
import { watchEyes } from "./video-watch.js";

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
  const root = resolve(rootDir, settings.canonDir);
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
    .command("add <name> [what]")
    .description(
      "ingest a source, into the SOP when one is named (`sop add <url>` for a link that fits none yet): a YouTube URL, another video URL (Instagram reel, TikTok, X), `drive:<folderId>` (every Doc under it), or a text file. A reel or video is broken down",
    )
    .option("--from <person>", "who gave it (a person's sources outrank an agent's): the provider")
    .option("--account <address>", "whose Drive (an autobrowse `drive` consent)")
    .option("--priority <n>", "higher wins when sources disagree (notes.md always wins)", (v) =>
      Number.parseInt(v, 10),
    )
    .option("--no-screen", "YouTube: captions only, skip the frames read of what is on screen")
    .option("--no-breakdown", "skip the breakdown of a reel or video")
    .option("--model <name>", "the breakdown model", "cohere")
    .action(
      async (
        first: string,
        second: string | undefined,
        opts: {
          from?: string;
          account?: string;
          priority?: number;
          screen?: boolean;
          breakdown?: boolean;
          model: string;
        },
      ) => {
        const [name, what] = second === undefined ? [null, first] : [first, second];
        const priority = opts.priority ?? DEFAULT_PRIORITY;
        let sources: Source[];
        if (YOUTUBE.test(what)) {
          // the frames, read by the eye, carry what the captions don't: what is on screen
          const { eye, ear, ffmpeg } = watchEyes(settings, rootDir);
          sources = [
            await youtubeSource(what, settings.ytDlp, priority, {
              ...(opts.screen === false ? {} : { eye }),
              ear,
              ffmpeg,
            }),
          ];
        } else if (/^https?:\/\//.test(what)) {
          // Reels, TikTok, X: no captions, so the watch core hears and reads the download.
          sources = [
            await videoSource(what, settings.ytDlp, priority, watchEyes(settings, rootDir)),
          ];
        } else if (what.startsWith("drive:")) {
          if (!opts.account) throw new Error("drive: needs --account <address>");
          const drive = autobrowseDrive(resolve(rootDir, settings.autobrowseDir), opts.account);
          sources = await driveSources(what.slice("drive:".length), drive, priority);
        } else if (/\.(md|txt)$/i.test(what)) sources = [await fileSource(resolve(what), priority)];
        else {
          if (!name) throw new Error("a reference file needs an SOP name");
          // Not text (PDF, image, design export): kept as a reference file, not a source.
          const dir = topicDir(root, name);
          await mkdir(join(dir, "refs"), { recursive: true });
          const to = join(dir, "refs", basename(what));
          await copyFile(resolve(what), to);
          console.log(to);
          return;
        }
        const who = { by: BY, why: `sop add ${what}` };
        const extra = opts.from ? { provider: { kind: "human", who: opts.from } } : {};
        const llm = opts.breakdown === false ? null : breakdownLlm(settings, rootDir, opts.model);
        for (const s of sources) {
          const path = await addSource(root, name, s, who, extra);
          console.log(path);
          const id = basename(path, ".md");
          const kind = loadWorking(root).docs.find((l) => l.doc.fm.id === id)?.doc.fm.kind;
          if (llm && (kind === "reel" || kind === "video")) {
            const b = await breakdownSource(root, id, llm, who);
            console.log(
              b ? `  broken down: ${b.hookStyle}, ${b.beats.length} beats` : "  no breakdown",
            );
          }
        }
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
    const r = await writeSopFiles(root, dir, name, notes);
    if (!r) return false;
    console.log(
      `${name}: ${r.pieces} piece${r.pieces === 1 ? "" : "s"} (${r.scope.kinds.join(", ")}), ${r.calls} call${r.calls === 1 ? "" : "s"} → standard.md, calls.md`,
    );
    return true;
  };

  sop
    .command("sync <name>")
    .description(
      "write standard.md (the numbers) and calls.md (your keep / tune / drop calls) from the Canon pieces notes.md's front matter names (kinds, platforms, set)",
    )
    .action(async (name: string) => {
      if (!(await sync(name)))
        console.log(`${name}: notes.md names no kinds in its front matter; nothing to measure`);
    });

  sop
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
      "hand the SOP (the guide, rendered) and its standard and calls from Canon to the content loop: every draft for the platform reads them (prod: node scripts/prod-wren.mjs sop push …)",
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

  registerSopPieces(sop, { root, settings, rootDir, by: BY });

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
