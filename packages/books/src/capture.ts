import {
  decodeEncodedWords,
  type MimePart,
  parseAddr,
  parseDate,
  parseMessage,
} from "@wren/core/mail";
import type { Db } from "@wren/db";
import { and, eq, inArray } from "drizzle-orm";
import { VENDORS, type VendorSpec } from "./chart.js";
import { shiftDay } from "./day.js";
import { billingQuery, type Mailbox, vendorFor } from "./mailbox.js";
import { documents, vendors } from "./schema.js";
import { type DocumentStore, sha256, storeKey } from "./store.js";
import { bodyText, pdfText, withoutNul } from "./text.js";

export interface CaptureOptions {
  /** The first day to look at, `YYYY-MM-DD`. */
  since: string;
  store: DocumentStore;
  runId?: string | null;
  vendorSpecs?: readonly VendorSpec[];
  log?: (line: string) => void;
}

export interface Captured {
  mailbox: string;
  /** Messages the billing search found. */
  found: number;
  /** Of those, already kept by an earlier run. */
  known: number;
  kept: number;
  attachments: number;
  /** Kept, but no vendor's sender rules match (the search is looser than the rules). */
  unmatched: number;
}

const isPdf = (part: MimePart) =>
  part.type === "application/pdf" ||
  (part.type === "application/octet-stream" && /\.pdf$/i.test(part.filename() ?? ""));

/**
 * Keep every billing email a mailbox holds since a day: the raw message and
 * each PDF it carries go to the store, then one row each in `documents`. A
 * message already kept is skipped before it is fetched, so a re-run costs one
 * search. Each message is its own checkpoint; nothing is read here.
 */
export async function capture(db: Db, mailbox: Mailbox, opts: CaptureOptions): Promise<Captured> {
  const specs = opts.vendorSpecs ?? VENDORS;
  const vendorIds = new Map(
    (await db.select({ id: vendors.id, key: vendors.key }).from(vendors)).map((v) => [v.key, v.id]),
  );
  // Gmail reads `after:` in its own zone; a day early keeps the first day whole.
  const ids = await mailbox.search(billingQuery(specs, shiftDay(opts.since, -1)));
  const known = new Set(
    ids.length === 0
      ? []
      : (
          await db
            .select({ key: documents.mailboxKey })
            .from(documents)
            .where(and(eq(documents.mailbox, mailbox.address), inArray(documents.mailboxKey, ids)))
        ).map((d) => d.key),
  );
  const out: Captured = {
    mailbox: mailbox.address,
    found: ids.length,
    known: known.size,
    kept: 0,
    attachments: 0,
    unmatched: 0,
  };
  for (const id of ids) {
    if (known.has(id)) continue;
    const raw = await mailbox.raw(id);
    const kept = await keepEmail(db, opts.store, raw, {
      mailbox: mailbox.address,
      mailboxKey: id,
      runId: opts.runId ?? null,
      vendorOf: (from, subject) => {
        const spec = vendorFor(specs, from, subject);
        return spec ? (vendorIds.get(spec.key) ?? null) : null;
      },
    });
    out.kept++;
    out.attachments += kept.attachments;
    if (kept.vendorId === null) out.unmatched++;
    opts.log?.(`  kept ${kept.subject || "(no subject)"} (${kept.attachments} pdf)`);
  }
  return out;
}

interface Keep {
  mailbox: string;
  mailboxKey: string;
  runId: string | null;
  vendorOf: (fromAddress: string, subject: string) => number | null;
}

/** Store one raw email and its PDFs, then record them in one transaction. */
async function keepEmail(db: Db, store: DocumentStore, raw: Uint8Array, keep: Keep) {
  const message = parseMessage(raw);
  const [name, address] = parseAddr(message.get("From") ?? "");
  const subject = withoutNul(decodeEncodedWords(message.get("Subject") ?? "")).trim();
  const vendorId = keep.vendorOf(address, subject);
  const hash = sha256(raw);
  const key = storeKey(hash, "message/rfc822");
  await store.put(key, raw, "message/rfc822");

  const pdfs: Array<{ hash: string; key: string; bytes: Uint8Array; filename: string | null }> = [];
  for (const part of message.walk()) {
    if (part === message || !isPdf(part)) continue;
    const bytes = part.bytes();
    const pdfHash = sha256(bytes);
    const pdfKey = storeKey(pdfHash, "application/pdf");
    await store.put(pdfKey, bytes, "application/pdf");
    const filename = part.filename();
    pdfs.push({ hash: pdfHash, key: pdfKey, bytes, filename: filename && withoutNul(filename) });
  }
  const pdfTexts = await Promise.all(pdfs.map((p) => pdfText(p.bytes)));

  await db.transaction(async (tx) => {
    const [email] = await tx
      .insert(documents)
      .values({
        sha256: hash,
        mediaType: "message/rfc822",
        size: raw.byteLength,
        storeKey: key,
        source: "mailbox",
        mailbox: keep.mailbox,
        mailboxKey: keep.mailboxKey,
        messageId: message.get("Message-ID")?.trim() ?? null,
        fromAddress: address.toLowerCase() || null,
        fromName: withoutNul(decodeEncodedWords(name)) || null,
        subject: subject || null,
        sentAt: parseDate(message.get("Date")),
        vendorId,
        text: bodyText(message),
        runId: keep.runId,
      })
      .onConflictDoNothing({ target: documents.sha256 })
      .returning({ id: documents.id });
    // The same bytes kept before (another mailbox's copy): that row already speaks for them.
    if (!email) return;
    for (const [i, pdf] of pdfs.entries()) {
      await tx
        .insert(documents)
        .values({
          sha256: pdf.hash,
          mediaType: "application/pdf",
          size: pdf.bytes.byteLength,
          storeKey: pdf.key,
          source: "attachment",
          parentId: email.id,
          filename: pdf.filename,
          vendorId,
          text: pdfTexts[i] ?? null,
          runId: keep.runId,
        })
        .onConflictDoNothing({ target: documents.sha256 });
    }
  });
  return { subject, vendorId, attachments: pdfs.length };
}
