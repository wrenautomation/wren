---
type: object
cluster: learn
universe: live
status: verified
verified: 2026-10-25
entity: packages/learn/src/schema.ts:313
---

# breakdown (Learn)

How one item is made: its hook style from a fixed set (`HOOK_STYLES`, the same set for every kind), the hook line and why it works, topic, beats with times, the call to action, and in `facts` what its kind's rubric adds (a reel's `format`; a post's shape and counts; a film's shots). `kind` is the item's kind when it was broken down; `BROKEN_DOWN` (`breakdown.ts`) lists the kinds with a rubric. Table `learn.breakdowns`, one row an [[learn/item]]. Design: `designs/2026-10-25-competitor-analyzer.md`. Learn → Competitors reads it beside the post's numbers (`items.stats`).

## Why this shape

A closed style set so reels group and rank; free tags would never count. Written by the judge that scored the item, right after the score (`scoreItem` calls `breakdownItem`), so a client's breakdown is on its own allowance. Once a row exists it is never asked again. Reach is views when given, else likes plus comments, so Instagram (no views) and TikTok rank together.

## Shape

- `item_id` (pk, FK items, cascade), `hook_style`, `hook`, `hook_why`, `topic`, `kind`, `facts` jsonb (the kind's rubric, checked by `FACTS[kind]`), `by` (`model`: code counted and the model labelled; `hand`: the seed study's facts, `learn import-films`), `beats` jsonb `[{t, beat}]` (`t` null when unplaced), `cta_kind` (`CTA_KINDS`), `cta` (null with `none`), `created_at`
- `facts` by kind: reel and video `{format}` (`POST_FORMATS`); post `{format, chars, lines, first_line_chars, link, hashtags, shape}` (`postCounts` + the model's `shape`); film `filmFactsSchema` (`film.ts`): `cuts`, `cuts_by_signal`, `cuts_trust`, `shot_median_s`, `shot_p90_s`, `cuts_per_10s`, `first_product_s`, `logo_s`, `cta_s`, `music`, `vo`, `shots[]` (`type`, `move`, `in` null until vision proves itself)
- A film's facts come off its read page: `renderWatched` (`@wren/video-watch`) writes a `## Facts` JSON fence (duration, audio, each detector's cuts) when the Mac reader ran the scene detectors (`WREN_SCENEDETECT`, default `uvx scenedetect`); `filmFactsOf` reads it at breakdown time, so an old page re-breaks down offline. Trust: hash within 20% of a hand count, else hash and adaptive within 2x (`cutsTrust`); ffmpeg's `scene` is evidence only
- `items.stats` jsonb `{likes, comments, views}` and `items.stats_at`: set by each creator pass (`pullCreators`, `creators.ts`), refreshed on posts seen before; the back catalog sets them on insert
- His calls (`calls.ts`): keep, tune or drop with his words, on the item's document (`doc:<id>`, Decide kind `document`) or one fact (its finding's key `doc:<id>/beats/2`, `/facts/shots/5`, kind `finding`) in `decision_calls` (`comment` column); `factRows` lists the callable paths off the row, a path outside them is refused; `factCalls` is the newest per path. Wren's workspace only
- Item page: a film's `shots` (`filmShots`, `film.ts`) draw as one strip, each shot as wide as it runs; a pressed shot opens its row to call, and his call marks the shot's foot. Shot rows stay out of the list until picked
- Views `learn.breakdown_records` (Wren's own, competitors only: an item with `draft_id` is ours and never listed, so never counted; `reach`, beats as `[m:ss] beat` lines, `calls` and `called` for the "To call" queue, `check` and `check_why` off `learn.checks`), `learn.hook_records` (per style: reels, creators, median and best reach, best reel) and `learn.standards` (one flat row per breakdown: platform, creator, reach, each kind's facts as typed columns; what an SOP's `standard.md` is measured on; only pieces a person picked count: a hand breakdown, a saved link, a followed creator's piece, or one he kept; a hunt's topic find counts once he keeps it, never when archived or dropped). `checkPiece` (`check.ts`) puts one of our pieces beside a `KindStandard` and the patterns `rulesOf` rolls up from his calls
- Shot labels: a film shot's `type`, `move` and `in` stay null. `labelShots` (`packages/video-watch/src/shots.ts`) asks Cohere vision; `wren learn shot-proof` scores it on the hand seed, and it failed the 80% bar on 10-25 (`designs/studies/2026-10-25-shot-label-proof.json`)
- Learn back (`learnback.ts`): `learn.checks` holds one row per competitor piece he kept a pattern on, per SOP, when our own pieces with that pattern do worse than all ours (median of one number per kind: a reel's hold at 3 s, a video's or film's share watched, a post's engagement per view; `MIN_STANDARD` of ours on each side). `checksOf` is pure; `writeChecks` replaces an SOP's rows. Competitors' "Check this" view lists them; his calls are never reset
- An SOP's two generated files (`standard.ts`): `scopeOf` reads `kinds`, `platforms`, `topic`, `set` off `notes.md`'s front matter; `standardOf` gives each number its median and middle half and each closed set its counts; `callsOf` rolls his calls on the pieces in scope (or asked in via `sop_sources`) into patterns (once the SOP's content line has a document, both read the line's documents instead: `lineItems`), a rule at `RULE_KEEPS` keeps with no drop; `writeSopFiles` writes `standard.md` and `calls.md` for `wren sop sync` ([[sop-build]])

Citations: `packages/learn/src/breakdown.ts`, `packages/learn/src/calls.ts`, `packages/learn/src/standard.ts`, `packages/learn/src/film.ts`, `packages/learn/src/creators.ts` (`statsOf`), `packages/video-watch/src/watch.ts` (`sceneDetectCuts`, `watchFacts`, `readWatchFacts`)

## Connected to

- **owned-by:** [[learn/item]]
- **writes:** [[platform/decide]] (`document` and `finding` calls)
- **joins:** `learn.sources` (followed or saved)
- **looks-like-but-is-not:** [[ads/ad-format]] (our own ad formats, edited by hand); the score (how useful to Wren, not how it was made)

## If you change this

- **Hits:** the style labels in `records.ts` (`HOOK`) must list every `HOOK_STYLES` value; the prompt (`breakdownPrompt`) names each style's meaning (`HOOK_STYLE_ABOUT`); adding a style needs a migration (check constraint); a new fact key goes in `FACTS[kind]` and the design's rubric list, never a column; a film page without a facts fence is skipped (`breakdownItem` returns false) until the Mac re-reads it; a call's index path (`beats/2`) holds only because a breakdown row is never regenerated: a re-breakdown would orphan his calls, so delete and re-ask only with the calls moved
- **Does not hit:** the score or the verdict

## Surfaces

| Surface | Role |
|---|---|
| `scoreItem` (executor `learn.score`, `wren learn read`, `rescore`) | writes, once an item |
| `wren learn breakdown [ids] [--limit n]` | writes: backfill |
| `wren learn import-films <json>` | writes: the seed study as film items, read on the Mac, broken down with hand facts (`by = hand`) |
| Learn → Competitors, Breakdowns (Kind facet; Films, Posts views), Hooks (`learn.breakdown`, `learn.hook`) | read |
| Item page → How it's made (`item.tsx` `Facts`; console `call`) | read the facts and his calls; writes a call |
| `wren learn call <id> <path> keep\|tune\|drop [words]` | writes a call (`show <id>` lists the paths) |
| Learn → Competitors → To call (`learn.breakdown` view `to-call`) | read: broken-down pieces with no call yet, best reach first |
| Learn → Competitors → Check this (view `check-this`) | read: kept patterns our numbers argue against, with why |
| `wren sop sync <name>` (and `sop build`) | read: `learn.standards` and the calls into the SOP folder |
| `wren sop hunt <name>` ([[sop-build]]) | write: candidates for the SOP saved and tagged with its name (`saveLink` with `creator`, `stats`, no worth call), the feed's `IN_FEED_BEFORE` items revived, then read and broken down |
| `wren lake sql` | read: `learn.standards` as is |

## See

- Design: `designs/2026-10-11-competitor-breakdowns.md`
