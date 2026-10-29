# @wren/voice: routes

Services: 1.

## VoiceConsole (service via `portalService`)

File: packages/voice/src/console.ts

- **dictated** `DictatedRequest` → `{ id: string; }` (serviceHandler)
- **dictation** `PortalRequest` → `{ rows: import("./dictation-store.js").DictationStat[]; }` (serviceHandler)
- **saveTest** `SaveTestRequest` → `{ id: number; }` (serviceHandler)
