/**
 * A setup: one Claude product a wren UI can open (designs/2026-11-04-multi-user-runtime.md,
 * Decisions 2 and 3). Data only: a new setup is a record in setups.ts, never a code path.
 * What it holds is fixed here, never per user; who may open it is a grant on `app`.
 */

/** `plan`: the signed-in Claude plan on this machine. `key`: a client's own API key. */
export type CredentialKind = "plan" | "key";

/** `sdk`: stream-json through the relay. `terminal`: the CLI's own TUI for a client's `/login` (WA-1051, not built). */
export type Connection = "sdk" | "terminal";

export interface Setup {
  /** URL key: `/s/<name>`. */
  name: string;
  title: string;
  /** Portal app a grant names (`@wren/core/access` APPS): `can(who, "run", {client, app})`. */
  app: string;
  /** Working dir; relative paths resolve from the workspace root. */
  cwd: string;
  model: string;
  /** Models the page may switch to; `model` is always allowed. */
  models?: readonly string[];
  /** Built-in tools (`--tools`). */
  tools: readonly string[];
  /** Skill filter sent in `initialize`: `plugin:skill` names. */
  skills: readonly string[];
  /** Plugin dirs (`--plugin-dir`): a package name resolves to its root, else a path. */
  plugins: readonly string[];
  /** MCP servers (`--mcp-config`); none by default (`--strict-mcp-config` always). */
  mcpServers?: Readonly<Record<string, unknown>>;
  /** `permissions.allow` rules: calls that skip the prompt. */
  allow: readonly string[];
  /** Fixed permission mode the page may not change. `dontAsk`: anything not in `allow` is denied, never asked. */
  mode?: "dontAsk";
  /** Host env names passed to the child, beyond the base. */
  passEnv: readonly string[];
  /** Fixed vars the child always gets (never a secret: records are public code). */
  vars?: Readonly<Record<string, string>>;
  /** Appended to the Claude Code system prompt. */
  append?: string;
  credentials: readonly CredentialKind[];
  connection: Connection;
  /**
   * The CLI's `sandbox` settings, passed as they are: an OS boundary on shell commands (writes to
   * the cwd and temp only, network by domain). File tools stay under `allow`.
   */
  sandbox?: Readonly<Record<string, unknown>>;
  /** Opens for the Mac's owner only, on every route: a setup with a wide shell (a maker). */
  owner?: true;
  /** What a maker builds for: tags a caller matches (a Vireo subject's slug). */
  serves?: readonly string[];
  /** Its sessions may start headless runs: `maker` on PATH, the session's own token in the env. */
  runs?: true;
}
