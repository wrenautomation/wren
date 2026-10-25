# Video: film file, self-check, edit rubric, sound kit, Studio stories (2026-10-24)

William, 10-24: take the good ideas from OpenFilm (openfilm/openfilm, MIT) and the "unslop" reel into our Studio. Keep our pipeline. Overhaul the video and content marketing UI in Storybook. Add a sound kit.

Why ours stays: OpenFilm has no cut engine, no local transcript, no ingest, no database, no publish, and is three weeks old (v0.2.5). We take its format, its check and its quality bar. We copy no code.

## Target state

A video edit is one row (`video_edits`). From it, Wren writes a real OpenFilm `film.html` that a person can read, diff and open in OpenFilm Studio. Every render is checked by a model before Approve. The edit pass works to one written bar. Every format has sound design from one licensed kit. Every Studio and content screen has a story at desktop and phone width, matched to the Studio and Marketing artifact.

## Decision 1: film.html is a projection, not the source of truth

OpenFilm renders from film.html. We render with Remotion from the row. A renderer rewrite buys nothing, so the row stays the source and film.html is a pure function of it. This is a downgrade from "one file both edit": import (film.html back to a patch) is part 2, after export works.

Export, `wren video film <id> [--short N] [--out dir]` (`packages/studio/src/film.ts`):
- One `film.html` per format: the long video at its own size, each Short at 1080×1920 (`<meta name="viewport">`).
- Kept spans (after `cuts`) become `<video src="assets/<main>.mp4#t=in,out" at="…">` clips of the same recording on one track. Times to 3 decimals.
- The camera track and crops become a second track with CSS: `object-fit: cover`, `object-position`, `left/top/width/height` from `coverRect`.
- Overlays become page clips (`<iframe src="pages/overlay-N.html">`) with `frame(t)`. Titles too.
- `words` become `assets/<main>.vtt`: a cue per caption line (`captionLines`), a timestamp tag per word, in the file's own seconds.
- Strict to OpenFilm SPEC §1 (no other attributes). Test: OpenFilm's own reader (`src/film-doc.mjs`, MIT) parses our output with no error; run it from npx in the test, never vendored.
- Files are links: media stays in S3 or beside the recording. `--out` writes the folder with relative paths.

Diff, `wren video history <id>`: each `runs` row already keeps what it replaced. Show each change as a unified diff of the two film.html projections. No new storage.

