# @wren/learn: routes

Services: 2.

## LearnConsole (service via `portalService`)

File: packages/learn/src/console.ts

- **alertPick** `PickRequest` → `{ source: string; pick: "every" | "off" | "top"; }` (serviceHandler)
- **alerts** `PortalRequest` → `{ saved: "every" | "off" | "top"; perHour: number; mail: { on: boolean; may: boolean; to: string; }; }` (serviceHandler)
- **bell** `PortalRequest` → `{ unseen: number; alerts: import("./alerts.js").BellLine[]; }` (serviceHandler)
- **bellSeen** `PortalRequest` → `{ n: number; }` (serviceHandler)
- **browse** `BrowseRequest` → `{ place: string; sort: "length" | "title" | "score" | "source" | "newest"; items: (import("./drive.js").Card & { pick: import("./decide.js").LearnPick | null; })[]; more: boolean; total: number; types: Partial<Record<import("./schema.js").ItemType, number>>; sources: { n: number; id: number; name: string; kind: "reddit" | "instagram" | "x" | "youtube" | "tiktok" | "newsletter" | "podcast" | "blog" | "forum" | "releases"; avatar: string | null; }[]; }` (serviceHandler)
- **call** `CallRequest` → `{ subject: string; row: import("./calls.js").FactRow | null; }` (serviceHandler)
- **collectionAdd** `CollectionRequest` → `{ id: string; name: string; }` (serviceHandler)
- **collectionDrop** `CollectionRequest` → `{ done: string[]; }` (serviceHandler)
- **collectionEdit** `CollectionRequest` → `{ id: string; name: string; }` (serviceHandler)
- **digestMail** `DigestMailRequest` → `{ on: boolean; }` (serviceHandler)
- **find** `SearchRequest` → `{ items: import("./items.js").Found[]; }` (serviceHandler)
- **follow** `FollowRequest` → `{ id: string; name: string; kind: "reddit" | "instagram" | "x" | "youtube" | "tiktok" | "newsletter" | "podcast" | "blog" | "forum" | "releases"; items: number; }` (serviceHandler)
- **home** `PortalRequest` → `{ shelves: { type: "link" | "reddit" | "instagram" | "x" | "youtube" | "tiktok" | "newsletter" | "podcast" | "blog" | "releases" | "shorts"; total: number; items: (import("./drive.js").Card & { pick: import("./decide.js").LearnPick | null; })[]; }[]; continue: (import("./drive.js").Card & { pick: import("./decide.js").LearnPick | null; })[]; top: (import("./drive.js").Card & { pick: import("./decide.js").LearnPick | null; })[]; sops: { at: string; id: number; sop: string; state: "failed" | "asked" | "added"; error: string | null; itemId: number | null; title: string; type: "link" | "reddit" | "instagram" | "x" | "youtube" | "tiktok" | "newsletter" | "podcast" | "blog" | "releases" | "shorts"; }[]; }` (serviceHandler)
- **item** `ItemRequest` → `{ pick: "keep" | "drop" | null; text: string; transcript: string | null; file: string | null; mediaUrl: string | null; moments: import("./schema.js").Moment[]; why: string | null; changes: string[]; verdict: "drop" | "show" | "hold" | null; failure: string | null; kind: "post" | "article" | "video" | "reel" | "film" | "episode"; breakdown: { kind: "post" | "article" | "video" | "reel" | "film" | "episode"; by: "model" | "hand"; facts: import("./calls.js").FactRow[]; shots: { t: number; len: number; src: "hand" | "scene"; type: "ui" | "b-roll" | "graphic" | "logo" | "text-card" | "talking-head" | null; move: "push" | "static" | "pull" | "pan" | "track" | "orbit" | "roll" | "rack-focus" | "macro" | "ui-zoom" | null; in: "cut" | "dissolve" | "fade" | "whip" | null; text: string | null; sound: "music" | "vo" | "both" | "silent" | null; note?: string | undefined; }[]; calls: { at: string; path: string; call: import("./calls.js").FactCall; comment: string | null; by: string | null; }[]; } | null; collection: { id: number; name: string; } | null; sops: { id: number; itemId: number | null; noteId: string | null; client: string | null; title: string | null; text: string | null; sop: string; state: "failed" | "asked" | "added"; file: string | null; points: Date | null; error: string | null; by: string | null; askedAt: Date; doneAt: Date | null; }[]; id: number; title: string; type: import("./schema.js").ItemType; url: string; thumbnail: string | null; duration: number | null; chars: number; source: { id: number; name: string; kind: import("./schema.js").SourceKind; avatar: string | null; } | null; creator: string | null; score: number | null; summary: string | null; status: "unread" | "read" | "archived"; state: "reading" | "failed" | "mac" | "scoring" | "ready"; starred: boolean; pinned: boolean; later: boolean; position: number | null; collectionId: number | null; tags: string[]; saved: boolean; at: string; }` (serviceHandler)
- **mark** `MarkRequest` → `{ done: string[]; }` (serviceHandler)
- **media** `IdsRequest` → `{ urls: string[]; }` (serviceHandler)
- **move** `MoveRequest` → `{ done: string[]; }` (serviceHandler)
- **open** `ItemRequest` → `{ ok: boolean; }` (serviceHandler)
- **progress** `ProgressRequest` → `{ ok: boolean; }` (serviceHandler)
- **rail** `PortalRequest` → `{ places: { inbox: number; all: number; later: number; starred: number; saved: number; archived: number; }; collections: { n: number; id: number; name: string; parentId: number | null; }[]; sources: { kind: "reddit" | "instagram" | "x" | "youtube" | "tiktok" | "newsletter" | "podcast" | "blog" | "forum" | "releases"; sources: { fresh: number; id: number; name: string; kind: "reddit" | "instagram" | "x" | "youtube" | "tiktok" | "newsletter" | "podcast" | "blog" | "forum" | "releases"; avatar: string | null; stopped: boolean; failure: string | null; }[]; }[]; tags: { n: number; tag: string; }[]; }` (serviceHandler)
- **readAgain** `IdsRequest` → `{ done: string[]; }` (serviceHandler)
- **save** `SaveRequest` → `{ id: string; url: string; kind: "post" | "article" | "video" | "reel" | "film" | "episode"; fresh: boolean; unread: boolean; }` (serviceHandler)
- **search** `SearchRequest` → `{ hits: import("./items.js").Hit[]; }` (serviceHandler)
- **seen** `PortalRequest` → `{ ok: boolean; }` (serviceHandler)
- **sources** `PortalRequest` → `{ may: boolean; kinds: { sources: { alert: "every" | "off" | "top" | null; items: number; fresh: number; last: string | null; id: number; name: string; url: string; page: string | null; kind: "reddit" | "instagram" | "x" | "youtube" | "tiktok" | "newsletter" | "podcast" | "blog" | "forum" | "releases"; avatar: string | null; tell: "every" | "digest" | "top"; failure: string | null; stopped: boolean; fetchedAt: Date | null; top: number | null; }[]; kind: "reddit" | "instagram" | "x" | "youtube" | "tiktok" | "newsletter" | "podcast" | "blog" | "forum" | "releases"; }[]; }` (serviceHandler)
- **tag** `TagRequest` → `{ done: string[]; }` (serviceHandler)
- **tell** `TellRequest` → `{ done: string[]; }` (serviceHandler)
- **toSop** `SopRequest` → `{ done: string[]; }` (serviceHandler)
- **today** `PortalRequest` → `{ since: string; total: number; held: number; items: import("./alerts.js").TodayLine[]; }` (serviceHandler)
- **unfollow** `IdsRequest` → `{ done: string[]; }` (serviceHandler)
- **unseen** `PortalRequest` → `{ n: number; }` (serviceHandler)

## LearnPictures (service)

File: packages/learn/src/pictures.ts

- **sign** `{ ref: string }` → `{ url: string | null }` (serviceHandler)
