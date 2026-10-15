# Saving and the UI audit (2026-10-14)

William: "make sure all user interaction based stuff like editing, saving is designed in a very
nice way ... shared save modules / logic to ensure there's no race conditions, it's durable,
survives crashes / restarts / tab closes." Then: "do a full fix race condition and functionality
audit ... this is unacceptable."

What he hit: a draft lost his typing on a tab switch (the box saved only on blur or ⌘S, and the
portal reloads itself after a deploy or a sign-in refresh); after autosave landed, typing lagged
and trailing spaces vanished (each save wrote the trimmed words back into the box and re-read the
record and the list); Approve said "cannot approve: <uuid> needs Subreddit" with no way to act on
it; Drafts had been hidden behind Write.

Fixed already: 2961d828 (autosave, kept words, Drafts back), a29963fa + 6c9b7b2b (no write-back
into the box, refs for the live base, stale reads ignored, quiet saves, refusals name the post).

## Decision

One way to save, everywhere a person types: `packages/ui/src/save/`. Notes keep their own Yjs
sync (`modules/notes/sync.ts`): it already is durable and merges; nothing else copies it.

### The save engine (lane A)

`useSaved<T>({ key, server, save, expect?, delay? })` returns `{ value, set, status, flush,
conflict, keepMine, takeTheirs }`.

- **Journal.** Every `set` writes `{base, value, at}` to localStorage under `wren.unsaved:<key>`
  synchronously, so a crash, reload or closed tab loses nothing. It clears once the server holds
  the value. On mount: a journal over the same base restores and saves; over a moved base it opens
  a conflict (both shown), never drops silently.
- **One writer per key.** Saves for a key run one at a time and coalesce (in flight + latest
  only), across tabs too (Web Locks `navigator.locks`, a no-op fallback). The base each save sends
  is the live one (refs), never a render's.
- **When it saves.** 1.2 s after the last change, on blur, on `visibilitychange` hidden, on
  `pagehide`, and on demand (`flush`, before any action that reads the saved value: Approve, Send,
  Ask Claude). The value in the input is never replaced by what was saved.
- **Conflicts.** `expect` (a version or the prior value) goes with every save. A refusal for a
  moved base is a conflict, not an error: "Changed elsewhere" with Keep mine / Use theirs.
- **Failures.** Offline, 5xx and timeouts retry with backoff (and on `online`); the status says
  "Saved on this device" meanwhile. A 4xx refusal shows its message and waits for him.
- **Write-through.** A save patches the page's read caches (`useCall`'s kept answers, `useLoad`'s
  seen map) with the new value instead of re-reading the record and the list on every pause. The
  page reads once when he leaves the field.
- **One status line.** `SaveStatus`: Saving… / Saved / Saved on this device / Changed elsewhere /
  Not saved: <why> — Retry. Same words and place everywhere.
- **Forms in dialogs.** `useKeptForm(key)`: what's typed in an action's form stays in the journal
  until it is sent, so a closed dialog or a reload gives it back. Every action call carries a
  request id; a double click or a retry sends one action, not two.

Migrate onto it: `DraftBox` (drop `draft-keep.ts`), `EditField` and the record edits, `FormBox` /
`useRun`, custom draft editors (carousel, slides, thread, blog, story, TikTok panel, fields).

### Marketing, end to end (lane B)

Every Marketing page (Today, Drafts, Write, Studio, Engage, Pieces, Numbers, To approve) and every
action on it works against a local portal with synthetic data, and every refusal reads as plain
words naming the post and what to do. Fields a platform requires show in the draft's panel before
Approve, with what's missing marked. Reddit drafts get a subreddit picked for them (the Reddit
gates' list) instead of failing at Approve. Approve from a row saves the draft's typing first.
Studio: every edit on a video (fields, cuts, transcript fixes, captions, formats) saves through the
engine and the preview says when it is older than the last change.

### The rest of the portal, and the server (lane C)

Every other edit surface (account, access, sites, the workflow editor, automations, doors,
library templates, documents, deals, people, learn, work, payments, marketplace): list each save
path, fix races in place now (stale closures, setState after await over newer typing, double
submit, lost typing on reload, a refetch reverting an edit), then move each onto the engine once
lane A lands. Server side: every edit handler checks `expect`/version and refuses a stale write
with a conflict code; Approve, Send and Post are idempotent on the request id; writes use the
`@wren/db` helpers (atomic/snapshot/serializable); refusals carry `{message, field?}` in plain
words, never an id.

### Studio is where content gets made (lane B, then lane D)

William: "studio experience needs to be way better. full control over content, writing, etc.
editing. feels almost like the write tab needs to be folded into the studio experience."

- Write folds into Studio. Studio opens on what to make or finish today (from the plan's
  commitments) and a New button: words post, thread, carousel, story, blog, video. Write's id
  stays as a redirect into Studio's New, so old links land.
- Every piece opens in Studio's one editor, wherever it was clicked (Today, Drafts, Pieces, To
  approve): its words for each platform side by side with the live per-platform check, media,
  the platform's fields (required ones marked), the funnel link, slides, schedule, Ask Claude /
  Redraft with a note, versions, and Approve / Schedule / Post now. Everything saves through the
  engine. Drafts stays the list; a row opens the editor.
- Videos keep today's tools (fields, cuts, transcript fixes, caption style, formats, editing agent,
  promos, Write about) in the same editor, plus a finishing view (lane D, after lane A lands): the
  player with a timeline under it, drag a cut's edges, add and move text on the video, place and
  style captions, pick the cover frame, see each format's crop, render the changed parts. Each
  change is an edit to the video's cut list the render path already reads.

### One sidebar (main session)

William: "not sure about the nested sidebar experience, it's taking up too much width." The pages
column beside the sidebar goes. The open app's pages fold out under its row in the sidebar; a
closed app's pages show on hover as now. Same information, one sidebar's width.

## Rules for every lane

- Test with synthetic data locally. Never scan or screenshot the live portal (Worker request cap);
  never post to a platform or call a live site through autobrowse.
- Commit only your own paths (`git commit -- <paths>`); other sessions edit this checkout. Don't
  push; the main session does. Run `./scripts/gates.sh` (or turbo typecheck + test:unit, biome,
  `map --check`) before calling a commit ready.
- Portal copy never names a `wren` CLI command. Copy is short plain sentences.
- Lane A owns `packages/ui/src/save/` and the files it migrates in `packages/ui`. Lanes B and C ask
  lane A (through the main session) for engine changes rather than editing it.

## Log

- 2026-10-14: written; lanes A, B, C started on Sonnet, restarted on Opus for this wave (William).
  Studio and sidebar added; lane D (video finishing view) starts when lane A lands.
