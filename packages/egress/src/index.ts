/**
 * The Wrenfile (designs/2026-11-08-egress.md): one policy for where this Mac's processes may
 * connect. Pure: parse, check, compile to a smokescreen ACL per role and to Claude's sandbox
 * settings per relay setup, and read smokescreen's decision log.
 */
import { parse, stringify } from "yaml";
import { z } from "zod";

export const MODES = ["open", "report", "enforce"] as const;
export type Mode = (typeof MODES)[number];

/** smokescreen's grammar: a name, or `*.` and a name; punycode, one wildcard at the start. */
const HOST = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/;
/** `~/…` home or `@/…` workspace root; never a bare or relative path. */
const SECRET = /^(~|@)\/[^\s]+$/;
const NAME = /^[a-z][a-z0-9-]*$/;

const host = z.string().regex(HOST, "a host like api.example.com or *.example.com");
const role = z
  .object({
    port: z.number().int().min(1024).max(65535),
    mode: z.enum(MODES),
    hosts: z.array(host).default([]),
  })
  .strict();
const agent = z
  .object({
    role: z.string().regex(NAME),
    /** CLIs run outside the sandbox: trusted code that needs its role's hosts. */
    run: z.array(z.string().regex(NAME)).default([]),
    /** What the sandboxed shell may reach. */
    hosts: z.array(host).default([]),
  })
  .strict();

const schema = z
  .object({
    version: z.literal(1),
    secrets: z.array(z.string().regex(SECRET, "starts with ~/ or @/")).min(1),
    roles: z.record(z.string().regex(NAME), role),
    agents: z.record(z.string().regex(NAME), agent),
  })
  .strict()
  .superRefine((w, ctx) => {
    if (!w.agents.default) ctx.addIssue({ code: "custom", message: "agents.default is missing" });
    for (const [name, a] of Object.entries(w.agents))
      if (!w.roles[a.role])
        ctx.addIssue({ code: "custom", message: `agents.${name}: no role ${a.role}` });
    const ports = new Map<number, string>();
    for (const [name, r] of Object.entries(w.roles)) {
      const had = ports.get(r.port);
      if (had)
        ctx.addIssue({ code: "custom", message: `roles ${had} and ${name} share port ${r.port}` });
      ports.set(r.port, name);
    }
  });

export type Wrenfile = z.infer<typeof schema>;
export type Role = Wrenfile["roles"][string];

export class WrenfileError extends Error {}

/** The parsed file, or a WrenfileError naming every problem. */
export function parseWrenfile(text: string): Wrenfile {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    throw new WrenfileError(`Wrenfile is not YAML: ${(e as Error).message}`);
  }
  const r = schema.safeParse(raw);
  if (!r.success)
    throw new WrenfileError(
      `Wrenfile: ${r.error.issues.map((i) => `${i.path.join(".") || "file"}: ${i.message}`).join("; ")}`,
    );
  return r.data;
}

/** Never proxied: this Mac's own services. Every role denies them anyway. */
const NO_PROXY = "localhost,127.0.0.1,::1";
/** Beyond smokescreen's own private-range deny. */
export const DENY_RANGES = ["100.64.0.0/10"] as const;

const proxyUrl = (r: Role) => `http://127.0.0.1:${r.port}`;

/** The env that sends a process through a role's proxy. Node needs `NODE_USE_ENV_PROXY`. */
export function proxyEnv(r: Role): Record<string, string> {
  const url = proxyUrl(r);
  return {
    HTTPS_PROXY: url,
    HTTP_PROXY: url,
    https_proxy: url,
    http_proxy: url,
    NO_PROXY,
    no_proxy: NO_PROXY,
    NODE_USE_ENV_PROXY: "1",
  };
}

/** smokescreen's ACL for one role: every caller gets the `default` rule (one process per role). */
export function aclOf(name: string, r: Role): string {
  return stringify({
    version: "v1",
    services: [],
    default: { project: `wren-${name}`, action: r.mode, allowed_domains: r.hosts },
  });
}

