/**
 * The journal: what a person typed and the server doesn't hold yet, on this device. Written
 * synchronously on each change, so a crash, a reload or a closed tab loses nothing; cleared once
 * the server holds it. Each entry names the tab that wrote it, so one tab's save never clears
 * words another tab is still typing.
 */
import type { Store } from "./env.js";

const PREFIX = "wren.unsaved:";
const FORM = "wren.form:";
/** A week: older entries are stale, whatever the record says. */
const JOURNAL_MS = 7 * 24 * 60 * 60 * 1000;

/** This page load's id: a reload is a new tab as far as the journal cares. */
export const TAB = Math.random().toString(36).slice(2, 10);

export interface Entry<T> {
  /** What the server held when the typing started over it. */
  base: T;
  /** The server's version of `base`, where the record has one. */
  version: string | null;
  value: T;
  at: number;
  tab: string;
}

function readRaw(store: Store | null, k: string): unknown {
  try {
    const raw = store?.getItem(k);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeRaw(store: Store | null, k: string, v: unknown | null) {
  try {
    if (v === null) store?.removeItem(k);
    else store?.setItem(k, JSON.stringify(v));
  } catch {
    // Storage full or blocked: the value still saves to the server.
  }
}

/** The entry for `key`, or null; a stale or broken one is dropped. */
export function readEntry<T>(store: Store | null, key: string, now: number): Entry<T> | null {
  const e = readRaw(store, PREFIX + key) as Partial<Entry<T>> | null;
  if (!e || !("value" in e) || !("base" in e)) return null;
  if (now - Number(e.at ?? 0) >= JOURNAL_MS) {
    writeRaw(store, PREFIX + key, null);
    return null;
  }
  return {
    base: e.base as T,
    version: typeof e.version === "string" ? e.version : null,
    value: e.value as T,
    at: Number(e.at),
    tab: typeof e.tab === "string" ? e.tab : "",
  };
}

export function writeEntry<T>(store: Store | null, key: string, e: Entry<T>) {
  writeRaw(store, PREFIX + key, e);
}

/**
 * Clear `key` unless another tab wrote it since and its value isn't the one saved (its words
 * are still unsaved).
 */
export function clearEntry<T>(
  store: Store | null,
  key: string,
  tab: string,
  saved?: (value: T) => boolean,
) {
  const e = readRaw(store, PREFIX + key) as Partial<Entry<T>> | null;
  if (e?.tab && e.tab !== tab && !(saved && "value" in e && saved(e.value as T))) return;
  writeRaw(store, PREFIX + key, null);
}

/** A form's typed values, kept until it is sent. */
interface KeptForm {
  values: Record<string, string>;
  /** What the form started from (an ask's text): the values come back only over the same. */
  base: string;
  at: number;
}

/**
 * The values kept under `key`, over the base they were typed on. A stale or broken entry is
 * dropped; one over another base comes back with that base, for the person to pick.
 */
export function readKept(
  store: Store | null,
  key: string,
  now: number,
): { values: Record<string, string>; base: string } | null {
  const e = readRaw(store, FORM + key) as Partial<KeptForm> | null;
  if (!e?.values || typeof e.values !== "object") return null;
  if (now - Number(e.at ?? 0) >= JOURNAL_MS) {
    writeRaw(store, FORM + key, null);
    return null;
  }
  return { values: e.values, base: typeof e.base === "string" ? e.base : "" };
}

/** The values kept under `key` over `base`, or null (none, or over another base). */
export function readForm(
  store: Store | null,
  key: string,
  base: string,
  now: number,
): Record<string, string> | null {
  const e = readKept(store, key, now);
  return e && e.base === base ? e.values : null;
}

export function writeForm(
  store: Store | null,
  key: string,
  values: Record<string, string> | null,
  base: string,
  now: number,
) {
  const empty = !values || Object.values(values).every((v) => v === "");
  writeRaw(store, FORM + key, empty ? null : ({ values, base, at: now } satisfies KeptForm));
}
