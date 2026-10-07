# Templates: the database is the live copy, files are defaults (2026-10-07)

Builds on `2026-10-06-edits-claude-templates.md` (one store, `templates` and `template_versions`,
Publish, edits layer). That doc retired the `.email` files after one import. This one keeps them,
as defaults. No second store.

## Answer first

- **Defaults are files.** Wren's built-in copy lives in one tree in the repo. Claude Code edits it,
  git keeps its history. A deploy syncs each file into the store as a `default` version.
- **The live copy is a row.** Each client's `templates` rows sit in that client's database
  (`wren_client_<id>`). Wren's own copy is the main database. A template either follows the default
  or has its own live version.
- **Install** gives a client every template its parts need, following the defaults. **Reset** stops
  using the client's version, so the default applies again. The client's versions stay in history.
- **Every save is a version** with who, when and why, plus an audit entry. A save names the version
  it was opened from; if the live one moved, it is refused with "Changed since you opened it."
- **One CLI for Claude Code and agents:** `wren templates ls|get|set|diff|reset|history|restore`.
  Same versions, audit and approval as the UI.
- **One UI:** a folder browser in Library (tree, list, editor with live preview), version history,
  side by side diff, restore. The browser is a kit component other settings reuse.
- **Permissions** come from scoped access: editing needs `act` on the template's app and channel.
  Making a version live on anything that sends goes to "To approve". Agents can propose, never
  approve.
- **Rendering stays logic-free.** Slots only, values escaped for email, CR/LF stripped from
  subjects, AI fills capped and code-checked.

## Storage: text rows, not blobs

Templates are a few KB of text. Postgres keeps them inline (TOAST compresses anything large), and
we need them inside transactions: compare-and-swap on save, diff, search, audit in the same commit.
An object store with pointers would add a second write that can fail apart from the row and buys
nothing at this size. Media (images, video) stays in the media library as it is today.

## Shape

| Change | Where |
|---|---|
| `templates.folder` (text, `a/b`): where it shows in the browser. Moving it never changes the ref code uses (`kind`, `system`, `name`) | schema + migration |
| `templates.follows_default` (bool): true = live is the newest default version | schema |
| `template_versions.origin`: `default`, `edit`, `restore`, `ai`, `import` | schema |
| `template_versions.why` (text), `opened_from` (version id) | schema |
| `template_versions.default_hash`: the file's hash, for `default` versions | schema |
| kind `post` beside `email`, `sms`, `dm`, `prompt` | `slots/kinds.ts` |
| `resolveTemplate(db, ref)`: own live version, else newest default | `core/src/templates.ts` |

Reads that send (email compose, `liveTexts`, `liveDms`, posts, `livePrompt`) go through
`resolveTemplate`. A send still pins the exact version id it used.

## Defaults tree

One tree: `packages/templates/defaults/<kind>/<system>/<folder>/<name>.<ext>`.

- The path is the default folder in the browser.
- Email `.email` files move here from `packages/niches/templates`.
- Prompts move out of code constants into files. Code reads them through the loader.
- SMS, DM and post defaults start from the copy in the store today.
- `wren templates sync` (run on deploy) writes each changed file as a new `default` version in
  every database. A client following the default gets it at once. A client with their own copy
  sees "Default updated" with a diff and can take it or keep theirs.

Defaults must reach the Lambda bundle the same way niche files do today. Repo is public: defaults
hold no client names, amounts or lead data.

## Versions, audit, conflicts

- Save: a new version, `origin=edit`, `why` asked in one line (optional in the UI, required in the
  CLI), `opened_from` set. Compare-and-swap on the draft or live version the editor opened. On a
  miss: "Changed since you opened it," with a diff of theirs against the current one, and two
  choices: reload, or save on top.
- Every save, publish, reset and restore writes the audit log in the same transaction.
- Restore makes a new version copying an old one (`origin=restore`). Nothing is overwritten.
- History and Undo keep working through the edits layer (`TEMPLATE_EDITS`).

## CLI

Ref: `<kind>:<system>/<name>`, e.g. `email:recruiting/book-first/opener`. `--client <id>` picks a
client's database; the default is Wren's own.

| Command | Does |
|---|---|
| `ls [folder] [--kind k] [--status s]` | tree or list, with status: default, edited, default updated, waiting approval |
| `get <ref> [--version n \| --default]` | the words, plus the version number to pass back |
| `set <ref> <file\|-> --why "..." --expect <n> [--publish]` | saves a version; `--publish` asks for approval on sending kinds |
| `diff <ref> [a] [b]` | default against live, or any two versions |
| `history <ref>` | versions with who, when, why, origin |
| `restore <ref> <n> --why "..."` | new version copying `n` |
| `reset <ref> --why "..."` | follow the default again |
| `install --client <id>` | the templates the client's parts need, following defaults |

The old `import`, `list`, `save`, `publish`, `show` go away.

## Permissions and approval

- The scoped-access check (`can(who, "act", {app, channel})`, `2026-10-06` access design) decides
  who edits. App comes from the kind: email and SMS and DM to their channel apps, `post` to
  Content, `prompt` to the package that asks it.
