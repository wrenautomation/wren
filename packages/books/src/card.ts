/**
 * The card's own record of what it paid: statement files (OFX/QFX or CSV) and
 * the bank's alert mail, one line per charge. Each line is sorted to a vendor
 * or personal, then matched to the bill it paid. A match gives a foreign bill
 * the CAD the card really took; a vendor that never mails a bill (Inbox
 * Insiders) gets one made from the line, so the books see every charge.
 */
import { type Db, serializable, type Tx } from "@wren/db";
import { completeAndParse, type LlmClient, type Tracer } from "@wren/llm";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type MailSpec, VENDORS, type VendorSpec, vendorSpec } from "./chart.js";
import { shiftDay } from "./day.js";
import {
  billDocuments,
  bills,
  cardLines,
  cardRules,
  documents,
  subscriptionEnds,
  vendors,
} from "./schema.js";
import { type DocumentStore, sha256, storeKey } from "./store.js";

/** The bank's alert mail: one per purchase once William turns purchase alerts on. */
export const CARD_ALERTS: MailSpec = { from: ["bmoalerts@bmo.com"] };
/** As a vendor-less spec, so `capture` keeps it beside the bills. */
export const CARD_ALERT_SPEC: VendorSpec = {
  key: "card-alerts",
  name: "Card alerts",
  account: "other",
  mail: CARD_ALERTS,
};

/** Days a charge waits for its mailed bill before one is made from the line. */
export const CARD_GRACE_DAYS = 5;
/** How far a bill's date may sit from its charge. */
const MATCH_DAYS = 5;
/** How far a foreign bill's CAD may sit from the charge: the card's own rate and fee. */
const MATCH_SLACK = 0.06;

export interface StatementLine {
  card: string;
  on: string;
  description: string;
  /** A charge is positive. */
  amountCents: number;
  currency: string;
  /** The bank's own id for the line (OFX FITID), when the file has one. */
  bankId: string | null;
}

/** Upper case, words only: "DYNADOT.COM 650-262-0100 CA" → "DYNADOT COM CA". */
export function descriptorOf(description: string): string {
  return description
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !/\d/.test(w))
    .join(" ")
    .slice(0, 80)
    .trim();
}

/** The vendor whose card words the descriptor carries, whole. */
export function cardVendor(descriptor: string, specs: readonly VendorSpec[] = VENDORS) {
  const padded = ` ${descriptor} `;
  return specs.find((v) => v.card?.some((w) => padded.includes(` ${descriptorOf(w)} `))) ?? null;
}

const cents = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  if (!Number.isFinite(n)) throw new Error(`not an amount: ${s}`);
  return Math.round(n * 100);
};

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
/** YYYYMMDD, YYYY-MM-DD, M/D/YYYY or "Oct 5, 2026" as YYYY-MM-DD. */
export function statementDay(s: string): string {
  const t = s.trim().replace(/^'/, "");
  let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[1]?.padStart(2, "0")}-${m[2]?.padStart(2, "0")}`;
  m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/.exec(t);
  const month = m ? MONTHS.indexOf(m[1]?.toLowerCase() ?? "") : -1;
  if (m && month >= 0)
    return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2]?.padStart(2, "0")}`;
  throw new Error(`not a day: ${s}`);
}

const lastFour = (s: string) => /(\d{4})\D*$/.exec(s)?.[1] ?? null;

/** An OFX or QFX statement (SGML or XML). Card statements sign purchases negative. */
export function parseOfx(text: string): StatementLine[] {
  const tag = (block: string, name: string) =>
    new RegExp(`<${name}>([^<\\r\\n]*)`, "i").exec(block)?.[1]?.trim() ?? null;
  const card = lastFour(tag(text, "ACCTID") ?? "") ?? "";
  const currency = (tag(text, "CURDEF") ?? "CAD").toUpperCase();
  const out: StatementLine[] = [];
  for (const m of text.matchAll(
    /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi,
  )) {
    const b = m[1] ?? "";
    const amount = tag(b, "TRNAMT");
    const day = tag(b, "DTUSER") ?? tag(b, "DTPOSTED");
    if (!amount || !day) continue;
    const description = [tag(b, "NAME"), tag(b, "MEMO")].filter(Boolean).join(" ").trim();
    out.push({
      card,
      on: statementDay(day.slice(0, 8)),
      description,
      amountCents: -cents(amount),
      currency,
      bankId: tag(b, "FITID"),
    });
  }
  return out;
}

