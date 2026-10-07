# Training record: every draft, kept whole (2026-10-07)

William, 2026-10-07: "all this data should be able to be collected, viewed, exported, eventually i
want to rl some models to write in my voice and what not."

## Answer first

- **One append-only table, `draft_events`.** Every draft of every kind keeps one row per step:
  written, edited, approved, rejected, scheduled, sent, failed. Who did it (the model, him, or
  Claude at his ask, with the ask), the words, the time.
- **The first version keeps its input.** A model's draft stores the full prompt, system prompt,
  model, max tokens, usage and raw answer on its `generated` row. Rows are never updated, so that
  copy is immutable.
- **Decisions carry a reason.** Reject takes an optional quick pick and a short note, in the
  portal and the CLI. Sent freezes the final words with the platform's id and link.
- **Outcomes stay where they are.** `content_metrics` (snapshots over time, now with `follows`
  where the platform gives it), `comments` (replies and authors), `reach_messages` (DM replies),
  `reddit_threads` (a comment's score). The export joins them.
- **View:** every draft page shows its timeline (the records layer's Activity tab over a view) and
  its versions with a diff (a section the draft box adds).
- **Export:** `wren train export` (one JSONL line per draft), `wren train pairs` (preference
  pairs), and Export JSONL beside Export CSV on every list.
- **Backfill:** `wren train backfill` folds today's rows, `runs` and `audit_events` into the
  table. Idempotent; William runs it on prod.

## What was there (prod, read only)

| Step | Kept | Missing |
|---|---|---|
| Draft | text, `llm` envelope, `prompt_version`, `idea_id`, `playbook_id` (posts only) | prompt and context; comments, threads and DMs keep nothing of the call |
| Edits | `draft-set` / `draft-ask` / `draft-undo` runs, `keepSentEdit` | a version list per draft |
| Reject | status | why |
| Sent | final text overwritten in place, `published_id`, `url` | nothing frozen |
| Engagement | `content_metrics` snapshots | follows per post |
| Export | CSV per list | JSONL, joins, pairs |

## Why a table and not `changes` or template versions

`changes` is the records layer's edit log: field patches with a compare-and-swap version, main
only, person or Claude. Template versions are copy, not drafts. Neither has a model as author, a
prompt, a decision with a reason, a sent text or rounds (a DM contact gets a new draft per reply).
Bending either would break their Undo. One narrow table beside them, written at the few places
drafts change hands, keeps both intact. It exists in every database (one schema everywhere), so a
client's drafts keep their record in their own database.

## Shape: `draft_events`

| Column | Is |
|---|---|
| `id` | serial |
| `item` | the Inbox id: `draft:<uuid>` (post), `comment:<id>`, `thread:<id>`, `dm:<contact>`, `invite:<contact>`, `video:<id>` |
| `round` | which draft of the item, from 1. Only DMs and invites go past 1: a new model draft or a write after a send opens the next |
| `kind` | `post`, `comment`, `thread`, `dm`, `invite`, `video`; `invite_note` and `linkedin_comment` reserved |
| `platform` | `linkedin`, `reddit`, ...; null for none |
| `event` | `generated`, `edited`, `approved`, `rejected`, `scheduled`, `sent`, `failed` |
| `via` | `model`, `person`, `claude` (Claude at his ask), `wren` (the system: a scheduler, an import) |
| `by` | the model's name, his email, `cli`, `console`, `scheduler` |
| `text`, `title` | the words at this step (text events and `sent`) |
| `ask` | his words to Claude, or his redraft note |
| `reason`, `note` | reject quick pick and free text; a failure's error in `note` |
| `llm` | on a model's `generated`: `{stage, model, provider, system, prompt, max_tokens, usage, raw_text, version}` |
| `slot` | approved or scheduled for this time |
| `external_id`, `url` | the platform's id and link on `sent` |
| `meta` | links: `idea`, `redraft_of`, `redrafted_as`, `message`, `playbook`, `undo` |
| `run_id` | the `runs` row it came from |
| `ref` | unique when set: the backfill's key, so a second run adds nothing |
| `at` | when |

Indexes: `(item, id)`, `(kind, at)`, unique `ref`. Not audited: it is already an append-only log.

Reject quick picks (`REJECT_REASONS`): `voice` Not my voice, `facts` Wrong facts, `length` Too
long, `salesy` Too salesy, `topic` Off topic, `timing` Bad timing, `repeat` Said before. Note: 280
characters.

## Where rows are written

| Step | Post | Comment answer | Thread comment | DM / invite | Video |
|---|---|---|---|---|---|
| generated | `draftIdea`, `redraft` | `sortComment` | `draftThread` | `draftDm` | first title or description change |
| edited | `writeDraft` (box, Ask Claude, Undo, `wren drafts set`), `editDraft` from the desk and `wren content edit` | `writeDraft`, `keepSentEdit` | same | same | studio `setEdit` |
| approved / scheduled | `approveDrafts` (slot) | | | | `approveVideo` |
| rejected | `rejectDrafts` (reason), redraft supersedes | `dropComment` | `skipThread` | a draft cleared | |
| sent / failed | `claim` publish pass | `markAnswered` | `markCommented` | `queueDraft` | via its post |

## Follows per post

| Platform | Follows per post | How |
|---|---|---|
| Instagram | yes | `follows` media insight, read in its own call so a Reel that refuses it keeps the rest |
| YouTube | not yet | `subscribersGained` lives in the Analytics API: needs the `yt-analytics.readonly` scope and an autobrowse route |
| LinkedIn, X, Facebook, Reddit, TikTok | no | their APIs give no follows per post |

## Export

`wren train export [--kind k,...] [--since date] [--format jsonl] [--include-people] [--out f]`.
One line per item and round (`packages/core/src/train.ts`, `trainRecords`):

```json
{"schema":"wren.draft/1","id":"draft:…#1","item":"draft:…","kind":"post","platform":"linkedin",
 "round":1,"group":"idea:…/linkedin","started":"…",
 "input":{"stage":"content_draft","model":"…","provider":"…","system":"…","prompt":"…",
          "max_tokens":4000,"usage":{},"raw_text":"…","ask":null},
 "context":{"idea":"…","playbook":"…"},
 "versions":[{"n":1,"event":"generated","via":"model","by":"…","ask":null,"title":null,"text":"…","at":"…","llm":{}},
             {"n":2,"event":"edited","via":"person","by":"…","ask":null,"title":null,"text":"…","at":"…","llm":null}],
 "decisions":[{"event":"approved","via":"person","by":"…","reason":null,"note":null,"slot":"…","at":"…"},
              {"event":"sent","via":"wren","by":"scheduler","reason":null,"note":null,"slot":null,"at":"…"}],
 "final":{"text":"…","title":null,"at":"…","external_id":"…","url":"…"},
 "outcome":{"measured":"…","views":0,"reactions":0,"comments":0,"shares":0,"follows":null,
            "snapshots":3,"replies":[{"author":"[person]","text":"…","at":"…"}]}}
```

- `input` is the first model version's `llm` plus the redraft note; null when no model wrote it.
- A `sent` with the same words as the version before is a decision, not a new version.
- `final` is null until sent; `outcome` is null until sent and for an item with none. Outcomes
  come from the view `draft_outcomes`: a post's newest metrics snapshot and the replies under it,
  the replies to an answered comment or thread, a DM contact's messages back (each round gets the
  ones between its send and the next).
- People: by default commenters, thread authors, DM contacts (name, each part of it, handle) and
  repliers read `[person]` everywhere, prompts included, and every email in the words reads
  `[email]`. Names come from the view `draft_people`. `by` stays: his login or a role.
  `--include-people` keeps them all.

`wren train pairs [--kind] [--since] [--include-people] [--out f]`, one line per pair
(`trainPairs`):
`{"schema":"wren.pair/1","type","id","kind","platform","input","chosen":{"record","title","text"},"rejected":{…},"why":{…}}`.

- **edit:** the model's first version loses to what he kept (the sent words, else his last
  version on an approved draft), when they differ. `why` lists his asks and who wrote each step.
