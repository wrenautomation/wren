/**
 * The accounts records are on (designs/2026-10-15-accounts-first-class.md): the login a row was
 * sent from or reached ("reddit@alt", "linkedin@wren", "social:<id>"), by key, with the words a
 * person reads ("u/<handle>") and its platform. A record declares its account field once
 * (`RecordDecl.account`) and gets the Account filter, column and grouping from this one set.
 *
 * The set is loaded from the database by whoever registers a source (the worker: reach accounts
 * and connected logins), at most once a minute, before records are served.
 */
import type { Queryable } from "@wren/db";

/** One account a record can be on. */
export interface RecordAccount {
  /** The login's key: an autobrowse credential ("reddit@alt") or a connection ("social:<id>"). */
  key: string;
  /** Its platform ("reddit"): the list draws that mark beside it. */
  platform: string;
  /** What a person reads: "u/<handle>", else the key. */
  label: string;
}

type Source = (db: Queryable) => Promise<RecordAccount[]>;

/** How long a load holds before the next read asks the database again. */
export const ACCOUNTS_TTL_MS = 60_000;

let known = new Map<string, RecordAccount>();
let source: Source | null = null;
let loadedAt = Number.NEGATIVE_INFINITY;

/** Where the set comes from; the worker registers one at build. Resets the cache. */
export function accountSource(load: Source | null): void {
  source = load;
  loadedAt = Number.NEGATIVE_INFINITY;
}

/** Replace the set (a source's load, or a test's). */
export function setRecordAccounts(rows: readonly RecordAccount[]): void {
  known = new Map(rows.map((r) => [r.key, r]));
}

/** Read the set again when it is older than the TTL. A failed load keeps the last one. */
export async function refreshRecordAccounts(db: Queryable, now = Date.now()): Promise<void> {
  if (!source || now - loadedAt < ACCOUNTS_TTL_MS) return;
  loadedAt = now;
  try {
    setRecordAccounts(await source(db));
  } catch {
    loadedAt = Number.NEGATIVE_INFINITY;
  }
}

/** Every known account's label, by key: an account field's choices. */
export function accountChoices(): Record<string, string> {
  return Object.fromEntries([...known.values()].map((a) => [a.key, a.label]));
}

/** One account, when known. */
export const recordAccount = (key: string): RecordAccount | undefined => known.get(key);

/** The known accounts on a platform, in key order. */
export function accountsOn(platform: string): RecordAccount[] {
  return [...known.values()]
    .filter((a) => a.platform === platform)
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** The label a person reads for a reach account: "u/<handle>" on Reddit, else the handle or key. */
export function accountLabel(platform: string, key: string, handle: string | null): string {
  if (!handle) return key;
  return platform === "reddit" ? `u/${handle}` : handle;
}

/** One account a person may send a draft from. */
export interface AccountOption {
  key: string;
  label: string;
  /** Its reach state ("warming", "active", "paused"); null for a login with no reach row. */
  state: string | null;
  /** Why it may not land, said not enforced: "r/x needs 50 karma, u/y has 3". */
  warn: string | null;
}

/**
 * A draft's account picker (designs/2026-10-15-accounts-first-class.md): the one it goes out as
 * now and the others on its platform. `current` null: the platform's default login. Shown only
 * where a platform has two or more.
 */
export interface AccountPick {
  /** The draft's platform: the picker draws its mark. */
  platform: string;
  current: string | null;
  /** The one it would go out as with no pick (the place's, the one they spoke to); null = default. */
  fallback: string | null;
  /** A person picked `current` (it is saved with the draft). */
  picked: boolean;
  options: AccountOption[];
}

/**
 * The account a draft goes out as: a person's pick, else the one they spoke to (a reply in a
 * conversation), else the item's own (the place's, the read's), else the default login (null).
 */
export function defaultAccount(o: {
  picked?: string | null;
  spokeTo?: string | null;
  assigned?: string | null;
}): string | null {
  return o.picked || o.spokeTo || o.assigned || null;
}
