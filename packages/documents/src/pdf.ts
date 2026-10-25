/**
 * The signed copy as a PDF (designs/2026-10-09-documents.md, "Proof"), built on demand from the
 * frozen row: the words, the lines and totals, then a signing record page with each step's time,
 * IP and agent, the signer, the consent words and the SHA-256. The same row always gives the
 * same bytes: the dates in the file are the document's own.
 */
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import type { Doc, DocEvent, DocKind } from "./schema.js";
import {
  CONSENT_WORDS,
  KIND_NAME,
  lineAmount,
  lineTax,
  money,
  SEALED_CONSENT_VERSION,
  SEALED_CONSENT_WORDS,
} from "./store.js";

const W = 612;
const H = 792;
const M = 56;
const SIZE = 11;
const LEAD = 15;

/** Helvetica speaks WinAnsi only: other characters print as "?". Quotes and dashes map over. */
export function ansi(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\t\r]/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

interface Pen {
  pdf: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
}

function newPage(p: Pen) {
  p.page = p.pdf.addPage([W, H]);
  p.y = H - M;
}

/** Words wrapped to the page, a new page when one fills. */
function write(p: Pen, text: string, o: { bold?: boolean; size?: number; gap?: number } = {}) {
  const font = o.bold ? p.bold : p.font;
  const size = o.size ?? SIZE;
  const lead = Math.max(LEAD, size * 1.35);
  for (const para of ansi(text).split("\n")) {
    const words = para.split(" ");
    let line = "";
    const out: string[] = [];
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > W - 2 * M && line) {
        out.push(line);
        line = w;
      } else line = next;
    }
    out.push(line);
    for (const l of out) {
      if (p.y < M + lead) newPage(p);
      p.page.drawText(l, { x: M, y: p.y, size, font, color: rgb(0.09, 0.09, 0.11) });
      p.y -= lead;
    }
  }
  p.y -= o.gap ?? 0;
}

/** A row of cells at fixed x, right-aligned past the first. */
/** One table row; the first cell wraps onto more lines rather than being cut. */
function row(p: Pen, cells: string[], bold = false) {
  const xs = [M, 330, 400, 470, W - M];
  const font = bold ? p.bold : p.font;
  const max = 330 - M - 8;
  const first: string[] = [];
  let line = "";
  for (const w of ansi(cells[0] ?? "").split(" ")) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, SIZE) > max && line) {
      first.push(line);
      line = w;
    } else line = next;
  }
  first.push(line);
  if (p.y < M + LEAD * first.length) newPage(p);
  first.forEach((l, n) => {
    p.page.drawText(l, { x: M, y: p.y - n * LEAD, size: SIZE, font });
  });
  cells.slice(1).forEach((c, k) => {
    const t = ansi(c);
    const right = xs[k + 2] ?? W - M;
    const x = Math.min(right, W - M) - font.widthOfTextAtSize(t, SIZE);
    p.page.drawText(t, { x, y: p.y, size: SIZE, font });
  });
  p.y -= LEAD * first.length;
}

const when = (d: Date | string | null) =>
  d ? `${new Date(d).toISOString().replace("T", " ").slice(0, 19)} UTC` : "";

/** A new PDF with the document's own dates, and the pen on its first page. */
async function start(d: Doc, business: string, at: Date | string): Promise<Pen> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(ansi(`${KIND_NAME[d.kind as DocKind]} ${d.number}: ${d.title}`));
  pdf.setAuthor(ansi(business));
  pdf.setProducer("Wren");
  pdf.setCreator("Wren");
  pdf.setCreationDate(new Date(d.createdAt));
  pdf.setModificationDate(new Date(at));
  return {
    pdf,
    page: pdf.addPage([W, H]),
    y: H - M,
    font: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
}

