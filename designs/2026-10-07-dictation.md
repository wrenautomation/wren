# Dictation: speech to text in the portal, on our own seam

2026-10-07. William wants voice in the UI, "especially for content editing and prompting claude
code". He asked for "low cost, potentially we can own the stack, scalable and performant (esp
when it comes to latency) under load / scale". Then: "voice in the UI is your call. eventually
we'd need at scale, owned on our gpu."

## Answer first

- **What:** a mic button (`Dictate`) on every draft editor, the Ask Claude boxes, ⌘K and record
  notes. Hold it or Alt+Space to talk; tap to toggle. Partial words show greyed at the cursor,
  final words go in at the cursor, and one ⌘Z takes the whole dictation back out.
- **Default engine:** Moonshine base runs in the browser on WebGPU. The audio never leaves the
  device. $0 per minute, and the load scales with our users' GPUs, not ours.
- **One seam:** dictation uses the voice agent's `Ears` (`packages/voice/src/types.ts`), so the
  same code drives a browser model, our server, or later our own GPU. The GPU is a URL.
- **Cost now:** $0. No vendor configured, no keys added.

## The seam

`Ears` takes audio frames and gives `speech`, `partial`, `final` and `silence`. Dictation adds
one smaller piece under it, a `Transcriber` (16 kHz audio in, words out), and one Ears for every
batch model, `TranscriberEars`:

- It cuts the audio into segments on a pause (an energy check, 700 ms of quiet) or at 20 s.
- While a segment grows it runs the model again on it for a partial, never queueing: one run at
  a time, at least 250 ms of new audio between runs (1.5 s on the server).
- When a segment ends it runs once more and sends the `final`.

Adapters (`packages/voice/src/dictation/`, the browser parts in `apps/portal/web/src/dictation/`):

| Adapter | Where it runs | Notes |
|---|---|---|
| `browser` (default) | a Web Worker, transformers.js on onnxruntime-web, WebGPU | loads on the first mic press, cached in Cache Storage |
| `server` | the portal Worker's `/api/dictate`, which posts a WAV to an OpenAI-compatible `/audio/transcriptions` | `DICTATE_URL` (+ `DICTATE_MODEL`, `DICTATE_KEY`); unset means off. Groq, faster-whisper or a Parakeet server all fit |
| `fake` | tests | reads the words back |
| `speech` (fallback) | the browser's Web Speech API | off by default: Chrome sends the audio to Google, Safari to Apple |

**Routing** (`pickAdapter`): browser if WebGPU is there, else server if `/api/dictate` says it's
on, else the speech fallback if he turned it on, else the button hides and its tooltip says why.
A browser model that fails to load drops to the next one for the rest of the visit. Each
person picks per device in Your settings (Auto, This device, Our server, Off, plus the fallback
switch), kept in local storage, since WebGPU and the model cache are per device anyway.

## Picking the model

Measured on this Mac (Apple silicon, Chrome via Playwright, WebGPU), seven synthetic clips of
3 to 5 s from macOS `say` in three voices, 0.3 s of silence around each. "First" is the first
token of a run, "final" the whole run. WER counts "3" for "three" as an error.

| Model (encoder / decoder) | Download | Cold load | First p50 | Final p50 | WER | Chrome RAM peak |
|---|---|---|---|---|---|---|
| Moonshine tiny (fp32 / q4) | 79 MB | 6.0 s | 50 ms | 281 ms | 6.3% | 1.6 GB |
| **Moonshine base (fp32 / q4)** | **158 MB** | **11.8 s** | **53 ms** | **337 ms** | **4.2%** | **2.1 GB** |
| Moonshine base (q4 / q4) | 101 MB | 9.7 s | 65 ms | 328 ms | 6.3% | 1.9 GB |
| Whisper base (fp32 / q4) | 210 MB | 28.6 s | 239 ms | 378 ms | 4.2% | 1.6 GB |
| Whisper small (fp32 / q4) | 590 MB | 53.0 s | 510 ms | 769 ms | 1.1% | 2.4 GB |
| Whisper large-v3-turbo (q4f16 / q4f16) | 567 MB | 41.5 s | 1397 ms | 1552 ms | 1.1% | 3.3 GB |

Moonshine base, because:

- Its cost grows with the audio. Whisper pads every run to 30 s, so each partial costs a full
  encoder pass (about 230 ms here) however short the segment. That's what makes live partials
  cheap on Moonshine.
- Final words in 337 ms p50 on 4 s clips, inside the 500 ms goal, with Whisper base's accuracy
  at three quarters of its download.
- Turbo and small are more accurate, but take 0.8 to 1.6 s per run and 590 MB on a first press.
  They belong on a server GPU, not in a tab.
