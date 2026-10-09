/**
 * Custom fields and custom values (designs/2026-10-09-custom-fields.md). An owner adds fields to
 * a record type that takes them (`custom` on its declaration); `withCustomFields` puts the live
 * ones on the type for one request, as fields `x_<key>` a person edits in place. Business facts
 * are an owner's `{biz.<key>}` for copy.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Queryable } from "@wren/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  CUSTOM_KINDS,
  type CustomField,
  type CustomKind,
  type CustomOption,
  type CustomValue,
  customFields,
  customFieldValues,
  customValues,
} from "./custom-schema.js";
import { PortalRefusal } from "./portal.js";
import {
  CUSTOM_CURRENCY,
  customColumn,
  type Field,
  type RecordEdits,
  type RecordType,
  type State,
  tintOf,
  type Values,
} from "./records.js";
import type { Step } from "./spine.js";
import { fillText } from "./webhook-events.js";

/** Live fields an owner may keep on one record type. */
export const CUSTOM_MOST = 50;
/** The longest text a value or business fact holds. */
export const CUSTOM_VALUE_MOST = 2000;
const OPTIONS_MOST = 40;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
/** Where a field shows on a record's page. */
const GROUP = "Custom fields";

/** The record type a spine subject's prefix names: `deal:<id>` is a deal. */
export const CUSTOM_SUBJECTS: Readonly<Record<string, string>> = { deal: "deals.deal" };

const ownerIs = (col: typeof customFields.owner | typeof customValues.owner, o: string | null) =>
  o === null ? isNull(col) : eq(col, o);

/** A label as a key: "Roof age" is roof_age. */
export function keyOf(label: string): string {
  const k = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/, "");
  return k || "field";
}

const YES_NO: Readonly<Record<string, State>> = {
  yes: { label: "Yes", tone: "good" },
  no: { label: "No", tone: "neutral" },
};

/** A choice's options as states, each with its own tint. */
const statesOf = (options: readonly CustomOption[]): Record<string, State> =>
  Object.fromEntries(
    options.map((o) => [o.key, { label: o.label, tone: "neutral" as const, tint: tintOf(o.key) }]),
  );

/** The record field a custom field reads as. */
export function fieldOf(f: Pick<CustomField, "key" | "label" | "kind" | "options">): Field {
  const base = { label: f.label, from: customColumn(f.key), group: GROUP };
  switch (f.kind as CustomKind) {
    case "number":
      return { ...base, kind: "number" };
    case "money":
      return { ...base, kind: "money", currency: CUSTOM_CURRENCY };
    case "date":
      return { ...base, kind: "date" };
    case "link":
      return { ...base, kind: "link" };
    case "choice":
      return { ...base, kind: "status", states: statesOf(f.options ?? []) };
    case "yes_no":
      return { ...base, kind: "status", states: YES_NO };
    default:
      return { ...base, kind: "text" };
  }
}

/** What a value of this field may be; null clears it. */
function schemaOf(f: Pick<CustomField, "kind" | "options">): z.ZodType<unknown> {
  switch (f.kind as CustomKind) {
    case "number":
    case "money":
      return z.number().finite().nullable();
    case "date":
      return z
        .string()
        .refine((v) => !Number.isNaN(Date.parse(v)), "isn't a date")
        .nullable();
    case "link":
      return z.string().max(CUSTOM_VALUE_MOST).url("isn't a link").nullable();
    case "choice": {
      const keys = (f.options ?? []).map((o) => o.key);
      return z
        .string()
        .refine((v) => keys.includes(v), "isn't one of its options")
        .nullable();
    }
    case "yes_no":
      return z.enum(["yes", "no"]).nullable();
    default:
      return z.string().max(CUSTOM_VALUE_MOST).nullable();
  }
}

/** A value as it's kept: text trimmed (empty clears it), a date as an ISO instant. */
function keptOf(f: Pick<CustomField, "kind">, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    return f.kind === "date" ? new Date(t).toISOString() : t;
  }
  return v;
}

/** An owner's fields on one record type, in order; archived ones too when asked. */
export function customFieldsOf(
  db: Queryable,
  owner: string | null,
  record: string,
  o: { archived?: boolean } = {},
): Promise<CustomField[]> {
  return db
    .select()
    .from(customFields)
    .where(
      and(
        ownerIs(customFields.owner, owner),
        eq(customFields.record, record),
        o.archived ? undefined : isNull(customFields.archivedAt),
      ),
    )
    .orderBy(asc(customFields.position), asc(customFields.createdAt));
}

/** A new field, or a change to one. The kind is fixed once made. */
export interface FieldInput {
  id?: string;
  record: string;
  label: string;
  key?: string;
  kind?: string;
  options?: readonly { key?: string; label: string }[];
  archived?: boolean;
}

