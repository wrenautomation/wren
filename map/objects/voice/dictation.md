---
type: object
cluster: voice
universe: live
status: verified
verified: 2026-10-07 @ 5ebedcfb
entity: packages/voice/src/dictation/index.ts
---

# dictation (voice)

Speech to text in the portal's text boxes, through the voice agent's `Ears` (designs/2026-10-07-dictation.md). Product word: Dictate, the mic button. Its reverse lives here too: Read aloud, the speaker button, text to speech through the voice agent's `Mouth`.

## Why this shape

One seam so the model can move: `Transcriber` turns 16 kHz audio into text, and `TranscriberEars` (`ears.ts:30`) makes any of them an `Ears` that gives partials while you talk and a final per pause. The browser runs Moonshine base on WebGPU today; our server or a GPU box later is a new `Transcriber`, not a new UI. `pickAdapter` (`route.ts:35`) prefers the browser, then the server, then the browser's own speech if allowed, and otherwise says why. The kit part takes an engine through context, so `packages/ui` carries no model.

## Shape

- seam: `Transcriber` (`transcriber.ts:11`), `TranscriberEars`, `EarStream.finish` (hear the rest, then resolve, `types.ts:97`), `openAiTranscriber` for any `/audio/transcriptions` server (`transcriber.ts:146`), `FakeTranscriber` for tests
- `startDictation` (`session.ts:54`): one press to the last words, commands applied (`applyCommands`, "new line" and "period" only, `commands.ts:11`), timed as mic, first (from talking) and final ms
- kit: `DictateField` (the mic inside the box), `Dictate` and `DictationProvider` (`packages/ui/src/dictate.tsx`); hold or Alt+Space to talk, a short press toggles, partials greyed at the caret, "Listening" and the time while it hears, one ⌘Z takes a dictation out
- portal: `PortalDictation` (`apps/portal/web/src/dictation/engine.ts`) routes to `BrowserModel` and its worker (`model.ts`, `model.worker.ts`), `ServerModel` (`server.ts`) or `SpeechEars` (`speech.ts`); the mic worklet `web/public/dictate-mic.js`; the pick per device in local storage `wren.dictate`, set in Your settings (`modules/account/dictation.tsx`)
- server: `/api/dictate` in the portal Worker (`apps/portal/src/dictate.ts`), off until `DICTATE_URL` is set
- timings: `dictate` runs in the run ledger (`packages/voice/src/dictation-store.ts`), saved by `VoiceConsole.dictated` for Wren's team, read by `VoiceConsole.dictation` into Voice > Latency (`modules/voice/dictation.tsx`)
- reading aloud: `readAloud` (`packages/voice/src/reading.ts`) cleans text for the ear (`readable`), cuts sentences (`sentencesOf`) and makes sentence n+1 while n plays; kit `ReadAloud`, `ReadingProvider`, `useReadAloud` (`packages/ui/src/read-aloud.tsx`); portal `PortalReading` (`apps/portal/web/src/reading/engine.ts`) with `KokoroMouth` and its worker (`mouth.ts`, `voice.worker.ts`: Kokoro 82M, WebGPU fp32 else wasm q8, `phonemes.ts` via phonemizer), `PageSpeakers` (Web Audio); settings per device in `wren.read` (on, voice, speed), set in Your settings (`modules/account/reading.tsx`); buttons on every `MessagePreview`, the Notes toolbar and inbound Inbox messages
- CSP (`apps/portal/web/public/_headers`): `'wasm-unsafe-eval'` and Hugging Face hosts; onnxruntime's wasm is ours, gzipped by `vite.config.ts` (`/ort/<version>/`)

Citations: `packages/voice/src/dictation/ears.ts:30`, `packages/voice/src/dictation/route.ts:35`, `packages/voice/src/dictation/session.ts:54`, `packages/ui/src/dictate.tsx:126`, `apps/portal/src/dictate.ts:56`, `packages/voice/src/dictation-store.ts:39`

## Connected to

- **joins:** [[voice/call]] (same `Ears` interface)
- **looks-like-but-is-not:** the Voice app's test call speech (`modules/voice/speech.ts`, the browser's own recognition for the agent test)

## If you change this

- **Hits:** every box with a `DictateField` (`draft.tsx`, `edits.tsx`, `action.tsx`, `palette.tsx`, Ask page, templates, videos and workflow Ask), `main.tsx` (the provider), `App.tsx` (the report hook), the CSP when the model moves
- **Hits (reading):** `MessagePreview` (To approve, templates), Notes `doc.tsx`, the Inbox `conversation.tsx`; Cache Storage `wren-read`
- **Does not hit:** the voice agent's call loop (it never calls `finish`); the database beyond `runs`

## Surfaces

| Surface | Role |
|---|---|
| portal text boxes | writes words into the box; the words are never stored |
| Voice > Latency | p50/p95 per adapter and stage |
| Your settings | Auto, This device, Our server, Off, and the fallback; Reading aloud on or off, voice, speed, a sample |

## See

- Source: `packages/voice/src/dictation/`, `apps/portal/web/src/dictation/`
- Design: `designs/2026-10-07-dictation.md`
