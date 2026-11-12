# Canon files: any file with a record (WA-1343)

William 11-12: "it should probably also support images and just everything yk?"

## Goal

A Canon source can hold files: a reel's video and poster, his chat screenshots, carousel slides,
a PDF. A file outlives the post it came from. The References page (canon-references doc) shows reel
video and poster. Other files wait for a page.

## Now

Counts: Canon at 11-12, 592 Instagram sources.

- A record is markdown in git. `Source.media` (`{sha256, type}`, knowledge `records.ts:89`) holds
  one file. No record uses it.
- The media bucket holds 394 reels at `cache/instagram/<id>.mp4` (engine `read` store,
  `s3-store.ts`). 258 of them are Canon sources; the key comes from the record id.
- 573 of the 592 carry an `image:` URL that expires (`oe=`).
- `wren source add <path>` copies a non-text file into `topics/<name>/refs/` in git
  (`canon.ts:150-158`). `topic build` lists `refs/` for the model (`sops/index.ts:700-703`).
  A screenshot with no topic has no way in.
- A carousel (`/p/`) fails: `yt-dlp -j` prints one JSON line per slide, and `ytDlpDownload` parses
  one object (engine `url.ts:155`). Image slides fail first: "No video formats found".
- wren already puts a file by key: starling `putKey`, `storedHead`, `s3MediaHost`
  (`packages/starling/inbound/src/media.ts`).

## Options

| | How | For | Against |
|---|---|---|---|
| A | Bytes in the bucket by content hash; the record lists its files | any file, any count | each entry needs the bytes hashed: 1.17 GB of reels read back |
| B | Bytes in Canon git (plain or LFS) | one store | 1 GB of video in git; the worker cannot sign a git file |
| C | DVC: pointers in git, bytes in S3 | vetted | a Python tool on every write; a page still needs our signer |
| D | Key from the record id only | no record write; reels work today | one file per record; a screenshot has no id to key on |
| **E** | **D for reels (video and poster), A for the rest under `canon/`** | **no reel rewrite; screenshots and slides get keys; private files off the publish prefix** | **two lookups: by id for reels, by `files` for the rest** |

Pick **E**. Priorities, in order: no Glacier read-back of 1.17 GB (A fails); files out of git
(B fails); no new tool (C fails); every file has a key (D fails).

## Shape

- Knowledge: `Source.files` replaces `Source.media`. An entry: `{key, type, role, at?, name?}`.
  - `key`: bucket key. `canon/<sha32><ext>` holds the content hash.
  - `type`: MIME. `role`: `image`, `slide`, `page` (a PDF or saved page), `file`.
  - `at`: Text, as on a finding (slide `3`, time `0:16`). `name`: the original file name.
  - knowledge lint checks the shape only. It knows no bucket.
- New source kind `image`: a picture with no page. Id `image-<sha12>`, so the same bytes give the
  same record. `--title` is required. The body is `--note`, then the eye's read: every word shown,
  then what the picture shows.
- A reel's poster sits beside its video: `cache/instagram/<id>.jpg`. No entry, no record write.
- `wren canon lint`: each `canon/` key exists (one HEAD each, `storedHead`).

## Writes (the Mac CLI, on William's AWS session)

- `wren source add <path>` with no `--topic`: a non-text file becomes an `image` source (or `doc`
  for a PDF). The bytes go to `canon/` through `putKey`. HEIC goes to JPEG first (`sips`). A type
  starling does not know is refused.
- With `--topic`, the `refs/` copy stays: `topic build` reads those files from disk.
- Carousels, in engine `read`: `postItems(url)` runs `yt-dlp -j --ignore-no-formats-error
  --skip-download` and parses each line. A video slide downloads; an image slide fetches its
  `thumbnail` (the full image). `wren source add` makes one `post` source: the caption, the eye's
  read of each slide, and `files` with `role: slide`, `at: <n>`. A single-item post stays a reel.
- Posters: `wren canon posters` reads each Canon reel's mp4 with no `.jpg` and writes one frame
  (`ffmpeg -ss 0.5`, else `-ss 0`). `source add` runs it for a new reel.

## Reads

- One worker statement, `s3:GetObject` only, on `cache/*/*.mp4`, `cache/*/*.jpg` and `canon/*`
  (`deploy/terraform/media.tf`). The publish grant on `media/*` stays as it is.
- The portal signs keys for a day. It needs the prod index (canon-references D1) first.

## Order

1. Engine: `files` and kind `image` in knowledge; `postItems` in read. Release.
2. wren: pin, `source add` paths, `canon posters`, `canon lint`, the IAM statement.
3. Backfill: posters for the 258 Canon reels; carousel `De2-09Cjnyx` with his note.
4. The References page, after canon-references D1.

## Cost

- Posters: 258 × about 30 KB = 8 MB. Reading the 258 mp4s back from Glacier IR: about 0.8 GB at
  $0.03/GB, under 3 cents. Screenshots and slides: small.
- The 334 reels not stored (about 1 GB) stay William's yes (canon-references D2).

## Non-goals

- No upload from the portal, no file editing, no public URLs.
- The `refs/` PDF stays in git; git history is not rewritten.
- A post that Instagram hides signed out (WA-1302) stays on that task.

## Risks

- His screenshots can show other people's names. They sit under `canon/`, Get-only for the
  worker, never on a publish path.
- Two writers on one record: `apply` keeps the last write (knowledge `write.ts:163`). One agent
  writes a source at a time today.
- yt-dlp's Instagram extractor changes: 2 tries, then the source keeps its URL and no slides.

## Log

- 2026-11-12: E picked. Reels keep D2's id keys; other files go under `canon/` by hash.
- 2026-11-12: goldfish review: 39 findings, 27 applied, 7 rejected; open: none.
  Rejected: gallery-dl (yt-dlp reads slides signed out), autobrowse desk route for carousels
  (signed-out yt-dlp needs no account), moving the PDF (topic build reads `refs/`), `files` on
  every record type (no reader), git history rewrite, a glossary, a delete guard.
