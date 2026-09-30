/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyTheme, PRESETS, type PresetName, readTheme, TOKENS, themeVars } from "./theme.js";

const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

describe("readTheme", () => {
  describe("preset names", () => {
    it("returns a copy of the named preset", () => {
      expect(readTheme("night")).toEqual(PRESETS.night);
      expect(readTheme("night")).not.toBe(PRESETS.night);
    });

    it("returns an empty theme for wren", () => {
      expect(readTheme("wren")).toEqual({});
    });

    it("does not change PRESETS when the result is mutated", () => {
      const t = readTheme("night");
      t.accent = "red";
      t.font = "serif";
      expect(PRESETS.night.accent).toBe("#e8794a");
      expect("font" in PRESETS.night).toBe(false);
    });

    it("does not change PRESETS when a result built from { preset } is mutated", () => {
      const t = readTheme({ preset: "soft" });
      t.accent = "red";
      expect(PRESETS.soft.accent).toBe("#3552d4");
    });

    it("returns {} for an unknown preset name", () => {
      expect(readTheme("nope")).toEqual({});
      expect(readTheme("")).toEqual({});
    });

    it("is case-sensitive about preset names", () => {
      expect(readTheme("Night")).toEqual({});
    });

    it("returns {} for names inherited from Object.prototype", () => {
      for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
        expect(readTheme(name)).toEqual({});
        expect(readTheme({ preset: name })).toEqual({});
      }
    });

    it("ignores a preset that isn't a string", () => {
      expect(readTheme({ preset: ["night"] })).toEqual({});
      expect(readTheme({ preset: { night: true } })).toEqual({});
      expect(readTheme({ preset: 1 })).toEqual({});
    });
  });

  describe("input that isn't a plain object", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["a number", 42],
      ["a boolean", true],
      ["a function", () => ({ accent: "red" })],
      ["an array", ["night"]],
      ["an array of pairs", [["accent", "red"]]],
    ])("returns {} for %s", (_label, raw) => {
      expect(readTheme(raw)).toEqual({});
    });
  });

  describe("objects", () => {
    it("starts from the preset and lets overrides win", () => {
      expect(readTheme({ preset: "night", accent: "red", font: "serif" })).toEqual({
        ...PRESETS.night,
        accent: "red",
        font: "serif",
      });
    });

    it("keeps the preset value when the override is dropped", () => {
      expect(readTheme({ preset: "night", accent: "" }).accent).toBe(PRESETS.night.accent);
      expect(readTheme({ preset: "night", accent: "a;b" }).accent).toBe(PRESETS.night.accent);
    });

    it("reads tokens with no preset", () => {
      expect(readTheme({ accent: "red", "ink-2": "#333" })).toEqual({
        accent: "red",
        "ink-2": "#333",
      });
    });

    it("does not keep the preset key itself", () => {
      expect(readTheme({ preset: "wren" })).toEqual({});
      expect(readTheme({ preset: "nope", accent: "red" })).toEqual({ accent: "red" });
    });

    it("drops unknown keys", () => {
      expect(readTheme({ accent: "red", colour: "blue", "--ui-ink": "#000", Accent: "x" })).toEqual(
        {
          accent: "red",
        },
      );
    });

    it("ignores inherited keys", () => {
      expect(readTheme(Object.create({ accent: "red" }))).toEqual({});
    });

    it("turns finite numbers into strings", () => {
      expect(
        readTheme({ "display-weight": 600, "radius-card": 0, "display-squeeze": 0.5 }),
      ).toEqual({
        "display-weight": "600",
        "radius-card": "0",
        "display-squeeze": "0.5",
      });
    });

    it("reads -0 as 0", () => {
      expect(readTheme({ frame: -0 })).toEqual({ frame: "0" });
    });

    it("drops NaN and Infinity", () => {
      expect(
        readTheme({ frame: Number.NaN, side: Number.POSITIVE_INFINITY, "radius-bar": -Infinity }),
      ).toEqual({});
    });

    it("drops values that aren't strings or numbers", () => {
      expect(
        readTheme({
          accent: true,
          ink: null,
          paper: undefined,
          canvas: ["red"],
          font: { family: "serif" },
          frame: 1n,
          side: Symbol("x"),
        }),
      ).toEqual({});
    });

    it("trims values", () => {
      expect(readTheme({ accent: "  red\n", font: "\tserif " })).toEqual({
        accent: "red",
        font: "serif",
      });
    });

    it("drops empty and whitespace-only strings", () => {
      expect(readTheme({ accent: "", ink: "   ", paper: "\n\t" })).toEqual({});
    });

    it("keeps a value of exactly 300 characters", () => {
      const v = "a".repeat(300);
      expect(readTheme({ font: v })).toEqual({ font: v });
    });

    it("drops a value over 300 characters", () => {
      expect(readTheme({ font: "a".repeat(301) })).toEqual({});
    });

    it("measures length after trimming", () => {
      const v = "a".repeat(300);
      expect(readTheme({ font: `  ${v}  ` })).toEqual({ font: v });
    });

    it.each([
      ["a semicolon", "red; background: blue"],
      ["an open brace", "red {"],
      ["a close brace", "red }"],
      ["a less-than", "red <"],
      ["a greater-than", "</style>"],
      ["an exclamation mark", "red !important"],
      ["a backslash", "u\\72l(x)"],
      ["url(", "url(https://evil.example/x.png)"],
      ["URL( in caps", "URL(https://evil.example/x.png)"],
      ["mixed-case url(", "Url(x)"],
      ["url( mid-value", "red url(x)"],
      ["@import", "@import 'x.css'"],
      ["@IMPORT in caps", "@IMPORT 'x.css'"],
      ["image-set(", 'image-set("https://evil.example/p.png" 1x)'],
      ["-webkit-image-set(", '-webkit-image-set("https://evil.example/p.png" 1x)'],
      ["cross-fade(", "cross-fade(red, blue)"],
      ["a spaced url (", "url (x)"],
      ["a call hidden by a comment", "ur/**/l(x)"],
      ["a bare paren", "(x)"],
      ["a call inside an allowed one", "color-mix(in srgb, image(x) 50%, red)"],
    ])("drops a value containing %s", (_label, value) => {
      expect(readTheme({ accent: value })).toEqual({});
    });

    it("keeps safe values that use quotes, commas, parens and slashes", () => {
      const theme = {
        font: '"Iowan Old Style", Georgia, serif',
        scrim: "rgb(0 0 0 / 0.5)",
        "shadow-window": "-1px 0 0 var(--ui-rule)",
        ease: "cubic-bezier(0.2, 0, 0, 1)",
      };
      expect(readTheme(theme)).toEqual(theme);
    });

    it("drops only the bad token, not the rest", () => {
      expect(readTheme({ accent: "red;", ink: "#111", paper: "url(x)", canvas: "#fff" })).toEqual({
        ink: "#111",
        canvas: "#fff",
      });
    });
  });

  describe("prototype pollution", () => {
    it("does not pollute or leak through a JSON __proto__ key", () => {
      const raw: unknown = JSON.parse('{"__proto__":{"accent":"red","polluted":"yes"}}');
      const theme = readTheme(raw);
      expect(theme).toEqual({});
      expect(Object.getPrototypeOf(theme)).toBe(Object.prototype);
      expect(theme.accent).toBeUndefined();
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(({} as Record<string, unknown>).accent).toBeUndefined();
    });

    it("does not pollute through a nested __proto__ alongside real tokens", () => {
      const raw: unknown = JSON.parse(
        '{"preset":"night","__proto__":{"ink":"red"},"accent":"blue"}',
      );
      const theme = readTheme(raw);
      expect(theme).toEqual({ ...PRESETS.night, accent: "blue" });
      expect(Object.getPrototypeOf(theme)).toBe(Object.prototype);
      expect(({} as Record<string, unknown>).ink).toBeUndefined();
    });

    it("drops constructor and prototype keys", () => {
      const raw: unknown = JSON.parse(
        '{"constructor":{"prototype":{"accent":"red"}},"prototype":"x"}',
      );
      const theme = readTheme(raw);
      expect(theme).toEqual({});
      expect(Object.hasOwn(theme, "constructor")).toBe(false);
      expect(({} as Record<string, unknown>).accent).toBeUndefined();
    });

    it("drops a string constructor value", () => {
      expect(Object.hasOwn(readTheme({ constructor: "red", accent: "blue" }), "constructor")).toBe(
        false,
      );
    });
  });
});