/** The words, the lines and the totals: what the signer reads. */
function writeDoc(p: Pen, d: Doc, business: string) {
  const kind = KIND_NAME[d.kind as DocKind];
  write(p, `${business}  |  ${kind} ${d.number}`, { size: 10, gap: 8 });
  write(p, d.title, { bold: true, size: 18, gap: 6 });
  if (d.name) write(p, `For ${d.name}`, { gap: 10 });
  for (const raw of d.body.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) p.y -= 6;
    else if (line.startsWith("## ")) write(p, line.slice(3), { bold: true, size: 13, gap: 2 });
    else if (line.startsWith("# ")) write(p, line.slice(2), { bold: true, size: 14, gap: 2 });
    else if (line.startsWith("- ")) write(p, `-  ${line.slice(2)}`);
    else write(p, line);
  }
  if (d.lines.length) {
    p.y -= 12;
    row(p, ["Item", "Qty", "Price", "Amount"], true);
    for (const l of d.lines)
      row(p, [
        l.tax_pct ? `${l.name} (tax ${l.tax_pct}%)` : l.name,
        String(l.qty),
        money(l.unit_cents, d.currency),
        money(lineAmount(l) + lineTax(l), d.currency),
      ]);
    p.y -= 6;
    row(p, ["Subtotal", "", "", money(d.subtotalCents, d.currency)]);
    if (d.taxCents) row(p, ["Tax", "", "", money(d.taxCents, d.currency)]);
    row(p, ["Total", "", "", money(d.totalCents, d.currency)], true);
    if (d.depositCents)
      row(p, ["Deposit due on signing", "", "", money(d.depositCents, d.currency)]);
  }
}

/** The PDF's bytes for one document and its events. */
export async function docPdf(
  d: Doc,
  events: readonly DocEvent[],
  business: string,
): Promise<Uint8Array> {
  const kind = KIND_NAME[d.kind as DocKind];
  const p = await start(d, business, d.signedAt ?? d.declinedAt ?? d.sentAt ?? d.createdAt);
  writeDoc(p, d, business);
  newPage(p);
  write(p, "Signing record", { bold: true, size: 16, gap: 8 });
  write(p, `Document: ${kind} ${d.number}, from ${business}`);
  write(p, `Status: ${d.status}`);
  if (d.signedAt) {
    write(p, `Signed by: ${d.signerName} <${d.signerEmail}>`);
    write(p, `Signed at: ${when(d.signedAt)}`);
    write(p, `IP: ${d.signedIp ?? "unknown"}`);
    write(p, `Browser: ${d.signedAgent ?? "unknown"}`);
    write(p, `Consent (version ${d.consentVersion}): "${CONSENT_WORDS}"`);
  }
  if (d.declinedAt)
    write(p, `Declined at: ${when(d.declinedAt)}${d.declinedWhy ? `: ${d.declinedWhy}` : ""}`);
  write(p, `SHA-256 of the text shown: ${d.sha256 ?? ""}`, { gap: 10 });
  write(p, "Every step", { bold: true, size: 13, gap: 2 });
  for (const e of events) {
    const who = e.by === "recipient" ? "recipient" : e.by;
    const where = [e.ip ? `IP ${e.ip}` : "", e.agent ? e.agent : ""].filter(Boolean).join(", ");
    write(
      p,
      `${when(e.at)}  ${e.type} by ${who}${e.note ? ` (${e.note})` : ""}${where ? `. ${where}` : ""}`,
      {
        size: 10,
      },
    );
  }
  return p.pdf.save({ useObjectStreams: false });
}

/**
 * The PDF Documenso signs, for a document sent for signature: the words and totals, the consent
 * line, then the signature block. `{{signature, r1}}` and `{{date, r1}}` are placeholders:
 * Documenso puts the signer's fields there and covers the text. The sealed copy gets its own
 * certificate page from Documenso, so there is no signing record here. The same document always
 * gives the same bytes.
 */