- **decision:** in one `group` (a post's idea and platform, else the item), a draft he turned
  down and never approved loses to each one he approved or sent. `why` is the reject's reason
  and note.
- **engagement:** sent posts on one platform within 30 days of each other. Engaged = reactions +
  comments + shares + follows on the newest snapshot. The winner has at least 3 and at least
  twice the loser's. Each post wins at most 3, against the posts nearest in time.

Portal: a record type that declares `drafts` (every draft list: `marketing.draft`, `.post`,
`.inbox`, `.approval`, `.comment`, `.thread`, `.dm`, `.invite`, `.video`) shows Export JSONL
beside Export CSV and in ⌘K. Each line is `{record, id, fields, drafts}`, `drafts` being that
row's `wren.draft/1` records with people out. The records API takes `format: "jsonl"` on any
list; others show only CSV.

## View

- Activity tab on every draft page (`marketing.draft`, `.post`, `.comment`, `.thread`, `.dm`,
  `.invite`, `.inbox`, `.approval`, `.video`) from the view `draft_activity`: the steps in words
  ("Rejected by … : Not my voice · note"), then each metrics snapshot and reply on a post. One
  key column per page, so comment 7 and contact 7 never mix.
- The draft box gets a Versions section (`apps/portal/web/src/modules/marketing/versions.tsx`):
  each version with who and when and his ask, the decisions, and the kit's `Diff` between any
  two, first against latest by default. A DM shows its newest round.

## Backfill

`wren train backfill [--dry-run]` (prod: `node scripts/prod-wren.mjs train backfill`,
`packages/content/src/train-backfill.ts`). Each row gets a `bf:` ref; a second run inserts
nothing. An item that already has live steps is left alone, so nothing is counted twice; run it
right after the deploy.

- Posts: `generated` from the model's raw answer (`llm.raw_text`), else the first audited text
  change's old value, else the row; edits from the `draft-*` runs, then `audit_events` text
  changes no run explains (same words within a minute); `approved` from `approved_at` or the
  audited status; `rejected` from status or a redraft (with its note); `sent` from a published
  row; `failed` with the error. Video uploads (`prompt_version` video) are `via wren`.
- Comments and threads: the first run's `before`, else the draft, as `generated` (no prompt was
  kept); edits from runs; `sent` from `answer` and `answer_ref`; `rejected` when dropped with a
  draft.
