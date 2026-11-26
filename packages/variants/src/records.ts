/**
 * Vireo's batches as a console record (designs/2026-11-26-batches-actions.md): the Batches list
 * on the shared records list. Rows come from Vireo's `batches`, read as the viewer, so an open
 * batch stays blind on every path (list, counts, search, export, Claude's reads).
 */
import {
  date,
  defineRecord,
  number,
  percent,
  prose,
  type RecordType,
  status,
  text,
} from "@wren/core/records";
import type { Db, Queryable } from "@wren/db";
import type { BatchPage } from "@wrenautomation/vireo";
import { sql } from "drizzle-orm";
import { variants } from "./index.js";
import { playableUrl, type Sign } from "./media-url.js";

/** waits = open and its subject's newest; any other open one was replaced by a newer batch */
const BATCH_STATES = {
  waiting: { label: "Waiting", tone: "warn" },
  replaced: { label: "Replaced", tone: "neutral" },
  closed: { label: "Closed", tone: "neutral" },
} as const;
const KIND_STATES = {
  text: { label: "Text", tone: "neutral" },
  image: { label: "Image", tone: "neutral" },
  video: { label: "Video", tone: "neutral" },
  page: { label: "Page", tone: "neutral" },
} as const;
const YES_NO = {
  yes: { label: "Yes", tone: "neutral" },
  no: { label: "No", tone: "neutral" },
} as const;
/** Vireo's page cap */
const PAGE = 100;

type BatchRow = BatchPage["rows"][number];

/** Every batch as this viewer may see it; "" (no one) is blind, never the agent's view. */
async function allBatches(db: Db, viewer: string, who?: string): Promise<BatchRow[]> {
  const v = variants(db);
  const seen = new Map<number, BatchRow>();
  for (let after: number | null = 0; after != null; ) {
    const page: BatchPage = await v.batches(
      { sort: "newest", limit: PAGE, after, ...(who ? { who } : {}) },
      viewer,
    );
    // offset paging: a batch made mid-read can shift a row; the id keeps it once
    for (const r of page.rows) seen.set(r.id, r);
    after = page.next;
  }
  return [...seen.values()];
}

/** A subject's folder name, by subject id (`folders.filed`). */
async function foldersOf(db: Queryable): Promise<Map<string, string>> {
  const got = await db.execute<{ ref: string; name: string }>(sql`
    select fi.ref, f.name from folders.filed fi join folders.folders f on f.id = fi.folder_id
    where fi.kind = 'subject'`);
  return new Map(got.map((r) => [String(r.ref), r.name]));
}

/** One list row: blind fields come from Vireo already nulled. */
export function rowOf(r: BatchRow, yours: ReadonlySet<number>, folders: Map<string, string>) {
  return {
    id: r.id,
    name: r.title ?? `Batch ${r.n}`,
    n: r.n,
    subject: r.subject.name,
    kind: r.subject.kind,
    state: r.waits ? "waiting" : r.state === "open" ? "replaced" : "closed",
    marked: `${r.marked} of ${r.samples}`,
    goodRate: r.goodRate,
    kept: r.kept,
    judges: r.judges,
    folder: folders.get(String(r.subject.id)) ?? null,
    yours: yours.has(r.id) ? "yes" : "no",
    created: r.createdAt,
    why: r.why,
    note: r.note,
  };
}

/**
 * `at`: the main db Vireo lives in and the media signer. Absent (stories' types, the preview):
 * the type is listed with no rows.
 */
export function batchRecord(at?: { db: Db; sign: Sign | null }): RecordType {
  const url = playableUrl(at?.sign ?? null);
  return defineRecord({
    id: "variants.batch",
    app: "variants",
    channel: null,
    name: { one: "batch", many: "batches" },
    rows: async (db, me) => {
      if (!at) return [];
      const viewer = me?.email ?? "";
      const [all, mine, folders] = await Promise.all([
        allBatches(at.db, viewer),
        viewer ? allBatches(at.db, viewer, viewer) : Promise.resolve([]),
        foldersOf(db),
      ]);
      const yours = new Set(mine.map((r) => r.id));
      return all.map((r) => rowOf(r, yours, folders));
    },
    key: "id",
    title: "name",
    subtitle: "why",
    fields: {
      name: text("Title"),
      subject: text("Subject"),
      n: number("Batch"),
      kind: status(KIND_STATES, "Kind"),
      state: status(BATCH_STATES, "State"),
      marked: text("Marked"),
      goodRate: percent("Good or better"),
      kept: number("Kept"),
      judges: number("People"),
      folder: text("Folder"),
      yours: status(YES_NO, "Marked by me"),
      created: date("Made"),
      why: prose("Agent"),
      note: prose("Note"),
    },
    by: "state",
    quick: ["subject", "kind", "folder", "yours"],
    views: [
      { id: "waiting", label: "Waiting", where: { state: "waiting" }, sort: "-created" },
      { id: "replaced", label: "Replaced", where: { state: "replaced" }, sort: "-created" },
      { id: "closed", label: "Closed", where: { state: "closed" }, sort: "-created" },
      { id: "all", label: "All", sort: "-created" },
    ],
    actions: ["variants.close", "variants.rename"],
    // a card's poster: the batch's first sample that has one; never its verdict
    thumbs: async (db, ids) => {
      const want = ids.map(Number).filter(Number.isSafeInteger);
      if (!want.length) return {};
      const got = await db.execute<{ batch: number; poster: string }>(sql`
        select distinct on (batch_id) batch_id batch, poster from vireo.samples
        where batch_id in (${sql.join(
          want.map((n) => sql`${n}`),
          sql`, `,
        )}) and poster is not null
        order by batch_id, id`);
      const out: Record<string, { url: string; kind: "image" }> = {};
      for (const r of got) {
        const link = await url(r.poster);
        if (link) out[String(r.batch)] = { url: link, kind: "image" };
      }
      return out;
    },
  });
}
