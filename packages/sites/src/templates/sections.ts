/**
 * The section library: the blocks a Sections page (`page`) is made of, in any order. Each block
 * has its own copy fields, checked like a template's, sample words for the Library, and its
 * render. Blocks are code, reviewed in git; a page's sections are data.
 */
import { button, esc, formBlock, items, lines, para, str } from "./parts.js";
import type { Content, CopyField, RenderContext } from "./types.js";

export interface SectionType {
  type: string;
  name: string;
  blurb: string;
  fields: readonly CopyField[];
  /** Words the Library's preview and a new section start from. */
  sample: Content;
  render(c: Content, ctx: RenderContext): string;
}

const ul = (xs: string[], cls: string, tag = "ul") =>
  xs.length
    ? `<${tag} class="${cls}">${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</${tag}>`
    : "";
const h2 = (s: string) => (s ? `<h2>${esc(s)}</h2>` : "");

const hero: SectionType = {
  type: "hero",
  name: "Hero",
  blurb: "The headline, a line under it, the button and an optional booking button.",
  fields: [
    { key: "headline", label: "Headline", kind: "text", max: 90 },
    { key: "sub", label: "Under the headline", kind: "long", max: 240 },
    { key: "cta", label: "Button", kind: "text", max: 40, hint: "Goes to the form." },
    { key: "book_label", label: "Booking button", kind: "text", max: 40, optional: true },
    { key: "book_url", label: "Booking link", kind: "url", max: 300, optional: true },
  ],
  sample: {
    headline: "Get ten booked calls in 30 days",
    sub: "For owners who want a full calendar without hiring.",
    cta: "See if you fit",
    book_label: "",
    book_url: "",
  },
  render(c) {
    const book = str(c, "book_url") && str(c, "book_label");
    return `<header class="hero"><h1>${esc(str(c, "headline"))}</h1>
<p class="lede">${para(str(c, "sub"))}</p>
<p class="actions">${button(str(c, "cta"), "#form", "cta")}${
      book ? button(str(c, "book_label"), str(c, "book_url"), "book", true) : ""
    }</p></header>`;
  },
};

const text: SectionType = {
  type: "text",
  name: "Text",
  blurb: "A heading and a few paragraphs.",
  fields: [
    { key: "heading", label: "Heading", kind: "text", max: 80, optional: true },
    { key: "body", label: "Text", kind: "long", max: 1500 },
  ],
  sample: {
    heading: "Why this works",
    body: "Most leads go cold in a day. We answer in five minutes.",
  },
  render: (c) =>
    `<section>${h2(str(c, "heading"))}${str(c, "body")
      .split(/\n{2,}/)
      .map((p) => `<p>${para(p)}</p>`)
      .join("")}</section>`,
};

const list: SectionType = {
  type: "list",
  name: "List",
  blurb: "A heading and ticked lines: what you get, who it's for.",
  fields: [
    { key: "heading", label: "Heading", kind: "text", max: 60 },
    { key: "items", label: "Lines", kind: "lines", max: 10 },
  ],
  sample: { heading: "What you get", items: ["A lander per offer", "Replies within five minutes"] },
  render: (c) => `<section>${h2(str(c, "heading"))}${ul(lines(c, "items"), "ticks")}</section>`,
};

const steps: SectionType = {
  type: "steps",
  name: "Steps",
  blurb: "How it works, numbered.",
  fields: [
    { key: "heading", label: "Heading", kind: "text", max: 60 },
    { key: "steps", label: "Steps", kind: "lines", max: 6 },
  ],
  sample: {
    heading: "How it works",
    steps: ["Send the form.", "We talk it through on a short call.", "You decide."],
  },
  render: (c) =>
    `<section>${h2(str(c, "heading"))}${ul(lines(c, "steps"), "steps", "ol")}</section>`,
};

const proof: SectionType = {
  type: "proof",
  name: "Proof",
  blurb: "Short lines of what's true: results and numbers.",
  fields: [
    { key: "lines", label: "Proof lines", kind: "lines", max: 5, hint: "Only what's true." },
  ],
  sample: { lines: ["Live in two weeks", "Every reply read by a person"] },
  render: (c) => `<section class="proof">${ul(lines(c, "lines"), "proof-list")}</section>`,
};

const quote: SectionType = {
  type: "quote",
  name: "Quote",
  blurb: "One customer's words, with their name.",
  fields: [
    { key: "quote", label: "Quote", kind: "long", max: 400, hint: "Their words, with their OK." },
    { key: "who", label: "Name", kind: "text", max: 80 },
    { key: "role", label: "Role or company", kind: "text", max: 80, optional: true },
  ],
  sample: { quote: "We stopped losing leads overnight.", who: "Sam Lee", role: "Owner" },
  render: (c) =>
    `<section class="quote"><blockquote><p>${para(str(c, "quote"))}</p><footer>${esc(str(c, "who"))}${
      str(c, "role") ? `, ${esc(str(c, "role"))}` : ""
    }</footer></blockquote></section>`,
};

