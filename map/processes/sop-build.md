---
type: process
status: verified
verified: 2026-10-04
consumes: []
produces: []
---

# sop-build

A video, a Drive folder or a file becomes a source file; one model call turns the folder into the next SOP.md.

## Input → Movement → Output

`wren sop add <name> <youtube url | other video url | drive:<folderId> | file>` writes `sources/<kind>-<id>.md` (front matter with `priority`) under `<sopsDir>/<name>/`, a private folder outside this repo (`../sops` by default). `wren sop build <name>` reads `notes.md`, the current `SOP.md` and every source, highest priority first, and asks Claude Code (Opus) for the next SOP.md. Only `wren sop push <name> --platform <p>` touches a database: it stores SOP.md as that platform's [[content/playbook]], which every draft prompt then carries.

## Why this shape

SOPs change weekly, so the loop is edit `notes.md` or `SOP.md`, build again: the prompt keeps the current text where it still holds, so a rebuild is a diff, not a rewrite. Videos are read as captions with a `[m:ss]` marker a minute and a heading per chapter so a rule can cite a moment, plus an `## On screen` section: Gemini (the llm.env key fleet, rotated on 429) reads the YouTube URL in 10-minute clips and transcribes every document, slide or table the speaker shows, since the speech alone misses them (`--no-screen` skips it). Other videos (Instagram reels, TikTok, X) have no captions: `yt-dlp` downloads them at 540p and `watch` reads them with ffmpeg and Cohere (10-21: the Gemini keys died). The words come only from the transcript; the vision model gives on-screen text only. Gemini's read of the screen is added when a key works. Drive goes through autobrowse's `drive` site on this machine (the token is in that checkout's `.env`), not through Restate: there is no desk worker to carry it.

## Steps

1. `youtubeSource` (`packages/research/src/sops/index.ts`): `yt-dlp -J`, the English json3 track, `captionsMarkdown`, then `screenText` (Gemini on the URL per clip).
2. `videoSource`: the `watch` core (`packages/research/src/sops/watch.ts`; `wren video watch` and `video look --with cohere` call the same one): `yt-dlp -j --no-simulate -S res:540` (`download`), ffmpeg scene cuts and a 360p frame every 2 s, Cohere Transcribe for the speech, `command-a-vision` for the on-screen text in batches of 8 frames. Each line carries its frame time; a frame with no line, or one the model refused after one text-only retry, is `(not read)`, never filled. Gemini (`askShown`, `gemini.ts`) adds an `## On screen (Gemini)` section only when a key still works, else it is skipped with no error. Source body: `## Caption`, `## Speech`, `## On screen`, `## Cuts`.
3. `driveSources`: walk the folder, export each Doc as text (`apps/cli/src/sop.ts` `autobrowseDrive`).
4. `extractPoints` (optional): one call per source writes `points/<stem>.md`, an exhaustive cited list the owner curates (delete, `!` to force); `readSopDir` hands build the points file in place of the raw source when it exists.
5. `buildSop`: `readSopDir` (priority order), `sopPrompt`, one `ClaudeCodeLlm.complete`, write `SOP.md`.

## If you change this

- **Hits:** `apps/cli/src/sop.ts`, settings `ytDlp`, `ffmpeg`, `sopsDir`, `autobrowseDir`; the COHERE keys (speech and screen of a non-YouTube video: with none, `sop add` of a reel fails).
- **Does not hit:** studies (`packages/research/src/studies`): those are web research into a database; this reads curated sources into a file.

## Surfaces

| Surface | Role |
|---|---|
| `wren sop` | add, build, ls, push |
| autobrowse `drive` site | exports Docs for `drive:` sources |
| `~/.claude/skills/sop-<name>` | symlink from `sop link`; `SKILL.md` points at SOP.md and refs/ |

## See

- Source: `packages/research/src/sops/index.ts`, `watch.ts` (the video reader), `gemini.ts`, `tools.ts`, `apps/cli/src/sop.ts`, `apps/cli/src/video-watch.ts`
