/**
 * Wren's built-in copy as files (designs/2026-10-07-templates-live-copy.md, defaults tree):
 * `packages/templates/defaults/<kind>/<system>/<folder>/<name>.<ext>`. Git keeps their history;
 * `sync` writes each changed file into a database as a `default` version, and a template that
 * follows its default goes live with it. A client's database takes only the defaults its parts
 * need (`install`), then keeps them current through `sync`.
 *
 * Nothing reads the disk at import: the bundles that carry the tree copy it beside them
 * (`out/defaults`), and the portal's pages import modules that import this one.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { parseKind, TEMPLATE_KINDS, type TemplateKind } from "./slots/kinds.js";
import {
  type LiveTemplate,
  promptRef,
  refText,
  resolveTemplate,
  type TemplateRef,
  writeDefault,
} from "./templates.js";

/** Each kind's file extension. Any other file in the tree (a README) is not a template. */
export const DEFAULT_EXT: Readonly<Record<TemplateKind, string>> = {
  email: ".email",
  sms: ".sms",
  dm: ".dm",
  post: ".post",
  prompt: ".prompt",
};

/** One default as its file has it. */
export interface DefaultFile {
  ref: TemplateRef;
  /** The words: the file without a byte order mark or its last newline. */
  source: string;
  /** sha256 of the file's bytes: a new default version only when this moves. */
  hash: string;
}

/**
 * The tree: `WREN_TEMPLATE_DEFAULTS` when set, else `defaults/` beside a bundle (the Lambda's
 * and the CLI's copy it there), else the repo's.
 */
export function defaultsDir(): string {
  const set = process.env.WREN_TEMPLATE_DEFAULTS;
  if (set) return set;
  for (const rel of ["../defaults", "../../templates/defaults"]) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(dir)) return dir;
  }
  throw new Error("no template defaults found: set WREN_TEMPLATE_DEFAULTS");
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((f) => {
      const path = join(dir, f);
      return statSync(path).isDirectory() ? filesUnder(path) : [path];
    });
}

/** Every default in a tree, each parsed, so a broken file fails here before anything is written. */
export function loadDefaults(dir: string = defaultsDir()): DefaultFile[] {
  const out: DefaultFile[] = [];
  for (const kind of TEMPLATE_KINDS) {
    const kindDir = join(dir, kind);
    if (!existsSync(kindDir)) continue;
    for (const system of readdirSync(kindDir).sort()) {
      const systemDir = join(kindDir, system);
      if (!statSync(systemDir).isDirectory()) continue;
      for (const path of filesUnder(systemDir)) {
        if (!path.endsWith(DEFAULT_EXT[kind])) continue;
        const name = relative(systemDir, path)
          .split(sep)
          .join("/")
          .slice(0, -DEFAULT_EXT[kind].length);
        const bytes = readFileSync(path);
        const source = bytes.toString("utf8").replace(/^﻿/, "").replace(/\n$/, "");
        parseKind(kind, name, source);
        out.push({
          ref: { kind, system, name },
          source,
          hash: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  }
  return out;
}

let cached: { dir: string; byRef: Map<string, DefaultFile> } | null = null;

/** One default's words from the tree (read once per process), or null when it has none. */
export function defaultFile(ref: TemplateRef): DefaultFile | null {
  const dir = defaultsDir();
  if (cached?.dir !== dir)
    cached = { dir, byRef: new Map(loadDefaults(dir).map((f) => [refText(f.ref), f])) };
  return cached.byRef.get(refText(ref)) ?? null;
}

/** A default's words, or throws: for code that ships one (a prompt) and can't run without it. */
export function defaultSource(ref: TemplateRef): string {
  const f = defaultFile(ref);
  if (!f) throw new Error(`no default for ${refText(ref)} in ${defaultsDir()}`);
  return f.source;
}

export interface SyncStats {
  /** Defaults this database has (or, for `all`, the tree has). */
  files: number;
  /** New default versions written. */
  written: number;
  /** Of them, the ones that went live (the template follows its default). */
  live: number;
}

/**
 * The tree into one database: every file (`all`, Wren's own) or only the templates already here
 * (a client's: `install` added them). Again changes nothing.
 */
export async function syncDefaults(
  db: Queryable,
  opts: { only: "all" | "present"; files?: readonly DefaultFile[]; by?: string },
): Promise<SyncStats> {
  const files = opts.files ?? loadDefaults();
  let take = files;
  if (opts.only === "present") {
    const rows = (await db.execute(sql`SELECT kind, system, name FROM templates`)) as unknown as {
      kind: string;
      system: string;
      name: string;
    }[];
    const here = new Set(rows.map((r) => `${r.kind}:${r.system}/${r.name}`));
    take = files.filter((f) => here.has(refText(f.ref)));
  }
  const stats: SyncStats = { files: take.length, written: 0, live: 0 };
  for (const f of take) {
    const out = await writeDefault(db, f.ref, f.source, {
      hash: f.hash,
      ...(opts.by ? { by: opts.by } : {}),
    });
    if (out.written) stats.written++;
    if (out.written && out.live) stats.live++;
  }
  return stats;
}

/**
 * Whether a part's template pattern covers a ref: `<kind>:<system>/<name>` names one,
 * one ending in `/` everything under it (`email:recruiting/`).
 */
export const covers = (pattern: string, ref: TemplateRef): boolean =>
  pattern.endsWith("/") ? refText(ref).startsWith(pattern) : refText(ref) === pattern;

/**
 * The defaults a client's parts need (each part's `provides.templates`), into its database,
 * following the default. A template it already has keeps its own copy.
 */
export async function installDefaults(
  db: Queryable,
  patterns: readonly string[],
  opts: { files?: readonly DefaultFile[]; by: string },
): Promise<SyncStats & { templates: string[] }> {
  const files = (opts.files ?? loadDefaults()).filter((f) =>
    patterns.some((p) => covers(p, f.ref)),
  );
  const stats = await syncDefaults(db, { only: "all", files, by: opts.by });
  return { ...stats, templates: files.map((f) => refText(f.ref)) };
}

/**
 * A prompt the code ships, as this database has it live. One that never synced takes the
 * shipped words as its first default version, following it; from then on the store's live
 * words are the prompt, so an edit there wins.
 */
export async function livePrompt(
  db: Queryable,
  ref: { system: string; name: string },
): Promise<LiveTemplate> {
  const r = promptRef(ref.system, ref.name);
  const live = await resolveTemplate(db, r);
  if (live) return live;
  const f = defaultFile(r);
  if (!f) throw new Error(`no default for ${refText(r)} in ${defaultsDir()}`);
  await writeDefault(db, r, f.source, { hash: f.hash });
  const seeded = await resolveTemplate(db, r);
  if (!seeded) throw new Error(`prompt ${refText(r)} did not seed`);
  return seeded;
}

/**
 * A template's live words, or its default's when this database never took it (a part installed
 * before its copy shipped): the default goes in following itself, as an install puts it. Null
 * when it has neither, or its words were emptied.
 */
export async function liveOrDefault(db: Queryable, ref: TemplateRef): Promise<LiveTemplate | null> {
  const live = await resolveTemplate(db, ref);
  if (live) return live;
  const have = (await db.execute(sql`SELECT 1 FROM templates
    WHERE kind = ${ref.kind} AND system = ${ref.system} AND name = ${ref.name}`)) as unknown[];
  if (have.length) return null;
  const f = defaultFile(ref);
  if (!f) return null;
  await writeDefault(db, ref, f.source, { hash: f.hash });
  return resolveTemplate(db, ref);
}
