---
type: process
status: verified
verified: 2026-10-01
consumes: []
produces: []
---

# sop-build

A video, a Drive folder or a file becomes a source file; one model call turns the folder into the next SOP.md.

## Input → Movement → Output

`wren sop add <name> <youtube url | drive:<folderId> | file>` writes `sources/<kind>-<id>.md` (front matter with `priority`) under `<sopsDir>/<name>/`, a private folder outside this repo (`../sops` by default). `wren sop build <name>` reads `notes.md`, the current `SOP.md` and every source, highest priority first, and asks Claude Code (Opus) for the next SOP.md. Nothing touches a database.

## Why this shape

SOPs change weekly, so the loop is edit `notes.md` or `SOP.md`, build again: the prompt keeps the current text where it still holds, so a rebuild is a diff, not a rewrite. Videos are read as captions with a `[m:ss]` marker a minute and a heading per chapter so a rule can cite a moment. Drive goes through autobrowse's `drive` site on this machine (the token is in that checkout's `.env`), not through Restate: there is no desk worker to carry it.

## Steps

1. `youtubeSource` (`packages/research/src/sops/index.ts`): `yt-dlp -J`, the English json3 track, `captionsMarkdown`.
2. `driveSources`: walk the folder, export each Doc as text (`apps/cli/src/sop.ts` `autobrowseDrive`).
3. `buildSop`: `readSopDir` (priority order), `sopPrompt`, one `ClaudeCodeLlm.complete`, write `SOP.md`.

## If you change this

- **Hits:** `apps/cli/src/sop.ts`, settings `ytDlp`, `sopsDir`, `autobrowseDir`.
- **Does not hit:** studies (`packages/research/src/studies`): those are web research into a database; this reads curated sources into a file.

## Surfaces

| Surface | Role |
|---|---|
| `wren sop` | add, build, ls |
| autobrowse `drive` site | exports Docs for `drive:` sources |

## See

- Source: `packages/research/src/sops/index.ts`, `apps/cli/src/sop.ts`
