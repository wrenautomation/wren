---
type: object
cluster: ui
universe: live
status: verified
verified: 2026-11-05 @ 8f09445ec
entity: apps/portal/web/src/player/store.ts:1
---

# player

The portal's one media player (our finished videos, recorded calls, a research source's video or post). A page draws a slot; the shell's host plays over it, and docks it bottom-right when you leave. Also called the mini player.

## Why this shape

An iframe or video that moves in the DOM reloads and loses its place. So the player never moves between page and dock: the host (`PlayerHost`, rendered in `App.tsx` beside the pages, outside any page) keeps one element mounted, lays it over the slot's box (fixed, followed each frame, clipped to the page's scrollers), and sets it in the dock when the slot unmounts. Only Picture-in-Picture moves it, by hand.

## Shape

- Store: `apps/portal/web/src/player/store.ts`: a tiny module store (no library), read by `usePlayer(selector)` (`use.tsx`, `useSyncExternalStore`). Item `{ id, kind: youtube | embed | media, src, title, media, startAt, ratio, back, onTime }`; mode `none | full | mini | pip`; commands `play`, `release`, `seek`, `dock`, `expand`, `close`, `report`, `attach`. The default store is `player` (`instance.ts`); Expand with no slot opens `item.back` through the router. A slot with no `back` takes the router's address (`here`, `route.ts`), so it is right on a memory history too.
- Slot: `PlayerSlot` (`slot.tsx`): `eager` plays when the page opens and the player is free, `replace` also takes it from another item. No flag: a Play button (the Shorts under a video).
- Host: `host.tsx` (full over the slot, the dock with Expand, Picture-in-Picture, Close; region "Mini player"), `media.tsx` (`YouTube` by postMessage, `Embed`, `FileMedia`), `geometry.ts` (clip), `pip.ts` (Document Picture-in-Picture, Chromium only; the button is hidden where the API is not there).
- Where "where you stopped" lives: `item.onTime`, kept by the store beyond the page.
- Users: Marketing videos (`modules/marketing/videos.tsx`: finished preview, Shorts, vertical cut), a recorded call (`modules/calendar/recorder.tsx`), a research source (`modules/research/page.tsx`: YouTube or a post's embed). Left alone, as tools and not playback: the storyboard and finish previews, shape preview, slides, heat, session replay, sites detail, the TikTok composer preview, the video-shelf posters (still frames).
- Stories: `pages-player.stories.tsx` (`Wren/Player`, ids `pages-player--…`: `Expanded`, `MiniDocked`, `NavigationSurvives`, on a recording's page `/today/recordings/1`); unit: `player/store.test.ts`, `geometry.test.ts`.

Citations: `apps/portal/web/src/App.tsx` (the host), `apps/portal/web/src/player/host.tsx:31`

## Connected to

- **owns:** `apps/portal/web/src/player/`
- **owned-by:** [[platform/portal-shell]] (renders the host)
- **joins:** Marketing videos, the recording page and Research (slots), `route.ts` `navigate` (Expand) and `here` (a slot's way back)
- **looks-like-but-is-not:** an editing preview (a tool: it stays on its page)

## If you change this

- **Hits:** every page with a `PlayerSlot`; a new playable surface needs a slot, never its own `<video>` or iframe. A change to the item id changes what counts as "the same player" (resume).
- **Does not hit:** editing previews; the YouTube transcript sync, which goes through `store.seek`.

## Surfaces

| Surface | Role |
|---|---|
| Marketing videos, a recording's page, a research source | slot |
| Shell (`App.tsx`) | host |

## See

- Bead: wa-0m4
- Source: `apps/portal/web/src/player/`
