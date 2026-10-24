#!/usr/bin/env bash
# Rebuild the sound kit's files (designs/2026-10-24-video-film-file.md, Decision 4) into this
# folder: Kenney's CC0 packs (kenney.nl: Interface Sounds, UI Audio, Impact Sounds), plus the
# swishes, riser and boom made here with ffmpeg. Each file: leading silence trimmed, mono 48 kHz
# 16-bit wav, peaks at -6 dBFS. The mix level is the edit's gainDb, never baked in.
# Usage: sfx/build.sh <folder with the unzipped kenney_* packs>
set -euo pipefail
src=${1:?folder with kenney_interface-sounds, kenney_ui-audio, kenney_impact-sounds}
out=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Trim, mono 48 kHz, then gain so the peak sits at -6 dBFS.
level() {
  local in=$1 id=$2
  ffmpeg -v error -y -i "$in" -af "silenceremove=start_periods=1:start_threshold=-60dB,aresample=48000" \
    -ac 1 -c:a pcm_s16le "$tmp/$id.wav"
  local peak
  peak=$(ffmpeg -hide_banner -i "$tmp/$id.wav" -af volumedetect -f null - 2>&1 |
    sed -n 's/.*max_volume: \(-*[0-9.]*\) dB.*/\1/p')
  ffmpeg -v error -y -i "$tmp/$id.wav" -af "volume=$(awk "BEGIN{print -6 - ($peak)}")dB" \
    -c:a pcm_s16le "$out/$id.wav"
}

kenney() { level "$src/$1" "$2"; }
kenney kenney_ui-audio/Audio/mouseclick1.ogg click-1
kenney kenney_interface-sounds/Audio/click_001.ogg click-2
kenney kenney_ui-audio/Audio/click3.ogg click-3
kenney kenney_interface-sounds/Audio/tick_001.ogg key-1
kenney kenney_interface-sounds/Audio/tick_002.ogg key-2
kenney kenney_interface-sounds/Audio/select_001.ogg key-3
kenney kenney_interface-sounds/Audio/pluck_001.ogg pop-1
kenney kenney_interface-sounds/Audio/drop_001.ogg pop-2
kenney kenney_interface-sounds/Audio/toggle_001.ogg pop-3
kenney kenney_interface-sounds/Audio/confirmation_001.ogg ding-1
kenney kenney_interface-sounds/Audio/confirmation_002.ogg ding-2
kenney kenney_interface-sounds/Audio/bong_001.ogg ding-3
kenney kenney_interface-sounds/Audio/error_001.ogg error-1
kenney kenney_interface-sounds/Audio/glitch_001.ogg glitch-1
kenney kenney_impact-sounds/Audio/impactSoft_heavy_000.ogg hit-1
kenney kenney_impact-sounds/Audio/impactPunch_heavy_000.ogg hit-2

# Made here (CC0 like the rest). A swish: pink noise in two bands, the low one peaking first, so
# it moves past. Seeded, so each build makes the same bytes.
swish() {
  local id=$1 d=$2 seed=$3
  ffmpeg -v error -y -f lavfi -i "anoisesrc=d=$d:c=pink:r=48000:seed=$seed" -filter_complex \
    "[0]asetnsamples=64,asplit[a][b];
     [a]lowpass=f=900,volume='pow(sin(PI*min(t/($d*0.8),1)),3)':eval=frame[lo];
     [b]bandpass=f=3200:w=2400,volume='pow(sin(PI*max(0,(t-$d*0.2))/($d*0.8)),3)':eval=frame[hi];
     [lo][hi]amix=inputs=2:normalize=0,afade=t=out:st=$(awk "BEGIN{print $d*0.85}"):d=$(awk "BEGIN{print $d*0.15}")" \
    -ac 1 -c:a pcm_s16le "$tmp/$id-raw.wav"
  level "$tmp/$id-raw.wav" "$id"
}
swish swish-1 0.28 11
swish whoosh-1 0.55 23
swish whoosh-2 0.9 37

# A riser: a sine climbing 200 to 1200 Hz under hissing noise, both swelling for 2 s.
ffmpeg -v error -y -f lavfi \
  -i "aevalsrc='0.5*sin(2*PI*200/(log(6)/2)*(exp(log(6)/2*t)-1))*pow(t/2,2)':d=2:s=48000" \
  -f lavfi -i "anoisesrc=d=2:c=white:r=48000:seed=5" -filter_complex \
  "[1]asetnsamples=64,highpass=f=2500,volume='0.4*pow(t/2,3)':eval=frame[n];[0][n]amix=inputs=2:normalize=0" \
  -ac 1 -c:a pcm_s16le "$tmp/riser-raw.wav"
level "$tmp/riser-raw.wav" riser-1

# A low boom for a title card: a sine falling to 45 Hz with a soft thump on top.
ffmpeg -v error -y -f lavfi \
  -i "aevalsrc='0.9*sin(2*PI*(45*t+80*(1-exp(-6*t))/6))*exp(-2.5*t)':d=1.6:s=48000" \
  -f lavfi -i "anoisesrc=d=0.08:c=brown:r=48000:seed=9" -filter_complex \
  "[1]lowpass=f=180,afade=t=out:st=0.02:d=0.06[t];[0][t]amix=inputs=2:normalize=0,afade=t=out:st=1.3:d=0.3" \
  -ac 1 -c:a pcm_s16le "$tmp/boom-raw.wav"
level "$tmp/boom-raw.wav" boom-1

# Each file's length, for kit.json.
for f in "$out"/*.wav; do
  printf '%s %s\n' "$(basename "$f" .wav)" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")"
done
