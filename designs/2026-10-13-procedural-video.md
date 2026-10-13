# Procedural video (fframes)

2026-10-13. William sent a reel (Learn item 701) about "ff-tracking, the procedural video generator". Question: can it fold into the video editing agent?

## What it is

- The reel names `mrsarac/ff-tracking` (the on-screen text misspells the owner). It is a demo, not a tool: one 6 second clip of an AI agent typing in a terminal, filmed by a virtual camera. MIT, Rust, created 2026-10-09, one release (v1.0.0), 370 stars.
- The engine is **fframes** (`dmtrKovalenko/fframes`, crates.io `fframes`). Programmatic video in Rust: each frame is an SVG tree from a function, drawn on the GPU (Skia on Metal or Vulkan), with SkSL or Shadertoy shaders as layers, ffmpeg libav for encoding. MIT, 2.7k stars, 21 contributors, 65 forks, repo from 2021. v1.0.2 on 2026-09-28, v1.2.0 on 2026-10-03, commits daily.
- ff-tracking adds two passes (SVG flat screen, then a lens shader for depth of field and tracking boxes) and Python-synthesized sound (keystroke clicks, hum, beeps) driven by the same track data as the picture.
- fframes ships an agent skill (`npx skills add https://fframes.studio`) and an agent CLI: `inspect` (problems per frame), `strip` (contact sheet), `onion`, `frame`, `audio analyze` (LUFS, peak), `render --draft`.

Not a text-to-video model. It is code a person or an agent writes. "Procedural" means the picture and sound come from math, with no footage.

## Decision

Do not fold it into the editing agent now.

- The editing agent cuts talking-head recordings (ingest, whisper, cuts, ffmpeg, Remotion layout, upload). fframes has no step in that. It makes footage-free motion pieces.
- The one place it fits is a **promo scene**. Later, add a `clip` scene kind to `Promo` (`packages/studio/src/promo.ts`, composition in `remotion/index.tsx`): a pre-rendered mp4 or alpha WebM that Remotion plays full frame or inset. An fframes project renders the clip in its own folder, outside the pnpm workspace. Claude Code writes it with fframes' own skill.
- Build the `clip` kind only when William wants a shot Remotion can't make (shader depth of field, glitch tears, a camera tracking real glyph positions). Until then it adds a Rust toolchain for nothing.

## Why

- Remotion already does what the editor needs: captions, tracks, loudness, matte, Studio preview, 5 promo scenes. `packages/studio` is TypeScript and is tested in the repo's gates. A second renderer in Rust splits the stack.
- Our promo is screens and type. fframes wins on looks Remotion's Chromium can't do cheaply (per-pixel shaders, a real lens). That is a style we may want, but nobody has asked for it.
- It is $0. Remotion's license is the cost to watch (free to 3 people, then $100 a month minimum for client use). fframes is MIT, so a clip route is also a way out of that cost for pure-graphics promos. That is a reason to keep the door open, not to switch.

## How (when we do it)

1. `clip` scene: `{ "kind": "clip", "file": "shot.mp4", "seconds": 6, "enter": "rise" }`. The schema checks the file exists. The composition plays it with `OffthreadVideo` (Remotion's frame-accurate video tag). Audio from the clip is kept or muted per scene. Tests: schema and the clock, like the other scenes.
2. fframes projects live in `~/fframes/<name>/`, not in wren (the repo is public, keep Rust build output out). The prebuilt Skia and ffmpeg libs download on first build (under a minute on Apple silicon). Draft renders take about a second a scene.
3. Encode with our ffmpeg (VideoToolbox), not fframes' libx264. Render fframes to a mezzanine file or PNG sequence, then `wren video promo` handles the final encode and loudness. This avoids the codec license point below.
4. Check its work the way fframes intends: `inspect` and `strip` before a long render. Our Promo only has `--still`.

## Steal now, no dependency

- **A contact sheet for Promo.** `wren video promo --strip 12` writes one PNG of evenly spaced frames. An agent can't watch video, and this is how it checks a layout. Small, in `packages/studio/src/remotion.ts` and `apps/cli/src/studio.ts`.
- **Sound tied to scene events.** Click per word, riser into a cut, beep on a stat landing, synthesized from the script's own timings. Promo takes a music file or none today. This is the part of the reel that made it feel real. It needs a small synth (numpy is enough, or a TypeScript buffer writer) and a loudness pass, which `loudness.ts` already has. Needs William's yes: designs/2026-10-11-promo-video.md ruled out music generation, and this is sound effects, not music.

## Cost

- Money: $0. No API, no seat. Claude Code runs on his plan.
- Setup: Rust (already on this Mac), `brew install ffmpeg x264 x265 opus` (ffmpeg is present). Prebuilt libs for macOS and Linux arm64 and x86_64. Windows needs a shared FFmpeg and LLVM.
- Time: a first clip is an agent session. The launch video (128 s) took its author 48 minutes with an agent, rendered in 36 s.

## Risks

- **Young.** v1 is two weeks old. crates.io shows a `1.2.1-rc` build. The author says the API stayed unreleased for years because it is explicit and verbose. One maintainer. Expect breaking changes. Pin the version.
- **Codec license.** The `h264` feature needs `libav-agree-gpl` (libx264 is GPL). Linking it into a binary we ship would pull in the GPL. We only render clips for our own use and re-encode with our ffmpeg, so the output is ours either way. Do not distribute an fframes binary.
- **Rust.** Verbose code, slow first compile (up to 20 minutes when a feature combo has no prebuilt lib), and nobody here reads it daily. An agent writes it; a bug is hard for us to fix by hand.
- **Mac only for us.** Metal on the desk Mac works. The Lambda and the Restate box can't run it (no GPU), so promos that use it can't be made by a worker.
- **ff-tracking is a one-off.** Copying it gives one look. The value is in fframes' parts, not the repo.

## Not now

- Replacing Remotion with fframes. No.
- A `packages/fframes` or Rust code in the wren repo. No.
- A cinematic terminal clip for our own launch video. Maybe: it is the Wren story (an agent working in a terminal). Ask William when the next promo is planned.
- Text-to-video models. A different tool. Not the same job.

## Decision log

- 2026-10-13: researched from the reel (Learn 701), the GitHub repos and the fframes README. Nothing built. Design ref reel for the same message added to Learn collection Design refs (item 700).
