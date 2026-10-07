/**
 * One server template for every data page: the shell, the styles, the kit, and the template's
 * body. Every value is escaped where it's printed; nothing a page holds is run.
 */
import { KIT_PATH } from "./kit.js";
import { esc } from "./templates/parts.js";
import type { Content, RenderContext, Template } from "./templates/types.js";

/** The headers a page goes out with: its own scripts and styles only, posts to its own host. */
export const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data: https:; " +
  "connect-src 'self'; form-action 'self'; frame-ancestors 'self'; base-uri 'none'";

const CSS = `
:root{--ink:#16181d;--muted:#5b6170;--paper:#fbfaf7;--line:#e4e1d8;--accent:#24594b;--accent-ink:#fff;--card:#fff}
@media (prefers-color-scheme:dark){:root{--ink:#eceae4;--muted:#a3a7b0;--paper:#121417;--line:#2a2e35;--accent:#7cc3a8;--accent-ink:#0d1512;--card:#191c20}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:720px;margin:0 auto;padding:0 20px 64px}
.banner{background:#f3d36b;color:#2b2200;text-align:center;font-size:14px;padding:6px 12px}
.hero{padding:72px 0 32px}
h1{font-size:clamp(32px,6vw,48px);line-height:1.1;letter-spacing:-.02em;margin:0 0 16px}
h2{font-size:22px;line-height:1.25;margin:0 0 12px}
.lede{font-size:20px;color:var(--muted);margin:0 0 28px}
section{padding:28px 0;border-top:1px solid var(--line)}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin:0}
.btn,button{display:inline-block;background:var(--accent);color:var(--accent-ink);border:1px solid var(--accent);border-radius:0;padding:14px 22px;font-family:inherit;font-weight:600;font-size:16px;line-height:1.2;text-decoration:none;cursor:pointer}
.btn.ghost{background:transparent;color:var(--accent)}
button:disabled{opacity:.6;cursor:default}
ul,ol{padding-left:22px;margin:0}
li{margin:6px 0}
.ticks{list-style:none;padding:0}
.ticks li{padding-left:28px;position:relative}
.ticks li:before{content:"";position:absolute;left:4px;top:.55em;width:10px;height:6px;border-left:2px solid var(--accent);border-bottom:2px solid var(--accent);transform:rotate(-45deg)}
.proof-list{list-style:none;padding:0;display:grid;gap:10px}
.proof-list li{border-left:3px solid var(--accent);padding-left:12px;margin:0}
details{border-bottom:1px solid var(--line);padding:12px 0}
summary{cursor:pointer;font-weight:600}
.terms p{margin:0 0 8px}
.ranked{list-style:none;padding:0;margin:8px 0 24px}
.ranked>li{background:var(--card);border:1px solid var(--line);padding:20px;margin:0 0 16px}
.rank{display:inline-block;min-width:32px;color:var(--accent)}
.rating{float:right;font-size:15px;color:var(--muted);font-weight:500}
.pros li::marker{content:"+  ";color:var(--accent)}
.cons li::marker{content:"-  ";color:var(--muted)}
.form form{display:grid;gap:14px;max-width:480px}
label{display:grid;gap:6px;font-size:15px;color:var(--muted)}
input,textarea{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:0;padding:12px}
.check{display:flex;gap:10px;align-items:flex-start}
.check input{margin-top:4px}
.trap{position:absolute;left:-9999px}
.sent{margin:0;font-weight:600}
.muted{color:var(--muted)}
footer{padding:32px 0 0;color:var(--muted);font-size:14px;border-top:1px solid var(--line)}
.preview form{pointer-events:none;opacity:.7}
@media (max-width:480px){body{font-size:16px}.hero{padding:48px 0 24px}.lede{font-size:18px}.btn{width:100%;text-align:center}}
`;

/** The whole page. Without tracking (a draft preview) the kit stays out and the form is shown, not live. */
export function renderPage(t: Template, c: Content, ctx: RenderContext): string {
  const { title, description } = t.head(c);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<style>${CSS}</style>
${ctx.track ? `<script src="${esc(ctx.base)}${KIT_PATH}" data-page="${esc(ctx.page)}" defer></script>` : ""}
</head>
<body${ctx.track ? "" : ' class="preview"'}>
${ctx.banner ? `<div class="banner">${esc(ctx.banner)}</div>` : ""}
<main>
${t.body(c, ctx)}
</main>
</body></html>`;
}

/** A page that isn't there, or isn't anymore. */
export function goneHtml(status: 404 | 410): string {
  const words = status === 410 ? "This page has been taken down." : "There's no page here.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${status === 410 ? "Gone" : "Not found"}</title><style>${CSS}</style></head><body><main><header class="hero"><h1>${words}</h1></header></main></body></html>`;
}
