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
One line per item and round:

```json
{"schema":"wren.draft/1","item":"draft:…","round":1,"kind":"post","platform":"linkedin",
 "input":{"stage":"content_draft","model":"…","system":null,"prompt":"…","max_tokens":4000},
 "versions":[{"n":1,"via":"model","by":"…","ask":null,"text":"…","title":null,"at":"…"},
             {"n":2,"via":"person","by":"…","text":"…","at":"…"}],
 "decisions":[{"event":"approved","via":"person","slot":"…","at":"…"},
              {"event":"rejected","reason":"voice","note":"…","at":"…"}],
 "final":{"text":"…","title":null,"external_id":"…","url":"…","at":"…"},
 "outcome":{"metrics":[{"as_of":"…","views":0,"reactions":0,"comments":0,"shares":0,"follows":null}],
            "replies":[{"author":"[person]","text":"…","at":"…"}],"score":null},
 "context":{"idea":"…","answering":"…"}}
```

- `final` is null until sent; `outcome` is null for a kind with none.
- People: by default the names of commenters, DM contacts and thread authors are replaced with
  `[person]` everywhere, prompts included. `--include-people` keeps them. His own email stays as
  `by` (a person's role, not a stranger's name).

`wren train pairs [--kind] [--since] [--include-people]`, one JSONL line per pair:
`{"schema":"wren.pair/1","type":"edit|decision|engagement","kind","platform","prompt","chosen","rejected","items":[a,b]}`.

- **edit:** the model's first version against the last words he kept (sent, else his last
  version), when they differ.
- **decision:** an approved or sent post against a rejected one for the same slot: the redraft
  chain, or the same platform and slot time.
- **engagement:** posts of one platform and kind, neighbours in publish time, the higher score
  (engagements per 100 views, newest snapshot) against the lower, when both have a snapshot and
  the scores differ.

Portal: the list's Export menu gets JSONL beside CSV. A record type that declares `jsonl` (every
draft kind) puts its full record on each line; any other list exports its fields.

## View

- Activity tab on every draft page (`marketing.draft`, `.post`, `.comment`, `.thread`, `.dm`,
  `.invite`, `.inbox`) from the view `draft_activity`: generated, edited, approved, rejected,
  sent, then each metrics snapshot and reply.
- The draft box's detail gets a Versions section: each version with who and when, and the kit's
  `Diff` between any two (side by side from `md`, unified under it).

## Backfill

`wren train backfill [--dry-run]` (prod: `node scripts/prod-wren.mjs train backfill`). Each row
gets `ref`; a second run inserts nothing.

- Posts: `generated` from the model's raw answer (`llm.raw_text`), else the row; edits from the
  `draft-*` runs, then `audit_events` text changes no run explains; status changes from
  `audit_events`, else `approved_at` and `published_at`; `sent` from a published row.
- Comments and threads: the first run's `before`, else the draft, as `generated`; edits from runs;
  `sent` from `answer`; `rejected` from dropped or skipped with a draft.
- DMs and invites: edits from runs; `sent` from manual outbound `reach_messages`.
- Videos: title and description versions from the `video *` runs' `before`.

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
