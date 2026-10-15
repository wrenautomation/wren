# Accounts are first class

Living doc. Started 2026-10-15 (bead wa-3h8). William: "we have two reddit profiles how does that work? how is the management for that? i dont have ability to granularly choose which account to send from?" and "and no filter by account either. this is terrible. account management should be first class in wren".

## Answer first

Every record that sends from an account now says which field holds it. From that one line it gets the Account filter, the account column, Group by account and saved views. Every draft box on a platform with two or more accounts gets a "Send as" picker. The pick is saved with the draft, and the send goes out from it. It saves through `callOnce`, so it rides the one write path (`WRITES`). Until the server holds it, the pick sits in the edits store (`useEdit`, key `draft:<id>:account`) and reads "Not saved yet". A reload or a failed save gives it back, and it goes again once. Marketing → Accounts lists every account in one place. `wren accounts` does the same in a terminal.

## The model

- The account key is the login: `reddit@alt`, `linkedin@wren`. People read it as its label (`u/<handle>` on Reddit). `packages/core/src/record-accounts.ts` holds the set. The worker loads it from `reach_accounts` and connected logins at most once a minute.
- A record declares it once: `accountField("From")` plus `account: "account"` on `defineRecord`. `defineRecord` refuses an `account:` that isn't an `accountField`. `platforms: ["reddit"]` keeps a Reddit-only list from offering LinkedIn.
- The shared UI pieces live in `packages/ui/src/accounts.tsx`: `AccountBadge`, `AccountFilter`, `AccountPicker` and `accountFieldOf`. The list bar, cells, cards, the phone shell and the draft box all use them, so no page draws its own.
- Picks go in `draft_accounts`, one row per draft item (`thread:<id>`, `comment:<id>`, `dm:<id>`, `invite:<id>`, `onpost:<id>`, `draft:<uuid>`). The audit triggers record who changed one and when. Migration 0274.

## Default and warnings

The account a draft goes out as is the pick, else the one they spoke to, else the place's account, else the platform's default login (`defaultAccount`).

The picker warns but never blocks when an account misses a sub's karma or age floor ("r/x needs 30 days old and 50 karma, u/y has 9 days and 4"), when a sub is held for an unexplained removal, or when warm-up has frozen the account. A picked account skips the numeric karma and age gate at send time. The hold still applies. A paused or retired pick is refused at send, and the person picks another.

## Where it applies

| Record | Account field |
|---|---|
| marketing.dm, marketing.invite | the account on the thread; a pick overrides |
| marketing.comment | the inbox that read it |
| marketing.thread, marketing.place | the place's account (Reddit) |
| Engage, To approve, Inbox (social) | the account the item is on |
| Post drafts, posts | the account the post went out on |
| marketing.account | the Accounts page itself |

The send paths read the pick: DM and invite replies (`queueDraft`), thread comments, comment answers and comments on others' posts.

## Accounts page

Marketing → Accounts (`marketing.account`) shows site, state, health, warm-up stage, karma, age, today's sends against caps, places, last send and when health was last read. It uses only existing reads, with no vendor call when the page loads. To move a subreddit, edit the place's account on Places. The choices are the other Reddit accounts.

## CLI

- `wren accounts [list] [--platform p]`, `wren accounts show <key>` (with its last 10 sends)
- `wren accounts assign <subreddit> <account>`
- `wren accounts pick <item> <account|default>`
- `--account <key>` on `wren reach reply` and `wren reach posts comment`

## Guard

`apps/worker/src/components.test.ts` → "account fields" fails when a record has an account field it doesn't declare. That covers any field over the account set, any field named `account`/`sentAs`, and any field labelled "Account"/"Send as". Two fields are allowed: the books spend's chart-of-accounts bucket and the Accounts page's own name.

## Not done

- Plan and Numbers are rollups with no per-row account, so they have no account filter.
- Touches have no list page. Each touch's text already says "as <account>".
- Reassign is a select on the place, not drag and drop.
- The thread scheduler may leave a picked thread in a gated sub unscheduled until someone sends it by hand.

## Decisions

- 2026-10-15: the key is the login, not the reach row id, so connected social logins and reach accounts share one set.
- 2026-10-15: picks live in their own table, not in each draft's JSON. Every draft kind reads them one way, and the audit log covers them.
- 2026-10-15: no per-account tabs. One filter chip, which saved views keep.
