/** A Sections page: a title, a description and blocks from the library in any order. */
import type { Offer } from "@wren/offers";
import { priceLine } from "./lander.js";
import { str } from "./parts.js";
import { SECTIONS_MAX, sectionOf } from "./sections.js";
import type { Content, SectionValue, Template } from "./types.js";

const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/** The page's sections as stored; anything else reads as none. */
export const sectionsOf = (c: Content): SectionValue[] => {
  const v = c.sections;
  return Array.isArray(v)
    ? v.filter(
        (x): x is SectionValue =>
          !!x && typeof x === "object" && typeof (x as SectionValue).type === "string",
      )
    : [];
};

export const page: Template = {
  id: "page",
  name: "Sections",
  blurb: "Blocks from the library in any order: hero, text, lists, proof, questions, a form.",
  fields: [
    { key: "title", group: "Page", label: "Page title", kind: "text", max: 90 },
    { key: "description", label: "Description", kind: "long", max: 160, optional: true },
    {
      key: "sections",
      group: "Sections",
      label: "Sections",
      kind: "sections",
      max: SECTIONS_MAX,
      hint: "At most one form.",
    },
  ],
  fill(offer: Offer, o) {
    const s = (id: string, type: string, c: Content): SectionValue =>
      ({ id, type, ...c }) as SectionValue;
    return {
      title: cut(offer.promise, 90),
      description: cut(offer.audience, 160),
      sections: [
        s("hero", "hero", {
          headline: cut(offer.promise, 90),
          sub: cut(`For ${o.audience?.trim() || offer.audience}`.replace(/\.?$/, "."), 240),
          cta: offer.application ? "See if you fit" : "Talk to us",
          book_label: offer.booking ? "Book a call" : "",
          book_url: offer.booking ?? "",
        }),
        s("get", "list", { heading: "What you get", items: offer.youGet.slice(0, 10) }),
        s("how", "steps", {
          heading: "How it works",
          steps: ["Send the form.", "We talk it through on a short call.", "You decide."],
        }),
        s("terms", "terms", {
          heading: "Terms",
          price: priceLine(offer.price),
          guarantee: offer.guarantee ?? "",
        }),
        s("form", "form", {
          form_title: "See if it fits",
          form_note: "",
          form_button: "Send",
          form: "",
          thanks: "Thanks. We'll be in touch soon.",
        }),
        s("footer", "footer", { text: offer.name }),
      ],
    };
  },
  head: (c) => ({ title: str(c, "title"), description: str(c, "description") }),
  body: (c, ctx) =>
    sectionsOf(c)
      .map((s) => sectionOf(s.type)?.render(s as Content, ctx) ?? "")
      .filter(Boolean)
      .join("\n"),
};
