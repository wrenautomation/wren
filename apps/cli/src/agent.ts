/**
 * `wren agent …` (designs/2026-11-04-multi-user-runtime.md, Decision 2): the relay that puts a
 * Claude setup in a wren page. `serve` runs it on 127.0.0.1; `check` opens one session as a page
 * would and reports what loaded and what it cost; `setups` lists the records; `token` prints the
 * local token the page sends first. `makers`, `run`, `runs` and `stop` drive headless runs through
 * a running relay (designs/2026-11-05-variants.md, C3); a chat calls them as `maker`.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  type Authorize,
  binDir,
  type Credential,
  checkSession,
  compactOf,
  fileCommands,
  fileLedger,
  hostSetups,
  localToken,
  RUN_ENV,
  relay,
  runClient,
  SETUPS,
  type Setup,
  sdkHistory,
  setupNamed,
  tokenMatches,
  UPLOADS_DIR,
} from "@wren/agent";
import { can, type MeAccess, whoFromMe } from "@wren/core/access";
import type { Command } from "commander";
import { egressFor, listening } from "./egress.js";

const AGENT_PORT = 4748;
const ORIGINS = [
  "https://app.wrenautomation.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
const SECRET_HOOK = join(homedir(), ".claude", "hooks", "no-secret-print.py");
const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
};

/** A page's answer is kept this long per token: the socket and the sessions list ask together. */
const ASKED_MS = 60_000;

/**
 * Decision 5: no Origin is a local process, which shows the local token. A page sends its
 * sign-in token; its own origin (on the allow list) says who that is (`delivery/me`), and the
 * grant decides: `can(who, "run", {app})` in Wren's own workspace.
 */
function pageGrant(local: string): Authorize {
  const asked = new Map<string, { at: number; me: MeAccess | null }>();
  const meOf = async (origin: string, token: string) => {
    const key = `${origin} ${token}`;
    const hit = asked.get(key);
    if (hit && Date.now() - hit.at < ASKED_MS) return hit.me;
    const res = await fetch(`${origin}/api/delivery/me`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: "{}",
    });
    const me = res.ok ? ((await res.json()) as MeAccess) : null;
    asked.set(key, { at: Date.now(), me });
    return me;
  };
  return async ({ credential, origin, setup }) => {
    if (!origin) return tokenMatches(credential, local) ? { who: "local", owner: true } : null;
    const me = await meOf(origin, credential);
    const who = me && whoFromMe(me, null);
    if (!who || !can(who, "run", { app: setup.app })) return null;
    // owner: a Wren admin, the only role that may run this Mac's agent unprompted (Decision 11)
    return {
      who: emailOf(credential) ?? new URL(origin).host,
      owner: me.team?.role === "admin",
    };
  };
}