- Moonshine needs the silence padding: unpadded it dropped the last words of one clip and made
  up a first word. `TranscriberEars` pads every run.

The weights load from Hugging Face at a pinned revision (MIT licence). onnxruntime's WebGPU
wasm is 26.9 MB, over the 25 MiB a Workers asset may be, so it loads from jsDelivr at a pinned
version. The build leaves it out of `dist` (a Vite plugin) and the model's worker keeps it in
Cache Storage beside the weights. Its loader is inside onnxruntime's WebGPU bundle, which ships
with the app, so no blob script is needed. CSP: `script-src` gains `'wasm-unsafe-eval'`,
`connect-src` gains `https://huggingface.co https://*.hf.co` and the one jsDelivr path. Moving
both to our own R2 later is one constant each.

## The Dictate part

- **Where:** draft boxes (posts, comments, DMs, replies all use `DraftBox`), template words,
  record notes (a record's long field), every Ask Claude box (drafts, records, videos,
  workflows), the Ask page, ⌘K.
- **Input:** hold the button or Alt+Space for push to talk; a press under 300 ms toggles, and the
  next press stops. Alt+Space types a no-break space on a Mac, which we stop. Known clashes:
  Windows opens its window menu on Alt+Space, and Alfred or the ChatGPT app can claim it on a
  Mac. The button works either way.
- **Text:** final words go in at the cursor with `insertText`, so the browser's own undo history
  survives, and spacing and a capital follow what's before the cursor. ⌘Z right after takes the
  whole dictation out at once. "New line" and "period" become a line break and a full stop.
- **Motion:** a red dot while the mic is open and a level bar that moves with the voice. Nothing
  else moves.
- **Errors in words:** "The browser blocked the mic. Allow it for this site, then try again.",
  "Loading the speech model, 40%", "Couldn't turn that into words. Try again."
- **Phone:** the same button. Without WebGPU it uses the server, or hides.

## Checked in the app

The real `DraftBox` and Ask Claude box on the portal's engine, prod's CSP, headless Chrome with a
synthetic WAV as the mic (`--use-file-for-fake-audio-capture`), 2026-10-07:

- First press, weights not cached: 8 to 19 s to listening, with a percentage while it loads.
- Later presses: 80 to 100 ms from press to listening.
- Release to the last words in the box: 370 to 510 ms.
- One ⌘Z took the whole dictation out. No CSP errors from dictation.

## Measuring

Each dictation is timed: mic open (press to the first frame), first words (press to the first
partial or final), and final (release to the last final in the box). It goes to the run ledger
as a `dictate` run (adapter, model, the three times, words, audio length; no text, no person),
pruned after 30 days like the other chatty commands. Voice > Latency shows p50 and p95 per
adapter beside the agent's pipeline stats.

## The GPU plan (his money call)

Not built, not configured.

- **Model:** NVIDIA Parakeet TDT 0.6B v2 (English, streaming, top of the open ASR board) behind
  an OpenAI-compatible server; faster-whisper large-v3-turbo as the multilingual option.
- **Box:** one L4 (24 GB) in us-east-1 beside the Restate box. Rough estimate, to be measured:
  Parakeet batches 50 to 100 live streams on one L4; faster-whisper turbo 15 to 30. Dictation is
  bursty (people talk maybe a tenth of the time they hold a box open), so one GPU covers
  hundreds of people at once.
- **Goal:** p95 under 500 ms from release to final words on clips under 10 s.
- **Scaling:** autoscale on queue depth and p95, minimum one warm GPU in work hours, zero at
  night; a serverless GPU host as the overflow.
- **Switch:** set `DICTATE_URL` to the box. Routing already prefers the browser, so the GPU only
  takes phones and machines without WebGPU until we flip the default.

## Later

- **Reading aloud:** a Kokoro `Mouth` adapter (82M, Apache 2.0, runs on WebGPU too). Not built.
- A WebSocket stream to the GPU server, once there is one: the HTTP route posts whole segments
  because OpenAI-style transcription is batch.
- Whisper small as a "more accurate" choice, if Moonshine's misses annoy him.

## Decision log

- 2026-10-07: William asked for voice in the UI and left the shape to me. Dictation first,
  browser first, behind the voice agent's `Ears`.
- 2026-10-07: Moonshine base over Whisper on the numbers above.
- 2026-10-07: Timings in the run ledger (`dictate`), not a new table: no migration, pruned at 30
  days.
- 2026-10-07: The adapter choice is per device in local storage, not a server pref.
- 2026-10-07: onnxruntime's wasm from jsDelivr: too big for a Workers asset, and R2 is a prod
  write.
