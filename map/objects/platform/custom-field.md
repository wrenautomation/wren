---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-09 @ 84ffb2b4
entity: packages/core/src/custom-schema.ts:43
---

# custom-field

An owner's own fields on a record type ("Roof age" on deals) and its business facts (designs/2026-10-09-custom-fields.md). Tables `custom_fields`, `custom_field_values`, `custom_values`, migration 0216. Account > Fields and Business facts.

## Why this shape

One layer over record types, not a column per field: no migration per client field, and every list, filter, sort, count and edit path works unchanged. A field becomes column `x_<key>` on the type for the request. Values sit in the database that holds the record, so the join never crosses databases.

## Shape

- `custom_fields`: `owner` (client, null is Wren; FK clients, cascade), `record` (type id), `key` (slug, fixed), `label`, `kind` (text, number, money, date, choice, yes_no, link; fixed), `options` (choice), `position`, `archived_at`. Unique (owner, record, key), nulls not distinct. 50 live per owner and type.
- `custom_field_values`: (`field`, `row`) primary key, `value` jsonb (2,000 chars max as text). Null clears.
- `custom_values`: business facts, (owner, key) unique; an empty value deletes.
- A type opts in with `custom: { owner, exists? }` on its declaration (`CUSTOM_RECORDS`). First: `deals.deal` in main. `withCustomFields(types, db)` adds the live fields and merges edits (one form, one history, undo); `serveRecords` joins the values laterally.
- Copy: `customFacts(main, owner, subject)` gives `biz.<key>` and `field.<key>`; wired into workflow follow-up texts (`channel-sms/follow.ts`).
- Workflow node `logic.set_field` (`setFieldStep`): one field on the subject's record (`CUSTOM_SUBJECTS`: `deal:`); others leave by skip. Dry tests say what it would set.
- Console routes `customFields`, `customFieldSave`, `customFieldOrder`, `businessFacts`, `businessFactSave` (`custom-console.ts`; read to see, `manage` to change).

Citations: `packages/core/src/custom-schema.ts:43`, `packages/core/src/custom-fields.ts:1`, `packages/core/src/custom-console.ts:1`, `packages/core/src/records-serve.ts:439`, `apps/portal/web/src/modules/account/Fields.tsx:1`

## Connected to

- **owns:** `custom_fields`, `custom_field_values`, `custom_values`
- **owned-by:** [[platform/records]]
- **joins:** [[clients/client]] by `owner` (cascade); [[platform/deal]] by `row`
- **looks-like-but-is-not:** a record type's declared fields ([[platform/records]]); setting rows ([[platform/settings]]); a client's facts held for Wren's marketplace

## If you change this

- **Hits:** every list of an opted type (its columns), its edit form, follow-up texts quoting `{biz.*}` or `{field.*}`, workflows with Set field. A key is a contract with copy and workflows: never rename one.
- **Does not hit:** a type without `custom`; the record's own table.

## Surfaces

| Surface | Role |
|---|---|
| Account > Fields, Business facts (`Fields.tsx`) | add, rename, order, options, archive; facts with their `{biz.key}` mark |
| deals records | values shown, filtered, edited |
| workflow canvas | Set field node |
