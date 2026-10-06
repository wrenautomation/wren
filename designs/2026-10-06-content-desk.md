# Content desk: one queue, drafts finished with Claude, DMs without the platform (2026-10-06)

William, 10-06: "is my idea for a unified multi platform content crm dashboard type thing built out
and integrated? i need a clean efficient way to do content management for myself asap."
Also 10-06: "dm drafting / the ability to draft a dm finalize it with claude code and in the UI,
and then send it out without ever going to the platform and wasting time searching is the goal."
Earlier 10-06: "not only should i be able to manually edit but also converse with you on recent
drafts, and you can update them accordingly after finalizing with me. like how we did with email
templates."

## Answer first

Built and live in Marketing (app.wrenautomation.com): Overview (every platform's numbers),
Inbox (comments, DMs and activity from IG, YouTube, LinkedIn, Reddit), Drafts (approve, edit,
redraft, reject), Comments, DMs, Threads, Invites, Followers. What's missing for "clean and
efficient":

1. **One queue.** Post drafts, Reddit threads and accepted invites live on their own pages. The
   Inbox becomes the one list of everything waiting on his click, and Marketing opens on it.
2. **DM drafts.** A DM thread waiting on him and an accepted invite have no draft. The model
   writes one, so the reply box opens filled.
3. **Ask Claude on any draft.** Every draft (post, comment answer, DM, thread comment, invite
   message) gets "Ask Claude": he says what to change, Claude Code on his Mac rewrites it, the
   draft updates, and the exchange stays on the item as a thread.
4. **Drafts from a terminal.** `wren drafts list|show|set`, so a Claude Code session can read and
   rewrite the same drafts while he talks to it.
5. **Message from People.** Find the person in Wren, click Message (or Invite on LinkedIn when not
   connected). No platform search.

Nothing sends without his click. Every send still goes through ReachDesk/Content, its window, caps
and account.

## 1. One queue (Inbox)

`marketing.inbox` (packages/content/src/social/records.ts) gains three types beside comment, dm
and activity:

- `draft:<id>`: `content_drafts` in `draft` state, with the slot it holds and its platform.
  Actions: the Drafts page's approve, edit, redraft, reject.
- `thread:<id>`: Reddit threads with a comment draft waiting (Marketing → Threads). Actions:
  comment, skip.
- `invite:<id>`: accepted invites with no message yet. Action: message.

Views: "Waiting on you" first and default (every type, state new/waiting, the soonest slot or
oldest item first), then Posts, Comments, DMs, Threads, Invites, Activity, All. The type badge says
which. Marketing's first page is the Inbox; Overview second. The other pages stay.

## 2. DM drafts

- A draft per waiting DM thread (a reply) and per accepted invite (a first message). Stored on the
  contact: `reach_contacts.draft`, `draft_at`, and `draft_for` (the inbound message id it answers;
  a newer inbound makes it stale and it is redrafted).
- Written in ReachWatch's pass after the inbox read and after the invites sweep. One model call per
  item, the fleet's model (Cohere on prod), at most 30 a day. Prompt: the `dm` SOP when one
  exists (`wren sop`), else a short fixed brief (casual, two sentences a paragraph, no pitch
  unless asked, his voice "I"), plus the thread and the person's facts (title, company, what they
  commented or posted). Code checks length and the platform's cap, like comment drafts.
- The Reply and Message dialogs open with the draft (`from: "draft"`). Inbox shows it as
  "Draft reply".

## 3. Ask Claude on any draft

- Action "Ask Claude" on every inbox type that holds a draft, and on Drafts, DMs, Comments,
  Threads, Invites. Dialog: "What to change, or ask".
- It opens a `runs` row (command `draft-ask`, args `{record, id, message}`, like `ask.ts`) and
  hands it to a handler that calls the desk's `claude.ask` (autobrowse `src/claude/service.ts`,
  Claude Code on his Mac, read only) with a draft system prompt: the current draft, its context
  (thread, comment, post, person), the platform's limits and the SOP; answer as JSON
  `{reply, draft}` (`draft` null when he only asked a question).
- Wren, not Claude, writes the new draft into the item's draft field. The run keeps the text it
  replaced, so "Undo" restores it.
- The item's detail shows the thread oldest first: his words, Claude's reply, the draft it made.
  While Claude works the row says so; the detail polls like the Ask app.
- $0: his plan. While the Mac is off a question waits in Restate.

## 4. Drafts from a terminal

`wren drafts list [--type post|dm|comment|thread|invite] [--limit n]`, `wren drafts show <id>`,
`wren drafts set <id> [--file f]` (else stdin). Ids are the inbox ids (`draft:12`, `dm:5`). On
prod: `node scripts/prod-wren.mjs drafts …`. `set` writes the same field the UI edits and records
a `runs` row (who = the CLI), so the thread shows it too.

## 5. Message from People

On a person with a LinkedIn URL or a Reddit handle: "Message" when there is a contact we can write
to (LinkedIn: connected via `linkedin@wren`; Reddit: any user, from `reddit@wren`), else "Invite"
on LinkedIn (queues `linkedin-invite` for that person now, under the ramp). Message opens the
dialog with a model draft, and Ask Claude works on it. It adds the contact (`found_in = people`)
and queues through `ReachDesk.reply`'s path. The lead guard still refuses a lead another channel
holds.

## Gaps closed beside this (on demand, never scheduled)

- **LinkedIn audience.** An autobrowse read of `linkedin@wren`'s followers and connections (and the
  Wren Page's followers), run when he clicks "Read now" on Followers or `wren social audience
  linkedin`. Writes `social_days` like the others. Never personal `linkedin`, never on a timer.
- **Reddit discovery reads.** `wren reach discovery run` and a "Read now" button on Places/Threads:
  one RedditReads pass. The loop stays unstarted.

## Cost

$0: Cohere free credits for DM drafts (at most 30 calls a day), his Claude plan for Ask Claude,
desk page loads on the Mac.

## Decision log

- 2026-10-06: William asked for the queue, DM drafts with Claude and on-demand gap fixes. Built as
  above. The Inbox becomes the landing page; the other pages stay for depth.
- 2026-10-06: Built the two gaps. LinkedIn: autobrowse `GET /audience` (own profile + Wren's Page, 4 a
  day, 0 for `linkedin` and `linkedin@alt`); `SocialDesk.readAudience` keeps it, replacing the day's
  row; SocialWatch skips LinkedIn's count (`AUDIENCE_ON_DEMAND`). Reddit: `run` is `sync`'s alias,
  and Read now calls `RedditReads/wren/sync`; nothing starts the loop.
