---
type: object
cluster: learn
universe: live
status: verified
verified: 2026-10-11 @ HEAD
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
- His calls (`calls.ts`): keep, tune or drop with his words, on the item (`learn:<id>`) or one fact (`learn:<id>/beats/2`, `/facts/shots/5`), as Decide kind `learn_fact` in `decision_calls` (`comment` column); `factRows` lists the callable paths off the row, a path outside them is refused; `factCalls` is the newest per path. Wren's workspace only
- Views `learn.breakdown_records` (Wren's own, `reach`, beats as `[m:ss] beat` lines) and `learn.hook_records` (per style: reels, creators, median and best reach, best reel)

Citations: `packages/learn/src/breakdown.ts`, `packages/learn/src/calls.ts`, `packages/learn/src/film.ts`, `packages/learn/src/creators.ts` (`statsOf`), `packages/video-watch/src/watch.ts` (`sceneDetectCuts`, `watchFacts`, `readWatchFacts`)

## Connected to

- **owned-by:** [[learn/item]]
- **writes:** [[platform/decide]] (`learn_fact` calls)
- **joins:** `learn.sources` (followed or saved)
- **looks-like-but-is-not:** [[ads/ad-format]] (our own ad formats, edited by hand); the score (how useful to Wren, not how it was made)

## If you change this

- **Hits:** the style labels in `records.ts` (`HOOK`) must list every `HOOK_STYLES` value; the prompt (`breakdownPrompt`) names each style's meaning (`HOOK_STYLE_ABOUT`); adding a style needs a migration (check constraint); a new fact key goes in `FACTS[kind]` and the design's rubric list, never a column; a film page without a facts fence is skipped (`breakdownItem` returns false) until the Mac re-reads it; a call's index path (`beats/2`) holds only because a breakdown row is never regenerated: a re-breakdown would orphan his calls, so delete and re-ask only with the calls moved
- **Does not hit:** the score or the verdict

## Surfaces

| Surface | Role |
|---|---|
| `scoreItem` (spine `learn.score`, `wren learn read`, `rescore`) | writes, once an item |
| `wren learn breakdown [ids] [--limit n]` | writes: backfill |
| `wren learn import-films <json>` | writes: the seed study as film items, read on the Mac, broken down with hand facts (`by = hand`) |
| Learn → Competitors, Reels, Hooks (`learn.breakdown`, `learn.hook`) | read |
| Item page → How it's made (`item.tsx` `Facts`; console `call`) | read the facts and his calls; writes a call |
| `wren learn call <id> <path> keep\|tune\|drop [words]` | writes a call (`show <id>` lists the paths) |

## See

- Design: `designs/2026-10-11-competitor-breakdowns.md`
