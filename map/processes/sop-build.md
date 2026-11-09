---
type: process
status: verified
verified: 2026-11-09
consumes: []
produces: []
---

# sop-build

A video, a Drive folder or a file becomes a source record in the knowledge repo; one model call turns the SOP's sources, notes and calls into the next guide record.

## Input → Movement → Output

`wren sop add <name> <youtube url | other video url | drive:<folderId> | file>` writes `sources/<kind>-<id>.md` (a source record, `priority` 1-9, tagged with the SOP's name; one commit with a by and a why) in the knowledge repo (`knowledgeDir`, `../knowledge` by default; private, outside this repo; `@wrenautomation/knowledge`). A source two SOPs share is one record with both tags. `notes.md`, `calls.md`, `standard.md`, `refs/` and `SKILL.md` sit in `topics/<name>/`. `wren sop sync <name>` reads the scope in `notes.md`'s front matter (`kinds`, `platforms`, `topic`, `set`) and writes `standard.md` (the numbers off `learn.standards` for those pieces) and `calls.md` (his keep / tune / drop calls on them, rolled up: [[learn/breakdown]]). `wren sop build <name>` syncs first (`--no-sync` skips), then reads `notes.md` (front matter stripped), `calls.md`, `standard.md`, the current guide (`guides/<name>.md`, cites expanded to `[stem m:ss]`) and every source tagged with the SOP, highest priority first, and asks Claude Code (Opus) for the next guide; its cites are renumbered (`numberCites`: `[n]` = the nth id in the guide's `cites`). `sync` and `push` touch the database: `wren sop push <name> --platform <p>` stores the rendered guide (`knowledge render`) as that platform's [[content/playbook]], which every draft prompt then carries, with the standard's lines for `post` on that platform (`postStandardFor`; the notes' scope is stored on the playbook, and a scope without `post` never steers a post). Write's "Check against the SOP" (`ContentDesk/check`, Wren only) breaks the draft down, puts it beside the standard and his calls, and saves up to 3 changes on `content_drafts.check`; a Studio edit shows its cut list beside the `film` standard (3 minutes or less, else `video`) on the video page.

## Why this shape

SOPs change weekly, so the loop is edit `notes.md` or the guide, call on pieces, build again (designs/2026-10-25-competitor-analyzer.md: he decides on examples, the machine rolls his calls into rules): the prompt keeps the current text where it still holds, so a rebuild is a diff, not a rewrite. Videos are read as captions with a `[m:ss]` marker a minute and a heading per chapter so a rule can cite a moment, plus an `## On screen` section: Gemini (the llm.env key fleet, rotated on 429) reads the YouTube URL in 10-minute clips and transcribes every document, slide or table the speaker shows, since the speech alone misses them (`--no-screen` skips it). Other videos (Instagram reels, TikTok, X) have no captions: `yt-dlp` downloads them at 540p and `watch` reads them with ffmpeg and Cohere (10-21: the Gemini keys died). The words come only from the transcript; the vision model gives on-screen text only. Gemini's read of the screen is added when a key works. Drive goes through autobrowse's `drive` site on this machine (the token is in that checkout's `.env`), not through Restate: there is no desk worker to carry it.

## Steps

1. `readYoutube` (read `src/video/url.ts`, `@wrenautomation/read/video`; `captionsBody` and the Gemini asks are in `src/video/read.ts` and `gemini.ts`): `yt-dlp -J`, the English json3 track, `captionsBody`, then the screen (Gemini on the URL per clip). Wren's `youtubeSource` (`packages/research/src/sops/index.ts`) files the `VideoRead` with the SOP's priority (`toSource`); so do `videoSource` and `audioSource`.
2. `readVideo` (`videoSource`): the `watch` core (read's `watch` downloads, `watchFile` reads the file: `@wrenautomation/read/video`, read `src/video/watch.ts`; `wren video watch` and `video look --with cohere` call the same one): `yt-dlp -j --no-simulate -S res:540` (`download`), ffmpeg scene cuts and a 360p frame every 2 s, Cohere Transcribe for the speech, `command-a-vision` for the on-screen text in batches of 8 frames. Each line carries its frame time; a frame with no line, or one the model refused after one text-only retry, is `(not read)`, never filled. Gemini (`askShown`, `gemini.ts`) adds an `## On screen (Gemini)` section only when a key still works, else it is skipped with no error. Source body: `## Caption`, `## Speech`, `## On screen`, `## Cuts`.
3. `driveSources`: walk the folder, export each Doc as text (`apps/cli/src/sop.ts` `autobrowseDrive`).
4. `extractPoints` (optional): one call per source writes its points as finding records (`form` point or passage, `order`, `section`, `must` tag for `- !`), tagged with the SOP; a rerun retires the old ones, or drops the tag when another SOP shares them (generated only: his calls, not line edits, decide what is in); `readSopDir` hands build the points in place of the raw source when there are some.
5. `writeSopFiles` (`packages/learn/src/standard.ts`, from the CLI's `sync`): `scopeOf` the notes, `standardOf` (median and middle half per number, counts per closed set, films' cut numbers from trusted counts only), `callsOf` (newest call per subject on pieces in scope or asked in through `sop_sources`; once the SOP's content line has taken a document, `standardOf` and `callsOf` read the line's documents instead; a pattern kept on `RULE_KEEPS` pieces with no drop is marked a rule), `standard.md` + `calls.md`. Research never imports learn: build reads the two files.
6. `buildSop`: `readSopDir` (priority order), `sopPrompt` (notes > calls > standard > points > sources), one `ClaudeCodeLlm.complete`, write `guides/<name>.md` (one commit), then `SKILL.md` (runs `knowledge render <name>`) and `counts.tsv`.
7. `learnBack` (`packages/starling/inbound/src/learn-back.ts`, `wren sop learn-back <name>`): our posted drafts in the scope's kinds and platforms with a number (`ourPieces` joins `content_drafts` to `marketing_post_records`; a long video of 3 minutes or less is a `film`), `saveOurs` as learn items with `draft_id`, read and broken down like a competitor's, then `checksOf` per kind against `rulesOf(callsOf)` and `writeChecks`.

## If you change this

- **Hits:** `apps/cli/src/sop.ts`, `apps/cli/src/learn-readers.ts` (the reader and judge `wren learn` shares with `sop learn-back`), settings `ytDlp`, `ffmpeg`, `knowledgeDir`, `autobrowseDir`; the knowledge repo's lint (a guide `[n]` past its cites fails the write) and its post-commit hook (a changed guide goes to the content playbook); the COHERE keys (speech and screen of a non-YouTube video: with none, `sop add` of a reel fails); a new fact key in a breakdown needs a column in `learn.standards` and a line in `NUMBERS` or `SHARES` (`standard.ts`) before a standard counts it; `scopeOf` reads only `key: a, b` lines.
- **Does not hit:** studies (`packages/research/src/studies`): those are web research into a database; this reads curated sources into a file.

## Surfaces

| Surface | Role |
|---|---|
| `wren sop` | hunt, add, sync, build, extract, ls, push |
| autobrowse `drive` site | exports Docs for `drive:` sources |
| `~/.claude/skills/sop-<name>` | symlink from `sop link`; `SKILL.md` renders the guide and points at refs/ |

## See

- Source: `packages/research/src/sops/index.ts`, `packages/learn/src/standard.ts`, `packages/learn/src/hunt.ts`; the readers are read's `src/video/` (`url.ts`, `list.ts`, `watch.ts`, `read.ts`, `gemini.ts`, `tools.ts`; `@wrenautomation/read/video`), pinned exact; `scripts/layers-guard.mjs` keeps yt-dlp out of wren's packages); `apps/cli/src/sop.ts`, `apps/cli/src/video-watch.ts`