const refuse = (why: string): never => {
  throw new PortalRefusal(why, 400);
};

function optionsOf(input: FieldInput["options"]): CustomOption[] {
  const out: CustomOption[] = [];
  for (const o of input ?? []) {
    const label = String(o.label ?? "").trim();
    if (!label) continue;
    if (label.length > 80) refuse("an option's name is over 80 characters");
    const key = o.key ? String(o.key) : keyOf(label);
    if (!KEY.test(key)) refuse(`option key ${key} takes lowercase letters, digits and _`);
    if (out.some((x) => x.key === key)) refuse(`two options are ${label}`);
    out.push({ key, label });
  }
  if (!out.length) refuse("a choice needs an option");
  if (out.length > OPTIONS_MOST) refuse(`a choice has at most ${OPTIONS_MOST} options`);
  return out;
}

/** Make or change one of an owner's fields; refused past the cap, on a key in use, or a kind change. */
export async function saveCustomField(
  db: Queryable,
  owner: string | null,
  input: FieldInput,
  by: string,
): Promise<CustomField> {
  const label = String(input.label ?? "").trim();
  if (!label) refuse("name the field");
  if (label.length > 80) refuse("a field's name is over 80 characters");
  if (!input.id) {
    const kind = (input.kind ?? "text") as CustomKind;
    if (!CUSTOM_KINDS.includes(kind)) refuse(`no such kind ${input.kind}`);
    const key = input.key ? String(input.key) : keyOf(label);
    if (!KEY.test(key)) refuse("a key takes lowercase letters, digits and _, a letter first");
    const all = await customFieldsOf(db, owner, input.record, { archived: true });
    if (all.some((f) => f.key === key)) refuse(`${key} is taken on this record; pick another`);
    const live = all.filter((f) => !f.archivedAt);
    if (live.length >= CUSTOM_MOST) refuse(`at most ${CUSTOM_MOST} fields per record`);
    const [made] = await db
      .insert(customFields)
      .values({
        owner,
        record: input.record,
        key,
        label,
        kind,
        options: kind === "choice" ? optionsOf(input.options) : null,
        position: live.length ? Math.max(...live.map((f) => f.position)) + 1 : 0,
        createdBy: by,
        updatedBy: by,
      })
      .returning();
    return made as CustomField;
  }
  const [now] = await db
    .select()
    .from(customFields)
    .where(and(eq(customFields.id, input.id), ownerIs(customFields.owner, owner)));
  if (!now) throw new PortalRefusal("no such field", 404);
  if (input.kind !== undefined && input.kind !== now.kind) refuse("a field's kind is fixed");
  if (input.key !== undefined && input.key !== now.key) refuse("a field's key is fixed");
  let options = now.options;
  if (now.kind === "choice" && input.options) {
    options = optionsOf(input.options);
    const kept = new Set(options.map((o) => o.key));
    const gone = (now.options ?? []).map((o) => o.key).filter((k) => !kept.has(k));
    if (gone.length) {
      const [used] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(customFieldValues)
        .where(
          and(
            eq(customFieldValues.field, now.id),
            sql`${customFieldValues.value} #>> '{}' in (${sql.join(
              gone.map((g) => sql`${g}`),
              sql`, `,
            )})`,
          ),
        );
      if ((used?.n ?? 0) > 0) refuse("an option you dropped is still set on a record");
    }
  }
  const archive = input.archived === undefined ? undefined : input.archived;
  if (archive === false && now.archivedAt) {
    const live = await customFieldsOf(db, owner, now.record);
    if (live.length >= CUSTOM_MOST) refuse(`at most ${CUSTOM_MOST} fields per record`);
  }
  const [saved] = await db
    .update(customFields)
    .set({
      label,
      options,
      ...(archive === undefined ? {} : { archivedAt: archive ? sql`now()` : null }),
      updatedAt: sql`now()`,
      updatedBy: by,
    })
    .where(eq(customFields.id, now.id))
    .returning();
  return saved as CustomField;
}

/** Put an owner's live fields on a record type in this order; the rest follow. */
export async function orderCustomFields(
  db: Queryable,
  owner: string | null,
  record: string,
  ids: readonly string[],
  by: string,
): Promise<void> {
  const live = await customFieldsOf(db, owner, record);
  const known = new Set(live.map((f) => f.id));
  const order = [
    ...ids.filter((id) => known.has(id)),
    ...live.map((f) => f.id).filter((id) => !ids.includes(id)),
  ];
  for (const [i, id] of order.entries())
    await db
      .update(customFields)
      .set({ position: i, updatedAt: sql`now()`, updatedBy: by })
      .where(eq(customFields.id, id));
}

