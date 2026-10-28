# @wren/auth-app

Role: package. Files: 11.

## Uses

- @wren/auth
- @wren/channel-email
- @wren/config
- @wren/core
- @wren/db
- @wren/ui

## Outside packages

node:child_process, node:crypto, node:fs, node:path, node:url

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nlambda_["lambda/ (4)"]
  nheaders_ts["headers.ts"]
  nworker_ts["worker.ts"]
  nweb_["web/ (5)"]
  nlambda_ --> nheaders_ts
  nworker_ts --> nheaders_ts
```

## Files

- headers.ts
- lambda/: lambda/build.mjs, lambda/http.ts, lambda/index.ts, lambda/keys.ts
- web/: web/src/App.tsx, web/src/app.css, web/src/main.tsx, web/src/next.ts, web/vite.config.ts
- worker.ts
