import { describe, expect, it } from "vitest";
import {
  defineOffer,
  fits,
  invalidAnswers,
  OFFERS,
  type Offer,
  offerFacts,
  offerFor,
  registry,
  type snapshot,
} from "./index.js";
import { snapshotText } from "./snapshot.js";

const base: Offer = {
  id: "test-offer",
  name: "Test",
  status: "live",
  audience: "Someone.",
  promise: "Something.",
  price: { kind: "quoted" },
  slots: null,
  days: null,
  youGet: ["A thing."],
  youGive: [],
  weGet: [],
  guarantee: null,
  measures: [{ key: "things", label: "Things", unit: "count" }],
  next: [],
  page: null,
  booking: null,
  application: null,
};
const offer = (o: Partial<Offer>): Offer => ({ ...base, ...o });

const app: NonNullable<Offer["application"]> = {
  questions: [
    {
      id: "size",
      ask: "Size?",
      kind: "one",
      required: true,
      choices: [
        { id: "small", label: "Small" },
        { id: "big", label: "Big" },
      ],
    },
    {
      id: "pains",
      ask: "Pains?",
      kind: "many",
      required: true,
      choices: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    },
    { id: "note", ask: "Note?", kind: "text", placeholder: "", required: false },
  ],
  fit: [{ question: "size", anyOf: ["big"] }],
};

describe("defineOffer", () => {
  it("accepts a well-formed offer", () => {
    expect(defineOffer(offer({ application: app })).id).toBe("test-offer");
  });
  it("takes a nested page: the service, then the offer", () => {
    expect(defineOffer(offer({ page: "/recruiting/lead-reactivation" })).page).toBe(
      "/recruiting/lead-reactivation",
    );
  });
  it.each([
    ["a non-kebab id", offer({ id: "Test_Offer" }), /kebab-case/],
    ["a free offer that takes nothing back", offer({ price: { kind: "free" } }), /weGet/],
    ["no measures", offer({ measures: [] }), /measure/],
    ["zero slots", offer({ slots: 0 }), /slots/],
    ["a self-loop", offer({ next: ["test-offer"] }), /itself/],
    ["a page that is not a path", offer({ page: "recruiting" }), /site path/],
    ["a page with a trailing slash", offer({ page: "/recruiting/" }), /site path/],
    ["a page with an underscore", offer({ page: "/recruiting/lead_reactivation" }), /site path/],
    ["an http booking link", offer({ booking: "http://cal.com/x" }), /https/],
    [
      "a fixed price with no range",
      offer({ price: { kind: "fixed", upfront: null, monthly: null } }),
      /range/,
    ],
    [
      "a fit rule on an unknown question",
      offer({ application: { ...app, fit: [{ question: "nope", anyOf: ["x"] }] } }),
      /unknown question/,
    ],
    [
      "a fit rule naming an unknown choice",
      offer({ application: { ...app, fit: [{ question: "size", anyOf: ["huge"] }] } }),
      /huge/,
    ],
    [
      "a fit rule on an optional question",
      offer({
        application: {
          questions: app.questions.map((q) => (q.id === "size" ? { ...q, required: false } : q)),
          fit: app.fit,
        },
      }),
      /optional/,
    ],
  ])("refuses %s", (_, o, err) => {
    expect(() => defineOffer(o)).toThrow(err);
  });
});

describe("registry", () => {
  it("refuses a ladder to an unknown offer", () => {
    expect(() => registry([offer({ next: ["ghost"] })])).toThrow(/unknown offer 'ghost'/);
  });
  it("refuses a ladder that loops", () => {
    expect(() =>
      registry([offer({ id: "a", next: ["b"] }), offer({ id: "b", next: ["a"] })]),
    ).toThrow(/loops: a -> b -> a/);
  });
  it("refuses two live offers on one page", () => {
    expect(() =>
      registry([offer({ id: "a", page: "/x" }), offer({ id: "b", page: "/x" })]),
    ).toThrow(/both claim page '\/x'/);
  });
  it("lets a draft share a page with the live offer it will replace", () => {
    expect(() =>
      registry([offer({ id: "a", page: "/x" }), offer({ id: "b", page: "/x", status: "draft" })]),
    ).not.toThrow();
  });
  it("refuses a live offer leading to a retired one", () => {
    expect(() =>
      registry([offer({ id: "a", next: ["b"] }), offer({ id: "b", status: "retired" })]),
    ).toThrow(/retired/);
  });
  it("resolves every registered offer by id", () => {
    for (const o of OFFERS) expect(offerFor(o.id)).toBe(o);
    expect(() => offerFor("nope")).toThrow(/registered: /);
  });
});

describe("applications", () => {
  const o = offer({ application: app });
  it("fits when every gate passes", () => {
    expect(fits(o, { size: "big", pains: ["a"] })).toBe(true);
    expect(fits(o, { size: "small", pains: ["a"] })).toBe(false);
    expect(fits(o, {})).toBe(false);
    expect(fits(offer({}), {})).toBe(true);
  });
  it("finds the first problem with an application", () => {
    expect(invalidAnswers(o, { size: "big", pains: ["a", "b"] })).toBeNull();
    expect(invalidAnswers(o, { size: "big" })).toMatch(/'pains' is required/);
    expect(invalidAnswers(o, { size: ["big", "small"], pains: ["a"] })).toMatch(/one choice/);
    expect(invalidAnswers(o, { size: "huge", pains: ["a"] })).toMatch(/no choice 'huge'/);
    expect(invalidAnswers(o, { size: "big", pains: ["a"], extra: "x" })).toMatch(/unknown/);
    expect(invalidAnswers(o, { size: "big", pains: ["a"], note: ["x"] })).toMatch(/text/);
    expect(invalidAnswers(offer({}), {})).toMatch(/no application/);
  });
});

describe("offerFacts", () => {
  it("gives copy the terms the offer sets, and nothing it leaves null", () => {
    expect(offerFacts(offer({ days: 30, slots: 3, page: "/x" }))).toEqual({
      "offer.name": "Test",
      "offer.days": "30",
      "offer.slots": "3",
      "offer.page": "/x",
    });
    expect(offerFacts(offer({}))).toEqual({ "offer.name": "Test" });
  });
});

describe("snapshot", () => {
  it("round-trips the registry as JSON", () => {
    const parsed = JSON.parse(snapshotText(OFFERS)) as ReturnType<typeof snapshot>;
    expect(parsed.version).toBe(1);
    expect(parsed.offers).toEqual(OFFERS);
  });
});
