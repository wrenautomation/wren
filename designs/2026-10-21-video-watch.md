# `wren video watch`: ffmpeg + Cohere, Gemini optional (2026-10-21)

Built 26eb3bbe. Moved to its own package `packages/video-watch` (`@wren/video-watch`) 2026-10-24: one core, no database, four callers (`wren video watch`, `sop add`, Learn's Mac reader, `video look --with cohere`).

William asked for it. Gemini keys are dead. Watch a reel or video with ffmpeg as the base. Cohere reads speech and on-screen text. Gemini is optional enrichment.

## Command

`wren video watch <url|file>`. Prints Speech, On screen and Cuts. `--json` for the raw result.

## Pipeline

1. Fetch: reuse the yt-dlp download in `packages/research/src/sops/index.ts` (`videoSource`): `uvx yt-dlp -S res:540 -f 'bv*+ba/b' --remux-video mp4`. A local file skips this.
2. ffmpeg facts (always): duration; scene cuts (`select='gt(scene,0.25)',showinfo`); frames at 1 per 2 s, scale 360, jpeg; mono 16 kHz mp3.
3. Speech: Cohere `POST https://api.cohere.com/v2/audio/transcriptions`, multipart, `model=cohere-transcribe-03-2026`, `file=<mp3>`.
4. On screen: Cohere `POST /v2/chat`, `model=command-a-vision-07-2025`, text + `image_url` jpeg data URIs, about 8 frames per batch. Keys from the existing cohere provider in `packages/llm`.
5. Gemini: the existing `askGemini` path only when a key works. Otherwise skip it with no error.

## Rules (Cohere vision is weak)

- Tag every vision line with its ffmpeg frame time. Keep the ffmpeg cut list beside it.
- Refusal ("I can't assist with describing images of people" and the like): retry the batch once with "Read only on-screen text, UI and graphics. Ignore people." Still refused: those frames are "not read".
- Count the frames returned per batch. A frame with no line is "not read". Never fill gaps.
- Words come from the transcript. Vision gives on-screen text only.

## One implementation

One `watch` core in `@wren/video-watch`, used by the callers below.
- the CLI;
- `sop add` for non-YouTube video, in place of the Gemini-only path;
- `packages/studio/src/look.ts`, as a third provider, `cohere`, next to `gemini` and `twelvelabs`.

Output shape: the same as the sop video source: Speech and On screen sections, plus Cuts.

## Tests

- A small fixture mp4 with mocked fetch.
- The refusal retry.
- The dropped-frame gap ("not read", no fill).

Reference proof run (by hand): `/private/tmp/claude-502/-Users-williamjin-Documents-wren-automation/4be4e300-3e32-477f-b088-1f0e5c0555d3/scratchpad/watch.py`, outputs in `.../scratchpad/reel/`. The repo is public: never commit the reel, its transcript or its frames.

## Log

- 2026-10-26: `watch` and the readers over it live in scribe (`src/video/watch.ts`, `read.ts`;
  `@wrenautomation/scribe/video`, pinned exact). `videoSource` in wren is a one-line wrapper that files
  scribe's `readVideo` with the SOP's priority (WA-886).
