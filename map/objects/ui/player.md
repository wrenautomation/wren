---
type: object
cluster: ui
universe: live
status: verified
verified: 2026-10-19 @ 5cab22cf (+ wa-0m4 player)
entity: apps/portal/web/src/player/store.ts:1
---

# player

The portal's one media player (Learn reels and videos, our finished videos, Library media). A page draws a slot; the shell's host plays over it, and docks it bottom-right when you leave. Also called the mini player.

## Why this shape

An iframe or video that moves in the DOM reloads and loses its place. So the player never moves between page and dock: the host (`PlayerHost`, rendered in `App.tsx` beside the pages, outside any page) keeps one element mounted, lays it over the slot's box (fixed, followed each frame, clipped to the page's scrollers), and sets it in the dock when the slot unmounts. Only Picture-in-Picture moves it, by hand.

## Shape

- Store: `apps/portal/web/src/player/store.ts`: a tiny module store (no library), read by `usePlayer(selector)` (`use.tsx`, `useSyncExternalStore`). Item `{ id, kind: youtube | embed | media, src, title, media, startAt, ratio, back, onTime }`; mode `none | full | mini | pip`; commands `play`, `release`, `seek`, `dock`, `expand`, `close`, `report`, `attach`. The default store is `player` (`instance.ts`); Expand with no slot opens `item.back` through the router.
- Slot: `PlayerSlot` (`slot.tsx`): `eager` plays when the page opens and the player is free, `replace` also takes it from another item. No flag: a Play button (the Shorts under a video).
- Host: `host.tsx` (full over the slot, the dock with Expand, Picture-in-Picture, Close; region "Mini player"), `media.tsx` (`YouTube` by postMessage, `Embed`, `FileMedia`), `geometry.ts` (clip), `pip.ts` (Document Picture-in-Picture, Chromium only; the button is hidden where the API is not there).
- Where "where you stopped" lives: `item.onTime`, kept by the store beyond the page. Learn's keeps it with `learn.progress`; Learn's moments and transcript read `usePlayer` time and call `store.seek`.
- Users: Learn item (`modules/learn/item.tsx`: YouTube, episode, IG/TikTok/X embeds), Marketing videos (`modules/marketing/videos.tsx`: finished preview, Shorts, vertical cut), Library media (`modules/library/media.tsx`), a recorded call (`modules/calendar/recorder.tsx`). Left alone, as tools and not playback: the storyboard and finish previews, shape preview, slides, heat, session replay, sites detail, the TikTok composer preview, the Library srcDoc preview, the video-shelf posters (still frames).
- Stories: `pages-player.stories.tsx` (`Pages/Player`: `Expanded`, `MiniDocked`, `NavigationSurvives`); unit: `player/store.test.ts`, `geometry.test.ts`.

Citations: `apps/portal/web/src/App.tsx` (the host), `apps/portal/web/src/player/host.tsx:36`

## Connected to

- **owns:** `apps/portal/web/src/player/`
- **owned-by:** [[platform/portal-shell]] (renders the host)
- **joins:** the Learn, Marketing and Library apps (slots), `route.ts` `navigate` (Expand)
- **looks-like-but-is-not:** an editing preview (a tool: it stays on its page)

## If you change this

- **Hits:** every page with a `PlayerSlot`; a new playable surface needs a slot, never its own `<video>` or iframe. A change to the item id changes what counts as "the same player" (resume).
- **Does not hit:** editing previews; the YouTube transcript sync, which goes through `store.seek`.

## Surfaces

| Surface | Role |
|---|---|
| Learn item, Marketing videos, Library media | slot |
| Shell (`App.tsx`) | host |

## See

- Bead: wa-0m4
- Source: `apps/portal/web/src/player/`