- DMs and invites: one round per manual outbound message. When he changed a draft at send, the
  run's `before` is the model's `generated` and its words his `edited`. An untouched draft is
  only his `sent`. Invite when it was his first message after the connection.
- Videos: title and description, walked back from today's through each `video *` run's `before`.

## Left out

- LinkedIn comments on others' posts and drafted invite notes: their code is on another branch
  (`posting`). They call `recordDraft` with kinds `linkedin_comment` and `invite_note`.
- YouTube follows (scope and route above).
- The training job itself.

## Decision log

- 2026-10-07: written from his note and a read of prod. One table over bending `changes` or
  template versions. Names redacted by default. Backfill as a CLI command so prod runs it through
  `prod-wren.mjs`.
- 2026-10-07, batch 1 built: the table, every write site above, reject reasons in the portal
  (Reject asks Why and Note, both optional) and `wren content reject --reason --note`, Instagram
  follows. A step that leaves out `kind` keeps the item's first one, so a video's YouTube upload
  (`draft:<id>`) stays `video`. Drop and skip are a `rejected` step only when a draft was there. A
  DM's `sent` is when his words are queued; the `reach_messages` row says when they left.
- 2026-10-07, batch 2 built: Versions section, `draft_activity`, `draft_outcomes` and
  `draft_people` views, `wren train export | pairs | backfill`, Export JSONL on draft lists
  (`RecordsCsv` became `RecordsFile` with `format` and `body`). Live steps now use the
  database's clock unless the time came from elsewhere (a platform's publish, the backfill), so
  one draft's steps sort on one clock. Engagement is the plain sum, not per 100 views: early
  snapshots often have no views. Decision pairs use the idea and platform, not the slot time.
