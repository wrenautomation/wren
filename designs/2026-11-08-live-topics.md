# Live topics: push "this changed" to open tabs (WA-1212)

William, 11-08: "can we make it a webhook or an SSE instead of a poll? I just don't like polls." Then: "use the DO signed webhook across the board for any of those things."

## Goal

A write that commits anywhere (Lambda, CLI on the Mac) tells every open portal tab within a second. The tab then reads again through its normal call. No timers. Vireo batches are the first user; any page joins with one option.

## Shape

```
writer (worker Lambda | wren CLI)          portal Worker                    tabs
  commit → tellLive(["variants"]) ──POST /api/live/changed──▶ LiveRoom DO ──ws──▶ useCall({live})
           HMAC-SHA256(ts.body)          (verify, then room "app"     (hibernating     → refetch
                                          and room "client:<id>")      sockets)
```

- **Webhook in:** `POST /api/live/changed`, body `{topics: string[], client?: string}`. The headers are `x-wren-ts` (ms) and `x-wren-sig` (hex HMAC-SHA256 of `<ts>.<body>`, with `LIVE_HOOK_SECRET`). The Worker refuses a ts more than 5 min away from now. Topics are short slugs (`[a-z0-9:_-]{1,64}`), 20 at most.
- **Room:** one `LiveRoom` Durable Object per site (`app`, `client:<id>`). It takes WebSocket hibernation sockets, so idle tabs cost nothing. A change goes to `app` (operators see every client) and, with a client, to that client's room as well.
- **Socket out:** `/api/live/topics`. It has the same door as `/api/live/writes`: same origin, the token in `Sec-WebSocket-Protocol` (`wren-topics, <token>`), never on the demo. Each frame is `{type:"changed", topics, client}`.
- **Writer:** `tellLive(topics, {client})` in `@wren/core/live`. It signs and POSTs, with a 2 s cap, and never throws. No `WREN_LIVE_SECRET` set = a no-op (tests, local).
- **Tab:** `useCall(key, fn, {live: "variants"})`. A topic frame reads that key again. The data still comes from the normal call, so a push carries a hint, never data.
- **Vireo:** a new port, `hooks.afterWrite`, runs after each write commits (vireo 0.10.0). Wren's host sets it to `tellLive(["variants"])`.

## Why this shape (options, 11-08)

| Option | Result |
|---|---|
| A. Signed webhook into a DO, WebSocket out | **Picked.** Under 1 s. The portal is a Worker already, and `WriteWatch` already runs this pattern. Idle sockets are free with hibernation. |
| B. Self-hosted SSE hub (Mercure, Centrifugo) on the pg box | Open source, but a new process on a box with 1.8 GB (1.2 GB used), a new domain and its own auth. |
| C. Postgres LISTEN/NOTIFY | Catches every write, but needs a listener that stays connected. Neither Lambda nor a Worker can be one, so it only feeds B. |
| Poll (15 s, 98fef3812) | Removed. 7.5 s average delay, and each open tab made 4 calls a minute, each one through Worker, Restate, Lambda and Postgres. |

WebSocket, not SSE: a DO can sleep with a WebSocket open, but an SSE stream keeps it awake and billed.

## Edges

- A missed push (the webhook fails, the socket drops, the Mac goes offline) costs only delay. Tabs read again on reconnect and on focus, as before.
- Restate replays can send the same push twice. That is harmless: it is a hint.
- The push goes after commit, never inside the transaction, so a tab never reads before the data is there.
- A batch he marks is not swapped under him: the Show bar holds new data (batches.tsx).
- Secret: `WREN_LIVE_SECRET` in deploy/prod.env and SSM `/wren/prod/env-2` (Lambda; CLI via prod-wren's optional keys) = GitHub `LIVE_HOOK_SECRET` (portal Worker, via deploy.sh). To rotate, set both. env-2 is full after it (4095/4096): the next secret needs `env-3`.
- A client's own data: `tellLive(topics, {client})` also reaches `client:<id>`. Frames carry topics only, so a tab learns no client id.

## Across the board (WA-1213)

The writer side moved from each writer's `tellLive` to the table. A trigger fires `pg_notify('wren_live', '<topic>')` at commit (migration 0385). The box hears it on the connections it already holds for `wren_wake` (`apps/worker/src/wake.ts`), paces each topic (one push a second at most), and calls `tellLive` with the database's client.

| Topic | Table | Page |
|---|---|---|
| `decisions` | `decisions` | profile's Lead check |
| `research` | `profile_lookups` | profile's Research |
| `ask` | `runs` (ask, record-ask, draft-ask) | Ask, any record's Ask Claude, a draft's turns |
| `videos` | `video_edits`, `video_marks`, `video_presence`, `runs` (video-*) | video editor |

- Why the table, not the writer: `video_edits` has many writers (Lambda, the CLI on the Mac, the desk). A missed `tellLive` fails quietly. NOTIFY is sent only at commit, so "after commit" holds by itself, and the Mac needs no secret.
- A page names its topics in `RecordExtras.live`; `RecordsApi.onTopic` subscribes. `RecordExtras.poll` is gone.
- The sidebar counts (`pulse.ts`) beat on any push (`ANY_TOPIC`), at most once per 5 s. The minute beat stays: most counts come from tables with no topic (inbound mail, queues).
- Vireo keeps `afterWrite`: its writes are in its own package.
- Domain's DNS check stays a poll: no writer of ours sees Cloudflare's change.
- Box down = no pushes; tabs still read on focus and reconnect.

## Decision log

- 2026-11-08: A, across the board (William). Topics, not data. One room per site. Vireo gets `afterWrite`.
- 2026-11-10: WA-1213: table triggers + the box's LISTEN feed `tellLive`, in place of a call in each writer. The box has been a long-lived process since 11-09, so option C's blocker ("no listener") is gone for the writer side; transport stays A.
