/** A file is the email; four marks parse into the block tree, anything else is refused with name and line. */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthoringError, loadTemplates, parseTemplate, toSource } from "./parse.js";
import { enumerateRenders, fieldKeys, placeholderFacts, variantCounts } from "./preview.js";
import {
  alleleKey,
  field,
  MissingFactError,
  optionText,
  render,
  text,
  variantPoints,
} from "./tree.js";

const FACTS = { first_name: "Jane", company_name: "Acme", "company.segment": "retirement" };
const bodies = (t: ReturnType<typeof parseTemplate>, n = 20) =>
  new Set(Array.from({ length: n }, (_, i) => render(t, {}, `s${i}`).body));

describe("parseTemplate", () => {
  it("plain text is one block and no subject", () => {
    const t = parseTemplate("followup", "Bumping this in case it got buried.\n");
    expect(t.subject).toBeNull();
    expect(t.body).toEqual([text("Bumping this in case it got buried.")]);
  });
  it("subject line parses with marks", () => {
    const t = parseTemplate(
      "opener",
      "subject: [[Quick question | A question]], {first_name}\n\nHi.\n",
    );
    const out = render(t, FACTS, "s");
    expect(["Quick question, Jane", "A question, Jane"]).toContain(out.subject);
    expect(out.body).toBe("Hi.");
  });
  it("field with fallback and required field", () => {
    const t = parseTemplate("opener", "Hi {first_name|there}, re {company_name}.");
    expect(t.body[1]).toEqual(field("first_name", "there"));
    expect(render(t, FACTS, "s").body).toBe("Hi Jane, re Acme.");
    expect(render(t, { company_name: "Acme" }, "s").body).toBe("Hi there, re Acme.");
    expect(() => render(t, {}, "s")).toThrow(MissingFactError);
    expect(() => render(t, {}, "s")).toThrow(/company_name/);
  });
  it("empty fallback renders nothing when missing", () => {
    const t = parseTemplate("opener", "Hi{ first_name|}.");
    expect(render(t, {}, "s").body).toBe("Hi.");
    expect(render(t, FACTS, "s").body).toBe("HiJane.");
  });
  it("variant points are auto-named in document order", () => {
    const t = parseTemplate("opener", "subject: [[A | B]] hello\n\n[[x | y | z]] world");
    expect(variantCounts(t)).toEqual({ v1: 2, v2: 3 });
    expect(Object.keys(render(t, {}, "s").provenance.picks).sort()).toEqual(["v1", "v2"]);
  });
  it("a pipe inside a field does not split the variant", () => {
    const t = parseTemplate("opener", "[[Hi {first_name|there} | Hello]].");
    expect(variantCounts(t)).toEqual({ v1: 2 });
    expect(bodies(t)).toEqual(new Set(["Hi there.", "Hello."]));
  });
  it("optional segment drops with its facts", () => {
    const t = parseTemplate(
      "opener",
      "I found {company_name}((, and saw you work with {company.segment} clients)).",
    );
    expect(render(t, FACTS, "s").body).toBe(
      "I found Acme, and saw you work with retirement clients.",
    );
    expect(render(t, { company_name: "Acme" }, "s").body).toBe("I found Acme.");
  });
  it("variant inside optional segment", () => {
    const t = parseTemplate("opener", "Hi((, [[glad | happy]] to see {company_name})).");
    expect(render(t, {}, "s").body).toBe("Hi.");
    expect(["Hi, glad to see Acme.", "Hi, happy to see Acme."]).toContain(
      render(t, { company_name: "Acme" }, "s").body,
    );
  });
  it("optional segment without facts refused", () => {
    expect(() => parseTemplate("opener", "Hi ((always here)).")).toThrow(/never be absent/);
  });
  it("a paren inside a group does not strand the terminator", () => {
    const t = parseTemplate(
      "opener",
      "Worth a look? ((I liked your {company.segment} work (great site, by the way))) Thanks.",
    );
    expect(render(t, FACTS, "s").body).toBe(
      "Worth a look? I liked your retirement work (great site, by the way) Thanks.",
    );
    const out = render(t, { first_name: "Jane" }, "s").body;
    expect(out).toBe("Worth a look? Thanks.");
  });
  it("unclosed group with inner parenthetical refused", () => {
    expect(() => parseTemplate("opener", "((a (b))")).toThrow(/unclosed \(\( \)\)/);
  });
  it("nesting refused", () => {
    expect(() => parseTemplate("opener", "[[a [[b | c]] | d]]")).toThrow(/nesting/);
    expect(() => parseTemplate("opener", "((x {a} ((y {b})) ))")).toThrow(/nesting/);
  });
  it("unclosed marks name template and line", () => {
    expect(() => parseTemplate("opener", "Hi,\n\nsee {first_name and more\n")).toThrow(
      /opener:3: unclosed \{ \}/,
    );
    expect(() => parseTemplate("opener", "[[a | b")).toThrow(/unclosed \[\[ \]\]/);
    expect(() => parseTemplate("opener", "((x {a}")).toThrow(/unclosed \(\( \)\)/);
  });
  it("bad field name refused", () => {
    expect(() => parseTemplate("opener", "Hi {first name}.")).toThrow(/bad fact name/);
    expect(() => parseTemplate("opener", "Hi {}.")).toThrow(/bad fact name/);
  });
  it("empty option refused", () => {
    expect(() => parseTemplate("opener", "[[a | | b]]")).toThrow(/empty option/);
  });
  it("empty subject line refused", () => {
    expect(() => parseTemplate("opener", "subject:   \n\nHi.")).toThrow(/ride the thread/);
  });
  it("subject near-misses refused", () => {
    expect(() => parseTemplate("opener", " subject: Quick question\n\nHi.\n")).toThrow(
      /opener:1: this line looks like a subject header/,
    );
    expect(() => parseTemplate("opener", "subject : Quick question\n\nHi.\n")).toThrow(
      /opener:1: this line looks like a subject header/,
    );
  });
  it("subject exact form still parses", () => {
    const t = parseTemplate("opener", "subject: Quick question\n\nHi.\n");
    expect(t.subject).not.toBeNull();
    expect(render(t, {}, "s").subject).toBe("Quick question");
  });
  it("empty body refused", () => {
    expect(() => parseTemplate("opener", "subject: Hi\n\n\n")).toThrow(/no body/);
  });
  it("errors are AuthoringError", () => {
    expect(() => parseTemplate("opener", "[[a | b")).toThrow(AuthoringError);
  });
});

