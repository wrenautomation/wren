# Agent panel: sees the page, logs its changes, asks before risky acts (WA-1333)

Status: draft for William. Source: the Amboras audit (WA-1327). Amboras is an e-commerce store
builder with an agent and split tests; weaver run 01M76HZZ85G2JEV3VK63NPF8TB read its product
and UI. Its agent panel is ahead of ours in the six points below.

## Goal

The side chat (the Claude agent panel on every portal page) is a teammate on every page. It sees
what you see. Each change it makes to Wren's data shows in one list, and you can undo it there.
It asks before it sends, spends or deletes. You can see which page it is changing now. Rule from
Amboras: the agent is an option, not a wall. Every act keeps its normal UI.

William, 11-11 (relayed by the weaver dev session, his words): "id like to see a storybook or
temp artifact if it doesn't fit claenly into the storybook so i can just see the ui changes /
what we took from them. page awareness makes sense to hae that imrpvoed." So phase 0 is stories
of every new part, shown to him before any wiring. Page awareness on every page is approved.

## Terms

- **Relay**: `wren agent serve` (`packages/agent`), a local server on William's Mac. It starts a
  `claude` child per chat and pipes it to the page over a socket.
- **Db relay**: the Wrenfile `db` block. Agent roles reach loopback only; their `wren` CLI reaches
  prod Postgres through this port.
- **Audit log**: `audit_events`, one row per row changed, in main and in each client's database
  (`packages/db/src/audit/`). `audit_changes` is a view over it in words; the console's Changes
  page (`console.change`) reads it.
- **Act class**: send, spend, delete, publish. The acts the agent must ask before.

## What exists (11-11)

| Part | Where | State |
|---|---|---|
| `[Page: App > Page (/path)]` on every turn | built in `modules/agent/files.ts:76` | done |
| What is in view (`usePageContext`) | `modules/agent/drive.ts`; used by App, Map, Research live, Variants page, batches, tree | one global string, last writer wins |
| Ask before a tool runs | SDK `canUseTool` → a card on that tool (`thread.ts:486`) | done, per tool |
| Steps card | `packages/ui/src/agent-steps.tsx`: shell calls fold into "Ran N commands", each opens to input and output; other calls are one row each | mostly done |
| Follow-up queue | `connect.ts:135-171`: `say` hands a turn to the SDK at once | not shown, not editable |
| Agent writes tagged | the CLI sets `wren.actor = claude-code` when `CLAUDECODE` is set (`apps/cli/src/main.ts:88`), as a connection startup parameter (`packages/db/src/index.ts:49`) | per agent, not per chat |
| Change lines in words | `audit_changes` (`install.ts:229-274`): who (agent / person / pipeline), area, "stage: Lead → Won" | done, 7 days |
| Record edits with undo | `changes` + `undoChange` (`packages/core/src/edits.ts:159`): compare-and-swap, undo once | only writes through `editRecord` |
| Send gate | drafts wait for approval (`packages/reactivation/src/compose.ts`), suppression (`packages/starling/channels/email/src/send/suppress.ts`) | email only |

## Target

1. **In view, every page.** Each turn carries the page and what is on screen: the list's filter
   and the rows shown (ids and names), the open record, the selection.
2. **Changes.** A Changes list in the panel, grouped per turn. Each line in words from
   `audit_changes`. Undo per line and per turn.
3. **Confirm.** An act of a risky class stops and a card asks in the chat. Yes runs it; No tells
   the agent why.
4. **Tab marks.** A dot on the nav tab of each page whose data the agent changed in the last
   few seconds.
5. **Queued follow-ups.** Turns typed while the agent works show over the composer as chips.
   Each chip can be edited or removed until it is sent.
6. **Steps card for every call.** Fold non-shell calls into the same steps card (today only shell
   calls fold).
7. **Autonomy dial per client**, for the agent: per act class, auto / approve / off.

## Decisions

### D1. The change log (hard to change)

