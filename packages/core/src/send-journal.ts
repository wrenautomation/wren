/**
 * A send journal for wren's own calls to a platform API (no autobrowse between). It keeps, per
 * write key, what autobrowse's desk journal keeps (autobrowse `src/sites/send-journal.ts`): one
 * record, written before the act, then the verdict. A take-over of a send (same key) or a replay
 * after a crash reads the record and never writes a second time.
 *
 * These routes have no verify read, so a record that has no verdict, or an `unknown` one, stays
 * `unknown`: wren reads no words.
 */
import type { Db } from "@wren/db";
import { eq } from "drizzle-orm";
import { sendJournal } from "./send-journal-schema.js";
import type { SendVerdict } from "./send-verdict.js";

export interface JournalEntry {
  key: string;
  site: string;
  method: string;
  path: string;
  account: string | null;
}

/** What the journal holds for a key. `verdict` is null while a try is open. */
export interface JournalRecord {
  verdict: SendVerdict | null;
  startedAt: string;
}

export interface SendJournal {
  /**
   * Write the record before the act. Won: this call made it, and may act. Lost: a record
   * exists (an earlier try, or a race), and it is returned.
   */
  begin(
    entry: JournalEntry,
    now: Date,
  ): Promise<{ won: true } | { won: false; record: JournalRecord }>;
  /** Store the end. */
  settle(key: string, verdict: SendVerdict, now: Date): Promise<void>;
  /** The record, or null when no try ever began. */
  read(key: string): Promise<JournalRecord | null>;
}

const recordOf = (r: { verdict: SendVerdict | null; startedAt: Date }): JournalRecord => ({
  verdict: r.verdict,
  startedAt: r.startedAt.toISOString(),
});

/** The journal on a Postgres database: Wren's, or a client's. */
export function dbSendJournal(db: Db): SendJournal {
  const read = async (key: string): Promise<JournalRecord | null> => {
    const [row] = await db.select().from(sendJournal).where(eq(sendJournal.key, key));
    return row ? recordOf(row) : null;
  };
  return {
    async begin(entry, now) {
      const made = await db
        .insert(sendJournal)
        .values({ ...entry, startedAt: now, updatedAt: now })
        .onConflictDoNothing()
        .returning({ key: sendJournal.key });
      if (made.length) return { won: true };
      // The row may be gone by now only if someone deleted it: read it as an open try then.
      return {
        won: false,
        record: (await read(entry.key)) ?? { verdict: null, startedAt: now.toISOString() },
      };
    },
    async settle(key, verdict, now) {
      await db.update(sendJournal).set({ verdict, updatedAt: now }).where(eq(sendJournal.key, key));
    },
    read,
  };
}

/** The `unknown` an open or unknown record answers: nothing can tell how that try ended. */
export const openTry = (r: JournalRecord): SendVerdict =>
  r.verdict && r.verdict.verdict === "unknown"
    ? r.verdict
    : {
        verdict: "unknown",
        reason: "an earlier try began and nothing can tell its end",
        since: r.startedAt,
      };
