/**
 * Writing findings (R6) about anyone: the source into `documents` once per url
 * and text, the fact upserted on its `fact_key` (seen again = `observed_at`
 * moves, the value is the latest reading). People and company research both
 * write through here.
 */
import { createHash } from "node:crypto";
import type { SiteClient } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, eq, sql } from "drizzle-orm";
import {
  type DocumentKind,
  documents,
  type FindingKind,
  findings,
  SIGNAL_KINDS,
  type SignalDated,
} from "./schema.js";

export interface DocumentDraft {
  url: string;
  kind: Exclude<DocumentKind, "pdf">;
  title: string | null;
  text: string;
  /** Who fetched it: the search backend, `linkedin`, or the job board. */
  fetchTier: string;
}

interface Draft {
  kind: FindingKind;
  /** Subject, kind, how we know, what: seeing it again is the same fact. */
  factKey: string;
  value: Record<string, unknown>;
  confidence: number;
  via: string;
  sourceUrl: string | null;
  document: DocumentDraft | null;
  /** A signal's date; absent on a signal kind with a link, it is read from the value. */
  signalAt?: Date | null;
  dated?: SignalDated | null;
}

/** A fact about a person. */
export interface FindingDraft extends Draft {
  personId: number;
}

/** A fact about a company. */
export interface CompanyFindingDraft extends Draft {
  companyId: number;
}

/** A dated, linked finding with its raw: what a signal collector hands the runner. */
export type SignalDraft = (FindingDraft | CompanyFindingDraft) & {
  signalAt: Date;
  dated: SignalDated;
};

export { pgSafe };

const isSignalKind = (k: FindingKind) => (SIGNAL_KINDS as readonly string[]).includes(k);
const ISO = /^\d{4}-\d{2}-\d{2}($|T)/;
const isoDate = (v: unknown): Date | null => {
  if (typeof v !== "string" || !ISO.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * A finding's signal date: its own when given, else read from the value. Only a signal kind with a
 * link is dated. `hiring`: the newest posting, else our read. `job_change`: our read. Others:
 * `published_at` or `date`. A profile never is: a channel's `published_at` is its creation date.
 */
export function signalDate(
  d: Pick<Draft, "kind" | "value" | "sourceUrl" | "signalAt" | "dated">,
  now: Date = new Date(),
): { at: Date; dated: SignalDated } | null {
  if (!isSignalKind(d.kind) || !d.sourceUrl) return null;
  if (d.signalAt && d.dated) return { at: d.signalAt, dated: d.dated };
  if (d.kind === "job_change") return { at: now, dated: "seen" };
  if (d.kind === "hiring") {
    const roles = Array.isArray(d.value.roles) ? (d.value.roles as { postedAt?: unknown }[]) : [];
    const newest = roles
      .map((r) => isoDate(r?.postedAt))
      .filter((x): x is Date => x !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return newest ? { at: newest, dated: "published" } : { at: now, dated: "seen" };
  }
  const at = isoDate(d.value.published_at) ?? isoDate(d.value.date);
  return at ? { at, dated: "published" } : null;
}

/** Why a collector's draft can't be kept as a signal; null when it can. */
export function signalRefusal(d: Draft): string | null {
  if (!isSignalKind(d.kind)) return `${d.kind} is not a signal kind`;
  if (!d.signalAt || Number.isNaN(d.signalAt.getTime()) || !d.dated) return "no date";
  if (!d.sourceUrl) return "no link";
  if (!d.document && d.value.raw === undefined) return "no raw";
  return null;
}

/**
 * Keep one signal: a draft with no date, no link or no raw is refused with the reason and never
 * written. Collectors' drafts go through here, never `keepFinding` alone.
 */
export async function keepSignal(
  db: Queryable,
  draft: SignalDraft,
): Promise<{ ok: true; id: number } | { ok: false; reason: string }> {
  const why = signalRefusal(draft);
  return why ? { ok: false, reason: why } : { ok: true, id: await keepFinding(db, draft) };
}

export async function keepDocument(db: Queryable, draft: DocumentDraft): Promise<number> {
  const d = pgSafe(draft);
  const contentHash = createHash("sha256").update(d.text).digest("hex");
  const [made] = await db
    .insert(documents)
    .values({
      url: d.url,
      kind: d.kind,
      title: d.title,
      text: d.text,
      contentHash,
      fetchTier: d.fetchTier,
    })
    .onConflictDoNothing({ target: [documents.url, documents.contentHash] })
    .returning({ id: documents.id });
  if (made) return made.id;
  const [had] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.url, d.url), eq(documents.contentHash, contentHash)));
  if (!had) throw new Error(`document ${d.url} neither inserted nor found`);
  return had.id;
}

/**
 * `sites` that keeps every read's whole answer as a document (kind `snippet`, at
 * `autobrowse:<site><path>?<input>`): nothing a source returns is lost, and what to use is
 * decided when reading. The same answer to the same read is one row.
 */
export function keepingAnswers(sites: SiteClient, db: Queryable): SiteClient {
  return {
    via: (site, method, path) => sites.via(site, method, path),
    async call<T>(...args: Parameters<SiteClient["call"]>): Promise<T> {
      const answer = await sites.call<T>(...args);
      const [site, method, path, input] = args;
      if (method === "GET") {
        const query = Object.entries(input ?? {}).map(([k, v]): [string, string] => [k, String(v)]);
        await keepDocument(db, {
          url: `autobrowse:${site}${path}?${new URLSearchParams(query)}`,
          kind: "snippet",
          title: `${site} ${path}`,
          text: JSON.stringify(answer) ?? "null",
          fetchTier: site.slice(0, 16),
        });
      }
      return answer;
    },
  };
}

/** Upsert one finding and its source; returns the finding's id. */
export async function keepFinding(
  db: Queryable,
  draft: FindingDraft | CompanyFindingDraft,
): Promise<number> {
  // Before pgSafe, which would turn a Date into {}.
  const signal = signalDate(draft);
  const f = pgSafe(draft);
  const documentId = f.document ? await keepDocument(db, f.document) : null;
  const row = {
    kind: f.kind,
    personId: "personId" in f ? f.personId : null,
    companyId: "companyId" in f ? f.companyId : null,
    factKey: f.factKey,
    value: f.value,
    documentId,
    sourceUrl: f.sourceUrl,
    confidence: f.confidence,
    via: f.via,
    signalAt: signal?.at ?? null,
    signalDated: signal?.dated ?? null,
  };
  // A first-seen date stays the first; a printed one follows the latest read. A read with no link
  // keeps the last one, so a dated signal never loses its link.
  const keepSeen = sql`excluded.signal_dated = 'seen' AND findings.signal_at IS NOT NULL`;
  const [kept] = await db
    .insert(findings)
    .values(row)
    .onConflictDoUpdate({
      target: findings.factKey,
      set: {
        value: row.value,
        documentId,
        sourceUrl: sql`coalesce(excluded.source_url, findings.source_url)`,
        confidence: row.confidence,
        observedAt: sql`now()`,
        signalAt: sql`CASE WHEN ${keepSeen} THEN findings.signal_at ELSE coalesce(excluded.signal_at, findings.signal_at) END`,
        signalDated: sql`CASE WHEN ${keepSeen} THEN findings.signal_dated ELSE coalesce(excluded.signal_dated, findings.signal_dated) END`,
      },
    })
    .returning({ id: findings.id });
  if (!kept) throw new Error(`finding ${f.factKey} neither inserted nor updated`);
  return kept.id;
}
