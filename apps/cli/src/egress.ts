/**
 * `wren egress` (designs/2026-11-08-egress.md): the Wrenfile made live on this Mac. One
 * smokescreen per role under launchd; the relay reads the file at each launch. JSON out.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
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
  decisionOf,
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
const HOME = homedir();
const BIN = join(HOME, ".local/share/wren/egress", `smokescreen-${SMOKESCREEN.version}`);
/** Per role: `<role>.acl.yaml`, `<role>.conf.yaml`, `<role>.env` (the desk's install reads it). */
export const EGRESS_DIR = join(HOME, ".config/wren/egress");
const LOGS = join(HOME, "Library/Logs/wren-egress");
const AGENTS = join(HOME, "Library/LaunchAgents");
const LABEL = "com.wrenautomation.egress-";
const ROTATE_BYTES = 50 * 1024 * 1024;

/** wren's repo dir; the workspace root is its parent. */
const repoDir = () => resolve(process.env.WREN_ROOT ?? process.cwd());
export const wrenfilePath = () => join(repoDir(), "Wrenfile");
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
  const args = [
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
  ];
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
  launchctl("bootstrap", domain(), plist);
}

const envText = (r: Role) =>
  `${Object.entries(proxyEnv(r))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`;

function rotate(name: string) {
  const log = join(LOGS, `${name}.log`);
  if (existsSync(log) && statSync(log).size > ROTATE_BYTES) renameSync(log, `${log}.1`);
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
    if (!m?.[1] || w.roles[m[1]]) continue;
    if (loaded(`${LABEL}${m[1]}`)) launchctl("bootout", `${domain()}/${LABEL}${m[1]}`);
    rmSync(join(AGENTS, f));
    for (const x of ["acl.yaml", "conf.yaml", "env"])
      rmSync(join(EGRESS_DIR, `${m[1]}.${x}`), { force: true });
    removed.push(m[1]);
  }
  // launchd starts it within a second; give it three
  const up = async (port: number) => {
    for (let i = 0; i < 12; i++) {
      if (await listening(port)) return true;
      await new Promise((t) => setTimeout(t, 250));
    }
    return false;
  };
  for (const r of roles) Object.assign(r, { up: await up(r.port) });
  return { installed, roles, removed };
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
      print({ since, roles: out });
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