describe("comments", () => {
  it("strip everywhere and leave no trace", () => {
    const commented =
      "## authoring note above the subject\n" +
      "subject: Hi {first_name}\n\nHi {first_name|there},\n\n" +
      "## note directly above the paragraph it explains\nWorth a look?\n";
    const bare = "subject: Hi {first_name}\n\nHi {first_name|there},\n\nWorth a look?\n";
    expect(parseTemplate("opener", commented)).toEqual(parseTemplate("opener", bare));
    expect(toSource(parseTemplate("opener", commented))).not.toContain("#");
  });
  it("a hash is prose unless the line opens with a double hash", () => {
    const t = parseTemplate("opener", "#1 in onboarding — we are # 1.\n");
    expect(t.body).toEqual([text("#1 in onboarding — we are # 1.")]);
  });
  it("single-hash comment shape refused", () => {
    expect(() => parseTemplate("opener", "Hi,\n\n# meant this as a note\n")).toThrow(
      /opener:3: .*## — double the hash/,
    );
    expect(() => parseTemplate("opener", "#\nHi.\n")).toThrow(/double the hash/);
  });
  it("error lines survive comment stripping", () => {
    expect(() =>
      parseTemplate("opener", "## one\n## two\nHi,\n\nsee {first_name and more\n"),
    ).toThrow(/opener:5: unclosed \{ \}/);
    expect(() => parseTemplate("opener", "## note\n subject: X\n\nHi.\n")).toThrow(
      /opener:2: this line looks like a subject header/,
    );
  });
  it("a comment-only file has no body", () => {
    expect(() => parseTemplate("opener", "## just notes\n## more notes\n")).toThrow(/no body/);
  });
});

