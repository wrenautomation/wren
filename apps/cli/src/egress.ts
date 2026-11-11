/**
 * `wren egress` (designs/2026-11-08-egress.md): the Wrenfile made live on this Mac. One
 * smokescreen per role under launchd, the key gate (credvault) for roles with keys, a Seatbelt
 * shim per locked role; the relay reads the file at each launch. JSON out.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { LaunchEgress, Setup } from "@wren/agent";
import {
  aclOf,
  byHost,
  DENY_RANGES,
  type Decision,
  dbRelayEnv,
  decisionOf,
  gateConfig,
  gateDir,
  lockProfile,
  mergeSandbox,
  parseWrenfile,
  proxyEnv,
  type Role,
  setupEgress,
  type Wrenfile,
} from "@wren/egress";
import type { Command } from "commander";

const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));

/** smokescreen release, pinned: a new version is a code change with its checksum. */
const SMOKESCREEN = {
  version: "v0.1.0",
  asset: "smokescreen_v0.1.0_darwin_arm64.tar.gz",
  sha256: "daaec6a547288cbb65bf76c0322b1b749b276856e131d4b284655aba821ec512",
};
/** The key gate's pieces, pinned: mitmproxy (MIT) in a venv, credvault from npm. */
const MITMPROXY = "12.1.2";
const CREDVAULT = "0.17.0";
const HOME = homedir();
const SHARE = join(HOME, ".local/share/wren/egress");
const BIN = join(SHARE, `smokescreen-${SMOKESCREEN.version}`);
const MITM_DIR = join(SHARE, `mitmproxy-${MITMPROXY}`);
const CREDVAULT_DIR = join(SHARE, `credvault-${CREDVAULT}`);
/** `egress-<role>`: runs a command as a locked role (Seatbelt + the role's proxy env). */
const SHIMS = join(SHARE, "bin");
const GATE = "gate";
/** Per role: `<role>.acl.yaml`, `<role>.conf.yaml`, `<role>.env` (the desk's install reads it). */
const EGRESS_DIR = join(HOME, ".config/wren/egress");
const LOGS = join(HOME, "Library/Logs/wren-egress");
const AGENTS = join(HOME, "Library/LaunchAgents");
const LABEL = "com.wrenautomation.egress-";
const ROTATE_BYTES = 50 * 1024 * 1024;

/** wren's repo dir; the workspace root is its parent. */
const repoDir = () => resolve(process.env.WREN_ROOT ?? process.cwd());
const wrenfilePath = () => join(repoDir(), "Wrenfile");
const readWrenfile = (): Wrenfile => parseWrenfile(readFileSync(wrenfilePath(), "utf8"));

/**
 * What the relay adds to a setup's launch: read fresh each time, so an edit needs no restart.
 * No Wrenfile = nothing added; a broken one throws, so no session opens outside the policy.
 */
export function egressFor(setup: Setup): LaunchEgress | undefined {
  if (!existsSync(wrenfilePath())) return undefined;
  const e = setupEgress(readWrenfile(), setup.name, resolve(repoDir(), ".."));
  return { ...e, sandbox: mergeSandbox(e.sandbox, setup.sandbox as Record<string, unknown>) ?? {} };
}

/** True when something answers on the port. */
export function listening(port: number, ms = 500): Promise<boolean> {
  return new Promise((done) => {
    const s = connect({ host: "127.0.0.1", port });
    const end = (ok: boolean) => {
      s.destroy();
      done(ok);
    };
    s.setTimeout(ms, () => end(false));
    s.once("connect", () => end(true));
    s.once("error", () => end(false));
  });
}

async function install(): Promise<boolean> {
  if (existsSync(BIN)) return false;
  const url = `https://github.com/stripe/smokescreen/releases/download/${SMOKESCREEN.version}/${SMOKESCREEN.asset}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`smokescreen download: ${res.status} ${url}`);
  const tgz = Buffer.from(await res.arrayBuffer());
  const sum = createHash("sha256").update(tgz).digest("hex");
  if (sum !== SMOKESCREEN.sha256)
    throw new Error(`smokescreen checksum ${sum} is not the pinned ${SMOKESCREEN.sha256}`);
  const tmp = `${BIN}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, "s.tgz"), tgz);
  execFileSync("tar", ["xzf", "s.tgz", "--strip-components", "1"], { cwd: tmp });
  renameSync(join(tmp, "smokescreen"), BIN);
  chmodSync(BIN, 0o755);
  rmSync(tmp, { recursive: true, force: true });
  return true;
}

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function plistOf(name: string, r: Role): string {
  return plist(name, [
    BIN,
    "--config-file",
    join(EGRESS_DIR, `${name}.conf.yaml`),
    "--egress-acl-file",
    join(EGRESS_DIR, `${name}.acl.yaml`),
    "--listen-ip",
    "127.0.0.1",
    "--listen-port",
    String(r.port),
    ...DENY_RANGES.flatMap((d) => ["--deny-range", d]),
  ]);
}

