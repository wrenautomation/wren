# Post shapes: every field a platform takes, typed and on screen (2026-10-07)

William, 2026-10-07: "posts usually have upload thumbnails for youtube, titles always, subtitles,
different config shapes. all of those need to be reflected in our UI so we can edit everything
and see everything."

## Answer first

- **One shape per platform**, a zod schema in `packages/core/src/content/shapes.ts`. It sits next
  to `Post` in the content port so adapters type their reads from it; `packages/content` uses it
  on every write. It replaces the free `extra` record: the column stays, its contents are the
  platform's shape.
- **Checked twice.** On save (the field editor, `wren content extra`, video approve) a bad value
  is refused. On publish `postOf` parses the shape; a draft that fails never reaches the adapter.
- **Each field carries its UI**: label, input (line, long, pick, switch, list, image, captions,
  number), limit, options, required, and status. The portal renders the form from that list. No
  per-platform form code.
- **Status per field**: `sent` (the adapter sends it), or `dev` (shown, not editable, tagged "In
  development"). Never a field that saves and then goes nowhere.
- **Same editor in three places**: the draft page, To approve, and the published post (read only:
  what went out).
- **Previews per platform**: YouTube watch card (thumbnail, title), Reddit card (subreddit,
  flair), LinkedIn feed card, IG Reel card (cover), TikTok, X and Facebook keep the feed preview.
- **Files**: thumbnail, Reel cover and caption files go to the media bucket through a ContentDesk
  `upload` handler (bytes in the call, 3 MB cap). No new bucket CORS, so it works on today's
  infra. The draft keeps `s3://bucket/media/<hash>.<ext>`; previews sign a GET.
- **Training record**: a field save is an `edited` row in `draft_events` with
  `meta.fields: {key: [before, after]}`; a title change also sets `title`. `wren train export`
  carries `fields` on each version.
- **Migration**: none. Prod drafts carry no `extra` keys today (checked 2026-10-07), and every key
  keeps its current name, so old rows parse.

## Fields

Status: **sent** before this build, **build** added now, **dev** shown as "In development",
**no API** the platform has no way.

### YouTube video and Short (`videos.insert`, `thumbnails.set`, `captions.insert`, `playlistItems.insert`)

| Key | Field | Limit | Status |
|---|---|---|---|
| `kind` | Video or Short | | build (approve sets it) |
| title column | Title, required | 100 chars | sent |
| text | Description | 5000 bytes | sent |
| `privacyStatus` | Visibility: private, unlisted, public | required | sent |
| scheduledFor | Publish at (`status.publishAt`, private only) | | sent |
| `madeForKids` | Made for kids (`selfDeclaredMadeForKids`), required by YouTube | | build |
| `thumbnail` | Thumbnail, video only | JPG/PNG, 2 MB, 1280x720 | sent (now fails loud) |
| `tags` | Tags | 500 chars total | sent |
| `categoryId` | Category | YouTube's list | sent |
| `playlistId` | Playlist | an id | build |
| `captions` | Subtitles file | .srt or .vtt | build |
| `captionsLanguage` | Subtitles language | | build |
| `defaultLanguage` | Title language | | build |
| `defaultAudioLanguage` | Audio language | | build |
| `notifySubscribers` | Notify subscribers (query param, default on) | | build |
| `syntheticMedia` | Made with AI (`containsSyntheticMedia`) | | build |
| | Short custom thumbnail | | no API (picked in the app) |
| | `embeddable`, `license`, `publicStatsViewable`, `recordingDate`, localizations | | not shown; defaults |

Unverified API projects post private only until Google's audit.

### Reddit (`/api/submit`, browser leg on old.reddit since 2026-09-29)

| Key | Field | Limit | Status |
|---|---|---|---|
| `subreddit` | Subreddit, required | | sent |
| title column | Title, required | 300 chars | sent |
| text | Body (self post) | 40000 chars | sent |
| `url` | Link (makes it a link post) | | sent |
| `sendReplies` | Replies to inbox (default on) | | build |
| `flairId`, `flairText` | Flair (some subs require it) | text 64 | dev: the browser leg can't pick flair |
| `nsfw`, `spoiler` | NSFW, Spoiler | | dev: not on old.reddit's form |
| | Image post | | dev: media upload not public |

### LinkedIn (`/rest/posts`)

| Key | Field | Limit | Status |
|---|---|---|---|
| text | Text, required | 3000 chars | sent |
| `visibility` | PUBLIC or CONNECTIONS | | sent |
| `noReshare` | Turn off reshares (`isReshareDisabledByAuthor`) | | build |
| | Images, video, PDF document with title | doc title required | dev: needs the upload flow |

### Instagram Reel (`/{ig}/media`, `media_publish`)

| Key | Field | Limit | Status |
|---|---|---|---|
| text | Caption | 2200 chars, 30 hashtags, 20 @ | sent |
| media | Video, required | 3 s to 15 min, 300 MB | sent |
| `shareToFeed` | Also in Feed (default on) | | sent |
| `cover` | Cover image (`cover_url`) | JPEG, 8 MB (3 MB here) | build |
| `thumbOffset` | Cover frame in ms (ignored with a cover) | | build |
| `collaborators` | Collaborators | 3 usernames | build |
| `audioName` | Audio name | | build |
| | Location, user tags, trial reels | | not shown |

The web composer path (no Graph) sends caption and file only; the others fail loud there.

### TikTok (`/v2/post/publish/video/init/`)

| Key | Field | Limit | Status |
|---|---|---|---|
| text | Caption | 2200 UTF-16 | sent |
| `privacy` | Who can see it, required | creator_info's options | sent |
| `noComment`, `noDuet`, `noStitch` | Turn off comments, duets, stitches | | build |
| `coverMs` | Cover frame in ms | | build |
| `aiGenerated` | AI-generated label (`is_aigc`) | | build |
| `brandContent`, `brandOrganic` | Paid partnership, Own business | | build |
| | Live privacy options from `creator_info/query` | | dev |

An unaudited TikTok app posts SELF_ONLY whatever is picked.

### X (`POST /2/tweets`)

| Key | Field | Limit | Status |
|---|---|---|---|
| text | Text | 280 | sent |
| media | One image or video | | sent |
| `replyTo`, `quote` | Reply to, Quote (post ids) | | sent |
| `replySettings` | Who can reply | following, mentionedUsers, subscribers, verified | build |
| | Up to 4 media, threads, polls | | dev |

### Facebook Page (`/{page}/feed`, `/photos`, `/videos`)

| Key | Field | Limit | Status |
|---|---|---|---|
| text | Message | 5000 here | sent |
| `link` | Link | | sent |
| media | Photo or video | | sent |

## Build

1. `core/content/shapes.ts`: `SHAPES[platform] = {schema, fields}`, `fieldsOf(platform, extra)`
   (parse, throws on a bad value), `fieldViews(platform, extra, kind)` for the UI. Tests.
2. `content`: `setFields(db, id, patch, who)` validates, writes `extra` and the title column,
   records `edited` with `meta.fields`. `setExtra` and the CLI go through it. Approve refuses a
   missing required field (replaces `needsExtra`). `postOf` parses. Video approve sets `kind`,
   `madeForKids: false`.
3. ContentDesk `fields` and `upload`; `DRAFT_CALLS` takes both.
4. Records: draft, approval and post loads return `shape: {platform, kind, fields, preview}` with
   signed image URLs (`contentRecords(signer)`).
5. Portal: `PostFields` editor (required mark, counter, picks, switches, tags, file pickers, "In
   development" tag) and `ShapePreview` cards, in drafts, To approve and posts.
6. Adapters (wren): YouTube, TikTok, Instagram, LinkedIn, X, Reddit as the tables say.
   autobrowse: YouTube `notifySubscribers`, `defaultAudioLanguage`, `containsSyntheticMedia`,
   `POST /upload/youtube/v3/captions`, `POST /youtube/v3/playlistItems`; TikTok `is_aigc` and
   brand toggles; Meta `thumb_offset`, `collaborators`, `audio_name`; X `reply_settings`. Mocked
   HTTP tests only.
7. `train.ts`: versions carry `fields`; a field-only edit is its own version.