/** RFC 4180 rows: quoted fields may hold commas, quotes ("") and line breaks. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows.filter((r) => r.some((f) => f.trim()));
}

/**
 * A CSV export: the header row is found by its names (BMO puts a note above
 * it), one amount column or debit and credit. A card's lines are mostly
 * charges, so whichever sign most lines carry is a charge.
 */
export function parseCsv(text: string, card?: string): StatementLine[] {
  const rows = csvRows(text);
  const find = (header: string[], re: RegExp) => header.findIndex((h) => re.test(h.trim()));
  const at = rows.findIndex(
    (r) => find(r, /amount|debit/i) >= 0 && find(r, /desc|merchant|payee|name/i) >= 0,
  );
  if (at < 0) throw new Error("no header row with an amount and a description");
  const header = rows[at] as string[];
  const col = {
    day: find(header, /^(transaction )?date$|trans.*date/i),
    posted: find(header, /post/i),
    description: find(header, /desc|merchant|payee|name/i),
    amount: find(header, /amount/i),
    debit: find(header, /debit|withdraw/i),
    credit: find(header, /credit|deposit/i),
    card: find(header, /card/i),
    currency: find(header, /currency/i),
  };
  const day = col.day >= 0 ? col.day : col.posted;
  if (day < 0) throw new Error("no date column");
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const lines = rows.slice(at + 1).flatMap((r): StatementLine[] => {
    const raw =
      col.amount >= 0
        ? cell(r, col.amount)
        : String((cents(cell(r, col.debit) || "0") - cents(cell(r, col.credit) || "0")) / 100);
    if (!raw || !cell(r, day)) return [];
    return [
      {
        card: lastFour(cell(r, col.card)) ?? card ?? "",
        on: statementDay(cell(r, day)),
        description: cell(r, col.description),
        amountCents: cents(raw),
        currency: (cell(r, col.currency) || "CAD").toUpperCase(),
        bankId: null,
      },
    ];
  });
  const negative = lines.filter((l) => l.amountCents < 0).length;
  return negative > lines.length / 2
    ? lines.map((l) => ({ ...l, amountCents: -l.amountCents }))
    : lines;
}

export function parseStatement(text: string, card?: string): StatementLine[] {
  const lines = /<OFX>|OFXHEADER|<\?OFX/i.test(text) ? parseOfx(text) : parseCsv(text, card);
  const out = card ? lines.map((l) => ({ ...l, card: l.card || card })) : lines;
  if (out.some((l) => !/^\d{4}$/.test(l.card)))
    throw new Error("the file names no card: pass its last four");
  return out;
}

