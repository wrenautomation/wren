import { describe, expect, it } from "vitest";
import {
  bucketOf,
  type FlagDef,
  type FlagSubject,
  fnv,
  formatRules,
  parseRules,
  shareRules,
  variantOf,
} from "./flags.js";

const nobody: FlagSubject = { id: null, roles: [], client: null, person: null };
const flag = (rules: string, o: Partial<FlagDef> = {}): FlagDef => {
  const variants = o.variants ?? ["off", "on"];
  const got = parseRules(rules, variants);
  if ("error" in got) throw new Error(got.error);
  return { key: "voice", variants, rules: got.rules, fallback: "off", killed: false, ...o };
};

describe("flags", () => {
  it("hashes as the lander does (FNV-1a over UTF-8)", () => {
    expect(fnv("hero:v-1")).toBe(208160467);
    expect(fnv("é")).toBe(513665217);
    expect(bucketOf("hero", "visitor-abc")).toBe(54.48);
  });

  it("first rule that holds wins; killed is the fallback", () => {
    const f = flag(
      "on: roles operator, admin\non: clients acme; people a@example.com\noff: everyone",
    );
    expect(variantOf(f, { ...nobody, roles: ["team", "operator"] })).toBe("on");
    expect(variantOf(f, { ...nobody, client: "acme" })).toBe("off");
    expect(variantOf(f, { ...nobody, client: "acme", person: "A@example.com" })).toBe("on");
    expect(variantOf({ ...f, killed: true }, { ...nobody, roles: ["admin"] })).toBe("off");
    expect(variantOf(flag(""), nobody)).toBe("off");
  });

  it("percent rules share one bucket per flag, and need an id", () => {
    // voice:will@example.com falls at 18.28.
    const s = { ...nobody, id: "will@example.com" };
    expect(variantOf(flag("on: 20%"), s)).toBe("on");
    expect(variantOf(flag("on: 18%"), s)).toBe("off");
    const abc = flag("a: 10%\nb: 20%\nc: everyone", { variants: ["a", "b", "c"], fallback: "c" });
    expect(variantOf(abc, s)).toBe("b");
    expect(variantOf(flag("on: 100%"), nobody)).toBe("off");
  });

  it("rules read back as they were written, and bad ones say why", () => {
    const text = "on: roles operator; clients acme, beta; 12.5%\noff: everyone";
    const got = parseRules(text, ["off", "on"]);
    expect("rules" in got && formatRules(got.rules)).toBe(text);
    expect(parseRules("maybe: everyone", ["off", "on"])).toEqual({
      error: 'Line 1: "maybe" isn\'t one of off, on.',
    });
    expect(parseRules("on: 120%", ["off", "on"])).toMatchObject({ error: /0 to 100/ });
    expect(parseRules("on: tuesdays", ["off", "on"])).toMatchObject({ error: /isn't roles/ });
  });

  it("shares become cumulative percents on the one bucket, the last everyone", () => {
    expect(shareRules(["a", "b", "c"], { a: 0.2, b: 0.3, c: 0.5 })).toEqual([
      { variant: "a", percent: 20 },
      { variant: "b", percent: 50 },
      { variant: "c" },
    ]);
    // A dropped variant gets nothing; what's left still covers everyone.
    expect(shareRules(["a", "b", "c"], { a: 1 / 3, c: 2 / 3 })).toEqual([
      { variant: "a", percent: 33.33 },
      { variant: "c" },
    ]);
    expect(shareRules(["a", "b"], {})).toEqual([]);
  });
});
