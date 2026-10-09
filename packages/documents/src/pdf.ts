/**
 * The signed copy as a PDF (designs/2026-10-09-documents.md, "Proof"), built on demand from the
 * frozen row: the words, the lines and totals, then a signing record page with each step's time,
 * IP and agent, the signer, the consent words and the SHA-256. The same row always gives the
 * same bytes: the dates in the file are the document's own.
 */
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import type { Doc, DocEvent, DocKind } from "./schema.js";
import { CONSENT_WORDS, KIND_NAME, lineAmount, lineTax, money } from "./store.js";

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
function row(p: Pen, cells: string[], bold = false) {
  const xs = [M, 330, 400, 470, W - M];
  if (p.y < M + LEAD) newPage(p);
  const font = bold ? p.bold : p.font;
  cells.forEach((c, i) => {
    const t = ansi(c);
    if (i === 0) {
      const max = 330 - M - 8;
      let s = t;
      while (s.length > 1 && font.widthOfTextAtSize(s, SIZE) > max) s = s.slice(0, -1);
      p.page.drawText(s === t ? s : `${s.slice(0, -1)}.`, { x: M, y: p.y, size: SIZE, font });
    } else {
      const right = xs[i + 1] ?? W - M;
      const x = Math.min(right, W - M) - font.widthOfTextAtSize(t, SIZE);
      p.page.drawText(t, { x, y: p.y, size: SIZE, font });
    }
  });
  p.y -= LEAD;
}

const when = (d: Date | string | null) =>
  d ? `${new Date(d).toISOString().replace("T", " ").slice(0, 19)} UTC` : "";

/** The PDF's bytes for one document and its events. */
export async function docPdf(
  d: Doc,
  events: readonly DocEvent[],
  business: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const kind = KIND_NAME[d.kind as DocKind];
  const at = d.signedAt ?? d.declinedAt ?? d.sentAt ?? d.createdAt;
  pdf.setTitle(ansi(`${kind} ${d.number}: ${d.title}`));
  pdf.setAuthor(ansi(business));
  pdf.setProducer("Wren");
  pdf.setCreator("Wren");
  pdf.setCreationDate(new Date(d.createdAt));
  pdf.setModificationDate(new Date(at));
  const p: Pen = {
    pdf,
    page: pdf.addPage([W, H]),
    y: H - M,
    font: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
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
  return pdf.save({ useObjectStreams: false });
}
