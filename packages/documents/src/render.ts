/**
 * The signing page at `/o/d/<token>` (designs/2026-10-09-documents.md, "Signing page"): the
 * words, the lines, the totals, then the signing form or what became of it. Every value is
 * escaped where it's printed; posts go to the same path. No script of ours runs on it: only
 * Turnstile's, when the edge has a site key.
 */
import type { Doc, DocKind } from "./schema.js";
import { CONSENT_WORDS, KIND_NAME, lineAmount, lineTax, money, SIGN_LABEL } from "./store.js";

export const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** What the page takes from the owner's Look: a brand color and a logo, if they're safe. */
export interface PageLook {
  accent: string | null;
  logo: string | null;
}
const HEX = /^#[0-9a-f]{6}$/i;
export function lookOf(raw: unknown): PageLook {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { accent: null, logo: null };
  const r = raw as Record<string, unknown>;
  const color = [r.brand, r.accent].find((v) => typeof v === "string" && HEX.test(v));
  const logo =
    typeof r.logo === "string" && /^https:\/\/[^\s"'<>]{1,500}$/.test(r.logo) ? r.logo : null;
  return { accent: (color as string | undefined) ?? null, logo };
}

const CSS = (accent: string | null) => `
:root{--ink:#16181d;--muted:#5b6170;--paper:#fbfaf7;--line:#e4e1d8;--accent:${accent ?? "#24594b"};--accent-ink:#fff;--card:#fff;--bad:#a3302a}
@media (prefers-color-scheme:dark){:root{--ink:#eceae4;--muted:#a3a7b0;--paper:#121417;--line:#2a2e35;--card:#191c20;--bad:#f08a80}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 64px}
header.top{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:24px}
header.top img{max-height:40px;max-width:180px}
.biz{font-weight:600}
.meta{color:var(--muted);font-size:15px}
h1{font-size:28px;line-height:1.25;margin:0 0 8px}
h2{font-size:20px;margin:28px 0 8px}
.words p{margin:0 0 12px}
.words ul{margin:0 0 12px;padding-left:22px}
table{width:100%;border-collapse:collapse;margin:24px 0;font-size:16px}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500;font-size:14px}
td.n,th.n{text-align:right;white-space:nowrap}
td small{color:var(--muted);display:block}
.totals td{border:0;padding:4px 6px}
.totals tr.total td{font-weight:700;font-size:18px;border-top:2px solid var(--ink);padding-top:8px}
.box{background:var(--card);border:1px solid var(--line);padding:20px;margin:32px 0}
label{display:block;font-size:15px;margin:12px 0 4px}
input[type=text],input[type=email],textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);background:var(--paper);color:var(--ink)}
.consent{display:flex;gap:10px;align-items:flex-start;margin:16px 0}
.consent input{margin-top:6px;width:18px;height:18px}
button,.button{display:inline-block;font:inherit;font-weight:600;padding:12px 20px;border:0;background:var(--accent);color:var(--accent-ink);cursor:pointer;text-decoration:none}
button.quiet{background:transparent;color:var(--ink);border:1px solid var(--line)}
.error{color:var(--bad);font-weight:600}
.done{border-left:4px solid var(--accent)}
details{margin-top:16px}
summary{cursor:pointer;color:var(--muted)}
footer{color:var(--muted);font-size:14px;margin-top:40px}
@media print{.box form,.noprint{display:none}}
`;

/** Light marks (`# `, `## `, `- `, blank lines) as HTML, escaped. */
export function marksHtml(body: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(esc).join("<br>")}</p>`);
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`);
    para = [];
    list = [];
  };
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith("## ")) {
      flush();
      out.push(`<h2>${esc(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      flush();
      out.push(`<h2>${esc(line.slice(2))}</h2>`);
    } else if (line.startsWith("- ")) {
      if (para.length) flush();
      list.push(line.slice(2));
    } else {
      if (list.length) flush();
      para.push(line);
    }
  }
  flush();
  return out.join("\n");
}

const day = (d: Date | string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

/** The lines and totals table; empty when there are no lines. */
export function linesHtml(
  d: Pick<Doc, "lines" | "currency" | "subtotalCents" | "taxCents" | "totalCents" | "depositCents">,
) {
  if (!d.lines.length) return "";
  const m = (c: number) => esc(money(c, d.currency));
  const rows = d.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.name)}${l.detail ? `<small>${esc(l.detail)}</small>` : ""}</td><td class="n">${esc(l.qty)}</td><td class="n">${m(l.unit_cents)}</td><td class="n">${l.tax_pct ? `${esc(l.tax_pct)}%` : ""}</td><td class="n">${m(lineAmount(l) + lineTax(l))}</td></tr>`,
    )
    .join("");
  return `<table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Tax</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals"><tbody>
<tr><td>Subtotal</td><td class="n">${m(d.subtotalCents)}</td></tr>
${d.taxCents ? `<tr><td>Tax</td><td class="n">${m(d.taxCents)}</td></tr>` : ""}
<tr class="total"><td>Total</td><td class="n">${m(d.totalCents)}</td></tr>
${d.depositCents ? `<tr><td>Deposit due on signing</td><td class="n">${m(d.depositCents)}</td></tr>` : ""}
</tbody></table>`;
}

