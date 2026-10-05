/**
 * SpamAssassin in Docker on the Mac (designs/2026-10-05-deliverability-tests.md): one
 * `spamd --local` container per run, each message piped through `spamc -R`. Free, and
 * the copy never leaves the machine. Local rules only: the block lists are the setup
 * test's job, and network tests would make the score drift with the lists.
 *
 * The container is `--rm` and its spamd runs under `timeout`, so a run killed before
 * `stop()` still leaves nothing behind for long. The Lambda never imports this.
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const SPAM_IMAGE = "wren-spamassassin";
/** At or above this a message fails. SpamAssassin's own spam line is 5.0; ours leaves room. */
export const SPAM_LIMIT = 2.0;
/** An orphaned container removes itself after this long. */
const LIFETIME_S = 1800;

export interface SpamRule {
  name: string;
  points: number;
  description: string;
}

export interface SpamScore {
  score: number;
  rules: SpamRule[];
}

/**
 * `spamc -R` output: `1.3/5.0` then the report, whose table lists each rule as
 * ` pts rule name  description`, a description running on over indented lines.
 */
export function parseReport(out: string): SpamScore {
  const lines = out.split(/\r?\n/);
  const score = Number.parseFloat(lines[0]?.split("/")[0] ?? "");
  if (!Number.isFinite(score)) throw new Error(`spamc gave no score: ${lines[0] ?? ""}`);
  const rules: SpamRule[] = [];
  const table = lines.findIndex((l) => /^\s*-+\s+-+/.test(l));
  for (const line of table < 0 ? [] : lines.slice(table + 1)) {
    const rule = line.match(/^\s*(-?\d+(?:\.\d+)?)\s+([A-Z0-9_]+)\s+(.*)$/);
    if (rule) {
      rules.push({
        points: Number.parseFloat(rule[1] as string),
        name: rule[2] as string,
        description: (rule[3] as string).trim(),
      });
    } else if (/^\s{5,}\S/.test(line) && rules.length) {
      const last = rules[rules.length - 1] as SpamRule;
      last.description = `${last.description} ${line.trim()}`;
    }
  }
  return { score, rules };
}

export interface Spamd {
  score(raw: Buffer): Promise<SpamScore>;
  stop(): Promise<void>;
}

/**
 * Build the image from `dockerDir` (the repo's `deploy/spamassassin`; cached layers make a
 * rebuild instant), start spamd, wait until it answers.
 */
export async function startSpamd(opts: {
  dockerDir: string;
  log?: (line: string) => void;
}): Promise<Spamd> {
  const log = opts.log ?? (() => {});
  log(`building ${SPAM_IMAGE} (cached after the first time)`);
  await run("docker", ["build", "-q", "-t", SPAM_IMAGE, opts.dockerDir], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const name = `wren-spamd-${process.pid}-${Date.now()}`;
  await run("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "--label",
    "wren.spamcheck=1",
    SPAM_IMAGE,
    "timeout",
    String(LIFETIME_S),
    "spamd",
    "--local",
    "--username=spamd",
    "--listen=127.0.0.1",
    "--allowed-ips=127.0.0.1",
    "--max-children=4",
    "--syslog=stderr",
  ]);
  const stop = async () => {
    await run("docker", ["rm", "-f", name]).catch(() => {});
  };
  try {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const ping = await run("docker", ["exec", name, "spamc", "-K"]).catch((e: unknown) => e);
      if (!(ping instanceof Error)) break;
      if (Date.now() > deadline) throw new Error(`spamd did not answer in 60 s: ${ping.message}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (err) {
    await stop();
    throw err;
  }
  return {
    score: (raw) => pipe(["exec", "-i", name, "spamc", "-R", "-x"], raw).then(parseReport),
    stop,
  };
}

function pipe(args: string[], input: Buffer): Promise<string> {
  return new Promise((ok, fail) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString("utf8");
    });
    child.on("error", fail);
    child.on("close", (code) =>
      code === 0 ? ok(out) : fail(new Error(`spamc exited ${code}: ${err.trim()}`)),
    );
    child.stdin.end(input);
  });
}
