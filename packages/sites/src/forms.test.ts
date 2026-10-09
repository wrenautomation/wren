import { OFFERS } from "@wren/offers";
import { describe, expect, it } from "vitest";
import { consentVersion } from "./form-store.js";
import {
  CONSENT_KEY,
  checkEntry,
  consentOf,
  consentWords,
  defaultSpec,
  FormProblem,
  type FormSpec,
  formHtml,
  keyOf,
  parseSpec,
  shows,
} from "./forms.js";
import { embedSnippets, KIT_JS, kitJs } from "./kit.js";
import { formUrl } from "./model.js";
import { renderFormPage, renderPage } from "./render.js";
import { templateOf } from "./templates/index.js";

const ID = "0b5c2a59-9a3e-4c47-9a35-0f1f2b6c1d11";

const quote: FormSpec = parseSpec({
  title: "Get a quote",
  intro: "Two minutes.",
  button: "Send",
  fields: [
    { kind: "text", label: "Name", required: true, max: 80 },
    { kind: "email", label: "Email", required: true },
    { kind: "phone", label: "Phone" },
    { kind: "select", label: "Service", options: ["Repair", "Install"], required: true },
    { kind: "multi", label: "Rooms", options: "Kitchen\nBath\nKitchen" },
    { kind: "date", label: "Start date" },
    { kind: "text", label: "Zip", rule: "zip" },
    { kind: "consent", label: consentWords("Acme Plumbing") },
    { key: "utm_source", kind: "hidden" },
  ],
  after: { kind: "thanks", text: "Thanks. We'll text you soon." },
  booking: { url: "/book", label: "Pick a time" },
});

describe("form specs", () => {
  it("keeps a good spec and fills keys from labels", () => {
    expect(quote.fields.map((f) => f.key)).toEqual([
      "name",
      "email",
      "phone",
      "service",
      "rooms",
      "start_date",
      "zip",
      CONSENT_KEY,
      "utm_source",
    ]);
    expect(quote.fields.find((f) => f.key === "rooms")?.options).toEqual(["Kitchen", "Bath"]);
    expect(quote.booking).toEqual({ url: "/book", label: "Pick a time" });
    expect(parseSpec(defaultSpec("Acme"))).toEqual(defaultSpec("Acme"));
  });

  it("refuses what can't be kept", () => {
    const base = { title: "T", fields: [{ kind: "email", label: "Email" }] };
    expect(() => parseSpec({ ...base, title: "" })).toThrow(FormProblem);
    expect(() => parseSpec({ title: "T", fields: [{ kind: "text", label: "Name" }] })).toThrow(
      /email or a phone/,
    );
    expect(() =>
      parseSpec({ ...base, fields: [...base.fields, { kind: "email", label: "Email" }] }),
    ).toThrow(/share the key/);
    expect(() =>
      parseSpec({ ...base, fields: [...base.fields, { kind: "regex", label: "X" }] }),
    ).toThrow(/no such kind/);
    expect(() =>
      parseSpec({ ...base, fields: [...base.fields, { kind: "select", label: "X" }] }),
    ).toThrow(/choice/);
    expect(() =>
      parseSpec({ ...base, fields: [...base.fields, { kind: "text", label: "X", rule: "(a+)+" }] }),
    ).toThrow(/no such rule/);
    expect(() =>
      parseSpec({ ...base, after: { kind: "redirect", url: "javascript:alert(1)" } }),
    ).toThrow(/redirect/);
    expect(() =>
      parseSpec({
        ...base,
        fields: [...base.fields, { kind: "consent", label: "a" }, { kind: "consent", label: "b" }],
      }),
    ).toThrow(FormProblem);
    expect(() =>
      parseSpec({ ...base, fields: [...base.fields, { key: "form", kind: "text", label: "x" }] }),
    ).toThrow(/key/);
  });

  it("makes keys from labels", () => {
    expect(keyOf("Best time to call?")).toBe("best_time_to_call");
    expect(keyOf("3 things")).toBe("f_3_things");
    expect(keyOf("!!!")).toBe("");
  });
});

