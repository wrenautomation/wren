import { describe, expect, it } from "vitest";
import { checkSource, parseKind, renderKind, sampleRender, squeeze } from "./kinds.js";
import { AuthoringError, toSource } from "./parse.js";
import { MissingFactError } from "./tree.js";

/** Texts and DMs before the slot module: their own field regex, then squeeze. The parity reference. */
function oldRender(body: string, fields: Record<string, string | null>): string {
  return body
    .replace(/\{([a-z_]+)(?:\|([^}]*))?\}/g, (_all, name: string, fallback: string | undefined) => {
      const value = fields[name]?.trim();
      if (value) return value;
      if (fallback !== undefined) return fallback;
      throw new Error(`no value for {${name}} and no fallback`);
    })
    .replace(/[ \t]+/g, " ")
    .trim();
}

const BODIES = [
  "Hi {first_name|there}, this is {sender} from Example Co. Reply STOP to opt out.",
  "{first_name|Hey}! Quick one about {company|your firm}.\n\nWorth a call this week?",
  "Hi {first_name|there},  see you at {time}.   {sender}",
  "No fields at all, just words: 50% off, (maybe) a deal & more.",
  "Thanks {first_name|}. {sender}",
  "Line one\nLine two {company|}\n  indented {sender}",
];
const FIELD_SETS: Record<string, string | null>[] = [
  { first_name: "Dana", company: "Northwind", sender: "Sam", time: "2:30 PM" },
  { first_name: null, company: null, sender: "Sam", time: "9:00 AM" },
  { first_name: "  ", company: "", sender: "Sam", time: "noon" },
];

describe("text kinds render as texts and DMs always did", () => {
  for (const kind of ["sms", "dm"] as const)
    for (const body of BODIES)
      for (const fields of FIELD_SETS)
        it(`${kind}: ${JSON.stringify(body).slice(0, 40)} with ${fields.first_name}`, () => {
          const tpl = parseKind(kind, "t", body);
          expect(renderKind(kind, tpl, fields, "seed").body).toBe(oldRender(body, fields));
        });

  it("a required field with no value still refuses", () => {
    const tpl = parseKind("sms", "t", "Hi {first_name}");
    expect(() => renderKind("sms", tpl, { first_name: null }, "s")).toThrow(MissingFactError);
  });

  it("a text gets variants and optional runs, picked by who it's for", () => {
    const tpl = parseKind("sms", "t", "[[Hi | Hey]] {first_name|there}((, from {company})).");
    const a = renderKind("sms", tpl, { first_name: "Dana", company: null }, "contact:1");
    expect(["Hi Dana.", "Hey Dana."]).toContain(a.body);
    expect(a.provenance.picks).toHaveProperty("v1");
    expect(renderKind("sms", tpl, { first_name: "Dana", company: null }, "contact:1").body).toBe(
      a.body,
    );
  });
});

describe("prompts", () => {
  it("go out byte for byte, braces escaped, an optional run dropping cleanly", () => {
    const source =
      'Write to {who}((, who moved to {moved_to})).\n\nReturn JSON:\n{{"subject": "..."}\n';
    const tpl = parseKind("prompt", "p", source);
    expect(renderKind("prompt", tpl, { who: "Dana", moved_to: null }, "x").body).toBe(
      'Write to Dana.\n\nReturn JSON:\n{"subject": "..."}\n',
    );
    expect(renderKind("prompt", tpl, { who: "Dana", moved_to: "Acme" }, "x").body).toBe(
      'Write to Dana, who moved to Acme.\n\nReturn JSON:\n{"subject": "..."}\n',
    );
    expect(toSource(tpl)).toBe(source);
  });

  it("keep markdown headings and leading space", () => {
    const source = "  # Heading\n## Sub\n\n- {item}\n";
    const tpl = parseKind("prompt", "p", source);
    expect(renderKind("prompt", tpl, { item: "x" }, "s").body).toBe("  # Heading\n## Sub\n\n- x\n");
  });

  it("take facts exactly: spaces kept, an empty one said, only null missing", () => {
    const tpl = parseKind("prompt", "p", "[[{a} | {b}]] and {c|them}");
    expect(renderKind("prompt", tpl, { a: "  x ", b: null, c: "" }, "s").body).toBe("  x  and ");
    expect(renderKind("prompt", tpl, { a: null, b: "y", c: null }, "s").body).toBe("y and them");
    // A text still trims a fact and reads "" as missing.
    expect(renderKind("sms", parseKind("sms", "t", "{c|them}"), { c: " " }, "s").body).toBe("them");
  });

  it("are saved as written, ends and all", () => {
    expect(checkSource("prompt", "p", "  Ask {who}.\n")?.source).toBe("  Ask {who}.\n");
  });
});

describe("checkSource", () => {
  const rules = { fields: ["first_name", "sender"], mustSayStop: true, minLength: 1 };
  it("trims a text, and empty is no template", () => {
    expect(checkSource("sms", "k", "  Hi {sender}. STOP to end.  ", rules)?.source).toBe(
      "Hi {sender}. STOP to end.",
    );
    expect(checkSource("sms", "k", "   ", rules)).toBeNull();
  });
  it("refuses a field the slot doesn't offer", () => {
    expect(() => checkSource("sms", "k", "Hi {company}. STOP", rules)).toThrow(/unknown field/);
    expect(() => checkSource("sms", "k", "Hi {x}", { fields: [] })).toThrow(/takes no fields/);
  });
  it("refuses a first text without STOP, a short or a long one", () => {
    expect(() => checkSource("sms", "k", "Hi {sender}", rules)).toThrow(/STOP/);
    expect(() => checkSource("sms", "k", "Hi", { minLength: 20 })).toThrow(/at least 20/);
    expect(() => checkSource("dm", "k", "x".repeat(201), { maxLength: 200 })).toThrow(/at most/);
  });
  it("refuses a prompt slot outside an email, and a mark that doesn't parse", () => {
    expect(() => checkSource("dm", "k", "Hi <<say hello>>")).toThrow(AuthoringError);
    expect(() => checkSource("sms", "k", "Hi {first_name")).toThrow(/unclosed/);
    expect(checkSource("email", "k", "subject: hi\n\n<<say hello>>\n")).not.toBeNull();
  });
});

describe("sampleRender", () => {
  it("puts an email's subject over its body", () => {
    const tpl = parseKind("email", "e", "subject: Hi {first_name|there}\n\nBody {company|}.\n");
    expect(sampleRender("email", tpl, { first_name: "Dana" })).toBe("Hi Dana\n\nBody.");
  });
  it("squeezes a text", () => {
    expect(squeeze("  a \t b  ")).toBe("a b");
  });
});
