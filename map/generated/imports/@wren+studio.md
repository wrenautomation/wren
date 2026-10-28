# @wren/studio

Role: package. Files: 42.

## Uses

- @wren/db
- @wren/core
- @wren/video

## Outside packages

node:child_process, node:crypto, node:fs, node:module, node:os, node:path, node:stream, node:url, node:util

## Folders

Dotted: types only.

```mermaid
flowchart LR
  ncuts_ts["cuts.ts"]
  nschema_ts["schema.ts"]
  ncaption_styles_ts["caption-styles.ts"]
  nfinish_ts["finish.ts"]
  ncaptions_ts["captions.ts"]
  nfinish_look_ts["finish-look.ts"]
  nsounds_ts["sounds.ts"]
  nduck_ts["duck.ts"]
  nfx_ts["fx.ts"]
  nchange_ts["change.ts"]
  nedit_ts["edit.ts"]
  ncap_ts["cap.ts"]
  nmedia_ts["media.ts"]
  nlocks_ts["locks.ts"]
  nprops_ts["props.ts"]
  nmatte_ts["matte.ts"]
  nsafe_zones_ts["safe-zones.ts"]
  nstress_ts["stress.ts"]
  nsentences_ts["sentences.ts"]
  nwhisper_ts["whisper.ts"]
  nalign_ts["align.ts"]
  nwords_ts["words.ts"]
  nstoryboard_ts["storyboard.ts"]
  nbar_ts["bar.ts"]
  nrender_hash_ts["render-hash.ts"]
  npunctuate_ts["punctuate.ts"]
  nindex_ts["index.ts"]
  nfilm_ts["film.ts"]
  nkit_ts["kit.ts"]
  nlook_ts["look.ts"]
  nloudness_ts["loudness.ts"]
  nobs_ts["obs.ts"]
  npromo_ts["promo.ts"]
  ncamera_ts["camera.ts"]
  npromo_clock_ts["promo-clock.ts"]
  ntake_ts["take.ts"]
  ncursor_ts["cursor.ts"]
  nremotion_ts["remotion.ts"]
  nvideo_check_ts["video-check.ts"]
  nremotion_["remotion/"]
  nsfx_["sfx/"]
  nvitest_config_ts["vitest.config.ts"]
  ncuts_ts -.-> nschema_ts
  nschema_ts -.-> ncaption_styles_ts
  nschema_ts -.-> nfinish_ts
  nschema_ts -.-> nsounds_ts
  nfinish_ts --> ncaption_styles_ts
  nfinish_ts --> ncaptions_ts
  nfinish_ts --> ncuts_ts
  nfinish_ts --> nfinish_look_ts
  nfinish_ts -.-> nschema_ts
  ncaptions_ts -.-> nschema_ts
  nfinish_look_ts -.-> ncaption_styles_ts
  nsounds_ts --> nduck_ts
  nsounds_ts --> nfx_ts
  nsounds_ts -.-> nschema_ts
  nchange_ts --> ncaption_styles_ts
  nchange_ts --> ncuts_ts
  nchange_ts --> nedit_ts
  nchange_ts --> nfinish_look_ts
  nchange_ts --> nprops_ts
  nchange_ts --> nschema_ts
  nchange_ts -.-> nsentences_ts
  nchange_ts --> nsounds_ts
  nchange_ts --> nstoryboard_ts
  nchange_ts -.-> nstress_ts
  nedit_ts --> ncap_ts
  nedit_ts --> ncaption_styles_ts
  nedit_ts --> ncuts_ts
  nedit_ts --> nfinish_ts
  nedit_ts --> nlocks_ts
  nedit_ts --> nmedia_ts
  nedit_ts --> nprops_ts
  nedit_ts --> nschema_ts
  nedit_ts --> nsentences_ts
  nedit_ts --> nsounds_ts
  nedit_ts --> nstress_ts
  nedit_ts --> nwhisper_ts
  nedit_ts --> nwords_ts
  ncap_ts --> nmedia_ts
  ncap_ts -.-> nsounds_ts
  nmedia_ts --> ncuts_ts
  nmedia_ts --> nfinish_ts
  nmedia_ts -.-> nschema_ts
  nprops_ts -.-> ncaption_styles_ts
  nprops_ts --> ncaptions_ts
  nprops_ts --> ncuts_ts
  nprops_ts --> nfinish_look_ts
  nprops_ts --> nfinish_ts
  nprops_ts -.-> nmatte_ts
  nprops_ts --> nmedia_ts
  nprops_ts --> nsafe_zones_ts
  nprops_ts -.-> nschema_ts
  nprops_ts --> nsounds_ts
  nprops_ts --> nstress_ts
  nmatte_ts --> ncuts_ts
  nmatte_ts --> nmedia_ts
  nmatte_ts -.-> nprops_ts
  nmatte_ts --> nsafe_zones_ts
  nmatte_ts -.-> nschema_ts
  nmatte_ts --> nstress_ts
  nstress_ts --> ncaptions_ts
  nstress_ts --> ncuts_ts
  nstress_ts -.-> nschema_ts
  nsentences_ts --> ncuts_ts
  nsentences_ts --> nmedia_ts
  nsentences_ts --> nprops_ts
  nsentences_ts -.-> nschema_ts
  nwhisper_ts --> nalign_ts
  nwhisper_ts -.-> nschema_ts
  nalign_ts -.-> nschema_ts
  nwords_ts -.-> nschema_ts
  nstoryboard_ts --> ncuts_ts
  nstoryboard_ts --> nfinish_ts
  nstoryboard_ts --> nprops_ts
  nstoryboard_ts -.-> nschema_ts
  nstoryboard_ts --> nsentences_ts
  nrender_hash_ts --> ncaption_styles_ts
  nrender_hash_ts --> ncuts_ts
  nrender_hash_ts --> nfinish_ts
  nrender_hash_ts --> nprops_ts
  nrender_hash_ts -.-> nschema_ts
  npunctuate_ts -.-> nschema_ts
  npunctuate_ts -.-> nstress_ts
  nindex_ts --> nbar_ts
  nindex_ts --> ncap_ts
  nindex_ts --> ncaption_styles_ts
  nindex_ts --> ncaptions_ts
  nindex_ts --> ncuts_ts
  nindex_ts --> nedit_ts
  nindex_ts --> nfilm_ts
  nindex_ts --> nfinish_ts
  nindex_ts --> nfx_ts
  nindex_ts --> nkit_ts
  nindex_ts --> nlocks_ts
  nindex_ts --> nlook_ts
  nindex_ts --> nloudness_ts
  nindex_ts --> nmatte_ts
  nindex_ts --> nmedia_ts
  nindex_ts --> nobs_ts
  nindex_ts --> npromo_ts
  nindex_ts --> nprops_ts
  nindex_ts --> npunctuate_ts
  nindex_ts --> nremotion_ts
  nindex_ts --> nrender_hash_ts
  nindex_ts --> nsafe_zones_ts
  nindex_ts --> nschema_ts
  nindex_ts --> nsentences_ts
  nindex_ts --> nsounds_ts
  nindex_ts --> nstress_ts
  nindex_ts --> ntake_ts
  nindex_ts --> nvideo_check_ts
  nindex_ts --> nwhisper_ts
  nindex_ts --> nwords_ts
  nfilm_ts --> ncuts_ts
  nfilm_ts --> nfinish_look_ts
  nfilm_ts --> nfinish_ts
  nfilm_ts --> nmedia_ts
  nfilm_ts --> nprops_ts
  nfilm_ts -.-> nschema_ts
  nfilm_ts --> nsounds_ts
  nkit_ts --> nfx_ts
  nkit_ts --> nsounds_ts
  nlook_ts --> ncuts_ts
  nlook_ts -.-> nschema_ts
  nobs_ts --> nedit_ts
  npromo_ts --> ncamera_ts
  npromo_ts --> ncursor_ts
  npromo_ts --> nloudness_ts
  npromo_ts --> npromo_clock_ts
  npromo_ts --> nsounds_ts
  npromo_ts --> ntake_ts
  ncamera_ts --> npromo_clock_ts
  ncamera_ts -.-> ntake_ts
  nremotion_ts -.-> nfinish_ts
  nremotion_ts --> nkit_ts
  nremotion_ts --> nloudness_ts
  nremotion_ts -.-> npromo_ts
  nremotion_ts -.-> nprops_ts
  nvideo_check_ts --> nbar_ts
  nremotion_ --> ncaption_styles_ts
  nremotion_ --> ncaptions_ts
  nremotion_ --> ncursor_ts
  nremotion_ --> nduck_ts
  nremotion_ --> nfinish_look_ts
  nremotion_ --> npromo_clock_ts
  nremotion_ -.-> npromo_ts
  nremotion_ -.-> nprops_ts
  nremotion_ --> nsafe_zones_ts
  nremotion_ -.-> nsounds_ts
```

## Files

- align.ts
- bar.ts
- camera.ts
- cap.ts
- caption-styles.ts
- captions.ts
- change.ts
- cursor.ts
- cuts.ts
- duck.ts
- edit.ts
- film.ts
- finish-look.ts
- finish.ts
- fx.ts
- index.ts
- kit.ts
- locks.ts
- look.ts
- loudness.ts
- matte.ts
- media.ts
- obs.ts
- promo-clock.ts
- promo.ts
- props.ts
- punctuate.ts
- remotion.ts
- remotion/: remotion/index.tsx
- render-hash.ts
- safe-zones.ts
- schema.ts
- sentences.ts
- sfx/: sfx/make.mjs
- sounds.ts
- storyboard.ts
- stress.ts
- take.ts
- video-check.ts
- vitest.config.ts
- whisper.ts
- words.ts
