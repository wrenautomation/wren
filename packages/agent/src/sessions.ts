/**
 * The sessions a relay started, by setup and person (designs/2026-11-04-multi-user-runtime.md,
 * Decision 4). The page lists and reopens only these: the CLI's own session store holds every
 * Claude session in a folder, other people's and other tools' too.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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