export async function sealedPdf(d: Doc, business: string): Promise<Uint8Array> {
  const p = await start(d, business, d.sentAt ?? d.createdAt);
  writeDoc(p, d, business);
  const need = 150;
  if (p.y < M + need) newPage(p);
  p.y -= 18;
  write(p, "Electronic records and signature", { bold: true, size: 13, gap: 2 });
  write(p, `${SEALED_CONSENT_WORDS} (version ${SEALED_CONSENT_VERSION})`, { gap: 18 });
  const at = (label: string, mark: string) => {
    p.page.drawText(label, { x: M, y: p.y, size: SIZE, font: p.bold });
    p.page.drawText(mark, { x: M + 80, y: p.y, size: SIZE, font: p.font });
    p.y -= 40;
  };
  at("Signature:", "{{signature, r1}}");
  at("Date:", "{{date, r1}}");
  return p.pdf.save({ useObjectStreams: false });
}

/**
 * A bill as the payer reads it (designs/2026-10-15-wise-billing.md): who it's from and to, the
 * lines and total, the due day, then how to pay by bank transfer with the reference to quote.
 * Amounts come formatted; the bank details come from the caller at runtime, never from here.
 */
interface InvoicePdf {
  number: string;
  issuedOn: string;
  dueOn: string;
  currency: string;
  /** Us; the tax number is our GST/HST registration. */
  from: { name: string; place?: string; email?: string; taxNumber?: string };
  /** Who pays: a name, then any address lines, email and tax number they gave. */
  to: { name: string; address?: string[]; email?: string; taxNumber?: string };
  lines: { what: string; amount: string }[];
  total: string;
  /** The memo the payer types, so the payment finds its invoice. */
  reference: string;
  /** Receive details for the invoice's currency, label then value; empty prints a line to ask. */
  pay: [string, string][];
}

/** The invoice's bytes. The same input always gives the same bytes. */
export async function invoicePdf(i: InvoicePdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(ansi(`Invoice ${i.number}`));
  pdf.setAuthor(ansi(i.from.name));
  pdf.setProducer("Wren");
  pdf.setCreator("Wren");
  const day = new Date(`${i.issuedOn}T00:00:00Z`);
  pdf.setCreationDate(day);
  pdf.setModificationDate(day);
  const p: Pen = {
    pdf,
    page: pdf.addPage([W, H]),
    y: H - M,
    font: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  write(p, i.from.name, { bold: true, size: 12 });
  for (const l of [i.from.place, i.from.email]) if (l) write(p, l, { size: 10 });
  if (i.from.taxNumber) write(p, `GST/HST no. ${i.from.taxNumber}`, { size: 10 });
  p.y -= 14;
  write(p, `Invoice ${i.number}`, { bold: true, size: 20, gap: 6 });
  write(p, "Bill to", { bold: true });
  write(p, i.to.name);
  for (const l of [...(i.to.address ?? []), i.to.email]) if (l) write(p, l, { size: 10 });
  if (i.to.taxNumber) write(p, `Tax no. ${i.to.taxNumber}`, { size: 10 });
  p.y -= 6;
  write(p, `Issued: ${i.issuedOn}`);
  write(p, `Due: ${i.dueOn}`, { bold: true, gap: 12 });
  row(p, ["Item", "", "", "Amount"], true);
  for (const l of i.lines) row(p, [l.what, "", "", l.amount]);
  p.y -= 6;
  row(p, ["Total due", "", "", i.total], true);
  p.y -= 18;
  write(p, "Pay by bank transfer", { bold: true, size: 14, gap: 4 });
  write(p, `Put this reference in the transfer's memo: ${i.reference}`, { bold: true, gap: 6 });
  if (i.pay.length === 0)
    write(p, `Ask ${i.from.email ?? i.from.name} for the bank details.`, { gap: 6 });
  for (const [label, value] of i.pay) write(p, `${label}: ${value}`);
  p.y -= 10;
  write(p, `Please send the total in ${i.currency}, the currency it's billed in.`, { size: 10 });
  return pdf.save({ useObjectStreams: false });
}
