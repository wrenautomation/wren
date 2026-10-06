#!/usr/bin/env node
// Secrets without printing them. A source is an env file (KEY=VALUE lines) or an SSM parameter
// (/wren/..., KEY=VALUE lines or one JSON object).
//   node scripts/secrets.mjs keys <source>             names and value lengths, never values
//   node scripts/secrets.mjs run <source> -- <command>  the command with every key in its env;
//                                                       any value in its output is masked
//   node scripts/secrets.mjs set KEY=VAR KEY==text -KEY only inside `run <env file>`: rewrites
//                                                       that file (KEY from $VAR or the literal
//                                                       text; -KEY drops it). The old line stays
//                                                       commented, dated: the way back
// The agent's Bash guard (~/.claude/hooks/no-secret-print.py) sends raw reads here.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/** The source's keys and values, whatever its shape. */
export function parse(text) {
  const t = text.trim();
  if (t.startsWith("{")) {
    const o = JSON.parse(t);
    return Object.fromEntries(
      Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]),
    );
  }
  const out = {};
  for (const line of t.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** `text` with every value of 6+ characters replaced by its key's name, longest first. */
export function mask(text, values) {
  const pairs = Object.entries(values)
    .filter(([, v]) => v.length >= 6)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [k, v] of pairs) text = text.split(v).join(`[${k}]`);
  return text;
}

function load(source) {
  const text =
    /^\/[\w/-]+$/.test(source) && !source.startsWith("/Users")
      ? execFileSync(
          "aws",
          [
            "ssm",
            "get-parameter",
            "--name",
            source,
            "--with-decryption",
            "--query",
            "Parameter.Value",
            "--output",
            "text",
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        )
      : readFileSync(source, "utf8");
  return parse(text);
}

/** `text` with each change applied; the line it replaces kept as a dated comment. */
export function setLines(text, changes, env, day = new Date().toISOString().slice(0, 10)) {
  let out = text;
  for (const c of changes) {
    const drop = c.startsWith("-");
    const m = drop ? [null, c.slice(1)] : c.match(/^([A-Za-z_]\w*)==?(.*)$/);
    if (!m) throw new Error(`not KEY=VAR, KEY==text or -KEY: ${c}`);
    const key = m[1];
    const value = drop ? null : c.includes("==") ? m[2] : env[m[2]];
    if (value === undefined) throw new Error(`$${m[2]} is not set`);
    const line = new RegExp(`^${key}=.*$`, "m");
    const kept = (old) => `# before ${day}: ${old}${value === null ? "" : `\n${key}=${value}`}`;
    if (line.test(out)) out = out.replace(line, kept);
    else if (value !== null) out = `${out.replace(/\n*$/, "\n")}${key}=${value}\n`;
  }
  return out;
}

const [cmd, source, ...rest] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}` && cmd === "set") {
  const file = process.env.SECRETS_SOURCE;
  if (!file || file.startsWith("/wren/")) {
    console.error("set runs inside `secrets.mjs run <env file> -- ...` only");
    process.exit(2);
  }
  const changes = process.argv.slice(3);
  writeFileSync(file, setLines(readFileSync(file, "utf8"), changes, process.env));
  console.log(`set ${changes.map((c) => c.split("=")[0]).join(", ")}`);
} else if (import.meta.url === `file://${process.argv[1]}`) {
  if (!source || !["keys", "run"].includes(cmd)) {
    console.error("usage: secrets.mjs keys <file|/ssm/name> | run <file|/ssm/name> -- <command>");
    process.exit(2);
  }
  const values = load(source);
  if (cmd === "keys") {
    for (const [k, v] of Object.entries(values)) console.log(`${k}  (${v.length} chars)`);
  } else {
    const command = rest[0] === "--" ? rest.slice(1).join(" ") : rest.join(" ");
    const child = spawn("sh", ["-c", command], {
      env: { ...process.env, ...values, SECRETS_SOURCE: source },
      stdio: ["inherit", "pipe", "pipe"],
    });
    // Whole lines only, so a value split across two reads is still masked.
    const pipe = (from, to) => {
      let held = "";
      from.on("data", (d) => {
        held += d;
        const cut = held.lastIndexOf("\n") + 1;
        to.write(mask(held.slice(0, cut), values));
        held = held.slice(cut);
      });
      return new Promise((done) => from.on("end", () => done(to.write(mask(held, values)))));
    };
    const ends = [pipe(child.stdout, process.stdout), pipe(child.stderr, process.stderr)];
    child.on("close", async (code) => {
      await Promise.all(ends);
      process.exit(code ?? 1);
    });
  }
}
