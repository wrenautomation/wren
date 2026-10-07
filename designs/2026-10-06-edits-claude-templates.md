# Edits, Ask Claude and templates: one layer each

2026-10-06. William: "first class editing and claude integration exists but is not principled and
isn't everywhere, isn't clear separation / visibility into template system that we run for all
cold outreach systems". Building on his "go on everything".

## What's there

- **Editing** is built per page:
  - Drafts have Save, Undo and Ask Claude (`DraftAsk`, five kinds).
  - The video has its own patch path (`editPatchSchema`, `setEdit`).
  - SMS and DM copy save one text with no history.
  - Settings save with no undo.
  - `defineRecord` can't say a field is editable.
  - Email copy, every sequence step, offers and prompts can't be edited in the portal at all.
- **Ask Claude:**
  - ⌘K answers questions and changes nothing. It knows only the page URL.
  - Drafts and the video can take a change from Claude, each by its own path.
- **Templates** are three systems:
  - Email: `.email` files in git, with variants, experiments and stats.
  - SMS and DMs: tables with one live text each, no versions, no variants, and no stats in the
    portal.
  - Reactivation: a prompt in code.
  - Three fill syntaxes and four step types.
  - Nothing in the portal shows a step's template, its variant and its numbers together.

## 1. Records declare their edits

`defineRecord` takes `edits`: the fields a person may change, a zod patch schema, a check, and
the store that writes it. The records layer serves edit, history and undo for every record that
declares edits. Edits are compare-and-swap on a version, so two people can't overwrite each
other.

Every change writes a `changes` row: record, id, before, after, who (a person or Claude), and the
run. History and Undo read it.

The portal draws inline edit, a History tab and Undo from the declaration. No page builds its
own. Drafts, video edits, SMS and DM copy, and Shop settings all move onto it.

## 2. Ask Claude on any record

Every record with edits gets Ask Claude in its panel. Claude gets:

- the record;
- its patch schema;
- the record's declared `context` (the lead, the playbook or SOP, the stats);
- the last five edits by people.

It returns a reply and a patch. The patch passes the record's schema and check, and shows as a
diff. Accept applies it through the same edit path, so History and Undo cover it.

⌘K gets the record you have open, not just the URL. When that record has edits, it can propose a
patch there too. It still runs on the desk's `claude` service on William's Mac, at $0. `DraftAsk`
and the video desk move onto this path.

## 3. One template system for all outreach

| Noun | Is | Never holds |
|---|---|---|
| Template | Copy for one step on one channel (email subject and body, text, DM, or a model prompt), with slots | who or when |
| Version | Every save. Sends record the version they used. One version is live; editing makes a draft, Publish makes it live | |
| Variant | A/B arms of a template, picked by the existing pickers and experiments, on every channel | |
| Slot | One syntax everywhere: `{field\|fallback}`, `((group))`, `<<prompt>>`, `{offer.*}`. One parser, one check, one sample render | |
| Sequence | Ordered steps: channel, template, wait, stop rules. One `Step` type on the spine's cadences | copy |
| Campaign | Who, when, which sequence | copy |

- **Storage:** templates live in Postgres. Email's `.email` files are imported once and then
  retired. SMS and DM tables merge into it. Reactivation's prompt, Ask Claude's prompts and the
  video desk's prompt become templates of kind prompt, versioned and editable.
- **Stats:** sends, replies and bookings per template version and variant, for every channel,
  from one view.
- **Offers** stay in code for now, because the lander reads a snapshot of them.

## 4. Seeing it

Library > Templates lists every template. Filter by channel, by system (recruiting, agencies,
reactivation, a client's) and by state. Each one opens with:

- its live and draft versions;
- variants;
- slots with a sample render;
- the sequences and campaigns that use it;
- numbers per version.

Library > Sequences shows each step with its template, variant and numbers in one row. Both edit
in place with Ask Claude, History and Undo from 1 and 2.

## Rules

- Publishing a template version never sends anything. Sends still need William's yes.
- Tests use synthetic copy. No real lead or client names in fixtures.
- Repo copy moves out of git into the database, which also takes it out of the public repo.

## Build order

1. Records layer: `edits`, `changes`, edit, history and undo, with the UI drawn from them.
   Settings and SMS and DM copy move onto it.
2. Ask Claude on any record with edits; ⌘K gets the open record; drafts and the video move onto
   it.
3. Templates: one slot module, one `Step`, `templates` and `template_versions`, the email import,
   SMS and DM merged, variants and stats on every channel, prompts as templates.
4. Library > Templates and Sequences.

Steps 1 and 2 are the records layer and the UI. Step 3 is the channels' backend. They run in
parallel, then meet in 4.

## Decision log

- 2026-10-06: written from his note and a map of today's code. Building.
- 2026-10-06: steps 1 and 2's records layer built (5714dc3). `edits` on `defineRecord` or
  `withEdits`, the `changes` table (0129), edit with compare-and-swap, history and undo. Undo
  works once, and only while what it set still stands. Ask Claude runs as a runs row (command
  `record-ask`) that the Ask service answers on the desk; Accept goes through the same edit
  with the run id. Text and DM copy moved first. A keyword reply keeps its Edit action, since
  saving it also sets the provider's own reply, which a database write can't do.
- 2026-10-06: step 3 built (a010145, b4bf24b, 195b220, 6268a2a, 4037f8e; the email switch
  follows the prod import). The spine's `Step` is already its handler type, so the one step is
  `CadenceStep`, which now names its template. Texts and DMs read live from the store, and
  every send keeps its version and picks. `template_stats` (0128) counts sends and replies per
  version and variant on every channel. Booked is email only: texts and DMs can't tie a booking
  to a send yet. Prompts seed themselves: the code's words become version 1 on first use, and
  after that only a store edit changes them. A prompt renders exactly, facts untrimmed and ""
  a value. Reactivation keeps `COMPOSE_VERSION` as its cache key, so a prompt edit redrafts no
  one, and records the store version in `compositions.prompt_version`. Parity tests hold every
  `.email` file and all three prompts byte for byte against the old code. `review` and
  `deliverability` still read the files; they author, they don't send. `sms_templates` and
  `reach_templates` stay until a later migration drops them.
- 2026-10-06: Wren's own settings moved onto edits (8a349a6): `console.setting`, one row per
  setting, on Loops > Settings; `needs: "manage"` on the declaration. The Shop shows the values
  and links there. Drafts (DraftAsk) and the video edit stay on their own path for now: the
  templates builder is changing those files.
- 2026-10-06: Templates edit through the edits layer (9da9164). `TEMPLATE_EDITS` patches the
  words (a draft) or `liveVersion` (Publish); the check refuses texts and DMs, empty words,
  authoring errors and unknown versions. Publish is an inline action on `console/recordsEdit`,
  so its undo is a rollback, and it never sends. `templateDetail` gives live and draft words
  rendered for the made-up lead (`SAMPLE_LEAD`, the same as Play's), slots, variants, numbered
  versions with their numbers, and the campaigns that use it.
