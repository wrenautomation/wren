/** The pieces every template shares: escaping, reading a field, the form, a button. */
import { formHtml } from "../forms.js";
import type { Content, ItemValue, RenderContext } from "./types.js";

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
/** Text safe inside HTML and inside a quoted attribute. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);

/** An address safe in `href`: https, http, mailto, tel, or a path of ours. */
export function safeHref(raw: string): string | null {
  const s = raw.trim();
  if (s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\")) return s;
  try {
    const u = new URL(s);
    return ["https:", "http:", "mailto:", "tel:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

export const str = (c: Content, key: string): string => {
  const v = c[key];
  return typeof v === "string" ? v : "";
};
export const lines = (c: Content, key: string): string[] => {
  const v = c[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
};
export const items = (c: Content, key: string): ItemValue[] => {
  const v = c[key];
  return Array.isArray(v) ? v.filter((x): x is ItemValue => !!x && typeof x === "object") : [];
};

/** A paragraph's line breaks kept. */
export const para = (s: string) => esc(s).replace(/\n/g, "<br>");

/** A button: a link out (booking) or down to the form. */
export function button(label: string, href: string, kind: "cta" | "book", ghost = false): string {
  const to = safeHref(href) ?? "#form";
  return `<a class="btn${ghost ? " ghost" : ""}" href="${esc(to)}" data-${kind}>${esc(label)}</a>`;
}

/** The default form's text consent, word for word: kept with each submit that ticks it. */
export const DEFAULT_CONSENT = "Text me about this. Reply STOP to stop.";

/**
 * The form: a hosted form's fields when the page names one (`ctx.form`), else name, email,
 * phone, a note, the text consent, and a field no person fills (a bot does, and the server drops
 * it). Posts without script too; the kit sends it as JSON.
 */
export function formBlock(
  c: { title: string; note: string; button: string; thanks: string },
  ctx: Pick<RenderContext, "page" | "base" | "form">,
): string {
  const head = `<h2>${esc(c.title)}</h2>
${c.note ? `<p class="muted">${para(c.note)}</p>` : ""}`;
  if (ctx.form)
    return `<section class="form" id="form">
${head}
${formHtml(ctx.form.spec, { form: ctx.form.id, page: ctx.page, base: ctx.base })}
</section>`;
  return `<section class="form" id="form">
${head}
<form method="post" action="${esc(ctx.base)}/o/__form" data-wren-form data-thanks="${esc(c.thanks)}">
<input type="hidden" name="page" value="${esc(ctx.page)}">
<label>Name<input name="name" autocomplete="name" required maxlength="120"></label>
<label>Email<input name="email" type="email" autocomplete="email" required maxlength="200"></label>
<label>Phone<input name="phone" type="tel" autocomplete="tel" maxlength="40"></label>
<label>Anything we should know<textarea name="note" rows="3" maxlength="1000"></textarea></label>
<label class="check"><input type="checkbox" name="sms_consent" value="yes"> ${DEFAULT_CONSENT}</label>
<label class="trap" aria-hidden="true">Leave empty<input name="website" tabindex="-1" autocomplete="off"></label>
<button type="submit">${esc(c.button)}</button>
<p class="sent" role="status" hidden></p>
</form>
</section>`;
}
