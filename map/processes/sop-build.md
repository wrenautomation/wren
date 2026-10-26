---
type: process
status: verified
verified: 2026-10-25
consumes: []
produces: []
---

# sop-build

A hunt seeds Learn with candidates for an SOP; a video, a Drive folder or a file becomes a source file; one model call turns the folder into the next SOP.md.

## Input → Movement → Output

`wren sop hunt <name>` reads the same front matter and seeds Learn: the `set`'s followed creators (a YouTube channel's items archived as `IN_FEED_BEFORE` come back as candidates; an Instagram or TikTok profile is walked like `learn catalog`), then the `topic` searched on YouTube by yt-dlp, most viewed first, until `--cap` (10) candidates in a day, each saved with the SOP's kind, its creator and views, and tagged with the SOP's name; then read, scored and broken down on this Mac (`packages/learn/src/hunt.ts`, `apps/cli/src/learn-readers.ts`). `wren sop add <name> <youtube url | other video url | drive:<folderId> | file>` writes `sources/<kind>-<id>.md` (front matter with `priority`) under `<sopsDir>/<name>/`, a private folder outside this repo (`../sops` by default). `wren sop sync <name>` reads the scope in `notes.md`'s front matter (`kinds`, `platforms`, `topic`, `set`) and writes `standard.md` (the numbers off `learn.standards` for those pieces) and `calls.md` (his keep / tune / drop calls on them, rolled up: [[learn/breakdown]]). `wren sop build <name>` syncs first (`--no-sync` skips), then reads `notes.md` (front matter stripped), `calls.md`, `standard.md`, the current `SOP.md` and every source, highest priority first, and asks Claude Code (Opus) for the next SOP.md. `sync` and `push` touch the database: `wren sop push <name> --platform <p>` stores SOP.md as that platform's [[content/playbook]], which every draft prompt then carries, with the standard's lines for `post` on that platform (`postStandardFor`; the notes' scope is stored on the playbook, and a scope without `post` never steers a post). Write's "Check against the SOP" (`ContentDesk/check`, Wren only) breaks the draft down, puts it beside the standard and his calls, and saves up to 3 changes on `content_drafts.check`; a Studio edit shows its cut list beside the `film` standard (3 minutes or less, else `video`) on the video page.

## Why this shape