describe("themeVars", () => {
  it("maps each token to --ui-<token>", () => {
    expect(themeVars({ accent: "#3552d4", "ink-2": "#4b5563" })).toEqual({
      "--ui-accent": "#3552d4",
      "--ui-ink-2": "#4b5563",
    });
  });

  it("returns {} for an empty theme", () => {
    expect(themeVars({})).toEqual({});
  });

  it("drops unknown keys", () => {
    const theme = { accent: "red", colour: "blue", "--ui-ink": "#000" } as Record<string, string>;
    expect(themeVars(theme)).toEqual({ "--ui-accent": "red" });
  });

  it("drops empty and non-string values", () => {
    const theme = {
      accent: "",
      ink: 0,
      paper: null,
      canvas: undefined,
      font: "serif",
    } as unknown as Record<string, string>;
    expect(themeVars(theme)).toEqual({ "--ui-font": "serif" });
  });

  it("drops a __proto__ key from parsed JSON", () => {
    const theme = JSON.parse('{"__proto__":{"accent":"red"},"ink":"#111"}') as Record<
      string,
      string
    >;
    const vars = themeVars(theme);
    expect(vars).toEqual({ "--ui-ink": "#111" });
    expect(Object.getPrototypeOf(vars)).toBe(Object.prototype);
  });

  it.each([
    "radius-window",
    "radius-card",
    "radius-control",
    "radius-button",
    "radius-tag",
    "radius-bar",
    "frame",
    "side",
    "main-width",
  ] as const)("turns a bare 0 into 0px for the length token %s", (key) => {
    expect(themeVars({ [key]: "0" })).toEqual({ [`--ui-${key}`]: "0px" });
  });

  it.each(["0.0", "00", ".0", "-0", "+0.00"])("treats %s as a zero length too", (zero) => {
    expect(themeVars({ "radius-window": zero })).toEqual({ "--ui-radius-window": "0px" });
  });

  it("leaves a zero with a unit, and a non-zero, alone", () => {
    expect(themeVars({ frame: "0em", side: "0.5" })).toEqual({
      "--ui-frame": "0em",
      "--ui-side": "0.5",
    });
  });

  it.each([
    "display-squeeze",
    "label-tracking",
    "button-tracking",
    "display-weight",
    "accent",
  ] as const)("keeps a bare 0 as 0 for the non-length token %s", (key) => {
    expect(themeVars({ [key]: "0" })).toEqual({ [`--ui-${key}`]: "0" });
  });

  it("leaves non-zero lengths alone", () => {
    expect(themeVars({ "radius-card": "18px", frame: "0px", side: "10" })).toEqual({
      "--ui-radius-card": "18px",
      "--ui-frame": "0px",
      "--ui-side": "10",
    });
  });

  it("gives calc-safe lengths for the editorial preset", () => {
    const vars = themeVars(PRESETS.editorial);
    expect(vars["--ui-radius-window"]).toBe("0px");
    expect(vars["--ui-frame"]).toBe("0px");
    expect(vars["--ui-radius-tag"]).toBe("2px");
  });

  it("keeps the soft preset's unitless trackings as 0", () => {
    const vars = themeVars(PRESETS.soft);
    expect(vars["--ui-label-tracking"]).toBe("0");
    expect(vars["--ui-button-tracking"]).toBe("0");
  });
});