| Option | How | For | Against |
|---|---|---|---|
| **A. Audit log + chat tag** | New startup parameters `wren.chat` and `wren.turn`, read by `audit_row()` into new columns `audit_events.chat` and `.turn`. The Changes list is `audit_changes` filtered by chat. | Every audited write by any CLI command, no code per command; words exist already. | Row level. Audit-skipped tables and the `rt` queue have no line. Cannot undo what left the system. |
| A0. Chat in the actor string | `wren.actor = claude-code:<chat>`; no new column. | No schema change. | `setAuditActor` overwrites the actor in 57 call sites (for example `templates.ts:325`), so most writes lose the chat. |
| B. Command ledger | Each mutating command writes its own inverse. | Undo in domain words; can undo side effects. | Each command needs an inverse; a missing one is a silent gap. |
| C. Records only | Agent writes only through `editRecord`. | Exists; field-level; compare-and-swap. | Most agent acts (approve, queue, import) are not record edits. |
| D. Drafts first | Agent writes to a draft copy; a person publishes. | Nothing lands unseen. | Every act becomes a review step: the wall Amboras warns against. |

**Recommend A.** Ranked by: coverage of what the agent can change, then no silent gaps, then
cost per new command.

How the tags get set:
- The relay mints a chat id (uuid) when it starts the child and passes `WREN_AGENT_CHAT` through
  the child's env (`launch.ts:136-146`). It links the id to the SDK session at `init`
  (`relay.ts:984`) and keeps it on `--resume`.
- Turns run one at a time. The relay writes the current turn id to a file named by
  `WREN_AGENT_TURN_FILE` when each turn starts. The CLI reads both at start and sets
  `wren.chat` and `wren.turn` as startup parameters, beside `wren.actor`. The CLI opens one
  connection per command (`main.ts:101`); the worker never sets them, so its writes carry none.
- `setAuditActor` sets only `wren.actor` and `wren.as`, so the chat tag survives it.
- The columns are added in `AUDIT_FUNCTION_STATEMENTS` (`install.ts:79-82`), not a drizzle
  migration. `audit_event_hash` includes them only when set, as it does `acting_as`
  (`install.ts:137-147`), so past seals still verify.

Undo, in one serializable transaction per line:
- A table with a `changes` row for that write: undo through `undoChange`. Hide the `changes`
  insert itself from the list (one edit, one line).
- Update: refuse if any changed column's live value differs from `new_values`. Else write
  `old_values` back.
- Insert (`new_values` is null for keyed tables, `install.ts:107-109`): refuse if a later event
  touched the same `row_key`. Else delete by key.
- Delete: re-insert `old_values`, with `OVERRIDING SYSTEM VALUE` for identity keys and without
  generated columns.
- No `row_key` (table without a primary key): no undo.
- The undo's own writes carry `wren.chat = <chat>` and `wren.turn = undo:<event id>`. A line
  with such a follower shows "Undone" and cannot be undone again.
- Refusal text: "It changed since. Undo the newer change first." / "Can't undo: this table has
  no key." / "Undone already."
- Undo a turn: its lines newest first, so children go before parents. It stops at the first
  refusal and says which line.

Changes API: one portal endpoint, `GET /agent/changes?chat=<id>`, reads main and, for a chat
that used `--client`, that client's database (the same route as `withDb`, `main.ts:111`).
`POST /agent/changes/undo {event | turn}`. Only the chat's owner or an admin may undo.

### D2. Where the confirm and the dial are enforced (hard to change)

| Option | How | For | Against |
|---|---|---|---|
| **A. At the act** | Each risky act calls `gate(act, client)`. It applies only when the actor is an agent (`claude%`). Under `approve`, it stores a pending row and the command exits with `needs-confirm <id>`; the chat draws a card. Yes is a portal API call by a signed-in person; it runs the act. Under `off`, the act refuses. | Holds for any command that reaches the act. | Each risky act must call `gate`. |
| B. In the relay | A PreToolUse hook matches the shell command against a list. | One place. | Text match: a script or a new command passes. |
| C. Both | A enforces; B labels the card early. | Card shows sooner. | Two lists to keep in step. |

**Recommend A.** Ranked by: cannot be bypassed by the agent, then cost.

- The agent cannot approve itself: `wren confirm` refuses when `CLAUDECODE` is set; Yes comes
  only from the portal.
- The worker and test engines are out of scope: they act on items a person already approved.
- Dial: `clients set --set autonomy.send=approve` (and `.spend`, `.delete`, `.publish`). Default
  by who drives the chat: an admin's agent runs `auto` (like bypass-permissions mode); anyone
  else's agent runs `approve`. A client's own setting overrides the default. The email send gate stays; `gate` sits before it.
- Shapes: `gate(act: "send"|"spend"|"delete"|"publish", client: string, what: string): Promise<void>`
  (throws `NeedsConfirm {id}` or refuses). Pending row: `agent_confirms(id, chat, act, client,
  what, args jsonb, state pending|yes|no, decided_by, at)`.
