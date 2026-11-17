# Add a creator from Studio (WA-1416)

## William's words (11-16)

- "honestly there should be a native add creator feature in studio"
- "can probably leverage super cheap weave run to just find every facet of media a creator uses and then adds the appropriate tracking"
- "note that it should correctly aggregate alternate accounts too. it should sort by platform too. long from youtube and short form as well"
- "doesn't have to only be searxng can be anything leveraging autobrowse automation etc. just not a full deep super 1000 source weaver run type thing is fine"

## Goal

In Studio › Inspiration, he types a name or pastes one profile link. The system finds every account the creator runs on each platform we read, main and alternate. It tracks them as one person and reads their posts at once. The feed then splits by format (YouTube long-form apart from Shorts) and groups by platform.

## Terms

- **Account**: one handle on one platform (`tracked_creators` row over `social_handles`).
- **Person**: one creator over many accounts (`creator_people`, studio-suite D10 A).
- **Alternate account**: a second account the same person runs: a clips channel, a podcast channel, a second-language channel the creator runs. A dub or clips channel a fan runs is a fan account.
- **Candidate**: an account the finder found and did not track.
- **Find**: one add from the portal; one row in `creator_finds`.
- **Desk**: the autobrowse worker on William's Mac. It claims runtime calls over HTTPS (pulled services, `apps/worker/src/rt.ts`); calls wait in Postgres while the Mac sleeps.
- **Weaver**: the research engine CLI (`engine/`). `weaver search` runs queries on a run and writes hits and spend to the ledger.

## What exists (11-16)

- Only the CLI tracks: `wren creator add <urls> --person --niche`. Reads run on the Mac (`creator refresh` under launchd, with `--account x=x@wren --account linkedin=linkedin@wren`).
- A person holds any number of accounts, so alternates need no schema change.
- `feedPosts` filters platform and kind as two separate lists (`creators.ts:766-767`). It cannot say "YouTube `video` but TikTok `video`".
- `findCreators` (`starling/outbound/src/creator-search.ts`, handler `ReachDesk/findCreators`) finds accounts by name per site. No page calls it since Learn went (WA-1317).
- The desk's `studio` service has one handler, `render` (autobrowse `src/studio/service.ts`). A send to a handler the desk has not registered gets 404 (`door.ts:275`).
- Prod post kinds: YouTube `video` 82, `short` 217, `live` 5; Instagram `reel` 407, `photo` 20, `carousel` 18; TikTok `video` 60; X `post` 257, `quote` 192, `reply` 72.

## Measured on Alex Hormozi (11-16)

He has 6 accounts: YouTube, TikTok `@ahormozi`, Instagram `hormozi`, X, LinkedIn, Threads.

| Way | Found, of 6 | Noise | Cost |
|---|---|---|---|
| Handles guessed from memory | 3 of 4 tried; TikTok `@alexhormozi` is a stranger's private account | | $0 |
| The profiles' own links (X, YouTube, IG bios) | 0 | | $0 |
| `weaver search`, one query per platform pinned to its site (run `01M7KDJGQX6F3YAF1GT0YFY0AC`) | 6 | wife Leila, fan pages, a Spanish dub channel, strangers | $0.034 |
| — SearXNG alone | 5 | | free |
| — Perplexity alone | 4, with Threads | | $0.006 |
| — Exa alone | 4, nothing new | | $0.028 |
| `findCreators` YouTube (Data API) | YouTube main, plus `@moremozi` (171k) and `@acqofficial` (122k), each with subscribers | Leila, two Spanish channels | free (API quota) |
| `findCreators` X | 0: it returns people who post about him | 6 strangers | free |
| `findCreators` Instagram | 0: `@alexhormozi` is the wrong account | `@watch`, `@r` | free |
| `findCreators` TikTok (Exa) | `@ahormozi` | | Exa |
| autobrowse `web /search` Brave, DuckDuckGo | none: Brave has no key; DuckDuckGo hits a bot check | | |

So the site-pinned weaver search finds the accounts. The YouTube Data API adds alternate channels and subscriber counts. A model has to drop the noise.

## Decisions

### D1. The finder

