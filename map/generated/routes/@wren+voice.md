# @wren/voice: routes

Services: 1.

## VoiceConsole (service via `portalService`)

File: packages/voice/src/console.ts

- **dictated** `DictatedRequest` → `{ id: string; }` (serviceHandler): writes public.runs
- **dictation** `PortalRequest` → `{ rows: import("./dictation-store.js").DictationStat[]; }` (serviceHandler): reads public.runs
- **saveTest** `SaveTestRequest` → `{ id: number; }` (serviceHandler): writes public.voice_calls, public.voice_turns; reads public.companies, public.documents, public.people, public.sms_contacts, public.sms_numbers