/** `~/x` stays for the CLI to expand; `@/x` becomes `//<root>/x` (absolute in Claude's settings). */
function secretPath(s: string, root: string): string {
  return s.startsWith("@/") ? `/${root.replace(/\/$/, "")}/${s.slice(2)}` : s;
}

/** What the relay adds to one setup's launch. */
export interface SetupEgress {
  role: string;
  /** Claude's `settings.sandbox`. */
  sandbox: Record<string, unknown>;
  /** `permissions.deny`: the Read tool is outside the OS sandbox. */
  deny: string[];
  env: Record<string, string>;
  /** For the system prompt; none when no CLI runs outside. */
  note?: string;
}

export function setupEgress(w: Wrenfile, setup: string, root: string): SetupEgress {
  const a = w.agents[setup] ?? w.agents.default;
  const r = a && w.roles[a.role];
  if (!a || !r) throw new WrenfileError(`no egress for setup ${setup}`);
  const paths = w.secrets.map((s) => secretPath(s, root));
  return {
    role: a.role,
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      excludedCommands: a.run.flatMap((c) => [c, `${c} *`]),
      filesystem: { denyRead: paths },
      network: { allowedDomains: a.hosts },
    },
    deny: paths.flatMap((p) => [`Read(${p})`, `Read(${p}/**)`]),
    env: proxyEnv(r),
    ...(a.run.length ? { note: runNote(a.run) } : {}),
  };
}

/** Claude runs a compound command inside the sandbox, where these CLIs lose their config and the web. */
const runNote = (run: readonly string[]) =>
  `Shell commands run in a sandbox. ${run.map((c) => `\`${c}\``).join(", ")} run outside it only as a plain call: never in a pipe, after \`&&\` or \`;\`, or in \`$( )\`. Filter their JSON in a second call.`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The policy under a setup's own sandbox: lists join, the policy's values win. A setup may add a
 * host or a write path; it can never drop a secret or turn the sandbox off.
 */
export function mergeSandbox(policy: Obj | undefined, own: Obj | undefined): Obj | undefined {
  if (!policy) return own;
  if (!own) return policy;
  const out: Obj = { ...own };
  for (const [k, v] of Object.entries(policy)) {
    const o = own[k];
    if (Array.isArray(v) && Array.isArray(o)) out[k] = [...new Set([...o, ...v])];
    else if (isObj(v) && isObj(o)) out[k] = mergeSandbox(v, o);
    else out[k] = v;
  }
  return out;
}

/** One smokescreen decision, as its JSON log line has it. */
export interface Decision {
  at: string;
  host: string;
  allow: boolean;
  /** Allowed now only because the role is `report` or `open`. */
  miss: boolean;
  reason: string;
}

export function decisionOf(line: string): Decision | null {
  if (!line.includes("CANONICAL-PROXY-DECISION")) return null;
  try {
    const d = JSON.parse(line) as Record<string, unknown>;
    return {
      at: String(d.start_time ?? d.time ?? ""),
      host: String(d.requested_host ?? "").replace(/:443$/, ""),
      allow: d.allow === true,
      miss: d.enforce_would_deny === true,
      reason: String(d.decision_reason ?? ""),
    };
  } catch {
    return null;
  }
}

export interface HostCount {
  host: string;
  n: number;
  denied: number;
  misses: number;
  last: string;
}

/** Decisions grouped by host, most first. */
export function byHost(ds: readonly Decision[]): HostCount[] {
  const m = new Map<string, HostCount>();
  for (const d of ds) {
    const c = m.get(d.host) ?? { host: d.host, n: 0, denied: 0, misses: 0, last: "" };
    c.n++;
    if (!d.allow) c.denied++;
    if (d.miss) c.misses++;
    if (d.at > c.last) c.last = d.at;
    m.set(d.host, c);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.host.localeCompare(b.host));
}