describe("loadTemplates", () => {
  let dir: string;
  const tmp = () => {
    dir = mkdtempSync(join(tmpdir(), "wren-templates-"));
    return dir;
  };
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keys by stem and names bad files", () => {
    const d = tmp();
    writeFileSync(join(d, "opener.email"), "subject: Hi {first_name}\n\nHello.\n");
    writeFileSync(join(d, "followup.email"), "Bump.\n");
    writeFileSync(join(d, "notes.md"), "not a template");
    const templates = loadTemplates(d);
    expect([...templates.keys()].sort()).toEqual(["followup", "opener"]);
    expect(templates.get("opener")?.name).toBe("opener");
    writeFileSync(join(d, "broken.email"), "Hi {first_name\n");
    expect(() => loadTemplates(d)).toThrow(/broken:1/);
  });
  it("an arm is a directory and the root is shared", () => {
    const d = tmp();
    writeFileSync(join(d, "final_followup.email"), "Closing this out.\n");
    mkdirSync(join(d, "pilot"));
    writeFileSync(join(d, "pilot", "opener.email"), "subject: Hi {first_name}\n\nHello.\n");
    writeFileSync(join(d, "pilot", "notes.md"), "not a template");
    const templates = loadTemplates(d);
    expect([...templates.keys()].sort()).toEqual(["final_followup", "pilot/opener"]);
    expect(templates.get("pilot/opener")?.name).toBe("pilot/opener");
    writeFileSync(join(d, "pilot", "broken.email"), "Hi {first_name\n");
    expect(() => loadTemplates(d)).toThrow(/pilot\/broken:1/);
  });
  it("a deeper tree is refused, not guessed at", () => {
    const d = tmp();
    mkdirSync(join(d, "pilot", "v2"), { recursive: true });
    writeFileSync(join(d, "pilot", "v2", "opener.email"), "subject: Hi\n\nHello.\n");
    expect(() => loadTemplates(d)).toThrow(/one level of arm directories only/);
  });
  it("requires the directory", () => {
    const d = tmp();
    expect(() => loadTemplates(join(d, "missing"))).toThrow(/does not exist/);
  });
  it("a BOM-prefixed file parses its subject", () => {
    const d = tmp();
    writeFileSync(join(d, "opener.email"), "﻿subject: Quick question\n\nHi.\n");
    const templates = loadTemplates(d);
    expect(templates.get("opener")?.subject).not.toBeNull();
    expect(render(templates.get("opener") as never, {}, "s").subject).toBe("Quick question");
  });
  it("a mid-file BOM is refused", () => {
    const d = tmp();
    writeFileSync(join(d, "opener.email"), "subject: Quick question\n\nHi ﻿there.\n");
    expect(() => loadTemplates(d)).toThrow(/opener:3/);
  });
});

describe("preview", () => {
  it("placeholder facts render structure without data", () => {
    const t = parseTemplate(
      "opener",
      "Hi {first_name|there}((, at {company_name})). [[a | b]] {company.segment}.",
    );
    expect(fieldKeys(t)).toEqual(["first_name", "company_name", "company.segment"]);
    const out = render(t, placeholderFacts(t), "s");
    expect(out.body).toContain("«first_name»");
    expect(out.body).toContain("«company_name»");
  });
  it("enumerate covers every combination", () => {
    const t = parseTemplate("opener", "subject: [[A | B]] x\n\n[[1 | 2 | 3]] y");
    const outs = [...enumerateRenders(t, {})];
    expect(outs).toHaveLength(6);
    expect(new Set(outs.map(([, r]) => `${r.subject}|${r.body}`)).size).toBe(6);
    expect(outs[0]?.[0]).toEqual({ v1: 0, v2: 0 });
  });
  it("enumerate without variants yields one", () => {
    const outs = [...enumerateRenders(parseTemplate("followup", "Bump {first_name|there}."), {})];
    expect(outs).toHaveLength(1);
    expect(outs[0]?.[1].body).toBe("Bump there.");
  });
});

describe("toSource", () => {
  it("round-trips every construct", () => {
    const source =
      "subject: [[Quick question | A question]] about {company_name}\n\n" +
      "Hi {first_name|there}((, and {extra|} noted, saw {company.segment} clients " +
      "[[glad | happy]] to connect)).\n\nSecond line here with {a.b} field.";
    const t = parseTemplate("synthetic", source);
    expect(parseTemplate(t.name, toSource(t))).toEqual(t);
  });
  it("emits the minimal marks", () => {
    const t = parseTemplate(
      "opener",
      "subject: Hi {company_name}\n\n[[a | b]] {first_name|there}((, {x})).",
    );
    expect(toSource(t)).toBe(
      "subject: Hi {company_name}\n\n[[a | b]] {first_name|there}((, {x})).\n",
    );
  });
});

