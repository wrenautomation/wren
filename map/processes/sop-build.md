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

`wren sop add <name> <youtube url | other video url | drive:<folderId> | file>` writes `sources/<kind>-<id>.md` (front matter with `priority`) under `<sopsDir>/<name>/`, a private folder outside this repo (`../sops` by default). `wren sop build <name>` reads `notes.md`, the current `SOP.md` and every source, highest priority first, and asks Claude Code (Opus) for the next SOP.md. Nothing touches a database.

## Why this shape

SOPs change weekly, so the loop is edit `notes.md` or `SOP.md`, build again: the prompt keeps the current text where it still holds, so a rebuild is a diff, not a rewrite. Videos are read as captions with a `[m:ss]` marker a minute and a heading per chapter so a rule can cite a moment, plus an `## On screen` section: Gemini (the llm.env key fleet, rotated on 429) reads the YouTube URL in 10-minute clips and transcribes every document, slide or table the speaker shows, since the speech alone misses them (`--no-screen` skips it). Other videos (Instagram reels, TikTok, X) have no captions: `yt-dlp` downloads them at 540p and Gemini gets two inline asks, speech and screen, so a screen it won't recite (RECITATION, text it knows from the web) never costs the speech; the screen ask then retries as first line plus paraphrase. Drive goes through autobrowse's `drive` site on this machine (the token is in that checkout's `.env`), not through Restate: there is no desk worker to carry it.

## Steps

1. `youtubeSource` (`packages/research/src/sops/index.ts`): `yt-dlp -J`, the English json3 track, `captionsMarkdown`, then `screenText` (Gemini on the URL per clip).
2. `videoSource`: `yt-dlp -j --no-simulate -S res:540`, the mp4 inline (14 MB cap, about 4 minutes), `askGemini` for speech, `askShown` for the screen.
3. `driveSources`: walk the folder, export each Doc as text (`apps/cli/src/sop.ts` `autobrowseDrive`).
4. `extractPoints` (optional): one call per source writes `points/<stem>.md`, an exhaustive cited list the owner curates (delete, `!` to force); `readSopDir` hands build the points file in place of the raw source when it exists.
5. `buildSop`: `readSopDir` (priority order), `sopPrompt`, one `ClaudeCodeLlm.complete`, write `SOP.md`.

## If you change this

- **Hits:** `apps/cli/src/sop.ts`, settings `ytDlp`, `sopsDir`, `autobrowseDir`.
- **Does not hit:** studies (`packages/research/src/studies`): those are web research into a database; this reads curated sources into a file.

## Surfaces

| Surface | Role |
|---|---|
| `wren sop` | add, build, ls |
| autobrowse `drive` site | exports Docs for `drive:` sources |
| `~/.claude/skills/sop-<name>` | symlink from `sop link`; `SKILL.md` points at SOP.md and refs/ |

## See

- Source: `packages/research/src/sops/index.ts`, `apps/cli/src/sop.ts`
