# @wren/video

Role: package. Files: 8.

## Uses

- @wren/db

## Outside packages

node:child_process, node:crypto, node:fs, node:path

## Folders

Dotted: types only.

```mermaid
flowchart LR
  ncapture_ts["capture.ts"]
  nencode_ts["encode.ts"]
  nindex_ts["index.ts"]
  noverlay_ts["overlay.ts"]
  npublish_ts["publish.ts"]
  nrecorder_ts["recorder.ts"]
  ntimeline_ts["timeline.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nencode_ts --> ntimeline_ts
  nindex_ts --> ncapture_ts
  nindex_ts --> nencode_ts
  nindex_ts --> noverlay_ts
  nindex_ts --> nrecorder_ts
  nindex_ts --> ntimeline_ts
  npublish_ts -.-> nencode_ts
  nrecorder_ts --> noverlay_ts
  nrecorder_ts -.-> ntimeline_ts
```

## Files

- capture.ts
- encode.ts
- index.ts
- overlay.ts
- publish.ts
- recorder.ts
- timeline.ts
- vitest.config.ts