describe("checking a submit", () => {
  const good = {
    name: " Pat Lee ",
    email: "pat@example.com",
    phone: "(555) 010-0000",
    service: "Repair",
    rooms: ["Kitchen", "Bath"],
    start_date: "2026-11-02",
    zip: "02139",
    sms_consent: "yes",
    utm_source: "google",
    extra: "dropped",
  };

  it("keeps the spec's fields only, trimmed, multi joined", () => {
    const { values, errors } = checkEntry(quote, good);
    expect(errors).toEqual({});
    expect(values).toEqual({
      name: "Pat Lee",
      email: "pat@example.com",
      phone: "(555) 010-0000",
      service: "Repair",
      rooms: "Kitchen, Bath",
      start_date: "2026-11-02",
      zip: "02139",
      sms_consent: "yes",
      utm_source: "google",
    });
  });

  it("names each bad field", () => {
    const { errors } = checkEntry(quote, {
      ...good,
      name: "",
      email: "pat@",
      phone: "12",
      service: "Demolition",
      rooms: "Kitchen, Garage",
      start_date: "2026-02-30",
      zip: "abc",
    });
    expect(Object.keys(errors).sort()).toEqual(
      ["email", "name", "phone", "rooms", "service", "start_date", "zip"].sort(),
    );
  });

  it("leaves consent out unless ticked, and needs a way to reach them", () => {
    const loose = parseSpec({
      title: "T",
      fields: [
        { kind: "email", label: "Email" },
        { kind: "phone", label: "Phone" },
        { kind: "consent", label: "Text me" },
      ],
    });
    expect(checkEntry(loose, { email: "a@b.co" }).values).toEqual({ email: "a@b.co" });
    expect(checkEntry(loose, {}).errors).toEqual({ email: "Add an email or a phone number." });
  });
});

describe("consent", () => {
  it("names the business in TCPA words and versions them", () => {
    const words = consentWords("Acme Plumbing");
    expect(words).toContain("Acme Plumbing");
    expect(words).toContain("Reply STOP");
    expect(words).toContain("not a condition of purchase");
    expect(consentOf(quote)).toBe(words);
    expect(consentVersion(words)).toMatch(/^[0-9a-f]{12}$/);
    expect(consentVersion(` ${words} `)).toBe(consentVersion(words));
    expect(consentVersion(consentWords("Other Co"))).not.toBe(consentVersion(words));
  });
});

describe("rendering a form", () => {
  it("draws every kind, escaped, with its after and booking", () => {
    const html = formHtml(
      { ...quote, title: "<b>x</b>", button: "Go <now>" },
      { form: ID, base: "" },
    );
    expect(html).toContain(`data-form="${ID}"`);
    expect(html).toContain(`data-thanks="Thanks. We&#39;ll text you soon."`);
    expect(html).toContain(`data-booking="/book"`);
    expect(html).toContain(`<select id=`);
    expect(html).toContain(`<fieldset class="multi"`);
    expect(html).toContain(`type="date"`);
    expect(html).toContain(`data-q="utm_source"`);
    expect(html).toContain(`name="sms_consent" value="yes"`);
    expect(html).toContain("Go &lt;now&gt;");
    expect(html).toContain(`name="website"`);
  });

  it("serves a hosted page with the kit naming the form", () => {
    const page = renderFormPage(quote, { form: ID, base: "" });
    expect(page).toContain(`data-form="${ID}" defer`);
    expect(page).toContain("<h1>Get a quote</h1>");
    const framed = renderFormPage(quote, { form: ID, base: "", embed: true });
    expect(framed).toContain("data-framed");
    expect(framed).toContain('class="form-page embed"');
  });

  it("puts a hosted form in a page's form section", () => {
    const t = templateOf("lander");
    const offer = OFFERS.find((o) => o.status === "live") ?? OFFERS[0];
    if (!offer) throw new Error("no offer registered");
    const content = t.fill(offer, {});
    const plain = renderPage(t, content, { page: ID, base: "", track: false });
    expect(plain).toContain('name="note"');
    const withForm = renderPage(t, content, {
      page: ID,
      base: "",
      track: false,
      form: { id: ID, spec: quote },
    });
    expect(withForm).toContain('name="service"');
    expect(withForm).toContain(`<input type="hidden" name="page" value="${ID}">`);
    expect(withForm).not.toContain('name="note"');
  });
});

