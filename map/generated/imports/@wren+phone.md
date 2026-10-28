# @wren/phone

Role: package. Files: 6.

## Uses

- @wren/auth
- @wren/channel-sms
- @wren/core

## Folders

Dotted: types only.

```mermaid
flowchart LR
  npublic_["public/ (4)"]
  nenv_ts["env.ts"]
  nworker_ts["worker.ts"]
  nworker_ts -.-> nenv_ts
```

## Files

- env.ts
- public/: public/app.js, public/c.js, public/sw.js, public/u.js
- worker.ts