/** The sign-in token's email, read after the portal accepted the token; a dev page sends none. */
function emailOf(token: string): string | null {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
    return typeof claims.email === "string" ? claims.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The folder that holds wren, engine and tasks: a setup's relative cwd resolves here. */
const workspaceRoot = () => resolve(process.env.WREN_ROOT ?? process.cwd(), "..");

/** This Mac's own setups, in the private tasks repo: makers, owner only (`@wren/agent` host.ts). */
const HOST_SETUPS = "tasks/docs/agent/setups";
const allSetups = (): readonly Setup[] => [
  ...SETUPS,
  ...hostSetups(resolve(workspaceRoot(), HOST_SETUPS), SETUPS),
];

/** Roles the setups use whose proxy does not answer. */
async function proxiesDown(): Promise<string[]> {
  const ports = new Map<string, number>();
  for (const s of allSetups()) {
    const port = Number(new URL(egressFor(s)?.env.HTTPS_PROXY ?? "http://x:0").port);
    if (port) ports.set(s.name, port);
  }
  const down = [];
  for (const [name, port] of ports) if (!(await listening(port))) down.push(name);
  return down;
}

export function registerAgent(program: Command): void {
  const agent = program
    .command("agent")
    .description("Claude setups in wren pages: a local relay on the plan or a client's key");

  agent
    .command("setups")
    .description("list setups: app, tools, skills, credentials; this Mac's own are owner only")
    .action(() => {
      for (const s of allSetups())
        console.log(
          `${s.name}  app=${s.app}  model=${s.model}  tools=${s.tools.join(",")}  skills=${s.skills.join(",")}  credentials=${s.credentials.join(",")}  ${s.connection}${s.owner ? "  owner only" : ""}${s.sandbox ? "  sandbox" : ""}${s.serves ? `  serves=${s.serves.join(",")}` : ""}${s.runs ? "  runs" : ""}`,
        );
    });

  agent
    .command("token")
    .description("print the local token a page sends first (made on first use, mode 600)")
    .action(() => console.log(localToken()));

  agent
    .command("serve")
    .description("run the relay on 127.0.0.1; one claude child per session")
    .option("--port <n>", "port", String(AGENT_PORT))
    .option(
      "--credential <kind>",
      "plan (this Mac's Claude login) or key (ANTHROPIC_API_KEY of this process: a client's, through secrets.mjs run)",
      "plan",
    )
    .option("--max <n>", "live sessions at once", "3")
    .option("--run-min <n>", "a headless run is stopped after this many minutes", "45")
    .option("--tape <dir>", "record each session's frames, both ways, for story fixtures")
    .action(
      (o: { port: string; credential: string; max: string; runMin: string; tape?: string }) => {
        const credential = credentialOf(o.credential);
        const setups = allSetups();
        const bins = new Map<string, string>();
        const r = relay({
          port: Number(o.port),
          authorize: pageGrant(localToken()),
          ledger: fileLedger(),
          commands: fileCommands(),
          history: sdkHistory,
          origins: ORIGINS,
          setups,
          credential,
          maxSessions: Number(o.max),
          runMs: Number(o.runMin) * 60_000,
          uploads: UPLOADS_DIR,
          ...(o.tape ? { tape: o.tape } : {}),
          launch: {
            root: workspaceRoot(),
            host: process.env,
            secretHook: existsSync(SECRET_HOOK) ? `python3 ${SECRET_HOOK}` : undefined,
            // chats compact where this Mac's terminal does
            compact: compactOf(readJson(join(homedir(), ".claude", "settings.json"))),
          },
          egress: egressFor,
          // one dir per setup per serve: a rebuild mid-session would pull a live child's PATH
          binDirs: (s) => {
            const dir = bins.get(s.name) ?? binDir(s, undefined, workspaceRoot());
            bins.set(s.name, dir);
            return [dir];
          },
          log: (l) => console.error(l),
        });
        r.server.on("listening", () => {
          console.error(
            `wren agent: ws://127.0.0.1:${o.port}/s/<setup> on ${credential.kind}; setups ${setups.map((s) => s.name).join(", ")}`,
          );
          // a setup or CLI change shows in the / menu at the next serve, before any chat
          void r.prime();
          void proxiesDown().then((down) => {
            if (down.length)
              console.error(
                `wren agent: egress proxy down for ${down.join(", ")}: its sessions cannot connect; run wren egress apply`,
              );
          });
        });
        const quit = () => void r.close().then(() => process.exit(0));
        process.on("SIGINT", quit);
        process.on("SIGTERM", quit);
      },
    );

  agent
    .command("check")
    .description(
      "open one session through a running relay; print what loaded and each turn's tokens",
    )
    .argument("[setup]", "setup name", "weaver")
    .option("--port <n>", "port", String(AGENT_PORT))
    .option("--say <text...>", "turns to send", ["Reply OK only."])
    .option("--resume <session>", "resume a session")
    .action(async (name: string, o: { port: string; say: string[]; resume?: string }) => {
      if (!setupNamed(name, allSetups()))
        throw new Error(`no setup ${name}; see wren agent setups`);
      const r = await checkSession({
        port: Number(o.port),
        token: localToken(),
        setup: name,
        prompts: o.say,
        resume: o.resume,
      });
      console.log(JSON.stringify(r, null, 2));
      if (r.closed && r.closed.code !== 1000 && r.closed.code !== 1005) process.exitCode = 1;
    });

  registerRuns(agent);
}

/** A chat's session token and relay from its env; a terminal uses the local token. */
const client = (port: string) =>
  runClient({
    url: process.env[RUN_ENV.url] ?? `http://127.0.0.1:${port}`,
    token: process.env[RUN_ENV.token] ?? localToken(),
  });
const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));

function registerRuns(agent: Command): void {
  const port = ["--port <n>", "the relay's port", String(AGENT_PORT)] as const;
  agent
    .command("makers")
    .description("list this Mac's makers (owner setups) and what each serves, as JSON")
    .option(...port)
    .action(async (o: { port: string }) =>
      json(
        (await client(o.port).makers()).map(({ name, title, serves, model, models }) => ({
          name,
          title,
          serves: serves ?? [],
          model,
          models,
        })),
      ),
    );
  agent
    .command("run")
    .description("queue one headless run of a setup: one prompt, no page, every ask denied")
    .argument("<setup>", "setup name")
    .argument("[prompt...]", "the prompt")
    .option("--file <path>", "read the prompt from a file")
    .option("--model <m>", "one of the setup's models")
    .option(...port)
    .action(
      async (
        setup: string,
        words: string[],
        o: { file?: string; model?: string; port: string },
      ) => {
        const prompt = o.file ? readFileSync(o.file, "utf8") : words.join(" ");
        json(await client(o.port).start(setup, prompt, o.model));
      },
    );
  agent
    .command("runs")
    .description("your runs, newest first, or one by id: state, session, result, denied calls")
    .argument("[id]", "run id")
    .option("--setup <name>", "one setup only")
    .option("--wait <seconds>", "block until none is queued or running, or the time passes")
    .option(...port)
    .action(async (id: string | undefined, o: { setup?: string; wait?: string; port: string }) => {
      const c = client(o.port);
      const read = async () => (id ? [await c.get(id)] : await c.list(o.setup));
      const until = Date.now() + Number(o.wait ?? 0) * 1000;
      let rows = await read();
      while (rows.some((r) => !r.ended) && Date.now() < until) {
        await new Promise((res) => setTimeout(res, 5000));
        rows = await read();
      }
      json(id ? rows[0] : rows);
    });
  agent
    .command("stop")
    .description("stop a queued or running run")
    .argument("<id>", "run id")
    .option(...port)
    .action(async (id: string, o: { port: string }) => json(await client(o.port).stop(id)));
}

function credentialOf(kind: string): Credential {
  if (kind === "plan") return { kind: "plan" };
  if (kind === "key") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key)
      throw new Error(
        "--credential key needs ANTHROPIC_API_KEY in this process (a client's, through secrets.mjs run)",
      );
    return { kind: "key", key };
  }
  throw new Error(`--credential plan|key, not ${kind}`);
}
