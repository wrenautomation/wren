# Sound kit

`fx/` holds the effects: earshot's `launch` kit (github.com/Leonxlnx/earshot, v0.4.0, MIT). `make.mjs` makes it again: `node packages/studio/sfx/make.mjs` (needs uv and ffmpeg). Never edit `fx/` or `src/fx.ts` by hand.

Licence: earshot's code is MIT. Its sounds are made in code. The 15 fitted sounds come from CC0 Freesound recordings (earshot `docs/CREDITS_FIT.md`). No sample from any other source is in these files.

`kit.json` names the music beds. They are not in the repo: they live in the media bucket under `sfx/` with their licence (`wren video sfx add`, `wren video sfx pull`).