describe("named loci", () => {
  const plain =
    "subject: [[Quick question | A question]] about {company_name}\n\n[[Hi | Hey]] {first_name|there}.";
  it("keeps an unnamed template's version and auto-names", () => {
    const t = parseTemplate("opener", plain);
    // The version main computed for this source before named loci existed.
    expect(t.version).toBe("13b78200b48e");
    expect([...variantPoints(t.body)].map((p) => [p.name, p.named])).toEqual([["v2", undefined]]);
  });
  it("parses a name, counts it in the auto-names, and changes the version", () => {
    const t = parseTemplate("opener", plain.replace("[[Hi", "[[#greet Hi"));
    expect([...variantPoints([...(t.subject ?? []), ...t.body])].map((p) => p.name)).toEqual([
      "v1",
      "greet",
    ]);
    expect(t.version).not.toBe(parseTemplate("opener", plain).version);
    expect(toSource(t)).toContain("[[#greet Hi | Hey]]");
    expect(parseTemplate(t.name, toSource(t))).toEqual(t);
  });
  it("nameAll writes every point's name and picks stay the same", () => {
    const t = parseTemplate("opener", plain);
    const named = parseTemplate("opener", toSource(t, { nameAll: true }));
    expect(toSource(named)).toContain("[[#v1 Quick question | A question]]");
    for (const seed of ["person:1", "person:2", "person:3", "company:9"]) {
      const facts = { company_name: "Acme", first_name: "Jane" };
      expect(render(named, facts, seed).subject).toBe(render(t, facts, seed).subject);
      expect(render(named, facts, seed).provenance.picks).toEqual(
        render(t, facts, seed).provenance.picks,
      );
    }
  });
  it("refuses a bad name", () => {
    expect(() => parseTemplate("opener", "[[#Greet Hi | Hey]] there")).toThrow(AuthoringError);
    expect(() => parseTemplate("opener", "[[#greet]] there")).toThrow(AuthoringError);
  });
  it("an allele's key is its words, facts as {key}", () => {
    const a = parseTemplate("a", "[[Hi {first_name} | Hey]] x");
    const b = parseTemplate("b", "Intro. [[#hook Yo | Hi {first_name|there}]] x");
    const [pa] = variantPoints(a.body);
    const [pb] = variantPoints(b.body);
    expect(alleleKey(pa?.options[0] ?? [])).toBe(alleleKey(pb?.options[1] ?? []));
    expect(alleleKey(pa?.options[0] ?? [])).toMatch(/^[0-9a-f]{12}$/);
    expect(optionText(pb?.options[1] ?? [])).toBe("Hi {first_name}");
  });
});

describe("render allocation", () => {
  it("renders exactly as before with no allocation (digest taken from main's code)", () => {
    const plain = parseTemplate(
      "opener",
      "subject: [[Quick question | A question | One question]] about {company_name}\n\n" +
        "[[Hi | Hey | Hello]] {first_name|there}.\n\n" +
        "[[We build | I build]] [[automations | tools | systems]] for {company_name}.",
    );
    const out = Array.from({ length: 50 }, (_, i) =>
      render(plain, { company_name: "Acme", first_name: i % 2 ? "Jo" : "" }, `person:${i}`),
    );
    expect(plain.version).toBe("1aa4154f5085");
    expect(createHash("sha256").update(JSON.stringify(out)).digest("hex").slice(0, 16)).toBe(
      "80e943baeebd4e17",
    );
  });
  const t = parseTemplate("opener", "subject: [[#s A | B | C]] for {company_name}\n\nBody.");
  const facts = { company_name: "Acme" };
  const seeds = Array.from({ length: 600 }, (_, i) => `person:${i}`);
  it("draws along the shares, the same seed giving the same pick", () => {
    const allocation = { snapshot: 7, shares: { s: [0.8, 0.2, 0] } };
    const picks = seeds.map((s) => render(t, facts, s, allocation).provenance.picks.s);
    expect(picks.filter((p) => p === 2)).toHaveLength(0);
    const first = picks.filter((p) => p === 0).length / seeds.length;
    expect(first).toBeGreaterThan(0.72);
    expect(first).toBeLessThan(0.88);
    expect(render(t, facts, "person:5", allocation)).toEqual(
      render(t, facts, "person:5", allocation),
    );
    expect(render(t, facts, "person:5", allocation).provenance.snapshot).toBe(7);
  });
  it("without an allocation renders exactly as before, with no snapshot key", () => {
    const r = render(t, facts, "person:5");
    expect(Object.keys(r.provenance)).not.toContain("snapshot");
    expect(r).toEqual(render(t, facts, "person:5", undefined));
    expect(render(t, facts, "person:5", { snapshot: 1, shares: {} }).subject).toBe(r.subject);
  });
});