/** One record's custom values, by key; a field with none is null. */
export async function customValuesOf(
  db: Queryable,
  fields: readonly CustomField[],
  row: string,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f.key, null]));
  if (!fields.length) return out;
  const rows = await db
    .select({ field: customFieldValues.field, value: customFieldValues.value })
    .from(customFieldValues)
    .where(
      and(
        inArray(
          customFieldValues.field,
          fields.map((f) => f.id),
        ),
        eq(customFieldValues.row, row),
      ),
    );
  const keyOfId = new Map(fields.map((f) => [f.id, f.key]));
  for (const r of rows) {
    const k = keyOfId.get(r.field);
    if (k) out[k] = r.value;
  }
  return out;
}

/** Set one record's values by key, each checked by its field; null clears one. */
export async function setCustomValues(
  db: Queryable,
  fields: readonly CustomField[],
  row: string,
  values: Readonly<Record<string, unknown>>,
  by: string,
): Promise<void> {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const [k, raw] of Object.entries(values)) {
    const f = byKey.get(k) ?? refuse(`no field ${k} here`);
    const got = schemaOf(f).safeParse(keptOf(f, raw));
    if (!got.success) refuse(`${f.label}: ${got.error.issues[0]?.message ?? "doesn't fit"}`);
    const v = got.data ?? null;
    if (v === null)
      await db
        .delete(customFieldValues)
        .where(and(eq(customFieldValues.field, f.id), eq(customFieldValues.row, row)));
    else
      await db
        .insert(customFieldValues)
        .values({ field: f.id, row, value: v, updatedBy: by })
        .onConflictDoUpdate({
          target: [customFieldValues.field, customFieldValues.row],
          set: { value: v, updatedAt: sql`now()`, updatedBy: by },
        });
  }
}

/** A field's key back from its column on the type: `x_roof_age` is roof_age. */
const keyOfColumn = (c: string) => c.slice(2);

/**
 * Each type that takes custom fields, with its owner's live ones on it for this request: a
 * field each, and edits that write them alongside the type's own.
 */
export async function withCustomFields(
  types: readonly RecordType[],
  db: Queryable,
): Promise<RecordType[]> {
  return Promise.all(
    types.map(async (t) => {
      if (!t.custom) return t;
      const live = await customFieldsOf(db, t.custom.owner, t.id);
      if (!live.length) return t;
      return customType(t, live);
    }),
  );
}

function customType(t: RecordType, live: readonly CustomField[]): RecordType {
  const custom = t.custom as NonNullable<RecordType["custom"]>;
  const fields = { ...t.fields };
  for (const f of live) fields[customColumn(f.key)] = fieldOf(f);
  const columns = live.map((f) => customColumn(f.key));
  const base = t.edits;
  if (!base && !custom.exists) throw new Error(`${t.id}: custom fields need exists or edits`);
  const shape = Object.fromEntries(live.map((f) => [customColumn(f.key), schemaOf(f)]));
  const ours = z.object(shape).partial().strict();
  const split = (v: Values) => {
    const own: Values = {};
    const mine: Values = {};
    for (const [k, x] of Object.entries(v)) (columns.includes(k) ? mine : own)[k] = x;
    return { own, mine };
  };
  const patch = z.record(z.string(), z.unknown()).transform((v, ctx) => {
    const { own, mine } = split(v);
    const kept = Object.fromEntries(
      Object.entries(mine).map(([k, x]) => [
        k,
        keptOf(live.find((f) => customColumn(f.key) === k) as CustomField, x),
      ]),
    );
    const a = ours.safeParse(kept);
    const b = base ? base.patch.safeParse(own) : null;
    if (!base && Object.keys(own).length)
      ctx.addIssue({ code: "unrecognized_keys", keys: Object.keys(own), input: v });
    for (const e of [a, b])
      if (e && !e.success)
        for (const i of e.error.issues) ctx.addIssue({ ...i, input: v } as never);
    if (!a.success || (b && !b.success) || (!base && Object.keys(own).length)) return z.NEVER;
    return { ...(b?.success ? b.data : {}), ...a.data } as Values;
  }) as unknown as z.ZodType<Values>;
  const read = async (db: Queryable, id: string): Promise<Values | null> => {
    const own = base ? await base.read(db, id) : (await custom.exists?.(db, id)) ? {} : null;
    if (!own) return null;
    const values = await customValuesOf(db, live, id);
    return {
      ...own,
      ...Object.fromEntries(Object.entries(values).map(([k, v]) => [customColumn(k), v])),
    };
  };
  const edits: RecordEdits = {
    ...(base ?? {}),
    fields: [...(base?.fields ?? []), ...columns],
    patch,
    ...(base?.check
      ? {
          check: (p: Values, now: Values, db: Queryable, id: string) =>
            (base.check as NonNullable<RecordEdits["check"]>)(split(p).own, now, db, id),
        }
      : {}),
    read,
    write: async (db, id, p, by) => {
      const { own, mine } = split(p);
      if (base && Object.keys(own).length) await base.write(db, id, own, by);
      if (Object.keys(mine).length)
        await setCustomValues(
          db,
          live,
          id,
          Object.fromEntries(Object.entries(mine).map(([k, v]) => [keyOfColumn(k), v])),
          by,
        );
    },
  };
  return { ...t, fields, edits, custom: { ...custom, keys: live.map((f) => f.key) } };
}

