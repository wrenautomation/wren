/**
 * `wren sop …`: SOPs built from videos, Drive Docs and files, kept as folders
 * under the SOPs directory (`SOP.md`, `notes.md`, `sources/`). `add` ingests
 * a source, `build` writes the next SOP.md on Claude Code, `ls` shows what is
 * there. Iterate by editing notes.md (your rules, top priority) and building
 * again. Drive reads go through autobrowse's `drive` site on this machine.
 */
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir, symlink, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { Settings } from "@wren/config";
import { ClaudeCodeLlm, fleetKeys, loadLlmEnv } from "@wren/llm";
import {
  addSource,
  buildSop,
  DEFAULT_PRIORITY,
  type DriveGet,
  driveSources,
  extractPoints,
  fileSource,
  readSopDir,
  type Source,
  videoSource,
  writeSkill,
  youtubeSource,
} from "@wren/research/sops";
import type { Command } from "commander";

const YOUTUBE = /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//;

/** autobrowse's CLI in its checkout: the Drive token lives in its .env, not ours. */
function autobrowseDrive(dir: string, account: string): DriveGet {
  return async (path, body) => {
    const args = ["-s", "autobrowse", "site", "call", "drive", "GET", path, "--account", account];
    args.push("--body", JSON.stringify(body));
    const r = spawnSync("pnpm", args, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0)
      throw new Error(`autobrowse drive ${path}: ${(r.stderr || r.stdout).trim()}`);
    return JSON.parse(r.stdout) as unknown;
  };
}

export function registerSop(program: Command, settings: Settings, rootDir: string): void {
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
          // Reels, TikTok, X: no captions, so Gemini hears and reads the download.
          loadLlmEnv(settings.llmEnvPath, rootDir);
          const geminiKeys = fleetKeys(process.env, "gemini");
          sources = [await videoSource(what, settings.ytDlp, priority, { geminiKeys })];
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
    .command("build <name>")
    .description("write the next SOP.md from notes.md and the sources, on Claude Code")
    .option("--model <model>", "Claude Code model", "opus")
    .action(async (name: string, opts: { model: string }) => {
      const dir = join(sopsDir, name);
      const llm = new ClaudeCodeLlm(opts.model, { timeoutMs: 1_800_000 });
      const text = await buildSop(dir, llm);
      console.log(`${join(dir, "SOP.md")} (${text.split(/\s+/).length} words)`);
    });

  sop
    .command("extract <name> [source]")
    .description(
      "list every point a source makes into points/<source>.md for you to curate (delete lines, prefix ! to force in); build then reads points instead of the raw source",
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
    .command("ls")
    .description("every SOP folder: sources by priority, whether SOP.md exists")
    .action(async () => {
      const names = (await readdir(sopsDir, { withFileTypes: true }).catch(() => []))
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name);
      for (const name of names) {
        const d = await readSopDir(join(sopsDir, name));
        console.log(
          `${name}: ${d.current ? "SOP.md" : "no SOP.md"}, notes ${d.notes.trim().length} chars`,
        );
        for (const s of d.sources) console.log(`  ${s.priority}  ${s.name}`);
      }
    });
}