- Publishing a version of email, SMS, DM or post creates a "To approve" item. Approving makes it
  live. The Inbox stays inbound only.
- Prompts publish directly: their output is a draft that still needs approval before it sends.
- A CLI or agent identity can save and propose. Only a person approves.

## Render safety

- Logic-free: slots (`{x}`), variants (`[[a|b]]`), groups (`((g))`), AI fills (`<<prompt>>`).
  No expressions, no eval. A test feeds hostile sources (`{constructor}`, `{__proto__}`,
  `{a.b()}`, `${x}`, `{{x}}`, `<%= x %>`) and checks each renders literally or fails to author,
  and that the slots package never imports `eval`, `Function` or `vm`. Lookups read own
  properties only.
- Email: the body is plain text turned into HTML with every line escaped
  (`channel-email/src/send/transport.ts:147`). A test pins that a slot value with markup arrives
  escaped.
- Subjects and header values (from name, reply-to) get CR and LF stripped at render.
  `renderedSubject` does not strip today; fix it there and in the slot render.
- SMS and DM: control characters other than newline stripped.
- AI fills: a length cap per slot (200 characters unless the slot says otherwise), one line unless
  declared, no URLs unless declared, no slot syntax in the output, no tools. Code checks the
  result; a fill that fails holds the unit. Scraped text goes in as quoted data marked untrusted,
  never as instructions.

## UI

Library, Templates becomes the browser. It is the first use of a kit `Browser` component (tree,
list, detail) that niches, SOPs, offers and settings reuse, since organization is the first
priority.

- Left: folders. Create, rename, move (drag or "Move to"). Counts per folder.
- Middle: rows with name, kind, status chip (Default, Edited, Default updated, Waiting approval),
  last edit by and when. Search across names and words. Filters by kind, app, status.
- Right: the editor with live preview (the existing render for the sample lead). Save asks why.
  Publish, Reset to default, History.
- History: versions with who, when, why and origin; live marked. Pick two to diff (side by side
  at 1440, unified at 390). Restore on any row.
- Conflict: the "Changed since you opened it" banner with the diff and both choices.
- At 390 the tree folds into a breadcrumb.

## Legacy tables

A migration copies any `sms_templates` or `reach_templates` row not already in the store, checks
the counts match, then drops both tables. Code that still reads them moves to `resolveTemplate`.

## Build (one implementer)

1. Schema, `resolveTemplate`, compare-and-swap with `why`, audit writes, the `post` kind. Render
   safety tests and the CR/LF fix.
2. Defaults tree, loader, `sync`, moving the email files and prompts, install, reset, the legacy
   drop.
3. The CLI.
4. Permission check and "To approve" on publish, using the scoped-access builder's API.
5. The `Browser` kit component, editor, history, diff, restore, conflict. Screenshots at 1440 and
   390.

## Left out

- Promoting a client's copy to a Wren default from the UI. Claude Code edits the file.
- Per-user (rather than per-client) copies inside one client.
- Template marketplace or sharing between clients.

## Decision log

- 2026-10-07: William: database is the live copy, files are defaults only; versions with
  who/when/why and audit; CLI for Claude Code; scoped-access permissions; publishes that send go
  to "To approve"; logic-free render with escaping. Text rows over blobs (my call, per William).
  Reset keeps the client's versions in history rather than deleting them (store all data). Folder
  is display only, so moving a template never breaks a ref.
- 2026-10-07, step 1 (builder): versions get a per-template `number` (1, 2, 3), what people read
  and what `--expect` names. The hash stays as `version` (what a send pins) but is no longer
  unique: a restore or a default can repeat old words. `uq_template_versions_niche` becomes an
  index; `(template_id, number)` is unique. The migration numbers kept versions in save order and
  sets `origin` to `import` or `ai` where it can tell.
- 2026-10-07, step 1: one ask per template, stored on the row (`waiting_version_id`,
  `waiting_by`), so "To approve" needs no new table. `templates.why` keeps why live last changed.
  The audit actor is set in each write's transaction; the audit triggers do the rest.
- 2026-10-07, step 1: `live_version_id` stays the truth. Following a default sets it to the
  newest default; until a database first syncs, reads fall back to the newest default when
  `follows_default` is set. First sync makes copy that was already here follow the default only
  when its live words are the file's, so nobody's edit is replaced.
- 2026-10-07, step 1: the compare-and-swap target is what the editor opened: the draft, else the
  live version. Saving the live words again clears the draft rather than adding a version.
- 2026-10-07, step 1: publishing is no longer a record edit (`liveVersion` patch). It goes
  through the templates service so the permission check and approval sit in one place. Words
  still save through `TEMPLATE_EDITS`, so History and Undo cover saves.
- 2026-10-07, step 1: reset is direct, no approval: it goes back to copy Wren already ships.
- 2026-10-07, step 1: control characters are stripped from posts too, and the fill cap is 200
  characters on top of the 25-word cap. The slot prompt now says quoted lead details are data,
  never instructions.