SOPs change weekly, so the loop is edit `notes.md` or `SOP.md`, call on pieces, build again (designs/2026-10-25-competitor-analyzer.md: he decides on examples, the machine rolls his calls into rules): the prompt keeps the current text where it still holds, so a rebuild is a diff, not a rewrite. Videos are read as captions with a `[m:ss]` marker a minute and a heading per chapter so a rule can cite a moment, plus an `## On screen` section: Gemini (the llm.env key fleet, rotated on 429) reads the YouTube URL in 10-minute clips and transcribes every document, slide or table the speaker shows, since the speech alone misses them (`--no-screen` skips it). Other videos (Instagram reels, TikTok, X) have no captions: `yt-dlp` downloads them at 540p and `watch` reads them with ffmpeg and Cohere (10-21: the Gemini keys died). The words come only from the transcript; the vision model gives on-screen text only. Gemini's read of the screen is added when a key works. Drive goes through autobrowse's `drive` site on this machine (the token is in that checkout's `.env`), not through Restate: there is no desk worker to carry it.

## Steps

0. `huntSop` (`packages/learn/src/hunt.ts`): `tagOf(name)` is the tag; `before` counts items with it saved in the last day; set creators by `lower(sources.name)` (unfollowed names are listed, never followed for him); a feed's `IN_FEED_BEFORE` items not read are revived (`archivedAt`, `why` cleared, `needsMac` set, kind set when the scope names one); `readCatalog` for a creator kind; `phrasesOf(topic)` → one `TopicSearch` each (`youtubeSearch`: `flatPlaylist(ytDlp, "ytsearchN:q")`), `rankFinds` merges by url, views desc; known urls skipped (his archive stays), the rest `saveLink` with `worth: false` (no `document` call: the hunt's picks are not his), `creator`, `stats`; `tagItems`. The CLI then `readQueued` + `breakdownItem` on `huntedIds`.
1. `youtubeSource` (`packages/research/src/sops/index.ts`): `yt-dlp -J`, the English json3 track, `captionsMarkdown`, then `screenText` (Gemini on the URL per clip).
2. `videoSource`: the `watch` core (`@wrenautomation/scribe/video`, scribe `src/video/watch.ts`; `wren video watch` and `video look --with cohere` call the same one): `yt-dlp -j --no-simulate -S res:540` (`download`), ffmpeg scene cuts and a 360p frame every 2 s, Cohere Transcribe for the speech, `command-a-vision` for the on-screen text in batches of 8 frames. Each line carries its frame time; a frame with no line, or one the model refused after one text-only retry, is `(not read)`, never filled. Gemini (`askShown`, `gemini.ts`) adds an `## On screen (Gemini)` section only when a key still works, else it is skipped with no error. Source body: `## Caption`, `## Speech`, `## On screen`, `## Cuts`.
3. `driveSources`: walk the folder, export each Doc as text (`apps/cli/src/sop.ts` `autobrowseDrive`).
4. `extractPoints` (optional): one call per source writes `points/<stem>.md`, an exhaustive cited list (generated only: his calls, not line edits, decide what is in); `readSopDir` hands build the points file in place of the raw source when it exists.
5. `writeSopFiles` (`packages/learn/src/standard.ts`, from the CLI's `sync`): `scopeOf` the notes, `standardOf` (median and middle half per number, counts per closed set, films' cut numbers from trusted counts only), `callsOf` (newest call per subject on pieces in scope or asked in through `sop_sources`; once the SOP's content line has taken a document, `standardOf` and `callsOf` read the line's documents instead; a pattern kept on `RULE_KEEPS` pieces with no drop is marked a rule), `standard.md` + `calls.md`. Research never imports learn: build reads the two files.
6. `buildSop`: `readSopDir` (priority order), `sopPrompt` (notes > calls > standard > points > sources), one `ClaudeCodeLlm.complete`, write `SOP.md`.
7. `learnBack` (`packages/content/src/learn-back.ts`, `wren sop learn-back <name>`): our posted drafts in the scope's kinds and platforms with a number (`ourPieces` joins `content_drafts` to `marketing_post_records`; a long video of 3 minutes or less is a `film`), `saveOurs` as learn items with `draft_id`, read and broken down like a competitor's, then `checksOf` per kind against `rulesOf(callsOf)` and `writeChecks`.

## If you change this

- **Hits:** `apps/cli/src/sop.ts`, `apps/cli/src/learn-readers.ts` (the reader, judge and creator pager `wren learn` shares with `sop hunt`), settings `ytDlp`, `ffmpeg`, `sopsDir`, `autobrowseDir`; the COHERE keys (speech and screen of a non-YouTube video: with none, `sop add` of a reel fails); a new fact key in a breakdown needs a column in `learn.standards` and a line in `NUMBERS` or `SHARES` (`standard.ts`) before a standard counts it; `scopeOf` reads only `key: a, b` lines.
- **Does not hit:** studies (`packages/research/src/studies`): those are web research into a database; this reads curated sources into a file.

## Surfaces

| Surface | Role |
|---|---|
| `wren sop` | hunt, add, sync, build, extract, ls, push |
| autobrowse `drive` site | exports Docs for `drive:` sources |
| `~/.claude/skills/sop-<name>` | symlink from `sop link`; `SKILL.md` points at SOP.md and refs/ |

## See

- Source: `packages/research/src/sops/index.ts`, `packages/learn/src/standard.ts`, `packages/learn/src/hunt.ts`; the video reader is scribe's `src/video/` (`watch.ts`, `gemini.ts`, `tools.ts`; `@wrenautomation/scribe/video`, pinned exact); `apps/cli/src/sop.ts`, `apps/cli/src/video-watch.ts`