- Guard: a test lists every write to a send or spend table (outbound messages, ad budgets,
  payments) and fails if it is outside a `gate` call. A name list alone is the same weakness as B.

### D3. How a page says what is in view

| Option | How | For | Against |
|---|---|---|---|
| **A. Shared parts publish** | Move the context store into `@wren/ui`, keyed by source (list, record, selection). The shared list, table, record page and record panel publish their rows. A page with its own layout adds one call. Joined in a fixed order per turn. | Correct ids and names. | Pages without shared parts need a call each. |
| B. Read the DOM | The panel reads `[data-record]` elements in the viewport. | Zero calls per page. | Only tagged markup; no filter or selection. |

**Recommend A.** A test lists page files with no context source, so a new page cannot miss it.
The text keeps 50 rows and counts the rest, so a turn stays under about 3 KB.

### Smaller calls

- **Tab marks**: a table → page map (one entry per record type's table, in `@wren/ui` beside
  the nav). A dot shows for 5 s after the chat's last change on that page; the `wren_live` topic
  stream tells the panel a row changed.
- **Queued chips**: the panel holds queued turns itself and calls `say` only after the running
  turn's `result` frame. `connect.ts` hands a turn to the SDK at once, so the queue there cannot
  be edited.
- UI follows the design-language artifact (`designs/2026-10-20-design-language/`). No stripe
  accents: a changed line takes a tint and a word, an undone line a strike and "Undone".

## Phases

0. **Stories for William.** `@wren/ui` parts with fixtures, no wiring: Changes list (per turn,
   undo, refusals, Undone), confirm card (send, spend, delete; yes, no, decided), tab marks on
   the nav, queued chips over the composer, the steps card with mixed calls, the in-view line
   ("Claude sees: …"), the dial in client settings. A part that does not fit Storybook goes in a
   temp artifact. Stop for his look.
1. In view on every page (D3) and the steps card for every call.
2. Change log (D1): tags, columns, Changes API, undo.
3. Gate and dial (D2).
4. Tab marks and queued chips.

## Tests

- Undo: update, insert, delete, stale (a second writer changed it), no key, undo twice, a turn
  with a parent and a child. Integration, synthetic rows.
- Tags: a CLI write under `WREN_AGENT_CHAT` carries chat and turn; a worker write carries none;
  `audit_verify()` passes before and after.
- Gate: an agent send under `approve` stops with `needs-confirm`; `wren confirm` under
  `CLAUDECODE` refuses; the portal Yes runs it once.
- In view: the page-file test from D3; a story per part.

## Non-goals

- Undo of anything that left the system (a sent email, a paid bill). The gate covers those.
- Lines for tables the audit skips (`AUDIT_SKIPPED` in `packages/db/src/audit/index.ts`:
  among them `decisions`, `findings`, `fills`, `draft_events`) and the `rt` queue. Work the
  agent queues shows as its queue row's command only, not its effects.
- Per tool call undo: a call id has no reliable route to the CLI.
- A dial for the worker or test engines (Vireo ships, Sites tests).

## Risks

- Undo after the worker reacted to a change: the check refuses when rows moved on; the line says
  what it could not put back.
- The gate holds only for acts that call it. The guard test is the backstop.
- The CLI reaches prod with full write rights through the db relay. A raw-SQL write would skip
  both the gate and the tag. No CLI command takes raw write SQL today (`prod-sql.mjs` is read
  only); keep it so.

## Decision log

- 2026-11-11: draft. Recommend D1 A, D2 A, D3 A.
- 2026-11-11: William (via weaver dev): stories or a temp artifact first; page awareness approved.
- 2026-11-11: goldfish review: 36 findings, 27 applied, 4 rejected (actor-string tag: 57
  overwrites; "phase 1 not UI only"; per-call grouping by time; worker dial), 5 merged; open:
  D1, D2, the dial default (`approve`).
- 2026-11-11: William: D2 A. Default `auto` for an admin's chat, `approve` for anyone else. D1 reopened: write volume of A, and undo/redo vs a write-back cache.
- 2026-11-11: William: D1 A, no limiter. A adds no writes: two tags on audit rows the per-row trigger already writes (prod: 1.8k/day, agent 4%). At 100 busy clients (~5M rows/day, ~60/s mean) the box's insert rate holds; the bind is disk (20 GB gp3, ~300 B a row). Revisit with audit retention when the disk fills, not with a limiter. A bulk turn groups into one line with one Undo.
