---
type: object
cluster: learn
universe: live
status: verified
verified: 2026-10-11 @ HEAD
entity: packages/learn/src/schema.ts:313
---

# breakdown (Learn)

How one reel or video is made: its hook style from a fixed set (`HOOK_STYLES`), the hook line and why it works, topic, format, beats with times, the call to action. Table `learn.breakdowns`, one row an [[learn/item]]. Learn → Competitors reads it beside the post's numbers (`items.stats`).

## Why this shape

A closed style set so reels group and rank; free tags would never count. Written by the judge that scored the item, right after the score (`scoreItem` calls `breakdownItem`), so a client's breakdown is on its own allowance. Once a row exists it is never asked again. Reach is views when given, else likes plus comments, so Instagram (no views) and TikTok rank together.

## Shape

- `item_id` (pk, FK items, cascade), `hook_style`, `hook`, `hook_why`, `topic`, `format` (`POST_FORMATS`), `beats` jsonb `[{t, beat}]` (`t` null when unplaced), `cta_kind` (`CTA_KINDS`), `cta` (null with `none`), `created_at`
- `items.stats` jsonb `{likes, comments, views}` and `items.stats_at`: set by each creator pass (`pullCreators`, `creators.ts`), refreshed on posts seen before; the back catalog sets them on insert
- Views `learn.breakdown_records` (Wren's own, `reach`, beats as `[m:ss] beat` lines) and `learn.hook_records` (per style: reels, creators, median and best reach, best reel)

Citations: `packages/learn/src/breakdown.ts`, `packages/learn/src/creators.ts` (`statsOf`)

## Connected to

- **owned-by:** [[learn/item]]
- **joins:** `learn.sources` (followed or saved)
- **looks-like-but-is-not:** [[ads/ad-format]] (our own ad formats, edited by hand); the score (how useful to Wren, not how it was made)

## If you change this

- **Hits:** the style labels in `records.ts` (`HOOK`) must list every `HOOK_STYLES` value; the prompt (`breakdownPrompt`) names each style's meaning (`HOOK_STYLE_ABOUT`); adding a style needs a migration (check constraint)
- **Does not hit:** the score or the verdict

## Surfaces

| Surface | Role |
|---|---|
| `scoreItem` (spine `learn.score`, `wren learn read`, `rescore`) | writes, once an item |
| `wren learn breakdown [ids] [--limit n]` | writes: backfill |
| Learn → Competitors, Reels, Hooks (`learn.breakdown`, `learn.hook`) | read |

## See

- Design: `designs/2026-10-11-competitor-breakdowns.md`
