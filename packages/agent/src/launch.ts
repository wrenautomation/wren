/**
 * Setup + credential → the `claude` command line and child env. Pure, so the plan guard is a unit
 * test. Unmodified CLI on stream-json; never `--bare` (it skips the plan login).
 */
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import type { Setup } from "./setup.js";

/** Any of these in the child bills an API account or another provider instead of the plan. */
export const TOKEN_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "ANTHROPIC_BASE_URL",
] as const;

/** The child sees only these host vars, plus the setup's `passEnv`. */
export const BASE_ENV = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "TZ",
] as const;

/** Lean context: no claude.ai connectors, bundled skills, auto memory or nonessential calls. */
export const LEAN_ENV: Readonly<Record<string, string>> = {
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  CLAUDE_AGENT_SDK_CLIENT_APP: "wren-agent/0",
};

/** `key` carries the client's key for one session; never the shared model-keys file. */
export type Credential = { kind: "plan" } | { kind: "key"; key: string };

export interface Launch {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export interface LaunchOptions {
  /** Workspace root: a relative setup cwd resolves from here. */
  root: string;
  /** Host env to pick from. */
  host: Readonly<Record<string, string | undefined>>;
  resume?: string | undefined;
  /** Hook command that blocks printing secrets (William's user hook, carried per setup). */
  secretHook?: string | undefined;
  /** Package name → root dir; default resolves from this package. */
  resolvePlugin?: (name: string) => string;
  /** Dirs put before PATH (the setup's CLIs). */
  binDirs?: readonly string[];
  command?: string;
}

const require_ = createRequire(import.meta.url);
/** A package's folder on node's lookup paths; reads no `exports` map, so any package works. */
export function pluginRoot(name: string): string {
  for (const dir of require_.resolve.paths(name) ?? []) {
    const root = join(dir, name);
    if (existsSync(join(root, "package.json"))) return realpathSync(root);
  }
  throw new LaunchError(`plugin package ${name} is not installed`);
}

export class LaunchError extends Error {}

export function launch(setup: Setup, cred: Credential, o: LaunchOptions): Launch {
  if (setup.connection !== "sdk")
    throw new LaunchError(
      `setup ${setup.name}: connection ${setup.connection} is not built (WA-1051)`,
    );
  if (!setup.credentials.includes(cred.kind))
    throw new LaunchError(
      `setup ${setup.name} takes ${setup.credentials.join(", ")}, not ${cred.kind}`,
    );

  const blocked = new Set<string>(TOKEN_VARS);
  const env: Record<string, string> = {};
  for (const k of [...BASE_ENV, ...setup.passEnv]) {
    const v = o.host[k];
    if (v !== undefined && !blocked.has(k)) env[k] = v;
  }
  if (o.binDirs?.length) env.PATH = [...o.binDirs, env.PATH ?? ""].filter(Boolean).join(":");
  for (const [k, v] of Object.entries(setup.vars ?? {})) if (!blocked.has(k)) env[k] = v;
  Object.assign(env, LEAN_ENV);
  if (cred.kind === "key") env.ANTHROPIC_API_KEY = cred.key;

  const settings: Record<string, unknown> = { permissions: { allow: [...setup.allow] } };
  if (o.secretHook)
    settings.hooks = {
      PreToolUse: [
        { matcher: "Bash|Read|Grep", hooks: [{ type: "command", command: o.secretHook }] },
      ],
    };

  // biome-ignore format: flag pairs read better one per line
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-prompt-tool", "stdio",
    "--setting-sources", "",
    "--settings", JSON.stringify(settings),
    "--strict-mcp-config",
    "--mcp-config", JSON.stringify({ mcpServers: setup.mcpServers ?? {} }),
    "--exclude-dynamic-system-prompt-sections",
    "--tools", setup.tools.join(","),
    "--model", setup.model,
  ];
  if (setup.mode) args.push("--permission-mode", setup.mode);
  const plugin = o.resolvePlugin ?? pluginRoot;
  for (const p of setup.plugins)
    args.push(
      "--plugin-dir",
      isAbsolute(p) ? p : p.startsWith(".") ? resolve(o.root, p) : plugin(p),
    );
  if (setup.append) args.push("--append-system-prompt", setup.append);
  if (o.resume) args.push("--resume", o.resume);

  return { command: o.command ?? "claude", args, env, cwd: setupCwd(setup, o.root) };
}

/** A setup's working dir: relative paths resolve from the workspace root. */
export const setupCwd = (setup: Setup, root: string): string =>
  isAbsolute(setup.cwd) ? setup.cwd : resolve(root, setup.cwd);
