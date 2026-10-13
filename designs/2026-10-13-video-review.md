# Video review in the portal (2026-10-13)

William: "our editing agent needs better support i don't even see it in the UI. right now the only
way for me to verify and finalize videos is through claude code."

## Decision

Videos goes back in Marketing's sidebar, and its page becomes where the editing agent works and
where he checks and finishes each video. No terminal step is left for a normal video.

What Claude Code did for video 4 (prod `runs`, 10-09), and where each now lives:

| In Claude Code | On the page |
|---|---|
| read the transcript, fix misheard words (15 `video words`) | the agent's pass fixes them |
| write title, description, chapters (`video set`) | the agent's pass writes them; he edits in place (already there) |
| `video cut` + `video render` | the agent's pass queues Render when it changed something; Render stays a button |
| look at the result, say what's off | Checks list and the preview; "Ask for changes" sends a note to the agent |
| `video approve` | Approve (already there), and new: Schedule, Reject, Bring back |

## How

- **Sidebar.** `videos` joins `MAIN` in `modules/marketing/index.ts`, after Write.
- **The agent's pass.** `VideoDesk.edit({id, note?})` opens a `video-edit` run and sends the
  private `editing`. That asks the desk's read-only `claude` (prompt `prompt:content/video-edit`,
  one allowed read: `video show <id>`) for `{reply, notes, words, patch}`. Wren writes each word fix
  (`setWords`, by `agent`), then the patch (`setEdit` on the run, as Ask does), then queues Render
  when anything changed. A note from him is what it acts on first. `wren video watch` sends `edit`
  for every new recording, so a recording arrives already edited.
- **What the agent did.** The record loads `steps` (every `video *` run for the id: who, what, when)
  and `checks` (title, description, chapters YouTube will show, cuts flagged by `reviewCuts`,
  render state, "changed since the last render"). The page shows the agent's passes with its notes,
  then the checks, then the steps folded.
- **Reject.** State `rejected` (migration: `ck_video_edits_state`). `VideoDesk.reject({id, note?})`
  from added, edited or rendered; `restore` puts it back to edited. Reject keeps the files.
- **Schedule.** Approve takes `publishAt`: the upload goes now, private, and YouTube makes it public
  then. A new optional YouTube field `publishAt` (ISO); channel-youtube sends it over
  `scheduledFor`.
- Ask Claude stays for a quick question; Ask for changes is the agent box.

## Why

- The page had most of the editor, but it sat under More, and nothing on it did the whole pass.
  He went to Claude Code because the agent lived there.
- Word fixes are the bulk of the work and Ask's patch could not touch words.
- A preview made before the last change looks final and isn't. The check says so.

## Not here

- Promo videos (`wren video promo`) have no row; they stay a CLI render.
- OBS Source Record's second file still pairs only through `wren video add`.