/** An owner's business facts, by key. */
export function businessFacts(main: Queryable, owner: string | null): Promise<CustomValue[]> {
  return main
    .select()
    .from(customValues)
    .where(ownerIs(customValues.owner, owner))
    .orderBy(asc(customValues.key));
}

/** Add or change one business fact; an empty value removes it. */
export async function saveBusinessFact(
  main: Queryable,
  owner: string | null,
  input: { key?: string; label: string; value: string },
  by: string,
): Promise<CustomValue | null> {
  const label = String(input.label ?? "").trim();
  if (!label) refuse("name the fact");
  if (label.length > 80) refuse("a fact's name is over 80 characters");
  const key = input.key ? String(input.key) : keyOf(label);
  if (!KEY.test(key)) refuse("a key takes lowercase letters, digits and _, a letter first");
  const value = String(input.value ?? "").trim();
  if (value.length > CUSTOM_VALUE_MOST) refuse(`a fact is at most ${CUSTOM_VALUE_MOST} characters`);
  if (!value) {
    await main
      .delete(customValues)
      .where(and(ownerIs(customValues.owner, owner), eq(customValues.key, key)));
    return null;
  }
  const [row] = await main
    .insert(customValues)
    .values({ owner, key, label, value, createdBy: by, updatedBy: by })
    .onConflictDoUpdate({
      target: [customValues.owner, customValues.key],
      set: { label, value, updatedAt: sql`now()`, updatedBy: by },
    })
    .returning();
  return row as CustomValue;
}

/** A value as copy says it: a choice by its label, a yes/no as Yes or No, a date as its day. */
function said(f: CustomField, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (f.kind === "choice") return f.options?.find((o) => o.key === v)?.label ?? String(v);
  if (f.kind === "yes_no") return v === "yes" ? "Yes" : "No";
  if (f.kind === "date" && typeof v === "string") return v.slice(0, 10);
  return String(v);
}

/**
 * The facts copy may quote for an owner: `biz.<key>` for each business fact, and with a
 * subject (`deal:<id>`), `field.<key>` for each custom field set on that record.
 */
export async function customFacts(
  main: Queryable,
  owner: string | null,
  subject?: string | null,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const b of await businessFacts(main, owner)) out[`biz.${b.key}`] = b.value;
  const [prefix, id] = subject
    ? [subject.slice(0, subject.indexOf(":")), subject.slice(subject.indexOf(":") + 1)]
    : [];
  const record = prefix ? CUSTOM_SUBJECTS[prefix] : undefined;
  if (record && id) {
    const live = await customFieldsOf(main, owner, record);
    const values = await customValuesOf(main, live, id);
    for (const f of live) {
      const s = said(f, values[f.key]);
      if (s !== null) out[`field.${f.key}`] = s;
    }
  }
  return out;
}

/**
 * The Set field node's step: one custom field on the event's subject record, its value filled
 * from the event. A subject that takes no fields leaves by `skip`; a field gone or a value that
 * doesn't fit fails the step.
 */
export function setFieldStep(main: Queryable): Step {
  return async (_port, e, at) => {
    const cut = e.subject.indexOf(":");
    const record = cut > 0 ? CUSTOM_SUBJECTS[e.subject.slice(0, cut)] : undefined;
    if (!record) return [{ port: "skip", event: e }];
    const key = String(at.with.field ?? "");
    const f = (await customFieldsOf(main, at.client, record)).find((x) => x.key === key);
    if (!f) throw new restate.TerminalError(`Set field: no field ${key} on ${record}`);
    const raw = fillText(String(at.with.value ?? ""), e).trim();
    const value = raw === "" ? null : f.kind === "number" || f.kind === "money" ? Number(raw) : raw;
    try {
      await setCustomValues(
        main,
        [f],
        e.subject.slice(cut + 1),
        { [key]: value },
        `workflow:${at.workflow}`,
      );
    } catch (err) {
      if (err instanceof PortalRefusal)
        throw new restate.TerminalError(`Set field: ${err.message}`);
      throw err;
    }
    const fields = {
      ...((e.data.fields as Record<string, unknown> | undefined) ?? {}),
      [key]: value,
    };
    return [{ port: "out", event: { ...e, data: { ...e.data, fields } } }];
  };
}