Locks (OpenFilm's `overrides` and `locked`): new column `video_edits.locked jsonb` (list of field paths, for example `"shorts.2"`, `"crops.short"`, `"overlays.0"`). A person's change from the page or `wren video set --lock` adds the path. The edit pass (`applyPass`) and `video ask` refuse to patch a locked path and say so. `wren video unlock <id> <path>`. In film.html a locked part's track carries `locked`.

## Decision 2: self-check before Approve

`wren video check <id> [--only output]` (`packages/studio/src/video-check.ts`, built 2026-10-24):
- Facts from ffmpeg on the rendered file: scene cuts (`sceneCuts`, exported from `@wren/video-watch`) and the output's own words. Not `watch()`: it sends every frame to Cohere vision, which refuses faces.
- A contact sheet: ffmpeg `tile` of one frame per 2 s or more (at most 48), plus 3 full frames (start, middle, end). This ffmpeg has no `drawtext`, so the prompt gives each tile's time by its place.
- One Gemini ask (`askGemini`) over the sheet and facts, against the bar. Gemini, because the LLM seam (`makeLlm`) takes no images. Never Cohere vision: it refuses frames with people.
- Answer: a list of `{ at, rule, says }` and a pass or fail. Stored as a `runs` row (`video check`) with the output's render hash, so a new render reads as not checked.
- `videoChecks` (the list he reads before Approve) shows the failures. Approve is not blocked; a fail shows red.
- `wren video render` (the desk's render) checks each output it made new. `--no-check` skips. A check error never fails the render.

## Decision 3: one edit bar

The rubric lives in one file, `packages/studio/src/bar.ts`, and is used by the edit pass prompt (`editPrompt` in `packages/content/src/video-edit.ts`) and by the self-check. Lines:
- Cuts fall in pauses. No clip starts on a clipped word or stops mid-thought.
- A Short opens on its strongest real line, ends on its point, stands alone.
- The face is sharp and well framed: eye line near 40% from the top, the head not cut.
- Text on screen is readable at phone size. Nothing that matters sits in a platform's button or caption zone (`safe-zones.ts`).
- Nothing private in any frame: keys, tokens, emails, names, customer data, notifications, other tabs.
- Captions: one plain font, 2 to 3 words at a time, no over-animation (reel rule 1).
- No emoji or icons. Pop-ups are real screenshots, static (reel rules 2 and 5).
- No sentence off the hook's point (reel rule 4).
- On a Short, the picture changes at least every 10 s (a cut, a crop change, an overlay).
- It holds up next to the best clips on the platform. A clip you would scroll past is not done.

Cut knobs per format: `studio.cuts` becomes `{ long: {...}, short: {...} }`. Short default `minGapS` 0.35, `airS` 0.12 (schema min for both drops to 0.1). Long keeps 0.7 and 0.2. A 0.1 s floor on a long talk fights the air and quiet-snap rules, so long stays as it is.
Built 2026-10-24: ingest and `wren video cuts` run the silence pass twice. The Short pass goes to its own column, `video_edits.short_cuts` (not in a patch). A Short plays `shortCutsOver(cuts, shortCuts)`: a Short cut inside a stretch he kept is dropped. `shortProps` gives the composition `segments` of the cut file; the Short plays one `<Sequence>` per segment. The vertical, square and portrait formats stay on the long cuts. `wren video knobs short --min-gap 0.4` sets the Short knobs; an old flat block reads as `long`.

## Decision 4: sound kit

Target: one kit, licensed for commercial use, that covers tech and general video: mouse clicks, key taps and typing beds, UI pops, notification dings, whooshes and swishes for cuts and zooms, risers, hits, a soft low boom for title cards, paper and camera sounds. Plus 5 to 10 music beds (calm tech, upbeat, tense).

Sourcing (builder researches, William's yes on the pick before it ships):
- Prefer CC0 (commit-safe): Kenney (UI Audio, Interface Sounds, Digital Audio), Freesound CC0 packs, Sonniss GDC bundles only if the licence allows; check each.
- Music: CC0 or a free licence with commercial use and no attribution, or YouTube Audio Library tracks marked no-attribution.
- The wren repo is public. Only CC0 files go in the repo. Anything else lives in the media bucket under `sfx/` with its licence file beside it.
- Every file normalised (ffmpeg `loudnorm`), trimmed of leading silence, stored as 48 kHz wav plus mp3, with a manifest `packages/studio/sfx/kit.json`: `{ id, file, kind, tags, durationS, licence, source }`.

Use in renders:
- New edit field `sounds: { at, id, gainDb }[]` (raw seconds), and `music: { id, gainDb, duck: true } | null`.
- Remotion `<Audio>` per sound and the bed. Voice stays at -14 LUFS; effects sit near -24, the bed near -30 and ducks 8 dB under speech (from `words` times).
- Auto-placement, deterministic, per format: a click on each click event, a swish on each crop or layout change, a pop on each overlay in, a key bed under terminal typing (key events), a low hit on the title card. The edit pass may add or remove; a person's choice locks.
- Long videos get fewer: no swish on plain cuts.

Built (2026-10-24, wa-qtyo.3). What changed from the plan, and why:
- Kit (replaced 10-24, William did not like the first kit): the effects are uisfx (npm `uisfx` 0.4.0, CC0 audio, github.com/romainsimon/uisfx). It is a dependency of `@wren/studio`; no sound file sits in the repo. It has 12 styles with the same 78 cues each. A sound id is `<style>/<cue>` (`studio/press`), its file `sfx/<style>/<cue>.ogg`. Hear them at uisfx.com.
- The rules and promos play one style, `STYLE` in `sounds.ts` (now `studio`, "editing precision, cinematic restraint"). To change it is one line. Cue picks: press on a click, typing on a key, open on an overlay, swipe on a layout change, start under a Short's card. Promos: swipe, back, forward on cuts, notification on a toast, success on the numbers, complete on the end card. These are picks by name, not by ear: William checks them in a render.
- No pack checked for this fits video editing (whooshes, risers, impacts). uisfx is a product UI pack; swipe and open stand in for transitions. Better transitions need a source William picks.
- Ogg, not wav, as uisfx ships it. Remotion and the OpenFilm reader take it.
- Levels: an effect plays at its cue's uisfx volume (0.065 to 0.26; files peak near -7.5 dBFS), plus its own `gainDb`. The bed is at `BED_DB` (-16). The whole render is levelled to -14 LUFS after.
- No music beds yet. uisfx has none.
- Beds go to the media bucket at `sfx/bed-<name>.wav`, each an entry in `sfx/kit.json` `beds` with `where: "bucket"`. `wren video sfx add` puts one there, `sfx pull` brings them to the Mac cache.
- Key taps are one per key press (at most one per 70 ms), not a typing bed. A bed would play over pauses in his typing.
- Shorts get no swish on plain cuts either. A swish plays on layout changes alone.
- Commands: `wren video sounds <id>` writes the rules' sounds (refused where he locked `sounds`), `wren video music <id> <bed id|none>`, `wren video sfx list|pull|add`. `wren video set` sets and locks `sounds` and `music` like any part.
- The film file lays each sound as an `<audio>` clip on a "sound" track. OpenFilm has no loop, so the bed is one clip per pass of its file. The duck is in the render only.
- Cap events: `capEvents` reads each segment's `cursor.json` clicks and `keyboard.bin` (bincode) or `keyboard.json` presses, moved onto the joined file. Modifier keys make no sound.
- The edit pass (`video ask`, the page's Change) knows `sounds` and `music`: the styles, the cues, the rules, and the edit's sounds now. `CUES` and `STYLES` in `sounds.ts` list them for it (a test holds them equal to the uisfx manifest). Every patch refuses an id that is not a style and a cue; a bed not in `kit.json` is refused at render.
- Promos get sound too. A sound on each cut by its entrance, on each toast, as the numbers start and on the end card. `music` takes a bed id or his own file; `sounds: false` turns the effects off. The bed sits at -8 dB, higher than under speech.
- The kit is read from the studio package folder the CLI names (uisfx resolves from there), not beside the bundled code. A real promo render found that bug.

Replaced again (2026-10-24, William: a kit made for product and tech videos, with the right sounds at the right place and level). The effects are earshot's `launch` kit (github.com/Leonxlnx/earshot, MIT, v0.4.0). What changed, and why:
- Why earshot: uisfx is a product app UI pack, with no whoosh, riser or hit. earshot makes each sound in code and names for each role where it sits against the cut (`offset_ms`), how close a run may go (`min_gap_ms`) and its level over the music (`bed_db`). Its numbers are medians measured on licensed launch films. That is the job.
- Skipped from the same reel: Openverse (5.2 M CC files with mixed licences, a search, not a kit), earshot's critique and timeline (they load models: torch, 20 to 40 s; a later option for `wren video check`), "Real SFX" (not found; our rules already place sounds from Cap events, layout, overlays and promo scenes).
- A generator, not a dependency. `node packages/studio/sfx/make.mjs` runs earshot from its git tag (uvx; PyPI `earshot` is a different package), renders the kit (13 s, no models), writes each take as Opus in Ogg (`sfx/fx/`, 128 kb/s, bit-exact, 72 takes, 656 KB), earshot's lock beside them, and `src/fx.ts` (`FX`). The render reads `FX` alone: no Python on the Mac or the worker. A test holds each file to its sha1 and to the lock.
- Licence: the code is MIT. The 15 fitted sounds come from CC0 Freesound recordings. The rest is synthesized. Recipes were tuned toward private reference clips, but no sample was copied. So the files go in the public repo (`sfx/README.md`).
- A sound id is a role (`click`, `whoosh.short`, `riser`). The n-th sound of a role in an output plays take n (mod the takes), so key taps and clicks do not repeat one file. `ROLE_SAYS` in `sounds.ts` says what each is, for the edit pass.
- Place: each take's sync point (its onset, or its peak for a whoosh, riser or swell) lands on the cue plus the role's offset. A take that would start before the output's first frame is trimmed (`trim`, Remotion `trimBefore`, the film's `#t=`).
- Level: each take's loudest 50 ms goes to the bed level plus `overBed(bed_db)`, never past -1 dBFS at its peak (earshot's own mixer). The bed level is set, not guessed (`FX_BED_LUFS`): `wren video sfx add` levels every bed file to -14 LUFS (`BED_LUFS`), so under a voice it plays at -30 (`BED_DB` -16). A promo plays its music at -24: a kit bed by that math, his own file measured at render time. A promo render is then levelled to -14 LUFS, like every other render (it was not: one came out at -23.7).
- Measured (2026-10-24, synthetic promo, pink-noise music at -17.8 LUFS): the render lands at -14.4 LUFS, true peak -1.3 dBTP. Each effect's loudest 50 ms (K-weighted, approximate) sits 4 to 8 dB over the music; earshot's target is 7.5 to 9. The end hit is lowest (+3.9): it lands on the riser's tail.
- Run gaps come from the kit: clicks at least 85 ms apart, keys 87 ms. They replace the old 50 and 70 ms.
- Rules: `click` on a click, `key` on a key press, `pop` on an overlay, `whoosh.short` on a layout change, `land` under a Short's card. Promos: `whoosh.short` on a rise or wipe cut, `whoosh.long` on a pull-back, `snap` on a flow cut, `pop` on a toast, `click.confirm` as the numbers start, a `riser` into the end card and a `hit` on it. Picks by the kit's own role notes, not by ear: William checks them in a render.
- Not used yet: earshot's stop-down (the music dips 6 to 12 dB before a hit, a drop, a big whoosh or a swell). Our beds are still empty.

## Decision 5: Studio and content stories

"Overhaul" = every screen of Studio and content marketing has a page story, in each key state, at 1280 and 390 width, light and dark, and matches the Studio and Marketing artifact (`designs/2026-10-21-studio-marketing/`, boards Main, Compose, Inbound, Outbound, Offer, Phone). Where a screen differs from the artifact, the builder ports the artifact's CSS values. The match check (`designs/2026-10-21-artifact-match.md`) judges.

Routes: `/content/{overview,studio,videos,pieces,drafts,plan,feed,facts,topics,explore,content}` and `/marketing/{plan,content,engage,inbox,ads,site,keywords,texts,text-copy,dm-copy,more}`. States: Studio waiting, due, compose, storyboard, finish, shorts, shelf, a render failing its check, a locked part, the film diff.

Costs:
- MSW fakes for every call `finish.tsx` and `videos.tsx` make. This is most of the work.
- Fixture media: synthetic only (ffmpeg smptebars and tone, as in `watch.test.ts`, or static posters). Never a real posted video: the repo is public.

## Order

1. Film file export + history + locks.
2. Bar + self-check + per-format cut knobs.
3. Sound kit: research, pick, manifest, Remotion audio, auto-placement (William picks the kit).
4. Stories overhaul, after 1 to 3 land their page parts.

Part 2, later: film.html import (a person's OpenFilm Studio edit back to a checked patch).