describe("applyTheme", () => {
  function fakeElement(initial: Record<string, string> = {}) {
    const props = new Map(Object.entries(initial));
    const style = {
      getPropertyValue: (k: string) => props.get(k) ?? "",
      setProperty: (k: string, v: string) => {
        props.set(k, v);
      },
      removeProperty: (k: string) => {
        const was = props.get(k) ?? "";
        props.delete(k);
        return was;
      },
    };
    return { el: { style } as unknown as HTMLElement, props };
  }

  it("sets each token as a custom property", () => {
    const { el, props } = fakeElement();
    applyTheme({ accent: "red", frame: "0" }, el);
    expect(Object.fromEntries(props)).toEqual({ "--ui-accent": "red", "--ui-frame": "0px" });
  });

  it("leaves unrelated properties alone", () => {
    const { el, props } = fakeElement({ color: "blue", "--ui-ink": "#000" });
    applyTheme({ accent: "red" }, el);
    expect(props.get("color")).toBe("blue");
    expect(props.get("--ui-ink")).toBe("#000");
  });

  it("undo removes properties that weren't set before", () => {
    const { el, props } = fakeElement();
    const undo = applyTheme({ accent: "red", ink: "#111" }, el);
    undo();
    expect(props.size).toBe(0);
  });

  it("undo restores prior values", () => {
    const { el, props } = fakeElement({ "--ui-accent": "blue", color: "green" });
    const undo = applyTheme({ accent: "red", ink: "#111" }, el);
    expect(props.get("--ui-accent")).toBe("red");
    undo();
    expect(Object.fromEntries(props)).toEqual({ "--ui-accent": "blue", color: "green" });
  });

  it("undo leaves properties the theme did not set", () => {
    const { el, props } = fakeElement();
    const undo = applyTheme({ accent: "red" }, el);
    props.set("--ui-ink", "#222");
    undo();
    expect(Object.fromEntries(props)).toEqual({ "--ui-ink": "#222" });
  });

  it("nested applies undo back to the original in reverse order", () => {
    const { el, props } = fakeElement({ "--ui-accent": "blue" });
    const undoA = applyTheme({ accent: "red" }, el);
    const undoB = applyTheme({ accent: "green", ink: "#111" }, el);
    undoB();
    expect(Object.fromEntries(props)).toEqual({ "--ui-accent": "red" });
    undoA();
    expect(Object.fromEntries(props)).toEqual({ "--ui-accent": "blue" });
  });

  it("does nothing for an empty theme", () => {
    const { el, props } = fakeElement({ "--ui-accent": "blue" });
    const undo = applyTheme({}, el);
    undo();
    expect(Object.fromEntries(props)).toEqual({ "--ui-accent": "blue" });
  });
});

