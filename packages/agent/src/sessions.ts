/**
 * The sessions a relay started, by setup and person (designs/2026-11-04-multi-user-runtime.md,
 * Decision 4). The page lists and reopens only these: the CLI's own session store holds every
 * Claude session in a folder, other people's and other tools' too.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface SessionRecord {
  setup: string;
  session: string;
  /** The person the relay let in (an email), or `local` for the local token. */
  who: string;
  at: string;
}

export interface Ledger {
  add(r: SessionRecord): void;
  /** Newest first, one row per session. */
  list(setup: string, who: string): SessionRecord[];
}

export const LEDGER_FILE = join(homedir(), ".config", "wren", "agent-sessions.jsonl");

const newestPer = (rows: SessionRecord[], setup: string, who: string): SessionRecord[] => {
  const by = new Map<string, SessionRecord>();
  for (const r of rows) if (r.setup === setup && r.who === who) by.set(r.session, r);
  return [...by.values()].sort((a, b) => b.at.localeCompare(a.at));
};

/** One JSON line per session start or resume; read whole on each list (small, local). */
export function fileLedger(path = LEDGER_FILE): Ledger {
  return {
    add: (r) => {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      appendFileSync(path, `${JSON.stringify(r)}\n`, { mode: 0o600 });
    },
    list: (setup, who) => {
      if (!existsSync(path)) return [];
      const rows: SessionRecord[] = [];
      for (const l of readFileSync(path, "utf8").split("\n")) {
        try {
          if (l) rows.push(JSON.parse(l) as SessionRecord);
        } catch {
          // a torn line from a crash: skip
        }
      }
      return newestPer(rows, setup, who);
    },
  };
}

export function memoryLedger(): Ledger {
  const rows: SessionRecord[] = [];
  return { add: (r) => void rows.push(r), list: (setup, who) => newestPer(rows, setup, who) };
}

/** Each setup's last full command list, as its CLI gave it: a new chat's `/` menu before its first turn. */
export interface CommandStore {
  get(setup: string): unknown[] | undefined;
  set(setup: string, list: unknown[]): void;
}

export const COMMANDS_FILE = join(homedir(), ".config", "wren", "agent-commands.json");

export function memoryCommands(): CommandStore {
  const by = new Map<string, unknown[]>();
  return { get: (s) => by.get(s), set: (s, l) => void by.set(s, l) };
}

/** One JSON file, read once; written only when a list changes. */
export function fileCommands(path = COMMANDS_FILE): CommandStore {
  const by = new Map<string, unknown[]>();
  try {
    const all = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    for (const [k, v] of Object.entries(all)) if (Array.isArray(v)) by.set(k, v);
  } catch {
    // none yet, or torn: start empty
  }
  return {
    get: (s) => by.get(s),
    set: (s, l) => {
      const was = by.get(s);
      if (was && JSON.stringify(was) === JSON.stringify(l)) return;
      by.set(s, l);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, JSON.stringify(Object.fromEntries(by)), { mode: 0o600 });
    },
  };
}
