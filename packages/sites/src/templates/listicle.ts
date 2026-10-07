/** The listicle: a title, ranked items with pros and cons, a verdict, then the form. */
import type { Offer } from "@wren/offers";
import { priceLine } from "./lander.js";
import { button, esc, formBlock, items, para, safeHref, str } from "./parts.js";
import type { Template } from "./types.js";

const RATING = /^(?:[0-4](?:\.\d)?|5(?:\.0)?)$/;

export const listicle: Template = {
  id: "listicle",
  name: "Listicle",
  blurb: "Ranked items with pros and cons, a verdict and a form. For readers comparing options.",
  fields: [
    { key: "title", group: "Top", label: "Title", kind: "text", max: 100 },
    { key: "intro", label: "Intro", kind: "long", max: 600 },
    {
      key: "items",
      group: "List",
      label: "Items, best first",
      kind: "items",
      max: 10,
      items: [
        { key: "name", label: "Name", kind: "text", max: 80 },
        { key: "blurb", label: "What it is", kind: "long", max: 400 },
        { key: "pros", label: "Pros, one per line", kind: "long", max: 400 },
        { key: "cons", label: "Cons, one per line", kind: "long", max: 400 },
        { key: "rating", label: "Rating out of 5", kind: "text", max: 3 },
        { key: "link", label: "Link", kind: "url", max: 300 },
        { key: "link_label", label: "Link label", kind: "text", max: 30 },
      ],
    },
    { key: "verdict", group: "Verdict", label: "Verdict", kind: "long", max: 600, optional: true },
    { key: "cta", label: "Button", kind: "text", max: 40, hint: "Goes to the form." },
    { key: "form_title", group: "Form", label: "Form heading", kind: "text", max: 80 },
    { key: "form_note", label: "Under the form heading", kind: "long", max: 200, optional: true },
    { key: "form_button", label: "Form button", kind: "text", max: 40 },
    {
      key: "form",
      label: "Hosted form",
      kind: "text",
      max: 80,
      optional: true,
      hint: "A form's slug or id from Sites, Forms. Empty: name, email, phone and a note.",
    },
    { key: "thanks", label: "After sending", kind: "text", max: 160 },
    { key: "footer", group: "Footer", label: "Footer", kind: "text", max: 160, optional: true },
  ],
  fill(offer: Offer, o) {
    const got = offer.youGet.slice(0, 5);
    return {
      title: `${got.length} things to know before you start: ${offer.name}`.slice(0, 100),
      intro: `${offer.promise} For ${o.audience?.trim() || offer.audience}`.replace(/\.?$/, "."),
      items: got.map((g) => ({
        name: g.slice(0, 80),
        blurb: "",
        pros: "",
        cons: "",
        rating: "",
        link: "#form",
        link_label: "Ask about it",
      })),
      verdict: [priceLine(offer.price), offer.guarantee ?? ""].filter(Boolean).join(" "),
      cta: offer.application ? "See if you fit" : "Talk to us",
      form_title: "See if it fits",
      form_note: "",
      form_button: "Send",
      form: "",
      thanks: "Thanks. We'll be in touch soon.",
      footer: offer.name,
    };
  },
  head: (c) => ({ title: str(c, "title"), description: str(c, "intro").slice(0, 160) }),
  body(c, ctx) {
    const rows = items(c, "items").filter((i) => i.name);
    const bullets = (s: string | undefined, cls: string) => {
      const xs = (s ?? "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
      return xs.length
        ? `<ul class="${cls}">${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
        : "";
    };
    return [
      `<header class="hero"><h1>${esc(str(c, "title"))}</h1><p class="lede">${para(str(c, "intro"))}</p></header>`,
      `<ol class="ranked">${rows
        .map((r, i) => {
          const rating = RATING.test(r.rating ?? "")
            ? `<span class="rating">${esc(r.rating ?? "")} / 5</span>`
            : "";
          const href = r.link ? safeHref(r.link) : null;
          return `<li><h2><span class="rank">${i + 1}</span>${esc(r.name ?? "")}${rating}</h2>${
            r.blurb ? `<p>${para(r.blurb)}</p>` : ""
          }${bullets(r.pros, "pros")}${bullets(r.cons, "cons")}${
            href ? `<p>${button(r.link_label || "Learn more", href, "cta", true)}</p>` : ""
          }</li>`;
        })
        .join("")}</ol>`,
      str(c, "verdict")
        ? `<section class="terms"><h2>Verdict</h2><p>${para(str(c, "verdict"))}</p></section>`
        : "",
      `<p class="actions">${button(str(c, "cta"), "#form", "cta")}</p>`,
      formBlock(
        {
          title: str(c, "form_title"),
          note: str(c, "form_note"),
          button: str(c, "form_button"),
          thanks: str(c, "thanks"),
        },
        ctx,
      ),
      str(c, "footer") ? `<footer>${esc(str(c, "footer"))}</footer>` : "",
    ].join("\n");
  },
};