function plist(name: string, args: string[]): string {
  const log = join(LOGS, `${name}.log`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}${name}</string>
  <key>ProgramArguments</key><array>${args.map((a) => `<string>${xml(a)}</string>`).join("")}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

/** Writes the file when its text changed; true if it did. */
function put(path: string, text: string): boolean {
  if (existsSync(path) && readFileSync(path, "utf8") === text) return false;
  writeFileSync(path, text);
  return true;
}

const domain = () => `gui/${process.getuid?.() ?? 501}`;
const launchctl = (...args: string[]) =>
  execFileSync("launchctl", args, { stdio: ["ignore", "ignore", "pipe"] });
const loaded = (label: string) => {
  try {
    launchctl("print", `${domain()}/${label}`);
    return true;
  } catch {
    return false;
  }
};

function restart(plist: string, label: string) {
  if (loaded(label)) launchctl("bootout", `${domain()}/${label}`);
  // bootout returns before the job is gone; bootstrap fails (5: I/O error) until it is
  for (let i = 0; ; i++) {
    try {
      launchctl("bootstrap", domain(), plist);
      return;
    } catch (e) {
      if (i >= 20) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

const envText = (r: Role) =>
  `${Object.entries(proxyEnv(r))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`;

function rotate(name: string) {
  const log = join(LOGS, `${name}.log`);
  if (existsSync(log) && statSync(log).size > ROTATE_BYTES) renameSync(log, `${log}.1`);
}

/** A stable node path (Homebrew's link), so a node upgrade does not break the job. */
const nodeBin = () =>
  ["/opt/homebrew/bin/node", "/usr/local/bin/node"].find((p) => existsSync(p)) ?? process.execPath;

function installGate(): boolean {
  let did = false;
  const mitmdump = join(MITM_DIR, "bin/mitmdump");
  if (!existsSync(mitmdump)) {
    const uv =
      ["/opt/homebrew/bin/uv", join(HOME, ".local/bin/uv")].find((p) => existsSync(p)) ?? "uv";
    execFileSync(uv, ["venv", "-q", "--python", "3.12", MITM_DIR], { stdio: "inherit" });
    const py = join(MITM_DIR, "bin/python");
    execFileSync(uv, ["pip", "install", "-q", "--python", py, `mitmproxy==${MITMPROXY}`], {
      stdio: "inherit",
    });
    did = true;
  }
  if (!existsSync(credvaultCli())) {
    execFileSync(
      "npm",
      [
        "install",
        "--prefix",
        CREDVAULT_DIR,
        "--no-save",
        "--ignore-scripts",
        `credvault@${CREDVAULT}`,
      ],
      { stdio: "inherit" },
    );
    did = true;
  }
  return did;
}
const credvaultCli = () => join(CREDVAULT_DIR, "node_modules/credvault/dist/cli.js");

/** The gate job restarts when its config, its pins or a source file changed. */
async function applyGate(w: Wrenfile) {
  const label = `${LABEL}${GATE}`;
  const plistPath = join(AGENTS, `${label}.plist`);
  const config = gateConfig(w, {
    root: resolve(repoDir(), ".."),
    mitmdump: join(MITM_DIR, "bin/mitmdump"),
  });
  if (!config) {
    if (loaded(label)) launchctl("bootout", `${domain()}/${label}`);
    rmSync(plistPath, { force: true });
    return null;
  }
  const installed = installGate();
  const configPath = join(EGRESS_DIR, "gate.json");
  const sources = (config.sources as string[]).map((p) => [
    p,
    existsSync(p) ? statSync(p).mtimeMs : 0,
  ]);
  const changed = [
    put(configPath, `${JSON.stringify(config, null, 2)}\n`),
    put(join(EGRESS_DIR, "gate.sources.json"), JSON.stringify(sources)),
    put(plistPath, plist(GATE, [nodeBin(), credvaultCli(), "gate", "--config", configPath])),
  ].some(Boolean);
  chmodSync(configPath, 0o600);
  rotate(GATE);
  const restarted = changed || installed || !loaded(label);
  if (restarted) restart(plistPath, label);
  const ports = Object.values(config.roles as Record<string, { port: number }>).map((r) => r.port);
  // the gate waits for mitmdump and its CA before the ports open
  const up = await Promise.all(ports.map((p) => waitUp(p, 60)));
  return { restarted, installed, ports, up: up.every(Boolean), log: join(LOGS, `${GATE}.log`) };
}

/** `<role>.sb` and `egress-<role>` for each locked role; both removed for an unlocked one. */
function applyLocks(w: Wrenfile) {
  mkdirSync(SHIMS, { recursive: true });
  const out = [];
  for (const [name, r] of Object.entries(w.roles)) {
    const sb = join(EGRESS_DIR, `${name}.sb`);
    const shim = join(SHIMS, `egress-${name}`);
    if (!r.lock) {
      rmSync(sb, { force: true });
      rmSync(shim, { force: true });
      continue;
    }
    put(sb, lockProfile(w, { root: resolve(repoDir(), "..") }));
    const env = Object.entries({ ...proxyEnv(r), ...dbRelayEnv(w) })
      .map(([k, v]) => `export ${k}='${v}'`)
      .join("\n");
    put(
      shim,
      `#!/bin/sh\n# wren egress: run a command as role ${name}: loopback only (Seatbelt), through its proxy\n${env}\nexec /usr/bin/sandbox-exec -f '${sb}' "$@"\n`,
    );
    chmodSync(shim, 0o755);
    out.push({ role: name, profile: sb, shim });
  }
  return out;
}

/**
 * A relay setup's bin dir: each CLI a locked role runs outside Claude's sandbox becomes a script
 * that runs it through `egress-<role>`. Other links stay.
 */
export function lockBins(dir: string, setup: Setup): void {
  if (!existsSync(wrenfilePath())) return;
  const w = readWrenfile();
  const a = w.agents[setup.name] ?? w.agents.default;
  const r = a && w.roles[a.role];
  if (!a || !r?.lock) return;
  const shim = join(SHIMS, `egress-${a.role}`);
  if (!existsSync(shim))
    throw new Error(`role ${a.role} is locked but ${shim} is missing: run wren egress apply`);
  for (const cli of a.run) {
    const link = join(dir, cli);
    if (!existsSync(link)) continue;
    const real = realpathSync(link);
    rmSync(link);
    writeFileSync(link, `#!/bin/sh\nexec '${shim}' '${real}' "$@"\n`, { mode: 0o755 });
  }
}

/** Polls a port until it answers; `quarters` × 250 ms. */
async function waitUp(port: number, quarters = 12): Promise<boolean> {
  for (let i = 0; i < quarters; i++) {
    if (await listening(port)) return true;
    await new Promise((t) => setTimeout(t, 250));
  }
  return false;
}

const DB = "db";
/** The db relay job (packages/egress/bin/db-relay.mjs): restarts when its plist changed. */
async function applyDb(w: Wrenfile) {
  const label = `${LABEL}${DB}`;
  const plistPath = join(AGENTS, `${label}.plist`);
  if (!w.db) {
    if (loaded(label)) launchctl("bootout", `${domain()}/${label}`);
    rmSync(plistPath, { force: true });
    return null;
  }
  const root = resolve(repoDir(), "..");
  const from = w.db.from.startsWith("@/")
    ? join(root, w.db.from.slice(2))
    : join(HOME, w.db.from.slice(2));
  const script = join(repoDir(), "packages/egress/bin/db-relay.mjs");
  const changed = put(plistPath, plist(DB, [nodeBin(), script, String(w.db.port), from]));
  rotate(DB);
  const restarted = changed || !loaded(label);
  if (restarted) restart(plistPath, label);
  return { port: w.db.port, restarted, up: await waitUp(w.db.port) };
}

async function apply() {
  const w = readWrenfile();
  const installed = await install();
  for (const d of [EGRESS_DIR, LOGS, AGENTS]) mkdirSync(d, { recursive: true });
  const roles = [];
  for (const [name, r] of Object.entries(w.roles)) {
    const label = `${LABEL}${name}`;
    const plist = join(AGENTS, `${label}.plist`);
    // each put runs: a short-circuit would leave a file stale
    const changed = [
      put(join(EGRESS_DIR, `${name}.acl.yaml`), aclOf(name, r)),
      put(join(EGRESS_DIR, `${name}.conf.yaml`), "allow_missing_role: true\n"),
      put(plist, plistOf(name, r)),
    ].some(Boolean);
    put(join(EGRESS_DIR, `${name}.env`), envText(r));
    rotate(name);
    const restarted = changed || installed || !loaded(label);
    if (restarted) restart(plist, label);
    roles.push({ role: name, port: r.port, mode: r.mode, restarted });
  }
  const removed = [];
  for (const f of readdirSync(AGENTS)) {
    const m = f.match(/^com\.wrenautomation\.egress-([a-z0-9-]+)\.plist$/);
    if (!m?.[1] || m[1] === GATE || m[1] === DB || w.roles[m[1]]) continue;
    if (loaded(`${LABEL}${m[1]}`)) launchctl("bootout", `${domain()}/${LABEL}${m[1]}`);
    rmSync(join(AGENTS, f));
    for (const x of ["acl.yaml", "conf.yaml", "env"])
      rmSync(join(EGRESS_DIR, `${m[1]}.${x}`), { force: true });
    removed.push(m[1]);
  }
  // launchd starts it within a second; give it three
  for (const r of roles) Object.assign(r, { up: await waitUp(r.port) });
  const gate = await applyGate(w);
  const db = await applyDb(w);
  const locks = applyLocks(w);
  return { installed, roles, removed, gate, db, locks };
}

const SPAN = /^(\d+)([mhd])$/;
function sinceOf(s: string): string {
  const m = s.match(SPAN);
  if (!m) throw new Error(`--since takes 30m, 6h or 7d, not ${s}`);
  const ms = Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as "m" | "h" | "d"];
  return new Date(Date.now() - ms).toISOString();
}

function decisions(name: string, since: string): Decision[] {
  const out: Decision[] = [];
  for (const f of [`${name}.log.1`, `${name}.log`]) {
    const p = join(LOGS, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const d = decisionOf(line);
      if (d && d.at >= since) out.push(d);
    }
  }
  return out;
}

export function registerEgress(program: Command): void {
  const egress = program
    .command("egress")
    .description("the Wrenfile: where each process on this Mac may connect");

  egress
    .command("check")
    .description("parse the Wrenfile; print each role's ACL and each setup's sandbox")
    .option("--setup <name...>", "setups to show", ["default", "weaver", "vireo"])
    .action((o: { setup: string[] }) => {
      const w = readWrenfile();
      const root = resolve(repoDir(), "..");
      print({
        file: wrenfilePath(),
        roles: Object.fromEntries(
          Object.entries(w.roles).map(([n, r]) => [n, { ...r, acl: aclOf(n, r) }]),
        ),
        setups: Object.fromEntries(o.setup.map((s) => [s, setupEgress(w, s, root)])),
      });
    });

  egress
    .command("apply")
    .description(
      "install smokescreen (pinned, checksum), write each role's files and launchd job, restart what changed",
    )
    .action(async () => print(await apply()));

  egress
    .command("status")
    .description("each role: up or down, its mode, decisions since --since")
    .option("--since <span>", "30m, 6h, 7d", "24h")
    .action(async (o: { since: string }) => {
      const w = readWrenfile();
      const since = sinceOf(o.since);
      const out = [];
      for (const [name, r] of Object.entries(w.roles)) {
        const ds = decisions(name, since);
        out.push({
          role: name,
          port: r.port,
          mode: r.mode,
          up: await listening(r.port),
          job: loaded(`${LABEL}${name}`),
          decisions: ds.length,
          denied: ds.filter((d) => !d.allow).length,
          misses: ds.filter((d) => d.miss).length,
        });
      }
      const gated = Object.entries(w.roles).filter(([, r]) => r.gate !== undefined);
      print({
        since,
        roles: out,
        gate: gated.length
          ? {
              job: loaded(`${LABEL}${GATE}`),
              ports: await Promise.all(
                gated.map(async ([role, r]) => ({
                  role,
                  port: r.gate,
                  up: await listening(r.gate ?? 0),
                })),
              ),
              audit: join(gateDir(), "audit.jsonl"),
            }
          : null,
      });
    });

  egress
    .command("log")
    .description(
      "decisions grouped by host; --misses = hosts not on the role's list (the ones to add or leave)",
    )
    .option("--role <name>", "one role; default all")
    .option("--misses", "only hosts the list does not hold")
    .option("--since <span>", "30m, 6h, 7d", "24h")
    .action((o: { role?: string; misses?: boolean; since: string }) => {
      const w = readWrenfile();
      if (o.role && !w.roles[o.role]) throw new Error(`no role ${o.role} in the Wrenfile`);
      const since = sinceOf(o.since);
      const names = o.role ? [o.role] : Object.keys(w.roles);
      print({
        since,
        roles: Object.fromEntries(
          names.map((n) => {
            const ds = decisions(n, since).filter((d) => !o.misses || d.miss || !d.allow);
            return [n, byHost(ds)];
          }),
        ),
      });
    });

  egress
    .command("env")
    .description("a role's proxy env, one KEY=VALUE a line, for a process started by hand")
    .argument("<role>")
    .action((name: string) => {
      const r = readWrenfile().roles[name];
      if (!r) throw new Error(`no role ${name} in the Wrenfile`);
      process.stdout.write(envText(r));
    });
}