| | A. Profile links | B. Pinned search + YouTube API + a pick | C. A weaver `person` plan run | D. Claude Code on the desk browses |
|---|---|---|---|---|
| How | read the given profile; follow its bio links | `weaver search` (SearXNG, Perplexity), one query per platform pinned to its site; `findCreators` YouTube; Haiku labels each profile | plan, search, open, extract, check | `claude/ask` on the desk with autobrowse |
| Finds (Hormozi) | 0 of 6 | 6 of 6, plus 2 alternates | 6 of 6 | unmeasured |
| Cost a find | $0 | $0.006 + Haiku (unmeasured, under $0.01) | about $0.10 (4 queries, 6 opens) | $0 on the plan, minutes |
| Output | links | a list of accounts | findings with quotes, not a list of accounts | the agent's word, different each time |

**Picked B.** Exa stays off: it found nothing new at 5x Perplexity's cost. C answers a question in findings; we need a list of accounts. D is slow and not repeatable. Bio links from the given profile join B's hits as candidates.

Spend: $0.006 a find, on William's click only. His words ("super cheap") cover it; no cap code.

Every search writes to the weaver ledger, one run per find, so the hits and the spend stay.

### D2. Where it runs

| | A. Desk runs the find (CLI) | B. Lambda runs the find (`findCreators` + `web /search`) |
|---|---|---|
| Search | SearXNG + Perplexity through weaver: 6 of 6 | Exa only works today: weak on X and Instagram |
| Mac needed | yes, for the find and the reads | only for the reads |

**Picked A.** The reads need the Mac anyway (yt-dlp, logins, the read proxy), and the weaver search is the one that finds the accounts.

