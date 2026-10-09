# Custom fields and custom values

2026-10-09. Gaps item 9, entry 4 (`2026-10-07-product-audit.md`: GHL Custom Fields and Custom
Values, Zapier Tables, Make Data stores). A client keeps its own facts on its deals and people,
and its business facts once, and copy quotes both.

## Today

Every record type has a fixed schema. Business facts sit in each channel's settings
(`booking_link` on texts) or nowhere: a template can't say `{biz.phone}`.

## Shape

Two parts.

- **Custom fields:** fields an owner adds to a record type: "Roof age" on deals, "Policy
  renewal" on people. Kinds: text, number, money, date, choice (options, each a tint), yes/no,
  link. Shown, filtered, sorted, counted and edited like declared fields.
- **Custom values:** an owner's business facts, key and value: `phone`, `address`, `hours`,
  `review_link`. One place, quoted by every template.

## Data (migration 0216, every database)

- `custom_fields`: `id` uuid, `owner` (client id, null is Wren), `record` (record type id,
  "deals.deal"), `key` (slug, 40), `label`, `kind`, `options` (jsonb, choice only: key and
  label), `position`, `archived_at`, `created_*`, `updated_*`. Unique (owner, record, key),
  nulls not distinct.
- `custom_field_values`: `field` (fk, cascade), `row` (the record's key as text), `value`
  (jsonb), `updated_at`, `updated_by`. Primary key (field, row).
- `custom_values`: `owner`, `key`, `label`, `value` (text, 2,000), `updated_*`. Unique (owner,
  key). Main database only.

Fields and values sit in the database that holds the record: deals in main, a client's people in
its own. The migrations run on every database, so the tables are everywhere.

Archive, never delete: an archived field hides, its values stay (store all data). A field's kind
is fixed once it has values; archive it and add another.

## Records

- A declaration opts in with `custom: { owner }` (the owner whose fields it takes, in its
  database). First: `deals.deal`, in main. `reactivation.person` (a client's own database)
  waits for round two. Any type adds one line later.
- `serveRecords` reads the opted types' live fields in one query. Each becomes field
  `x_<key>`, its kind mapped (choice and yes/no are `status`). The type's source gains one left
  join: values of that type's fields, aggregated per row as jsonb, each field a column cast once
  by kind. Filters, sorts, page cursors, counts and the footer stats then need nothing new.
- **Edits:** custom fields join the type's `edits` (one form, one history, undo, Ask Claude).
  `read` adds their values; `write` splits the patch and upserts `custom_field_values`. A type
  with no edits gets edits for its custom fields only. Each edit leaves its `changes` row as
  today.
- Cap: 50 live fields per owner and record type; a value up to 2,000 characters.

## Copy

- `{biz.<key>}` quotes a custom value; `{field.<key>}` a custom field of the record a send is
  about (the spine subject: `deal:<id>`, `person:<id>`). A missing one is a missing fact, as
  any field: a bare one refuses the draft, a fallback or a group handles it.
- `customFacts(main, owner, subject)` returns both sets. Wired into workflow follow-up texts,
  before the pure `render()`. Render stays pure. The fixed text slots (reminders, missed call)
  keep their field lists for now.
- `booking_link` stays where it is; a client's custom value `booking_link` wins when set.

## Workflows

- Node **"Set field"** (`logic.set_field`): sets one custom field on the event's subject record,
  value fixed or `{{data.path}}`. Pure on the database only, so dry tests show the write and
  don't make it. Round one takes the field's key as text; a picker of the owner's fields comes later.
- Set field puts what it set on the event's `data.fields`, so later If/else and Code nodes see
  `data.fields.roof_age`. Loading every field onto each event waits for round two.

## Portal

- **Settings → Fields:** per record type, the fields in order: add, rename, reorder, edit
  choice options, archive. Kind picked once.
- **Settings → Business facts:** the custom values, key, label, value, with the template mark
  to copy (`{biz.phone}`).
- Record lists and details show them after the declared fields, grouped "Custom fields".
- Team and the client's admins edit fields; anyone who may edit the record edits its values.

## Not in this round

- Custom objects (a record type a client defines): L in the audit. Not until a client asks.
- Formula or rollup fields.
- A trigger on a field change. Set field plus the deal and form triggers cover the asks so far.

## Shipped

- 2026-10-09: round one. Tables (0216), deals in main, Account > Fields and Business facts, Set
  field, follow-up texts quote `{biz.*}` and `{field.*}`. Map card `platform/custom-field`.

## Decision log

- 2026-10-09: my calls (William: build it all, ask nothing). One layer over record types, not a
  column per field: no migration per client field, and every list, filter and edit path works
  unchanged. Values in the record's own database, so the join never crosses databases.
