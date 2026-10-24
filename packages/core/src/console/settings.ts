/**
 * Wren's own settings as records (`console.setting`): a component's settings block as form
 * boxes, each box as one line he reads and types, and a guess's `built` pointer in plain words.
 */
import type { Queryable } from "@wren/db";
import { z } from "zod";
import { settingsFor, setWrenSettings } from "../clients/index.js";
import { wrenSettings } from "../clients/schema.js";
import { ACCOUNT_SITES, ACCOUNTS, type Component } from "../components.js";
import { wordsPatch } from "../edits.js";
import { PortalRefusal } from "../portal.js";
import { date, defineRecord, type RecordType, text, type Values } from "../records.js";
import { codeLabel } from "../template-labels.js";
import { formOf, type HandlerField, type Schema } from "./handlers.js";

/** A settings block as a page may show it: defaults filled, prices left out; null if it won't parse. */
export function shownSettings(c: Component, block: unknown): Record<string, unknown> | null {
  const out = c.settings.safeParse(block ?? {});
  if (!out.success || typeof out.data !== "object" || out.data === null) return null;
  const shown = { ...(out.data as Record<string, unknown>) };
  for (const k of c.priced) delete shown[k];
  return shown;
}

/** A component's settings as form boxes, prices left out. */
export function settingsForm(c: Component, forClient = false): HandlerField[] | null {
  const schema = z.toJSONSchema(c.settings, { io: "input", unrepresentable: "any" }) as Schema;
  const properties = { ...schema.properties };
  for (const k of c.priced) delete properties[k];
  for (const k of forClient ? c.wrenOnly : c.clientOnly) delete properties[k];
  return formOf({ ...schema, properties });
}

/** camelCase or snake_case as words: "minAdsPerAdset" is "min ads per adset". */
const wordsOf = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();

/** A code name a reader can't use: an env var, a module, a dotted key, a template ref. */
const CODE = /[A-Z]{2,}_|@wren\/|\b[a-z]\w*\.[a-z]\w*\b|#\d/;

/**
 * Where a guess is built, said in plain words for the page (`Guess.built` points at the code):
 * a setting by its form label, a niche field, a port, a part or an account by name. A pointer
 * only code reads gives null: the page says "Built" and no more.
 */
export function builtWords(
  c: Component,
  built: string,
  name: (id: string) => string | null,
): string | null {
  const settings = /^settings\.(.+)$/.exec(built);
  if (settings) {
    const labels = new Map((settingsForm(c) ?? []).map((f) => [f.field, f.label]));
    const keys = (settings[1] ?? "")
      .split(/,\s*/)
      .map((k) => k.replace(/^settings\./, ""))
      .filter((k) => /^\w+$/.test(k));
    const words = keys.map((k) => labels.get(k) ?? wordsOf(k));
    return words.length
      ? `${words.length > 1 ? "Settings" : "Setting"}: ${words.join(", ")}`
      : null;
  }
  const niche = /^niche\.(\w+)$/.exec(built);
  if (niche) return `The niche's ${wordsOf(niche[1] ?? "")}`;
  const port = /^(in|out)\.(\w+)$/.exec(built);
  if (port) {
    const p = (port[1] === "in" ? c.in : c.out).find((x) => x.id === port[2]);
    return p ? `${port[1] === "in" ? "Takes" : "Gives"} ${p.label}` : null;
  }
  const part = name(built);
  if (part) return part;
  if (CODE.test(built)) return null;
  const account = ACCOUNT_SITES.find((a) => new RegExp(`\\b${a}\\b`).test(built));
  const said = account ? built.replace(account, ACCOUNTS[account].label) : built;
  return said[0]?.toUpperCase() + said.slice(1);
}

/** A form field's value in a settings block: `a.b` reads nested. */
const at = (block: Record<string, unknown>, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined),
      block,
    );

/** `block` with `path` set, or removed when `value` is undefined; the rest kept as it was. */
const setAt = (block: Record<string, unknown>, path: string, value: unknown) => {
  const [head = "", ...rest] = path.split(".");
  const out = { ...block };
  if (rest.length) {
    const inner = out[head] && typeof out[head] === "object" ? out[head] : {};
    out[head] = setAt(inner as Record<string, unknown>, rest.join("."), value);
  } else if (value === undefined) delete out[head];
  else out[head] = value;
  return out;
};

/** A setting as one line he reads and types. */
const settingText = (f: HandlerField, v: unknown): string => {
  if (v === undefined || v === null) return "";
  if (f.type === "switch") return v ? "on" : "off";
  if (Array.isArray(v) && (f.type === "lines" || f.type === "numbers")) return v.join(", ");
  return typeof v === "object" ? JSON.stringify(v) : String(v);
};

/**
 * A setting as the list shows it: a block of lists reads "Recruiting: a, b; Agencies: c", not
 * JSON. Editing still starts from `settingText`, so what he types round-trips.
 */
