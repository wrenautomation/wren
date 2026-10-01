/**
 * `wren sop …`: SOPs built from videos, Drive Docs and files, kept as folders
 * under the SOPs directory (`SOP.md`, `notes.md`, `sources/`). `add` ingests
 * a source, `build` writes the next SOP.md on Claude Code, `ls` shows what is
 * there. Iterate by editing notes.md (your rules, top priority) and building
 * again. Drive reads go through autobrowse's `drive` site on this machine.
 */
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Settings } from "@wren/config";
import { ClaudeCodeLlm } from "@wren/llm";
import {
  addSource,
  buildSop,
  DEFAULT_PRIORITY,
  type DriveGet,
  driveSources,
  fileSource,
  readSopDir,
  type Source,
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
      "ingest a source: a YouTube URL, `drive:<folderId>` (every Doc under it), or a text file",
    )
    .option("--account <address>", "whose Drive (an autobrowse `drive` consent)")
    .option("--priority <n>", "higher wins when sources disagree (notes.md always wins)", (v) =>
      Number.parseInt(v, 10),
    )
    .action(async (name: string, what: string, opts: { account?: string; priority?: number }) => {
      const dir = join(sopsDir, name);
      const priority = opts.priority ?? DEFAULT_PRIORITY;
      let sources: Source[];
      if (YOUTUBE.test(what)) sources = [await youtubeSource(what, settings.ytDlp, priority)];
      else if (what.startsWith("drive:")) {
        if (!opts.account) throw new Error("drive: needs --account <address>");
        const drive = autobrowseDrive(resolve(rootDir, settings.autobrowseDir), opts.account);
        sources = await driveSources(what.slice("drive:".length), drive, priority);
      } else sources = [await fileSource(resolve(what), priority)];
      for (const s of sources) console.log(await addSource(dir, s));
    });

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
