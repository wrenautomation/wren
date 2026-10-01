/**
 * Deterministic email discovery over stored documents. Free, versioned, auditable:
 * one email_scan enrichment per document under the same (subject, kind, model,
 * prompt_version) cache key as paid LLM work, with model "deterministic". Bump
 * SCAN_VERSION to re-scan history after improving the patterns.
 *
 * Signal sources in precision order: a mailto: link, a regex hit in prose, a
 * markup-only hit (JSON-LD, attributes), then conservative de-obfuscation (both a
 * bracketed at-marker AND a dot-marker required, never guessed).
 */
import { companies, emailDomain, emailSyntaxError, inPlay, normalizeEmail } from "@wren/core";
import type { Queryable } from "@wren/db";
import { and, asc, eq, ne, notInArray } from "drizzle-orm";
import { readPage } from "../fetch/htmltext.js";
import { type Document, documents, enrichments } from "../schema.js";

export const SCAN_VERSION = "v3";
export const SCAN_MODEL = "deterministic";
const CONTEXT_CHARS = 120;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const OBFUSCATED_RE =
  /([A-Za-z0-9._%+-]+)\s*(?:\[\s*at\s*\]|\(\s*at\s*\))\s*([A-Za-z0-9-]+)\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\bdot\b)\s*([A-Za-z]{2,10})\b/gi;

const ASSET_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".ico",
  ".css",
  ".js",
  ".mjs",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".webm",
  ".pdf",
] as const;
/** Placeholder/template/infrastructure domains that never receive real mail; suffix-matched. */
const NOISE_DOMAIN_SUFFIXES = [
  "example.com",
  "example.org",
  "example.net",
  "email.com",
  "domain.com",
  "yourdomain.com",
  "yourcompany.com",
  "yoursite.com",
  "yourwebsite.com",
  "mysite.com",
  "mydomain.com",
  "company.com",
  "website.com",
  "test.com",
  "sentry.io",
  "wixpress.com",
  "sentry-next.wixpress.com",
  "schema.org",
  "w3.org",
  "placeholder.com",
] as const;
const NOISE_LOCALPARTS: ReadonlySet<string> = new Set([
  "you",
  "your",
  "yourname",
  "name",
  "user",
  "username",
  "test",
  "example",
  "someone",
  "somebody",
  "email",
  "youremail",
  "firstname",
  "first.last",
  "john.doe",
  "jane.doe",
  "johndoe",
  "janedoe",
  "abc",
]);
const HEX_LOCAL_RE = /^[0-9a-f]{16,}$/; // tracking/beacon ids

export type SignalSource = "mailto" | "text" | "markup" | "deobfuscated";

/** One surviving address with enough context for the pick stage to judge it. Stored as-is (snake_case). */
export interface EmailSignal {
  email: string;
  source: SignalSource;
  /** ±CONTEXT_CHARS of surrounding page text ("" if markup-only). */
  context: string;
  page_url: string;
  /** email domain == company domain (or subdomain, www-blind). */
  on_domain: boolean;
}

/** 'Jane Doe <jane@x.com>' -> 'jane@x.com'; plain addresses pass through. */
export function bareAddress(raw: string): string {
  const lt = raw.lastIndexOf("<");
  const gt = raw.lastIndexOf(">");
  return lt >= 0 && gt > lt ? raw.slice(lt + 1, gt).trim() : raw;
}

function rejected(email: string): boolean {
  if (emailSyntaxError(email) !== null) return true;
  const lowered = email.toLowerCase();
  if (ASSET_EXTENSIONS.some((ext) => lowered.endsWith(ext))) return true;
  const at = lowered.indexOf("@");
  const local = lowered.slice(0, at);
  const domain = lowered.slice(at + 1);
  if (NOISE_DOMAIN_SUFFIXES.some((s) => domain === s || domain.endsWith(`.${s}`))) return true;
  if (NOISE_LOCALPARTS.has(local) || HEX_LOCAL_RE.test(local)) return true;
  // '%' is RFC-legal but in scanned markup it is always percent-encoding debris.
  return local.includes("%");
}

function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

function isOnDomain(email: string, companyDomain: string | null | undefined): boolean {
  if (!companyDomain) return false;
  const mailHost = stripWww(emailDomain(email) ?? "");
  const site = stripWww(companyDomain.toLowerCase());
  return mailHost === site || mailHost.endsWith(`.${site}`);
}

function contextFor(email: string, text: string): string {
  const at = text.toLowerCase().indexOf(email.toLowerCase());
  if (at === -1) return "";
  const lo = Math.max(0, at - CONTEXT_CHARS);
  const hi = Math.min(text.length, at + email.length + CONTEXT_CHARS);
  return text.slice(lo, hi).split(/\s+/).filter(Boolean).join(" ");
}