export const settingShown = (f: HandlerField, v: unknown): string => {
  const words = (x: unknown): string =>
    Array.isArray(x)
      ? x.map(words).join(", ")
      : x && typeof x === "object"
        ? Object.entries(x)
            .map(([k, y]) => `${codeLabel(k)}: ${words(y)}`)
            .join("; ")
        : String(x);
  return v && typeof v === "object" && f.type !== "switch" ? words(v) : settingText(f, v);
};

/** What he typed, as the schema takes it; blank goes back to the default. */
const settingValue = (f: HandlerField, typed: string): unknown => {
  const t = typed.trim();
  if (!t) return undefined;
  if (f.type === "number") return Number(t);
  if (f.type === "switch")
    return /^(on|yes|true)$/i.test(t) ? true : /^(off|no|false)$/i.test(t) ? false : t;
  if (f.type === "lines")
    return t
      .split(t.includes("\n") ? /\n/ : /,/)
      .map((x) => x.trim())
      .filter(Boolean);
  if (f.type === "numbers")
    return t
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
  if (f.type === "json") {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return typed;
};

/**
 * Wren's own settings, one row per setting of each part that runs for Wren (`wren_settings`), save
 * a part with its own editor (`Component.editor`): edited in place with History, Undo and Ask
 * Claude (`./edits.ts`). Saving one keeps the rest of its block, prices included, and needs
 * `manage`, as the Shop's Save does.
 */
export function settingRecord(all: readonly Component[]): RecordType {
  const settings = all
    .filter((c) => c.wrenSettings && !c.editor)
    .flatMap((c) => (settingsForm(c) ?? []).map((f) => ({ c, f, id: `${c.id}:${f.field}` })));
  const one = (id: string) => settings.find((s) => s.id === id);
  const blockFor = async (db: Queryable, c: Component) => {
    const block = (await settingsFor(db, null))[c.id];
    return block && typeof block === "object" ? (block as Record<string, unknown>) : {};
  };
  /** The block a patch makes, or why the part's schema won't take it. */
  const next = async (db: Queryable, id: string, patch: Values) => {
    const s = one(id);
    if (!s) throw new PortalRefusal("no such setting", 404);
    const block = setAt(
      await blockFor(db, s.c),
      s.f.field,
      settingValue(s.f, String(patch.value ?? "")),
    );
    const out = s.c.settings.safeParse(block);
    const problem = out.success
      ? null
      : out.error.issues.map((i) => i.message).join("; ") || "the part won't take that";
    return { s, block, problem };
  };
  return defineRecord({
    id: "console.setting",
    app: "loops",
    channel: null,
    name: { one: "setting", many: "settings" },
    rows: async (db) => {
      const saved = await db.select().from(wrenSettings);
      const blocks = Object.fromEntries(saved.map((r) => [r.component, r]));
      return settings.map(({ c, f, id }) => {
        const row = blocks[c.id];
        return {
          id,
          part: c.name,
          setting: f.label,
          value: settingShown(f, at(shownSettings(c, row?.settings) ?? {}, f.field)),
          hint: f.hint ?? null,
          choices: f.options?.join(", ") ?? null,
          updated_at: row?.updatedAt?.toISOString() ?? null,
          updated_by: row?.updatedBy ?? null,
        };
      });
    },
    key: "id",
    title: "setting",
    subtitle: "part",
    fields: {
      part: text("Part"),
      setting: text("Setting"),
      value: text("Value"),
      hint: text("What it does"),
      choices: text("Choices"),
      updatedAt: date("Saved"),
      updatedBy: text("By"),
    },
    views: [{ id: "all", label: "All" }],
    edits: {
      fields: ["value"],
      patch: wordsPatch({ value: 4000 }),
      needs: "manage",
      about: "one of Wren's own settings, typed as text; blank puts the default back",
      read: async (db, id) => {
        const s = one(id);
        if (!s) return null;
        return {
          value: settingText(s.f, at(shownSettings(s.c, await blockFor(db, s.c)) ?? {}, s.f.field)),
        };
      },
      check: async (patch, _now, db, id) => (await next(db, id, patch)).problem,
      write: async (db, id, patch, by) => {
        const { s, block, problem } = await next(db, id, patch);
        if (problem) throw new PortalRefusal(problem, 400);
        await setWrenSettings(db, s.c.id, block, by);
      },
      context: async (_db, id) => {
        const s = one(id);
        if (!s) return null;
        return [
          `${s.c.name}: ${s.c.blurb}`,
          `Setting "${s.f.label}"${s.f.hint ? `: ${s.f.hint}` : ""}.`,
          s.f.options ? `One of: ${s.f.options.join(", ")}.` : "",
          s.f.type ? `Typed as ${s.f.type}.` : "",
        ]
          .filter(Boolean)
          .join("\n");
      },
    },
  });
}