const terms: SectionType = {
  type: "terms",
  name: "Terms",
  blurb: "The price and the guarantee.",
  fields: [
    { key: "heading", label: "Heading", kind: "text", max: 60 },
    { key: "price", label: "Price", kind: "long", max: 200, optional: true },
    { key: "guarantee", label: "Guarantee", kind: "long", max: 300, optional: true },
  ],
  sample: { heading: "Terms", price: "Priced on the call.", guarantee: "" },
  render(c) {
    const xs = [str(c, "price"), str(c, "guarantee")].filter(Boolean);
    return xs.length
      ? `<section class="terms">${h2(str(c, "heading"))}${xs.map((t) => `<p>${para(t)}</p>`).join("")}</section>`
      : "";
  },
};

const faq: SectionType = {
  type: "faq",
  name: "Questions",
  blurb: "Questions and answers that fold open.",
  fields: [
    { key: "heading", label: "Heading", kind: "text", max: 60 },
    {
      key: "faq",
      label: "Questions",
      kind: "items",
      max: 8,
      items: [
        { key: "q", label: "Question", kind: "text", max: 120 },
        { key: "a", label: "Answer", kind: "long", max: 500 },
      ],
    },
  ],
  sample: { heading: "Questions", faq: [{ q: "How long does it take?", a: "Two weeks." }] },
  render(c) {
    const xs = items(c, "faq").filter((f) => f.q && f.a);
    return xs.length
      ? `<section>${h2(str(c, "heading"))}${xs
          .map(
            (f) =>
              `<details><summary>${esc(f.q ?? "")}</summary><p>${para(f.a ?? "")}</p></details>`,
          )
          .join("")}</section>`
      : "";
  },
};

const cta: SectionType = {
  type: "cta",
  name: "Call to action",
  blurb: "A line that asks, and the button again.",
  fields: [
    { key: "heading", label: "Heading", kind: "text", max: 90 },
    { key: "sub", label: "Under it", kind: "long", max: 240, optional: true },
    { key: "cta", label: "Button", kind: "text", max: 40, hint: "Goes to the form." },
    { key: "book_label", label: "Booking button", kind: "text", max: 40, optional: true },
    { key: "book_url", label: "Booking link", kind: "url", max: 300, optional: true },
  ],
  sample: {
    heading: "Ready when you are",
    sub: "",
    cta: "Talk to us",
    book_label: "",
    book_url: "",
  },
  render(c) {
    const book = str(c, "book_url") && str(c, "book_label");
    return `<section class="cta">${h2(str(c, "heading"))}${
      str(c, "sub") ? `<p>${para(str(c, "sub"))}</p>` : ""
    }<p class="actions">${button(str(c, "cta"), "#form", "cta")}${
      book ? button(str(c, "book_label"), str(c, "book_url"), "book", true) : ""
    }</p></section>`;
  },
};

const form: SectionType = {
  type: "form",
  name: "Form",
  blurb: "The form that enters the page's door. One per page.",
  fields: [
    { key: "form_title", label: "Form heading", kind: "text", max: 80 },
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
  ],
  sample: {
    form_title: "See if it fits",
    form_note: "",
    form_button: "Send",
    form: "",
    thanks: "Thanks. We'll be in touch soon.",
  },
  render: (c, ctx) =>
    formBlock(
      {
        title: str(c, "form_title"),
        note: str(c, "form_note"),
        button: str(c, "form_button"),
        thanks: str(c, "thanks"),
      },
      ctx,
    ),
};

const footer: SectionType = {
  type: "footer",
  name: "Footer",
  blurb: "One line at the bottom.",
  fields: [{ key: "text", label: "Footer", kind: "text", max: 160 }],
  sample: { text: "Wren Automation, Toronto" },
  render: (c) => `<footer>${esc(str(c, "text"))}</footer>`,
};

/** Every block, in the order "Add a section" lists them. */
export const SECTIONS: readonly SectionType[] = [
  hero,
  text,
  list,
  steps,
  proof,
  quote,
  terms,
  faq,
  cta,
  form,
  footer,
];

export const sectionOf = (type: unknown): SectionType | undefined =>
  SECTIONS.find((s) => s.type === type);

/** A page holds this many sections at most. */
export const SECTIONS_MAX = 20;
