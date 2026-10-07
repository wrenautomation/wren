/** The lander: one offer, one ask. Hero, what you get, how it works, terms, questions, form. */
import type { Offer, Price } from "@wren/offers";
import { button, esc, formBlock, items, lines, para, str } from "./parts.js";
import type { Template } from "./types.js";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const range = (r: { min: number; max: number }) =>
  r.min === r.max ? usd(r.min) : `${usd(r.min)} to ${usd(r.max)}`;

/** The price in one line, from the offer's terms. */
export function priceLine(p: Price): string {
  switch (p.kind) {
    case "free":
      return "Free.";
    case "quoted":
      return "Priced on the call, from what we find.";
    case "fixed":
      return [
        p.upfront ? `${range(p.upfront)} upfront` : null,
        p.monthly ? `${range(p.monthly)} a month` : null,
      ]
        .filter(Boolean)
        .join(", then ")
        .concat(".");
    case "performance":
      return (
        `${usd(p.upfront)} to start, then ${usd(p.perUnit)} per ${p.unit}` +
        (p.cap === null ? "." : `, up to ${usd(p.cap)}.`)
      );
  }
}

const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

export const lander: Template = {
  id: "lander",
  name: "Lander",
  blurb: "One offer, one ask: hero, what you get, how it works, terms, questions and a form.",
  fields: [
    { key: "headline", label: "Headline", kind: "text", max: 90 },
    { key: "sub", label: "Under the headline", kind: "long", max: 240 },
    { key: "cta", label: "Button", kind: "text", max: 40, hint: "Goes to the form." },
    { key: "book_label", label: "Booking button", kind: "text", max: 40, optional: true },
    { key: "book_url", label: "Booking link", kind: "url", max: 300, optional: true },
    {
      key: "proof",
      label: "Proof lines",
      kind: "lines",
      max: 5,
      optional: true,
      hint: "Only what's true. One per line.",
    },
    { key: "get_title", label: "What you get, heading", kind: "text", max: 60 },
    { key: "get", label: "What you get", kind: "lines", max: 8 },
    { key: "steps_title", label: "How it works, heading", kind: "text", max: 60 },
    { key: "steps", label: "Steps", kind: "lines", max: 6 },
    { key: "give", label: "What you put in", kind: "lines", max: 6, optional: true },
    { key: "price", label: "Price", kind: "long", max: 200, optional: true },
    { key: "guarantee", label: "Guarantee", kind: "long", max: 300, optional: true },
    {
      key: "faq",
      label: "Questions",
      kind: "items",
      max: 8,
      optional: true,
      items: [
        { key: "q", label: "Question", kind: "text", max: 120 },
        { key: "a", label: "Answer", kind: "long", max: 500 },
      ],
    },
    { key: "form_title", label: "Form heading", kind: "text", max: 80 },
    { key: "form_note", label: "Under the form heading", kind: "long", max: 200, optional: true },
    { key: "form_button", label: "Form button", kind: "text", max: 40 },
    { key: "thanks", label: "After sending", kind: "text", max: 160 },
    { key: "footer", label: "Footer", kind: "text", max: 160, optional: true },
  ],
  fill(offer: Offer, o) {
    const faq = [
      ...(offer.days ? [{ q: "How long does it take?", a: `${offer.days} days.` }] : []),
      { q: "What does it cost?", a: priceLine(offer.price) },
    ];
    return {
      headline: cut(offer.promise, 90),
      sub: cut(`For ${o.audience?.trim() || offer.audience}`.replace(/\.?$/, "."), 240),
      cta: offer.application ? "See if you fit" : "Talk to us",
      book_label: offer.booking ? "Book a call" : "",
      book_url: offer.booking ?? "",
      proof: [],
      get_title: "What you get",
      get: offer.youGet.slice(0, 8),
      steps_title: "How it works",
      steps: ["Send the form.", "We talk it through on a short call.", "You decide."],
      give: offer.youGive.slice(0, 6),
      price: priceLine(offer.price),
      guarantee: offer.guarantee ?? "",
      faq,
      form_title: "See if it fits",
      form_note: "",
      form_button: "Send",
      thanks: "Thanks. We'll be in touch soon.",
      footer: offer.name,
    };
  },
  head: (c) => ({ title: str(c, "headline"), description: str(c, "sub") }),
  body(c, ctx) {
    const list = (key: string, cls: string, tag = "ul") => {
      const xs = lines(c, key);
      return xs.length
        ? `<${tag} class="${cls}">${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</${tag}>`
        : "";
    };
    const book = str(c, "book_url") && str(c, "book_label");
    const faq = items(c, "faq").filter((f) => f.q && f.a);
    const terms = [str(c, "price"), str(c, "guarantee")].filter(Boolean);
    return [
      `<header class="hero"><h1>${esc(str(c, "headline"))}</h1>`,
      `<p class="lede">${para(str(c, "sub"))}</p>`,
      `<p class="actions">${button(str(c, "cta"), "#form", "cta")}${
        book ? button(str(c, "book_label"), str(c, "book_url"), "book", true) : ""
      }</p></header>`,
      lines(c, "proof").length
        ? `<section class="proof">${list("proof", "proof-list")}</section>`
        : "",
      `<section><h2>${esc(str(c, "get_title"))}</h2>${list("get", "ticks")}</section>`,
      `<section><h2>${esc(str(c, "steps_title"))}</h2>${list("steps", "steps", "ol")}</section>`,
      lines(c, "give").length
        ? `<section><h2>What you put in</h2>${list("give", "dots")}</section>`
        : "",
      terms.length
        ? `<section class="terms"><h2>Terms</h2>${terms.map((t) => `<p>${para(t)}</p>`).join("")}</section>`
        : "",
      faq.length
        ? `<section><h2>Questions</h2>${faq
            .map(
              (f) =>
                `<details><summary>${esc(f.q ?? "")}</summary><p>${para(f.a ?? "")}</p></details>`,
            )
            .join("")}</section>`
        : "",
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