describe("TOKENS and PRESETS", () => {
  it("TOKENS has no duplicates", () => {
    expect(new Set(TOKENS).size).toBe(TOKENS.length);
  });

  it("every token is lowercase kebab-case", () => {
    for (const t of TOKENS) expect(t).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
  });

  it("every preset uses only keys from TOKENS", () => {
    const known = new Set<string>(TOKENS);
    for (const name of PRESET_NAMES)
      for (const key of Object.keys(PRESETS[name]))
        expect(known.has(key), `${name}.${key}`).toBe(true);
  });

  it.each(PRESET_NAMES)("preset %s passes readTheme unchanged", (name) => {
    expect(readTheme({ preset: name })).toEqual(PRESETS[name]);
    expect(readTheme({ ...PRESETS[name] })).toEqual(PRESETS[name]);
  });
});

describe("TOKENS match kit.css", () => {
  const css = readFileSync(new URL("./kit.css", import.meta.url), "utf8");

  it.each([...TOKENS])("kit.css reads --ui-%s", (token) => {
    expect(css).toMatch(new RegExp(`var\\(\\s*--ui-${token}(?![a-z0-9-])`));
  });

  it("every --ui-* property kit.css declares is in TOKENS", () => {
    const declared = new Set([...css.matchAll(/--ui-([a-z0-9-]+):/g)].map((m) => m[1]));
    expect(declared.size).toBeGreaterThan(0);
    const known = new Set<string>(TOKENS);
    expect([...declared].filter((d) => d === undefined || !known.has(d))).toEqual([]);
  });
});