describe("show-when rules and steps", () => {
  const job = parseSpec({
    title: "Get a quote",
    button: "Send",
    fields: [
      { kind: "email", label: "Email", required: true },
      { kind: "select", label: "Service", options: ["Repair", "Install"], required: true },
      {
        kind: "text",
        label: "What broke",
        required: true,
        show: { key: "service", op: "is", values: ["repair"] },
      },
      { kind: "step", label: "A few more details" },
      { kind: "phone", label: "Phone", show: { key: "service", op: "not", values: ["Repair"] } },
      { kind: "consent", label: consentWords("Acme"), show: { key: "phone", op: "filled" } },
      { key: "utm_source", kind: "hidden" },
    ],
    after: { kind: "thanks", text: "Thanks." },
  });

  it("keeps rules on fields above and steps by place", () => {
    expect(job.fields.map((f) => f.key)).toEqual([
      "email",
      "service",
      "what_broke",
      "step_4",
      "phone",
      CONSENT_KEY,
      "utm_source",
    ]);
    expect(job.fields[2]?.show).toEqual({ key: "service", op: "is", values: ["repair"] });
    expect(job.fields[5]?.show).toEqual({ key: "phone", op: "filled" });
  });

  it("refuses rules and steps that can't work", () => {
    const base = { title: "T", after: { kind: "thanks", text: "x" } };
    const bad = (fields: unknown[]) => () => parseSpec({ ...base, fields });
    const email = { kind: "email", label: "Email" };
    expect(bad([{ kind: "text", label: "A", show: { key: "email", op: "filled" } }, email])).toThrow(
      /above it/,
    );
    expect(bad([email, { kind: "text", label: "A", show: { key: "email", op: "is" } }])).toThrow(
      /which answer/,
    );
    expect(
      bad([
        email,
        { kind: "select", label: "S", options: ["A"] },
        { kind: "text", label: "B", show: { key: "s", op: "is", values: ["Z"] } },
      ]),
    ).toThrow(/isn't a choice/);
    expect(
      bad([
        { kind: "text", label: "A" },
        { ...email, show: { key: "a", op: "filled" } },
      ]),
    ).toThrow(/always asked/);
    expect(bad([{ kind: "step", label: "x" }, email])).toThrow(/start with a new step/);
    expect(bad([email, { kind: "step", label: "x" }])).toThrow(/end with a new step/);
    expect(
      bad([email, { kind: "step" }, { key: "utm_source", kind: "hidden" }, { kind: "step" }, email]),
    ).toThrow(/two fields share|Step 2 has no questions/i);
    expect(
      bad([email, { key: "utm", kind: "hidden", show: { key: "email", op: "filled" } }]),
    ).toThrow(/can't have a show rule/);
  });

  it("tests a rule in any case", () => {
    expect(shows(undefined, [])).toBe(true);
    expect(shows({ key: "a", op: "is", values: ["Repair"] }, ["repair"])).toBe(true);
    expect(shows({ key: "a", op: "not", values: ["Repair"] }, ["Install"])).toBe(true);
    expect(shows({ key: "a", op: "filled" }, [])).toBe(false);
    expect(shows({ key: "a", op: "empty" }, [])).toBe(true);
  });

  it("asks and keeps only the fields shown", () => {
    const repair = checkEntry(job, {
      email: "a@b.co",
      service: "Repair",
      what_broke: "Sink",
      phone: "555 010 0000",
      sms_consent: "yes",
    });
    expect(repair.errors).toEqual({});
    // Phone was hidden for a repair, so its value and the consent it gated are dropped.
    expect(repair.values).toEqual({ email: "a@b.co", service: "Repair", what_broke: "Sink" });

    const install = checkEntry(job, { email: "a@b.co", service: "Install", phone: "5550100000" });
    expect(install.errors).toEqual({});
    expect(install.values).toEqual({ email: "a@b.co", service: "Install", phone: "5550100000" });

    // A shown required field still needs filling.
    expect(checkEntry(job, { email: "a@b.co", service: "Repair" }).errors).toEqual({
      what_broke: "Fill this in.",
    });
  });

  it("draws one div a step with its heading, and each rule on its field", () => {
    const html = formHtml(job, { form: ID, base: "" });
    expect(html.match(/class="step"/g)).toHaveLength(2);
    expect(html).toContain('<div class="step" data-step="2">\n<h3>A few more details</h3>');
    expect(html).toContain(
      `<label data-show="${'{"key":"service","op":"is","values":["repair"]}'.replace(/"/g, "&quot;")}" for=`,
    );
    expect(html).toMatch(/<label data-show="[^"]+" class="check">/);
    expect(html).not.toContain("step_4");
  });

  it("kit applies rules and steps, and counts a step", () => {
    expect(KIT_JS).toContain('send("step",n)');
    expect(KIT_JS).toContain("[data-show]");
    expect(KIT_JS).toContain("input[required]:not(:disabled)");
  });
});

describe("kit and embed", () => {
  it("bakes in the Turnstile key, or none", () => {
    expect(KIT_JS).toContain("TK=null");
    expect(kitJs("0x4AAA$&")).toContain('TK="0x4AAA$&"');
    expect(kitJs("  ")).toContain("TK=null");
  });

  it("gives an iframe and a script tag for the same form", () => {
    const e = embedSnippets({ origin: "https://example.com", slug: "quote", title: 'A "q"' });
    expect(e.url).toBe(formUrl("example.com", "quote"));
    expect(e.iframe).toContain('src="https://example.com/o/f/quote?embed=1"');
    expect(e.iframe).toContain('title="A q"');
    expect(e.script).toContain('data-embed="quote"');
  });
});
