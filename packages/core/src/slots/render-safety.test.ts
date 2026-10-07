/**
 * Template words are data, never code (designs/2026-10-07-templates-live-copy.md, safety): a
 * hostile slot renders as words or is refused, facts are read from their own keys only, and the
 * renderer never evaluates anything.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseKind, renderKind, type TEMPLATE_KINDS } from "./kinds.js";
import { AuthoringError } from "./parse.js";
import { MissingFactError } from "./tree.js";

const FACTS = { first_name: "Dana", sender: "Sam" };
const render = (
  kind: (typeof TEMPLATE_KINDS)[number],
  source: string,
  facts: Record<string, unknown> = FACTS,
) => renderKind(kind, parseKind(kind, "t", source), facts, "seed").body;

describe("hostile slots", () => {
  it("never reads an inherited property as a fact", () => {
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(() => render("sms", `Hi {${key}}. STOP`)).toThrow(MissingFactError);
      expect(render("sms", `Hi {${key}|friend}. STOP`)).toBe("Hi friend. STOP");
    }
  });

  it("refuses a call or an expression as a fact name", () => {
    for (const source of ["{a.b()}", "{first_name + 1}", "{process.exit(1)}", "{x;y}"])
      expect(() => parseKind("email", "t", `Subject: s\n\n${source}`)).toThrow(AuthoringError);
  });

  it("keeps other template syntaxes as plain words", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a hostile source, on purpose
    expect(render("dm", "Pay ${first_name} now")).toBe("Pay $Dana now");
    expect(render("dm", "Hi {{first_name}}")).toBe("Hi {first_name}}");
    expect(render("dm", "Hi <%= first_name %> and {{7*7}}")).toBe(
      "Hi <%= first_name %> and {7*7}}",
    );
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a hostile source, on purpose
    expect(() => render("post", "Sum: ${1+1}")).toThrow(AuthoringError);
  });

  it("drops control characters a fact carries into a text, a DM or a post", () => {
    const facts = { first_name: "Da\rna\u0007\u001b[31m", sender: "Sam" };
    for (const kind of ["sms", "dm", "post"] as const)
      expect(render(kind, "Hi {first_name}. STOP", facts)).toBe("Hi Dana[31m. STOP");
  });

  it("keeps an email subject on one line whatever a fact holds", () => {
    const tpl = parseKind("email", "t", "Subject: Hi {first_name}\n\nBody");
    const out = renderKind("email", tpl, { first_name: "Dana\r\nBcc: x@example.com" }, "seed");
    expect(out.subject).toBe("Hi Dana Bcc: x@example.com");
    expect(out.subject).not.toMatch(/[\r\n]/);
  });

  it("never imports an evaluator", () => {
    const dir = new URL(".", import.meta.url);
    for (const file of readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    )) {
      const code = readFileSync(new URL(file, dir), "utf8");
      expect(code, file).not.toMatch(
        /\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(|node:vm|from "vm"/,
      );
    }
  });
});
