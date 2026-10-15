# Word timing test

2026-10-15. William: "test it, if it's not good remove it."

## Why

Studio's words come from whisper.cpp (`packages/studio/src/whisper.ts`: large-v3-turbo, Metal, `-ml 1 -sow`, Silero VAD). Word edges drift. `cuts.ts` and `props.ts` work around it. Silence cuts, word captions, stressed words and the YouTube SRT all read these times. Better edges fix all of them at once.

## Candidates

1. **now**: what ships.
2. **dtw**: whisper.cpp's own token timestamps (`-dtw large.v3.turbo`). No new stack.
3. **whisperx**: WhisperX's wav2vec2 forced alignment run over our transcript text (align only, no diarization, no HF token). Python via `uv`, called as a subprocess like `whisper-cli`. BSD-2.

## Test

- Two real takes from the studio media dir, ~1 min each, one long-form and one Short. Never commit media or transcripts (public repo).
- Truth: the edges that matter are the ones next to a pause (cuts and caption breaks happen there). Mark them from the waveform: speech onset and offset by short-window energy (10 ms frames) around each pause, checked against a spectrogram image for a sample of 20. Inner word edges are not scored. Keep truth files outside the repo, in the studio cache.
- Score per candidate: median and p90 |start error| and |end error| in ms, words dropped or added vs truth, and wall time on this Mac.
- Also score what matters downstream: silence cuts from `cuts.ts` against cuts from truth (ms of speech clipped, ms of dead air kept).

## Decide

- Winner must beat **now** by a clear margin (p90 edge error down ≥ 30%, no speech clipped) and run under 1x realtime on this Mac.
- Winner: an optional `align` step behind `transcribe()` returning the same `Word[]`. Default on if it wins. Studio UI and YouTube upload unchanged.
- Losers: no code left. No Python left if WhisperX loses.
- Nothing wins: write the numbers here and close.

## Out of scope

Filler (um/uh) detection. Diarization. Swapping the transcriber.

## Report

The numbers table, the call, commits.