/**
 * Every surviving (email, best source) on one page, mailto-first. Pure function.
 * Dedupe keeps the highest-precision source per address.
 */
export function scanPage(
  html: string | null,
  text: string,
  opts: { pageUrl: string; companyDomain: string | null | undefined },
): EmailSignal[] {
  const candidates: Array<[string, SignalSource]> = [];
  if (html) {
    const page = readPage(html, opts.pageUrl);
    for (const addr of page.mailtos) candidates.push([bareAddress(addr), "mailto"]);
  }
  for (const m of text.matchAll(EMAIL_RE)) candidates.push([m[0], "text"]);
  if (html) for (const m of html.matchAll(EMAIL_RE)) candidates.push([m[0], "markup"]);
  for (const m of text.matchAll(OBFUSCATED_RE)) {
    candidates.push([`${m[1]}@${m[2]}.${m[3]}`, "deobfuscated"]);
  }

  const signals = new Map<string, EmailSignal>();
  for (const [raw, source] of candidates) {
    const email = normalizeEmail(raw);
    if (signals.has(email) || rejected(email)) continue;
    signals.set(email, {
      email,
      source,
      context: contextFor(email, text),
      page_url: opts.pageUrl,
      on_domain: isOnDomain(email, opts.companyDomain),
    });
  }
  return [...signals.values()];
}

export interface ScanStats {
  selected: number;
  scanned: number;
  signals: number;
  pages_with_signals: number;
}

export interface ScanSelectOptions {
  limit?: number | undefined;
  niche?: string | null | undefined;
}

export type ScanTarget = Document & { companyDomain: string | null };

const scannedDocumentIds = (db: Queryable) =>
  db
    .select({ id: enrichments.documentId })
    .from(enrichments)
    .where(
      and(
        eq(enrichments.kind, "email_scan"),
        eq(enrichments.model, SCAN_MODEL),
        eq(enrichments.promptVersion, SCAN_VERSION),
      ),
    );

/** Documents without an email_scan row: shells carry no words worth scanning; tombstones nothing at all. */
export async function selectScanTargets(
  db: Queryable,
  opts: ScanSelectOptions = {},
): Promise<ScanTarget[]> {
  const conditions = [
    notInArray(documents.id, scannedDocumentIds(db)),
    ne(documents.text, ""),
    eq(documents.isShell, false),
    inPlay,
  ];
  if (opts.niche != null) conditions.push(eq(companies.niche, opts.niche));
  const q = db
    .select({ document: documents, companyDomain: companies.domain })
    .from(documents)
    .leftJoin(companies, eq(documents.companyId, companies.id))
    .where(and(...conditions))
    .orderBy(asc(documents.id));
  const rows = opts.limit === undefined ? await q : await q.limit(opts.limit);
  return rows.map((r) => ({ ...r.document, companyDomain: r.companyDomain ?? null }));
}

/** One scan target by document id (the Restate unit re-reads instead of journaling html). */
export async function loadScanTarget(db: Queryable, id: number): Promise<ScanTarget | null> {
  const [row] = await db
    .select({ document: documents, companyDomain: companies.domain })
    .from(documents)
    .leftJoin(companies, eq(documents.companyId, companies.id))
    .where(eq(documents.id, id));
  return row ? { ...row.document, companyDomain: row.companyDomain ?? null } : null;
}

/** One email_scan enrichment for one document. */
export async function scanDocument(
  db: Queryable,
  doc: ScanTarget,
  runId: string | null = null,
): Promise<EmailSignal[]> {
  const signals = scanPage(doc.html, doc.text, {
    pageUrl: doc.url,
    companyDomain: doc.companyDomain,
  });
  await db.insert(enrichments).values({
    documentId: doc.id,
    kind: "email_scan",
    model: SCAN_MODEL,
    promptVersion: SCAN_VERSION,
    output: { signals },
    runId,
  });
  return signals;
}

export interface ScanRunOptions extends ScanSelectOptions {
  runId?: string | null;
  checkpoint?: (doc: ScanTarget) => void | Promise<void>;
}

/** One email_scan enrichment per unscanned document (free, cached); one transaction per document. */
export async function runScan(db: Queryable, opts: ScanRunOptions = {}): Promise<ScanStats> {
  const targets = await selectScanTargets(db, opts);
  const stats: ScanStats = {
    selected: targets.length,
    scanned: 0,
    signals: 0,
    pages_with_signals: 0,
  };
  for (const doc of targets) {
    const signals = await db.transaction((tx) => scanDocument(tx, doc, opts.runId ?? null));
    stats.scanned += 1;
    stats.signals += signals.length;
    if (signals.length) stats.pages_with_signals += 1;
    if (opts.checkpoint) await opts.checkpoint(doc);
  }
  return stats;
}
