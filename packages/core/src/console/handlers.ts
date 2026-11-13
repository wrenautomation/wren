/**
 * Handlers as records: every handler a form can call (`console.handler`), from the worker's
 * service definitions (`Registry.specs`), with its input schema read into form boxes (`formOf`).
 */
import type { HandlerSpec } from "@wren/runtime/pg";
import { defineRecord, type RecordType, status, text } from "../records.js";

/** Every handler the worker serves; the worker passes its registry's `specs`. Async on Lambda, which loads its domains on demand. */
export type HandlerList = () => readonly HandlerSpec[] | Promise<readonly HandlerSpec[]>;

/** One handler as the Call form reads it. */
export interface HandlerRow {
  service: string;
  handler: string;
  kind: "service" | "object" | "workflow";
  /** Callable from outside: the service and the handler are both public. */
  public: boolean;
  effect: string | null;
  /** It declares an input schema, so it opens to a form. */
  form: boolean;
  /** Its input takes a portal `viewer`, which `call` fills with the operator. */
  viewer: boolean;
}

/** `*Portal` services are the apps' own backends: their pages are their form. */
export const isPortal = (service: string) => service.endsWith("Portal");

export function handlersOf(specs: readonly HandlerSpec[]): HandlerRow[] {
  return specs.map((h) => ({
    service: h.service,
    handler: h.handler,
    kind: h.kind,
    public: h.public,
    effect: h.metadata.effect ?? null,
    form: h.input !== undefined,
    viewer: (h.input as Schema | undefined)?.properties?.viewer !== undefined,
  }));
}

/** The handler's input schema; null when it declares none. */
export function inputSchemaOf(
  specs: readonly HandlerSpec[],
  service: string,
  handler: string,
): unknown {
  return specs.find((h) => h.service === service && h.handler === handler)?.input ?? null;
}

/** One box of a handler's form; `type` left out is a line of text, as in the ui's `FormField`. */
export interface HandlerField {
  /** Its path in the input: `parent.child` for a nested field. */
  field: string;
  label: string;
  type?: "long" | "date" | "url" | "number" | "switch" | "select" | "lines" | "numbers" | "json";
  optional?: true;
  hint?: string;
  /** A select's choices. */
  options?: readonly string[];
  /** A choice as people read it, by value ("first" is "First batch only"); from `.meta({ labels })`. */
  labels?: Readonly<Record<string, string>>;
}

export type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  anyOf?: Schema[];
  enum?: unknown[];
  items?: Schema;
  format?: string;
  title?: string;
  description?: string;
  /** An enum's choices as people read them: `.meta({ labels })` on the zod enum. */
  labels?: Record<string, string>;
};

/** "openersPerDay" → "Openers per day". */
const words = (name: string) => {
  const w = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** Drops a `null` branch: a nullable field is an optional one. */
const nonNull = (s: Schema): Schema => {
  const branches = s.anyOf?.filter((b) => b.type !== "null");
  if (branches?.length === 1 && branches[0]) return branches[0];
  if (Array.isArray(s.type)) {
    const types = s.type.filter((t) => t !== "null");
    if (types.length === 1) return { ...s, type: types[0] as string };
  }
  return s;
};

/** A day's key as its name: an hours block reads "Hours: Friday". */
const DAYS: Readonly<Record<string, string>> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/**
 * A handler's input schema as form boxes, per the doc's table; null when it declares no
 * fields (the JSON box). Anything the table doesn't name is a JSON box for that field.
 */
export function formOf(input: unknown): HandlerField[] | null {
  const root = nonNull((input ?? {}) as Schema);
  if (root.type !== "object" || !root.properties) return null;
  const out: HandlerField[] = [];
  const walk = (obj: Schema, path: string, label: string, parentOptional: boolean) => {
    for (const [name, raw] of Object.entries(obj.properties ?? {})) {
      // `call` fills a portal handler's viewer with the operator; the form never asks for it.
      if (!path && name === "viewer") continue;
      const s = nonNull(raw);
      const field = path ? `${path}.${name}` : name;
      const day = DAYS[name];
      const own = s.title ?? day ?? words(name);
      // A nested box reads "Stages: research", never "Stages.Research"; a day or a title keeps
      // its capital ("Contact: X handle").
      const at = !label
        ? own
        : day || s.title
          ? `${label}: ${own}`
          : `${label}: ${own.charAt(0).toLowerCase()}${own.slice(1)}`;
      const optional = parentOptional || !obj.required?.includes(name) || s !== raw;
      if (s.type === "object" && s.properties && Object.keys(s.properties).length) {
        walk(s, field, at, optional);
        continue;
      }
      const item = s.items?.type;
      const type: HandlerField["type"] | undefined = s.enum
        ? "select"
        : s.type === "string"
          ? s.format === "date"
            ? "date"
            : s.format === "uri"
              ? "url"
              : undefined
          : s.type === "number" || s.type === "integer"
            ? "number"
            : s.type === "boolean"
              ? "switch"
              : s.type === "array" && item === "string"
                ? "lines"
                : s.type === "array" && (item === "number" || item === "integer")
                  ? "numbers"
                  : "json";
      out.push({
        field,
        label: at,
        ...(type ? { type } : {}),
        ...(optional ? { optional: true as const } : {}),
        ...(s.description ? { hint: s.description } : {}),
        ...(s.enum ? { options: s.enum.map(String) } : {}),
        ...(s.enum && s.labels ? { labels: s.labels } : {}),
      });
    }
  };
  walk(root, "", "", false);
  return out;
}

/**
 * Every handler a form can call, as a record: public ones outside the `*Portal` services.
 * Its id is "<service>/<handler>"; the detail carries the input schema.
 */
export const handlerRecord = (handlerList: HandlerList): RecordType =>
  defineRecord({
    id: "console.handler",
    app: "office",
    channel: null,
    name: { one: "handler", many: "handlers" },
    rows: async () =>
      handlersOf(await handlerList())
        .filter((h) => h.public && !isPortal(h.service))
        .map((h) => ({
          id: `${h.service}/${h.handler}`,
          service: h.service,
          handler: h.handler,
          kind: h.kind,
          needs_key: h.kind === "service" ? "no" : "yes",
          effect: h.effect,
          form: h.form ? "form" : "json",
        })),
    key: "id",
    title: "handler",
    subtitle: "service",
    fields: {
      service: text("Service"),
      handler: text("Handler"),
      kind: status({
        service: { label: "Service", tone: "neutral" },
        object: { label: "Object", tone: "neutral" },
        workflow: { label: "Workflow", tone: "neutral" },
      }),
      needsKey: status(
        { yes: { label: "Asks a key", tone: "neutral" }, no: { label: "No key", tone: "neutral" } },
        "Key",
      ),
      effect: status(
        {
          spends: { label: "Spends", tone: "bad" },
          sends: { label: "Sends", tone: "warn" },
          posts: { label: "Posts", tone: "warn" },
        },
        "Effect",
      ),
      form: status(
        { form: { label: "Form", tone: "good" }, json: { label: "JSON box", tone: "neutral" } },
        "Input",
      ),
    },
    views: [
      { id: "all", label: "All", sort: "service" },
      { id: "forms", label: "With a form", where: { form: "form" }, sort: "service" },
      {
        id: "effects",
        label: "Effects",
        where: { effect: ["spends", "sends", "posts"] },
        sort: "service",
      },
    ],
    load: async (_db, id) => {
      const slash = id.indexOf("/");
      if (slash < 0) return null;
      const input = inputSchemaOf(await handlerList(), id.slice(0, slash), id.slice(slash + 1));
      return { input, form: formOf(input) };
    },
  });
