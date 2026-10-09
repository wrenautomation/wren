#!/usr/bin/env node
// Wren for AI tools: one file, no dependencies, Node 18+ (designs/2026-10-09-ai-tools.md).
// It calls your Wren's /api/agent with your access token and prints JSON. The skill beside it
// (SKILL.md) tells your agent how to use it. Every call acts as you, with what you may do.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "wren",
  "agent.json",
);
const DEFAULT_HOST = "https://app.wrenautomation.com";
const USAGE = `wren: your Wren records and handlers, as you.

  wren login [host]            save a token (pasted, or piped in) and your Wren's address
  wren types                   the record types you can read; start here
  wren list <type> [flags]     a type's rows: --view v --q words --where field=value
                               (repeat it) --sort field|-field --cursor c --limit 1-50
  wren get <type> <id>         one row with its detail and activity
  wren handlers [words]        Wren's team: the handlers you can call
  wren describe <Svc/handler>  Wren's team: a handler's input schema
  wren call <Svc/handler> [--key k] [--input '{json}' | --input @file.json] [--confirm name]
                               runs one; one that changes something needs --confirm <handler>
  wren tools                   what each command sends

  --host url   another Wren (a client's own address)     --pretty   indented JSON
  WREN_TOKEN and WREN_HOST override what login saved.`;

const fail = (message, code = 1) => {
  process.stderr.write(`wren: ${message}\n`);
  process.exit(code);
};

function parse(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
    if (k === "pretty" || k === "help") {
      flags[k] = true;
      continue;
    }
    const v = inline ?? argv[++i];
    if (v === undefined) fail(`--${k} needs a value`, 2);
    flags[k] = [...(flags[k] ?? []), v];
  }
  return { pos, flags };
}

const one = (flags, k) => flags[k]?.at(-1);
const value = (v) => {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

function saved() {
  try {
    return JSON.parse(readFileSync(CONFIG, "utf8"));
  } catch {
    return {};
  }
}

function target(flags) {
  const s = saved();
  const host = (one(flags, "host") || process.env.WREN_HOST || s.host || DEFAULT_HOST).replace(
    /\/+$/,
    "",
  );
  const token = process.env.WREN_TOKEN || s.token;
  return { host, token };
}

async function readSecret(prompt) {
  if (!process.stdin.isTTY) {
    let s = "";
    for await (const chunk of process.stdin) s += chunk;
    return s.trim();
  }
  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let s = "";
    const done = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", on);
      process.stderr.write("\n");
      resolve(s.trim());
    };
    const on = (ch) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") return done();
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f") s = s.slice(0, -1);
        else s += c;
      }
    };
    process.stdin.on("data", on);
  });
}

async function send(t, path, body) {
  if (!t.token && body !== undefined)
    fail("no token. Run `wren login` with one from Account > AI tools.", 3);
  const res = await fetch(`${t.host}/api/agent${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "wren-cli/1",
      ...(t.token ? { authorization: `Bearer ${t.token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch((err) => fail(`can't reach ${t.host}: ${err.message}`));
  const text = await res.text();
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    fail(`${t.host} answered ${res.status}, not JSON`);
  }
  if (!res.ok) fail(out?.error ?? `refused (${res.status})`, res.status === 401 ? 3 : 1);
  return out;
}

async function main() {
  const { pos, flags } = parse(process.argv.slice(2));
  const [cmd, ...rest] = pos;
  if (!cmd || flags.help || cmd === "help") {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const t = target(flags);
  const print = (v) => process.stdout.write(`${JSON.stringify(v, null, flags.pretty ? 2 : 0)}\n`);

  switch (cmd) {
    case "login": {
      const host = (rest[0] || one(flags, "host") || saved().host || DEFAULT_HOST).replace(
        /\/+$/,
        "",
      );
      const token = await readSecret("Paste your Wren token (it won't show): ");
      if (!/^wren_[A-Za-z0-9_-]{43}$/.test(token)) fail("that isn't a Wren token (wren_…)", 2);
      await send({ host, token }, "/types", {});
      mkdirSync(join(CONFIG, ".."), { recursive: true, mode: 0o700 });
      writeFileSync(CONFIG, JSON.stringify({ host, token }), { mode: 0o600 });
      chmodSync(CONFIG, 0o600);
      process.stderr.write(`Saved for ${host}.\n`);
      return;
    }
    case "tools":
      return print(await send(t, ""));
    case "types":
      return print(await send(t, "/types", {}));
    case "list": {
      const [record] = rest;
      if (!record) fail("list <type>: which type? `wren types` lists them", 2);
      const where = {};
      for (const w of flags.where ?? []) {
        const [k, v] = w.split(/=(.*)/s, 2);
        if (!k || v === undefined) fail(`--where ${w}: use field=value`, 2);
        const val = value(v);
        where[k] = k in where ? [].concat(where[k], val) : val;
      }
      return print(
        await send(t, "/list", {
          record,
          view: one(flags, "view"),
          q: one(flags, "q"),
          where: Object.keys(where).length ? where : undefined,
          sort: one(flags, "sort"),
          cursor: one(flags, "cursor"),
          limit: one(flags, "limit") ? Number(one(flags, "limit")) : undefined,
        }),
      );
    }
    case "get": {
      const [record, id] = rest;
      if (!record || id === undefined) fail("get <type> <id>", 2);
      return print(await send(t, "/get", { record, id: value(id) }));
    }
    case "handlers":
      return print(await send(t, "/handlers", { q: rest.join(" ") || undefined }));
    case "describe": {
      if (!rest[0]) fail("describe <Service/handler>", 2);
      return print(await send(t, "/describe", { id: rest[0] }));
    }
    case "call": {
      const [id] = rest;
      const [service, handler] = (id ?? "").split("/");
      if (!service || !handler) fail("call <Service/handler>", 2);
      const raw = one(flags, "input");
      let input;
      if (raw !== undefined) {
        const text = raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw;
        try {
          input = JSON.parse(text);
        } catch {
          fail("--input must be JSON (or @file.json)", 2);
        }
      }
      return print(
        await send(t, "/call", {
          service,
          handler,
          key: one(flags, "key"),
          input,
          confirm: one(flags, "confirm"),
        }),
      );
    }
    default:
      fail(`no command ${cmd}. \`wren help\` lists them`, 2);
  }
}

await main();
