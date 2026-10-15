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

## Result (2026-10-15)

Call: **WhisperX wins.** It ships as `align.ts`, on by default behind `transcribe()`. DTW loses; no code kept.

Clips (kept outside the repo, in `~/.cache/wren/timing`): a 43 s Short span, a 60 s long-form minute, and a 60 s minute picked for the most pauses (the only one with many silence cuts). Truth: 10 ms energy, a speech core 25 dB under the take's p95 level (50 ms or longer, so clicks don't count), edges where it drops 35 dB under, pauses of 250 ms or more. 36 edges were checked on a spectrogram, picked where the candidates disagreed most. The first, floor-based threshold counted breaths and mouth clicks as speech; this one doesn't. Truth can still end ~200 ms early on a soft voiced tail, and it counts an untranscribed um as speech. Errors are after `fitWords`, which is what gets stored.

Pause edges, all three clips (135 edges):

| | start p50 | start p90 | end p50 | end p90 | **all p90** | words in a pause |
|---|---|---|---|---|---|---|
| now | 190 ms | 1030 | 90 | 580 | **900** | 52 |
| dtw | 150 | 720 | 90 | 760 | **730** (-19%) | 44 |
| whisperx | 19 | 512 | 37 | 163 | **356** (-60%) | 9 |

All-edge p90 per clip: Short 650 / 450 / 356, long-form 440 / 410 / 244, pauses 1310 / 1170 / 512 (now / dtw / whisperx).

Silence cuts from `cuts.ts`, pause clip (truth gives 24 cuts, 14.9 s of dead air kept):

| | cuts | speech clipped | dead air kept |
|---|---|---|---|
| now | 13 | 0 ms | 26.4 s |
| dtw | 16 | 0 ms | 28.8 s |
| whisperx | 23 | 0 ms | 15.9 s |

Whole 13 min take (same truth rule, not spectrogram-checked): p90 550 → 260 ms, cuts 19 → 37 (truth 38), dead air kept 163.8 → 156.3 s, nothing clipped.

Wall time on this Mac (busy, load ~30): whisper 4-6 s a minute clip; dtw needs flash attention off (`-nfa`), 3-18 s; WhisperX adds ~8 s a clip, ~6 s of it model load. The 13 min take: whisper 110 s, align 46 s more, 0.2x realtime. Python peaks at ~1.5 GB while it runs.

Where WhisperX still misses: a word whisper heard wrong, or an um it left out. The aligner then stretches a neighbour over the um or puts a start early. Those are the p90 tail. DTW gives one time per token, so ends still come from whisper's segments and stay smeared.

## What shipped

- `packages/studio/src/align.ts`: `alignSegments` (sentence or 15 s runs, half a second of pad, never past a neighbour), the WhisperX call (one `align` per segment, CPU, 4 threads), `mergeAligned` (aligner times; a word it can't place keeps whisper's, clamped so nothing overlaps). Same `Word[]`, same count.
- `transcribe(wav, { align })`: on unless `align: false`. `wren video add --no-align` skips it.
- Setup, outside the repo: `uv venv --python 3.11 ~/.cache/wren/whisperx/.venv && uv pip install --python ~/.cache/wren/whisperx/.venv/bin/python whisperx==3.8.6`. The wav2vec2 base model (~360 MB) downloads on first run. No HF token, no diarization.