Flow:
1. The portal writes a `creator_finds` row (state `waiting`) and sends `studio/creatorFind {id}`. An open find with the same normalized input is returned in its place.
2. The desk runs `prod-wren.mjs creator find --request <id> --account x=x@wren --account linkedin=linkedin@wren` (the plist's logins). The command writes each step and the candidates on the row.
3. It tracks what passes D3 and sets the find `found`. The handler then runs `creator refresh --id <tracked ids>` as its own step. Each row shows its read as it lands.
4. A tick in the sheet is a portal write (`trackCreator`, to the find's person), then `studio/creatorRead {ids}`. The desk runs `creator refresh --id <ids>` with the same logins.

From a terminal: `wren creator find "<name or url>" --niche <n>` (JSON out).

Failure:
- The command catches every error and writes `failed` with the reason. The handler times out at 10 minutes.
- The sheet counts a find with no update for 10 minutes as failed, with Try again.
- A 404 from the door (desk not yet updated) writes `failed`: "the Mac runs an older desk".
- Closing the sheet does not cancel the find. Reopening shows it.

Rollout: wren first (CLI, table, portal). Then the desk handlers in autobrowse. Until then a find fails with the 404 reason above.

### D3. The pick and what tracks itself

Haiku (through `@wren/llm`) gets the name, the given link, and each candidate's URL, title, snippet and followers when known. It labels each `main`, `alternate`, `fan`, `other person` or `not a profile`, with a one-line why.

An account **tracks itself** when all hold:
- its label is `main`;
- its display name equals the person's name, word for word (lowercase, letters and digits, single spaces). "Alex Hormozi Clips" and "alexhormozi" do not match "alex hormozi". The handle never counts: the stranger's TikTok `@alexhormozi` would pass a handle rule;
- it is the only such hit on its platform. Two on one platform: the YouTube one with more subscribers tracks; elsewhere (no follower counts in search) both are candidates.

The display name comes from the hit title: the text before ` (@`, ` - `, ` | ` or ` / ` ("Alex Hormozi (@hormozi) • Instagram", "Alex Hormozi - YouTube", "Alex Hormozi (@AlexHormozi) / X"). YouTube API hits give it directly.

Replayed on run `01M7KDJGQX6F3YAF1GT0YFY0AC`: exactly YouTube `@alexhormozi`, Instagram `hormozi`, X `alexhormozi`, TikTok `ahormozi` and Threads `hormozi` pass. Daily Alex Hormozi, Alex Hormozi en Español and Leila do not. That replay is the test fixture.

A pasted profile link always tracks itself: William named it.

Everything else is a candidate. `alternate` rows show ticked, so one Track click adds them. `fan` and `other person` rows show unticked. `not a profile` rows are counted, not shown.

LinkedIn rows never track themselves: profile reads through `linkedin@wren` are unproven. Threads reads through the cleared bare Instagram login (`creator.ts:80-81`), so Threads tracks like the rest.

A first read that fails ("private", "not found") leaves the account in the read-failed state. The sheet shows it with Remove.

Each tracked account's note says how it was found ("search, main, name matches").

### D4. Person and niche

- The person: the person of a hit that passes D3 and is already tracked; else `personNamed(name)`; else a new person with that name. A hit that fails D3 (Leila) never lends its person.
- A link input runs in this order: track the link, read it, take the name from the read, then search.
- A hit already tracked shows "Tracked" on its row and keeps its person. The find never passes a new person to it (`trackCreator` would move it, `creators.ts:101`).
- The niche: a field in the sheet, default the niche in the address. `creator find` takes `--niche`, required, like `creator add`.

### D5. The feed by format and platform

A tab row over the gallery, after YouTube's channel tabs (Videos, Shorts, Live): **All · Long-form · Shorts · Posts**.

| Format | (platform, kind) |
|---|---|
| long | YouTube `video`, `live` |
| short | YouTube `short`, Instagram `reel`, TikTok any |
| post | every other pair (X, Instagram `photo` and `carousel`, LinkedIn, Threads) |

`feedPosts` takes `format`, one SQL `case` over (platform, kind). The tabs set `format` in the address; the Filter menu keeps platform and kind. Group gets a second choice: by platform. Sections go in the order of the platform with the best post first, as group by creator does.

### D6. `creator_finds`

| Column | Type | Note |
|---|---|---|
| id | serial | |
| input | text | as typed |
| input_key | text | normalized; one open find per key |
| name | text | the person's name, once known |
| niche | text | |
| person_id | int null | `creator_people` |
| state | text | `waiting`, `finding`, `found`, `failed` |
| step | text | `searching`, `picking`, `reading 2 of 4` |
| candidates | jsonb | `[{platform, handle, url, name, followers, label, why, sources, creatorId, tracked, readError}]` |
| run_id | text | weaver ledger run |
| error | text | |
| requested_by | text | |
| created_at, updated_at | timestamptz | |

### D7. States: the Add sheet

| State | Shows | Enters on | Next | Motion |
|---|---|---|---|---|
| empty | field "Name or profile link", niche, Find | Add creator | waiting | sheet rises (200 ms) |
| not a link we read | "Not a profile link", under the field | Find on a bad URL | empty | text fades in (150 ms) |
| waiting | "Waits for the Mac" | sent, not claimed | finding, failed | none |
| finding | the step: searching, picking, reading 2 of 4 | claimed | found, failed | step text crossfades (150 ms) |
| found | tracked rows with "Tracked"; candidates with tick, label and why | done | tracking, closed | rows fade in (150 ms) |
| nothing found | "No accounts found for X", try a link | done, 0 | empty | none |
| tracking | Track button busy | Track | found | spinner |
| read failed | row says why, Remove | first read fails | found | none |
| failed | the reason, Try again | error, 404, 10 min stale | waiting | none |
| narrow (390) | full-height sheet | width | | |

## Build

- `packages/research`: `creator_finds` schema and migration; `format` in `FeedFilter`; group by platform.
- `apps/cli/src/creator.ts`: `creator find`.
- Portal handlers (canon-console): find, find status, track.
- Portal UI: the Add sheet, the format tabs, group by platform.
- autobrowse `src/studio/service.ts`: `creatorFind`, `creatorRead`.
- Tests: the name rule (exact, clips suffix, handle form); the format `case`; the person rule (tracked hit, named, new).

## Not in this step

- LinkedIn reads are unproven; LinkedIn shows as a candidate only.
- No new platform readers.

## Risks

- A fan page with the exact name, labeled `main`. The followers rule picks the larger one; William can Remove.
- A common name ("Alex Lee"). The pick sees snippets and followers. A link is the sure way in; "nothing found" says so.
- YouTube Data API quota: 100 units a search, 10,000 a day.

## Decision log

- 2026-11-16: B picked for D1 on the Hormozi measure. Exa off. The find runs on the desk.
- 2026-11-16: goldfish review: 28 findings across critic, reader and zoom-out; 21 applied, 7 rejected. Applied: a `format` filter (the tab Blocker), tick as a portal write plus `creatorRead` (no read before track), the name rule, person and niche rules, the table, failure and rollout, Threads readable. Rejected: a spend cap (his words cover $0.006), a find cancel, a find-dedupe index beyond one open find per input, per-platform tabs (group by platform covers it), term links. `findCreators` reused for YouTube only, after measuring it: X and Instagram missed. Open: none.
- 2026-11-16: advisor: the handle clause dropped (it matched the stranger's `@alexhormozi`); the name rule replayed on the measure run; a person comes only from a hit that passes D3; the find ends at `found` before the reads.
