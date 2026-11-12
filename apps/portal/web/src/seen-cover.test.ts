/**
 * Every page tells the side chat what is in view (designs/2026-11-11-agent-panel.md, D3 A). A
 * list page publishes through the shared records parts; a hand-drawn page calls `useSeen` in its
 * own file or a file it imports. A new page that does neither fails here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { CLIENT_PLACES, TEAM_PLACES } = await import("./modules/places.js");
const { research } = await import("./modules/research/index.js");

const ROOT = new URL("./", import.meta.url);
const FILES = readdirSync(ROOT, { recursive: true, encoding: "utf8" }).filter(
  (f) => /\.tsx?$/.test(f) && !/\.(test|stories)\.tsx?$/.test(f) && !f.startsWith("stories/"),
);
const SRC = new Map(FILES.map((f) => [f, readFileSync(new URL(f, ROOT), "utf8")]));

/** Publishes in view: its own call, or a shared records part that does. */
const PUBLISHES = /\buseSeen\(|<(RecordsList|RecordsPage|RecordBody|Records)\b/;

/** Pages with nothing for the agent to read, each with why. */
const NOTHING_IN_VIEW: Record<string, string> = {
  "/campaigns/write": "moves to Studio at once",
  "/campaigns/real": "fixed text about the demo",
  "/project/welcome": "fixed text",
  "/office/contract": "the contract's fixed text",
  "/office/overview": "a client's own settings form; the page line names it",
  "/office/social": "a settings form; the page line names it",
  "/office/mail": "a settings form; the page line names it",
  "/office/you": "a settings form; the page line names it",
  "/office/look": "a settings form; the page line names it",
  "/office/experiments": "a settings form; the page line names it",
};

const defines = (name: string) =>
  [...SRC.entries()].find(([, s]) =>
    new RegExp(`(function|const|class)\\s+${name}\\b[^\\n]*[=(<{]`).test(s),
  )?.[0];

/** A file's local imports, as source paths. */
const imports = (file: string): string[] =>
  [...(SRC.get(file) ?? "").matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)].flatMap((m) => {
    const base = new URL(m[1] ?? "", new URL(file, ROOT)).pathname.slice(ROOT.pathname.length);
    const stem = base.replace(/\.js$/, "");
    return [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`].filter((f) =>
      SRC.has(f),
    );
  });

/** The file or anything it imports, two deep, publishes. */
const reaches = (file: string, depth = 2): boolean =>
  PUBLISHES.test(SRC.get(file) ?? "") ||
  (depth > 0 && imports(file).some((f) => reaches(f, depth - 1)));

type Page = { id: string; Page?: unknown; template?: string };
type Place = { id: string; pages: readonly Page[] };

const silent = (places: readonly Place[]) =>
  places.flatMap((m) =>
    m.pages.flatMap((p) => {
      const at = `/${m.id}/${p.id}`;
      if (p.template || at in NOTHING_IN_VIEW) return [];
      const name = (p.Page as { name?: string } | undefined)?.name;
      const file = name ? defines(name) : undefined;
      if (!file) return [`${at}: no file for ${name || "an unnamed Page"}`];
      return reaches(file) ? [] : [`${at}: ${file}`];
    }),
  );

describe("in view", () => {
  it("every team page says what it shows", () => {
    expect(silent([...TEAM_PLACES, research])).toEqual([]);
  });
  it("every client page says what it shows", () => {
    expect(silent(CLIENT_PLACES)).toEqual([]);
  });
  it("names no gone page", () => {
    const known = new Set(
      [...TEAM_PLACES, research, ...CLIENT_PLACES].flatMap((m) =>
        m.pages.map((p) => `/${m.id}/${p.id}`),
      ),
    );
    expect(Object.keys(NOTHING_IN_VIEW).filter((at) => !known.has(at))).toEqual([]);
  });
});