export interface PageCtx {
  business: string;
  look: PageLook;
  /** The link's token: the forms post back to the same path. */
  token: string;
  /** Turnstile's site key; null runs no check (local, tests). */
  siteKey: string | null;
  /** How to reach the owner, for an expired or void one. */
  reach: { phone: string | null; email: string | null };
  /** A refusal to show above the form. */
  error?: string | null;
  /** Prefill for the form after a refusal. */
  typed?: { name?: string; email?: string } | null;
  /** The deposit's state: none asked, to pay, or paid. */
  deposit?: "pay" | "paid" | null | undefined;
}

const shell = (title: string, ctx: Pick<PageCtx, "look">, inner: string, turnstile: boolean) =>
  `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<style>${CSS(ctx.look.accent)}</style>
${turnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ""}
</head>
<body><main>
${inner}
</main></body></html>`;

/** The page for an open, signed or declined document. */
export function docPage(d: Doc, ctx: PageCtx): string {
  const kind = d.kind as DocKind;
  const path = `/o/d/${esc(ctx.token)}`;
  const head = `<header class="top"><div>${ctx.look.logo ? `<img src="${esc(ctx.look.logo)}" alt="${esc(ctx.business)}">` : `<span class="biz">${esc(ctx.business)}</span>`}</div><div class="meta">${esc(KIND_NAME[kind])} ${esc(d.number)}</div></header>`;
  const intro = `<h1>${esc(d.title)}</h1>
<p class="meta">${d.name ? `For ${esc(d.name)}. ` : ""}${d.expiresAt && d.status !== "signed" ? `Open until ${esc(day(d.expiresAt))}.` : ""}</p>`;
  const words = d.body.trim() ? `<div class="words">${marksHtml(d.body)}</div>` : "";
  let action = "";
  if (d.status === "signed") {
    action = `<div class="box done"><p><strong>Signed by ${esc(d.signerName)} on ${esc(day(d.signedAt))}.</strong></p>
<p><a href="${path}/pdf">Download the signed copy (PDF)</a></p>
${ctx.deposit === "pay" && d.depositCents ? `<p><a class="button" href="${path}/pay">Pay deposit: ${esc(money(d.depositCents, d.currency))}</a></p><p class="meta">The payment goes through Stripe.</p>` : ""}
${ctx.deposit === "paid" ? "<p>Deposit paid. Thank you.</p>" : ""}</div>`;
  } else if (d.status === "declined") {
    action = `<div class="box done"><p><strong>Declined on ${esc(day(d.declinedAt))}.</strong> ${esc(ctx.business)} has been told.</p></div>`;
  } else {
    const turn = ctx.siteKey
      ? `<div class="cf-turnstile" data-sitekey="${esc(ctx.siteKey)}"></div>`
      : "";
    action = `<div class="box">
${ctx.error ? `<p class="error" role="alert">${esc(ctx.error)}</p>` : ""}
<form method="post" action="${path}">
<input type="hidden" name="act" value="sign">
<input type="hidden" name="sha" value="${esc(d.sha256)}">
<label for="name">Your full name</label>
<input type="text" id="name" name="name" autocomplete="name" required maxlength="200" value="${esc(ctx.typed?.name ?? "")}">
<label for="email">Your email</label>
<input type="email" id="email" name="email" autocomplete="email" required maxlength="200" value="${esc(ctx.typed?.email ?? d.email ?? "")}">
<div class="consent"><input type="checkbox" id="consent" name="consent" value="yes" required><label for="consent" style="margin:0">${esc(CONSENT_WORDS)}</label></div>
${turn}
<button type="submit">${esc(SIGN_LABEL[kind])}</button>
</form>
<details><summary>Decline</summary>
<form method="post" action="${path}">
<input type="hidden" name="act" value="decline">
<label for="why">Why, if you'd like to say</label>
<textarea id="why" name="why" rows="3" maxlength="1000"></textarea>
${ctx.siteKey ? `<div class="cf-turnstile" data-sitekey="${esc(ctx.siteKey)}"></div>` : ""}
<p><button type="submit" class="quiet">Decline</button></p>
</form></details>
</div>`;
  }
  const foot = `<footer>Fingerprint (SHA-256) of this text: <code>${esc(d.sha256)}</code></footer>`;
  return shell(
    `${KIND_NAME[kind]} ${d.number}: ${d.title}`,
    ctx,
    `${head}${intro}${words}${linesHtml(d)}${action}${foot}`,
    !!ctx.siteKey && (d.status === "sent" || d.status === "viewed"),
  );
}

/** One line for a link that's expired, void, or not there, and how to reach the owner. */
export function shutPage(
  why: "expired" | "void" | "missing",
  ctx: Pick<PageCtx, "business" | "look" | "reach">,
): string {
  const words =
    why === "expired"
      ? "This document has expired."
      : why === "void"
        ? "This document was withdrawn."
        : "There's no document here.";
  const reach = [ctx.reach.phone, ctx.reach.email].filter(Boolean).map(esc).join(" or ");
  return shell(
    why === "missing" ? "Not found" : words,
    ctx,
    `<h1>${esc(words)}</h1>${why !== "missing" && reach ? `<p>To ask for a new one, reach ${esc(ctx.business)} at ${reach}.</p>` : ""}`,
    false,
  );
}