/** A line's fingerprint: the bank's id, else the line itself and how many like it came before. */
export function fingerprints(lines: readonly StatementLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    if (l.bankId) return `ofx:${l.card}:${l.bankId}`;
    const key = `${l.card}:${l.on}:${l.amountCents}:${descriptorOf(l.description)}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return `csv:${sha256(new TextEncoder().encode(key)).slice(0, 24)}:${n}`;
  });
}

export interface CardImport {
  lines: number;
  added: number;
  known: number;
  /** Alert lines this statement confirmed. */
  confirmed: number;
}

/** Keep a statement file and add its lines; a line imported before is skipped. */
export async function importStatement(
  db: Db,
  store: DocumentStore,
  file: { bytes: Uint8Array; filename: string; card?: string },
  runId: string | null = null,
): Promise<CardImport> {
  const text = new TextDecoder().decode(file.bytes);
  const parsed = parseStatement(text, file.card);
  const prints = fingerprints(parsed);
  const mediaType = /\.(ofx|qfx)$/i.test(file.filename) ? "application/x-ofx" : "text/csv";
  const hash = sha256(file.bytes);
  const key = storeKey(hash, mediaType);
  await store.put(key, file.bytes, mediaType);
  const out: CardImport = { lines: parsed.length, added: 0, known: 0, confirmed: 0 };
  await serializable(db, async (tx) => {
    out.added = out.known = out.confirmed = 0;
    await tx
      .insert(documents)
      .values({
        sha256: hash,
        mediaType,
        size: file.bytes.byteLength,
        storeKey: key,
        source: "file",
        filename: file.filename,
        kind: "other",
        readAt: new Date(),
        runId,
      })
      .onConflictDoNothing({ target: documents.sha256 });
    const [doc] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.sha256, hash));
    if (!doc) throw new Error("statement not kept");
    for (const [i, l] of parsed.entries()) {
      const fingerprint = prints[i] as string;
      const fields = {
        card: l.card,
        on: l.on,
        description: l.description,
        descriptor: descriptorOf(l.description),
        amountCents: l.amountCents,
        currency: l.currency,
        source: "statement" as const,
        fingerprint,
        documentId: doc.id,
      };
      const [known] = await tx
        .select({ id: cardLines.id })
        .from(cardLines)
        .where(eq(cardLines.fingerprint, fingerprint));
      if (known) {
        out.known++;
        continue;
      }
      // The alert for the same charge becomes this line, keeping its sort and bill.
      const [alert] = await tx
        .select({ id: cardLines.id })
        .from(cardLines)
        .where(
          and(
            eq(cardLines.source, "alert"),
            eq(cardLines.card, l.card),
            eq(cardLines.amountCents, l.amountCents),
            sql`${cardLines.on} between ${shiftDay(l.on, -4)} and ${shiftDay(l.on, 4)}`,
          ),
        )
        .orderBy(sql`abs(${cardLines.on} - ${l.on}::date)`, asc(cardLines.id))
        .limit(1);
      if (alert) {
        await tx.update(cardLines).set(fields).where(eq(cardLines.id, alert.id));
        out.confirmed++;
      } else {
        await tx.insert(cardLines).values(fields);
        out.added++;
      }
    }
  });
  return out;
}

/** A purchase alert as the model reads it; null fields when the mail doesn't say. */
const AlertReading = z.object({
  purchase: z.boolean(),
  merchant: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  on: z.string().nullable(),
  card: z.string().nullable(),
});

export function alertPrompt(doc: { subject: string | null; text: string | null }): string {
  return [
    "A bank sent this email. If it reports one card purchase or charge, say so and give its",
    "merchant as printed, amount (a number), currency (ISO code), day (YYYY-MM-DD) and the card's",
    'last four digits. Anything else (a statement notice, a payment, an offer) is "purchase": false.',
    'Answer only JSON: {"purchase":bool,"merchant":str|null,"amount":num|null,"currency":str|null,"on":str|null,"card":str|null}',
    "",
    `Subject: ${doc.subject ?? ""}`,
    "",
    (doc.text ?? "").slice(0, 8000),
  ].join("\n");
}

/** The model's amount must be printed in the mail, or the line isn't kept. */
export function amountPrinted(amount: number, text: string): boolean {
  const plain = amount.toFixed(2);
  const grouped = Number(plain).toLocaleString("en-US", { minimumFractionDigits: 2 });
  const flat = text.replace(/\s/g, "");
  return flat.includes(plain) || flat.includes(grouped) || flat.includes(plain.replace(".", ","));
}

export interface AlertsRead {
  read: number;
  added: number;
}

/** Read the alert mail not read yet into lines. */
export async function readCardAlerts(
  db: Db,
  llm: LlmClient,
  opts: { runId?: string | null; tracer?: Tracer | null; card?: string } = {},
): Promise<AlertsRead> {
  const todo = await db
    .select()
    .from(documents)
    .where(
      and(
        isNull(documents.readAt),
        isNull(documents.parentId),
        inArray(documents.fromAddress, [...CARD_ALERTS.from]),
      ),
    )
    .orderBy(asc(documents.sentAt));
  const out: AlertsRead = { read: 0, added: 0 };
  for (const doc of todo) {
    const outcome = /statement/i.test(doc.subject ?? "")
      ? null
      : await completeAndParse(llm, alertPrompt(doc), AlertReading, {
          maxTokens: 400,
          runId: opts.runId ?? null,
          tracer: opts.tracer ?? null,
          name: "books.card_alert",
          metadata: { document: doc.id },
        });
    const r = outcome?.parsed;
    const card = r?.card ? lastFour(r.card) : (opts.card ?? null);
    const text = `${doc.subject ?? ""}\n${doc.text ?? ""}`;
    const kept =
      r?.purchase && r.amount && r.merchant && card && amountPrinted(r.amount, text)
        ? {
            card,
            on:
              r.on && /^\d{4}-\d{2}-\d{2}$/.test(r.on)
                ? r.on
                : (doc.sentAt?.toISOString().slice(0, 10) ?? ""),
            description: r.merchant,
            descriptor: descriptorOf(r.merchant),
            amountCents: Math.round(r.amount * 100),
            currency: (r.currency ?? "CAD").toUpperCase().slice(0, 3),
            source: "alert" as const,
            fingerprint: `alert:${doc.id}`,
            documentId: doc.id,
          }
        : null;
    await serializable(db, async (tx) => {
      if (kept?.on) await tx.insert(cardLines).values(kept).onConflictDoNothing();
      await tx
        .update(documents)
        .set({ readAt: new Date(), kind: "other", reading: outcome?.envelope() ?? null })
        .where(eq(documents.id, doc.id));
    });
    out.read++;
    if (kept?.on) out.added++;
  }
  return out;
}

/** Sort lines no one sorted: William's rules first, then the vendors' card words. */
export async function sortCard(db: Db): Promise<number> {
  const ruled = await db.execute(sql`
    UPDATE ${cardLines} l SET vendor_id = r.vendor_id, personal = r.personal
    FROM ${cardRules} r
    WHERE r.descriptor = l.descriptor AND l.vendor_id IS NULL AND NOT l.personal
      AND (r.vendor_id IS NOT NULL OR r.personal)`);
  const ids = new Map(
    (await db.select({ id: vendors.id, key: vendors.key }).from(vendors)).map((v) => [v.key, v.id]),
  );
  const open = await db
    .select({ id: cardLines.id, descriptor: cardLines.descriptor })
    .from(cardLines)
    .where(and(isNull(cardLines.vendorId), eq(cardLines.personal, false)));
  let n = ruled.count ?? 0;
  for (const l of open) {
    const spec = cardVendor(l.descriptor);
    const id = spec && ids.get(spec.key);
    if (!id) continue;
    await db.update(cardLines).set({ vendorId: id }).where(eq(cardLines.id, l.id));
    n++;
  }
  return n;
}

/** William's call: every line with this descriptor is the vendor's, or personal; now and later. */
export async function ruleCard(
  db: Db,
  descriptor: string,
  to: { vendor: string } | "personal",
): Promise<number> {
  let vendorId: number | null = null;
  if (to !== "personal") {
    const [v] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.key, to.vendor));
    if (!v) throw new Error(`no vendor ${to.vendor}`);
    vendorId = v.id;
  }
  const personal = to === "personal";
  return serializable(db, async (tx) => {
    await tx
      .insert(cardRules)
      .values({ descriptor, vendorId, personal })
      .onConflictDoUpdate({ target: cardRules.descriptor, set: { vendorId, personal } });
    // A line moved off a vendor drops the bill it made; a mailed bill it matched stays.
    const moved = await tx
      .select({ id: cardLines.id, billId: cardLines.billId })
      .from(cardLines)
      .where(eq(cardLines.descriptor, descriptor));
    await voidCardBills(
      tx,
      moved.flatMap((l) => (l.billId ? [l.billId] : [])),
    );
    const rows = await tx
      .update(cardLines)
      .set({ vendorId, personal, billId: null })
      .where(eq(cardLines.descriptor, descriptor))
      .returning({ id: cardLines.id });
    return rows.length;
  });
}

async function voidCardBills(tx: Tx, billIds: readonly number[]) {
  if (!billIds.length) return;
  await tx
    .update(bills)
    .set({ review: "void", updatedAt: new Date() })
    .where(and(inArray(bills.id, [...billIds]), sql`${bills.number} LIKE 'card:%'`));
}

export interface CardMatch {
  matched: number;
  /** Foreign bills that now carry the CAD the card took. */
  charged: number;
  /** Bills made from lines no mail ever billed. */
  made: number;
}

/**
 * Match each business charge to its bill: same vendor, within days, and the
 * amount (a foreign bill's CAD within the card's slack). A charge with no bill
 * after the grace gets one made from it; a mailed bill that turns up later
 * takes the line back and voids the made one.
 */
export async function matchCard(
  db: Db,
  on: string,
  runId: string | null = null,
): Promise<CardMatch> {
  const out: CardMatch = { matched: 0, charged: 0, made: 0 };
  const open = await db.execute<{
    id: number;
    on: string;
    amount_cents: string;
    vendor_id: number;
    bill_id: number | null;
  }>(sql`
    SELECT l.id, l."on"::text "on", l.amount_cents, l.vendor_id, l.bill_id
    FROM ${cardLines} l LEFT JOIN ${bills} b ON b.id = l.bill_id
    WHERE l.vendor_id IS NOT NULL AND NOT l.personal AND l.amount_cents > 0
      AND (l.bill_id IS NULL OR b.number LIKE 'card:%')
    ORDER BY l."on", l.id`);
  for (const l of open) {
    const amount = Number(l.amount_cents);
    const slack = Math.max(100, Math.round(amount * MATCH_SLACK));
    const [hit] = await db.execute<{
      bill_id: number;
      currency: string;
      charged: string | null;
    }>(sql`
        SELECT c.bill_id, c.currency::text currency, b.charged_cad_cents charged
        FROM books.bill_costs c JOIN ${bills} b ON b.id = c.bill_id
        WHERE c.vendor_id = ${l.vendor_id} AND b.number NOT LIKE 'card:%'
          AND c.review NOT IN ('personal', 'void') AND c.total_cents > 0
          AND c.issued_on BETWEEN ${shiftDay(l.on, -MATCH_DAYS)} AND ${shiftDay(l.on, MATCH_DAYS)}
          AND abs(coalesce(b.charged_cad_cents, c.cad_cents,
            CASE WHEN c.currency = 'CAD' THEN c.total_cents END) - ${amount}) <= ${slack}
          AND NOT EXISTS (SELECT 1 FROM ${cardLines} o WHERE o.bill_id = c.bill_id AND o.id <> ${l.id})
        ORDER BY abs(c.issued_on - ${l.on}::date),
          abs(coalesce(b.charged_cad_cents, c.cad_cents, c.total_cents) - ${amount})
        LIMIT 1`);
    if (hit) {
      await serializable(db, async (tx) => {
        if (l.bill_id) await voidCardBills(tx, [l.bill_id]);
        await tx.update(cardLines).set({ billId: hit.bill_id }).where(eq(cardLines.id, l.id));
        if (hit.currency !== "CAD" && hit.charged === null)
          await tx
            .update(bills)
            .set({ chargedCadCents: amount, updatedAt: new Date() })
            .where(eq(bills.id, hit.bill_id));
      });
      out.matched++;
      if (hit.currency !== "CAD" && hit.charged === null) out.charged++;
      continue;
    }
    if (l.bill_id || l.on > shiftDay(on, -CARD_GRACE_DAYS)) continue;
    await makeBill(db, l.id, runId);
    out.made++;
  }
  return out;
}

/** A receipt from the card line itself: the CAD it took, no tax known. */
async function makeBill(db: Db, lineId: number, runId: string | null) {
  await serializable(db, async (tx) => {
    const [l] = await tx.select().from(cardLines).where(eq(cardLines.id, lineId));
    if (!l?.vendorId) return;
    const [v] = await tx.select().from(vendors).where(eq(vendors.id, l.vendorId));
    if (!v) return;
    const [bill] = await tx
      .insert(bills)
      .values({
        vendorId: v.id,
        number: `card:${l.id}`,
        kind: "receipt",
        issuedOn: l.on,
        currency: l.currency,
        subtotalCents: l.amountCents,
        taxCents: 0,
        totalCents: l.amountCents,
        plan: vendorSpec(v.key)?.plan ?? null,
        cycle: v.cycle,
        paymentMethod: `card ending ${l.card}`,
        accountId: v.accountId,
        review: "ok",
        documentId: l.documentId,
        runId,
      })
      .onConflictDoUpdate({
        target: [bills.vendorId, bills.number],
        set: { review: "ok", updatedAt: new Date() },
      })
      .returning({ id: bills.id });
    if (!bill) return;
    await tx
      .insert(billDocuments)
      .values({ billId: bill.id, documentId: l.documentId })
      .onConflictDoNothing();
    await tx.update(cardLines).set({ billId: bill.id }).where(eq(cardLines.id, l.id));
  });
}

export async function descriptorOfLine(db: Db, id: number): Promise<string | null> {
  const [l] = await db
    .select({ d: cardLines.descriptor })
    .from(cardLines)
    .where(eq(cardLines.id, id));
  return l?.d ?? null;
}

/** Lines no rule or vendor claims yet. */
export async function unsortedCard(db: Db) {
  return db
    .select({
      descriptor: cardLines.descriptor,
      lines: sql<number>`count(*)::int`,
      last: sql<string>`max(${cardLines.on})::text`,
    })
    .from(cardLines)
    .where(
      and(
        isNull(cardLines.vendorId),
        eq(cardLines.personal, false),
        sql`${cardLines.amountCents} > 0`,
      ),
    )
    .groupBy(cardLines.descriptor)
    .orderBy(sql`count(*) desc`);
}

/** A subscription cancelled on a day; its next bill, if one comes, brings it back. */
export async function endSubscription(
  db: Db,
  vendorKey: string,
  endedOn: string,
  plan?: string | null,
): Promise<void> {
  const [v] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.key, vendorKey));
  if (!v) throw new Error(`no vendor ${vendorKey}`);
  const p = (plan ?? vendorSpec(vendorKey)?.plan ?? "").toLowerCase();
  await db
    .insert(subscriptionEnds)
    .values({ vendorId: v.id, plan: p, endedOn })
    .onConflictDoUpdate({
      target: [subscriptionEnds.vendorId, subscriptionEnds.plan],
      set: { endedOn },
    });
}
