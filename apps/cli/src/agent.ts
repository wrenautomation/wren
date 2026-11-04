/**
 * `wren agent …` (designs/2026-11-04-multi-user-runtime.md, Decision 2): the relay that puts a
 * Claude setup in a wren page. `serve` runs it on 127.0.0.1; `check` opens one session as a page
 * would and reports what loaded and what it cost; `setups` lists the records; `token` prints the
 * local token the page sends first.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  binDir,
  type Credential,
  checkSession,
  localToken,
  relay,
  SETUPS,
  setupNamed,
} from "@wren/agent";
import type { Command } from "commander";

export const AGENT_PORT = 4748;
const ORIGINS = [
  "https://app.wrenautomation.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
const SECRET_HOOK = join(homedir(), ".claude", "hooks", "no-secret-print.py");

/** The folder that holds wren, engine and tasks: a setup's relative cwd resolves here. */
const workspaceRoot = () => resolve(process.env.WREN_ROOT ?? process.cwd(), "..");

export function registerAgent(program: Command): void {
  const agent = program
    .command("agent")
    .description("Claude setups in wren pages: a local relay on the plan or a client's key");

  agent
    .command("setups")
    .description("list setups: app, tools, skills, credentials")
    .action(() => {
      for (const s of SETUPS)
        console.log(
          `${s.name}  app=${s.app}  model=${s.model}  tools=${s.tools.join(",")}  skills=${s.skills.join(",")}  credentials=${s.credentials.join(",")}  ${s.connection}`,
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
    .action((o: { port: string; credential: string; max: string }) => {
      const credential = credentialOf(o.credential);
      const bins = new Map<string, string>();
      const r = relay({
        port: Number(o.port),
        token: localToken(),
        origins: ORIGINS,
        setups: SETUPS,
        credential,
        maxSessions: Number(o.max),
        launch: {
          root: workspaceRoot(),
          host: process.env,
          secretHook: existsSync(SECRET_HOOK) ? `python3 ${SECRET_HOOK}` : undefined,
        },
        // one dir per setup per serve: a rebuild mid-session would pull a live child's PATH
        binDirs: (s) => {
          const dir = bins.get(s.name) ?? binDir(s);
          bins.set(s.name, dir);
          return [dir];
        },
        log: (l) => console.error(l),
      });
      r.server.on("listening", () =>
        console.error(
          `wren agent: ws://127.0.0.1:${o.port}/s/<setup> on ${credential.kind}; setups ${SETUPS.map((s) => s.name).join(", ")}`,
        ),
      );
      const quit = () => void r.close().then(() => process.exit(0));
      process.on("SIGINT", quit);
      process.on("SIGTERM", quit);
    });

  agent
    .command("check")
    .description(
      "open one session through a running relay; print what loaded and each turn's tokens",
    )
    .argument("[setup]", "setup name", "birdwatch")
    .option("--port <n>", "port", String(AGENT_PORT))
    .option("--say <text...>", "turns to send", ["Reply OK only."])
    .option("--resume <session>", "resume a session")
    .action(async (name: string, o: { port: string; say: string[]; resume?: string }) => {
      if (!setupNamed(name)) throw new Error(`no setup ${name}; see wren agent setups`);
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
