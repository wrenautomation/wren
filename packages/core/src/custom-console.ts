/**
 * Settings → Fields and Business facts (designs/2026-10-09-custom-fields.md): an owner's custom
 * fields on each record type that takes them, and their business facts. Anyone who reads there
 * sees them; changing them needs `manage` there. Values are edited on the record itself.
 */
import type * as restate from "@restatedev/restate-sdk";
import { type Db, type Queryable, serializable, setAuditActor } from "@wren/db";
import { can, WREN } from "./access.js";
import { placeOf } from "./access-console.js";
import {
  businessFacts,
  customFieldsOf,
  type FieldInput,
  orderCustomFields,
  saveBusinessFact,
  saveCustomField,
} from "./custom-fields.js";
import type { CustomField, CustomValue } from "./custom-schema.js";
import { answer, PortalRefusal, type PortalRequest } from "./portal.js";
import { CUSTOM_RECORDS } from "./records.js";

type Input = PortalRequest & Record<string, unknown>;

/** What Settings → Fields shows: the types that take fields, and the asked one's fields. */
export interface FieldsView {
  records: { id: string; name: { one: string; many: string } }[];
  record: string | null;
  fields: CustomField[];
}

const recordOf = (v: unknown): string => {
  if (typeof v !== "string" || !CUSTOM_RECORDS.has(v))
    throw new PortalRefusal("that list takes no fields", 404);
  return v;
};

export function customApi(main: Db) {
  /** Where the request looks, as an owner (null is Wren), refused past `need` there. */
  const at = async (req: PortalRequest, need: "read" | "manage") => {
    const p = await placeOf(main, req);
    if (!can(p.who, need, { client: p.client }))
      throw new PortalRefusal(need === "read" ? "no access" : "you don't manage this here", 403);
    return { owner: p.client === WREN ? null : p.client, by: p.by };
  };
  const change = async <T>(
    req: PortalRequest,
    fn: (tx: Queryable, owner: string | null, by: string) => Promise<T>,
  ) => {
    if (req.viewAs) throw new PortalRefusal("view as is read-only", 403);
    const { owner, by } = await at(req, "manage");
    return serializable(main, async (tx) => {
      await setAuditActor(tx, by);
      return fn(tx, owner, by);
    });
  };
  return {
    customFields: async (req: Input): Promise<FieldsView> => {
      const { owner } = await at(req, "read");
      const records = [...CUSTOM_RECORDS].map(([id, name]) => ({ id, name }));
      const record = req.record === undefined ? (records[0]?.id ?? null) : recordOf(req.record);
      return {
        records,
        record,
        fields: record ? await customFieldsOf(main, owner, record, { archived: true }) : [],
      };
    },
    customFieldSave: (req: Input): Promise<CustomField> =>
      change(req, (tx, owner, by) =>
        saveCustomField(
          tx,
          owner,
          {
            ...(req as unknown as FieldInput),
            record: recordOf(req.record),
          },
          by,
        ),
      ),
    customFieldOrder: (req: Input): Promise<CustomField[]> =>
      change(req, async (tx, owner, by) => {
        const record = recordOf(req.record);
        const ids = Array.isArray(req.ids) ? req.ids.map(String) : [];
        await orderCustomFields(tx, owner, record, ids, by);
        return customFieldsOf(tx, owner, record, { archived: true });
      }),
    businessFacts: async (req: Input): Promise<CustomValue[]> => {
      const { owner } = await at(req, "read");
      return businessFacts(main, owner);
    },
    businessFactSave: (req: Input): Promise<CustomValue[]> =>
      change(req, async (tx, owner, by) => {
        await saveBusinessFact(
          tx,
          owner,
          {
            ...(typeof req.key === "string" && req.key ? { key: req.key } : {}),
            label: String(req.label ?? ""),
            value: String(req.value ?? ""),
          },
          by,
        );
        return businessFacts(tx, owner);
      }),
  };
}
export type CustomApi = ReturnType<typeof customApi>;

export function customHandlers(api: CustomApi) {
  const write = (name: keyof CustomApi, label: string) => (ctx: restate.Context, req: Input) =>
    answer(() => ctx.run(label, () => answer(() => api[name](req) as Promise<unknown>)));
  return {
    customFields: (_: restate.Context, req: Input) => answer(() => api.customFields(req)),
    customFieldSave: write("customFieldSave", "save field"),
    customFieldOrder: write("customFieldOrder", "order fields"),
    businessFacts: (_: restate.Context, req: Input) => answer(() => api.businessFacts(req)),
    businessFactSave: write("businessFactSave", "save fact"),
  };
}
