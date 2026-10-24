---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-22 @ 1d8e91bb
entity: packages/core/src/custom-schema.ts:43
---

# custom-field

An owner's own fields on a record type ("Roof age" on a record type) and its business facts (designs/2026-10-09-custom-fields.md). Tables `custom_fields`, `custom_field_values`, `custom_values`, migration 0216. Account > Fields and Business facts.

## Why this shape

One layer over record types, not a column per field: no migration per client field, and every list, filter, sort, count and edit path works unchanged. A field becomes column `x_<key>` on the type for the request. Values sit in the database that holds the record, so the join never crosses databases.

## Shape

- `custom_fields`: `owner` (null: the database's own workspace, Wren in main, the client in its own database; a client id only in main; FK clients, cascade), `record` (type id), `key` (slug, fixed), `label`, `kind` (text, number, money, date, choice, yes_no, link; fixed), `options` (choice), `position`, `archived_at`. Unique (owner, record, key), nulls not distinct. 50 live per owner and type.
- `custom_field_values`: (`field`, `row`) primary key, `value` jsonb (2,000 chars max as text). Null clears.
- `custom_values`: business facts, (owner, key) unique; an empty value deletes.
- A type opts in with `custom: { owner, exists? }` on its declaration (`CUSTOM_RECORDS`). `pipeline.journey` opts in again (`journeyRecord`, `packages/pipeline/src/records.ts`; the old `deals.deal` opt-in went with `@wren/deals`); `pipeline.deal` opts in too (`deal:` in `CUSTOM_SUBJECTS`). The pipeline console reads the workspace's fields with owner null from the database that serves the record (`typesFor`, `console/console-api.ts`) and drops the form edit, since it has no `recordsEdit`. Settings > Fields (`customApi`'s `onClient`) and Set field (`setFieldStep(main, open)`) write a client's fields and values to its own database, owner null. `withCustomFields(types, db)` adds the live fields and merges edits (one form, one history, undo); `serveRecords` joins the values laterally.
- Copy: `customFacts(main, owner, subject, rows)` gives `biz.<key>` (main) and `field.<key>` (from `rows`, the record's database); wired into workflow follow-up texts (`channel-sms/follow.ts`).
- Workflow node `logic.set_field` (`setFieldStep`): one field on the subject's record (`CUSTOM_SUBJECTS`: `journey:` for `pipeline.journey`, `deal:` for `pipeline.deal`); others leave by skip. Dry tests say what it would set.
- Console routes `customFields`, `customFieldSave`, `customFieldOrder`, `businessFacts`, `businessFactSave` (`custom-console.ts`; read to see, `manage` to change).

Citations: `packages/core/src/custom-schema.ts:43`, `packages/core/src/custom-fields.ts:1`, `packages/core/src/custom-console.ts:1`, `packages/core/src/records-serve.ts:439`, `apps/portal/web/src/modules/account/Fields.tsx:1`

## Connected to

- **owns:** `custom_fields`, `custom_field_values`, `custom_values`
- **owned-by:** [[platform/records]]
- **joins:** [[clients/client]] by `owner` (cascade; facts, and fields in main); the record's id by `row`
- **looks-like-but-is-not:** a record type's declared fields ([[platform/records]]); setting rows ([[platform/settings]]); a client's facts held for Wren's marketplace

## If you change this

- **Hits:** every list of an opted type (its columns), its edit form, follow-up texts quoting `{biz.*}` or `{field.*}`, workflows with Set field. A key is a contract with copy and workflows: never rename one.
- **Does not hit:** a type without `custom`; the record's own table.

## Surfaces

| Surface | Role |
|---|---|
| Account > Fields, Business facts (`Fields.tsx`) | add, rename, order, options, archive; facts with their `{biz.key}` mark |
| records of a type that opts in | values shown, filtered, edited |
| workflow canvas | Set field node |
