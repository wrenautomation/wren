# @wren/notes

Role: package. Files: 33.

## Uses

- @wren/core
- @wren/db

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nindex_ts["index.ts"]
  naccess_ts["access.ts"]
  ntypes_ts["types.ts"]
  nboards_ts["boards.ts"]
  nschema_ts["schema.ts"]
  ndiff_ts["diff.ts"]
  ndoc_ts["doc.ts"]
  nposition_ts["position.ts"]
  nsheet_ts["sheet.ts"]
  nstore_ts["store.ts"]
  nsuggest_ts["suggest.ts"]
  ntask_records_ts["task-records.ts"]
  ntasks_ts["tasks.ts"]
  ntrain_ts["train.ts"]
  ninbox_ts["inbox.ts"]
  nmention_mail_ts["mention-mail.ts"]
  ndocx_ts["docx.ts"]
  nconsole_routes_ts["console-routes.ts"]
  nrecords_ts["records.ts"]
  nconsole_ts["console.ts"]
  nconsole_comments_ts["console-comments.ts"]
  nconsole_context_ts["console-context.ts"]
  nconsole_boards_ts["console-boards.ts"]
  nchips_ts["chips.ts"]
  npropose_ts["propose.ts"]
  ndrive_ts["drive.ts"]
  nconsole_pages_ts["console-pages.ts"]
  nconsole_records_ts["console-records.ts"]
  nconsole_sharing_ts["console-sharing.ts"]
  nconsole_training_ts["console-training.ts"]
  nconsole_writes_ts["console-writes.ts"]
  nroom_ts["room.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nindex_ts --> naccess_ts
  nindex_ts --> nboards_ts
  nindex_ts --> ndiff_ts
  nindex_ts --> ndoc_ts
  nindex_ts --> nposition_ts
  nindex_ts --> nsheet_ts
  nindex_ts --> nstore_ts
  nindex_ts --> nsuggest_ts
  nindex_ts --> ntask_records_ts
  nindex_ts --> ntasks_ts
  nindex_ts --> ntrain_ts
  nindex_ts --> ntypes_ts
  naccess_ts --> ntypes_ts
  nboards_ts --> naccess_ts
  nboards_ts --> nschema_ts
  nboards_ts --> ntypes_ts
  nschema_ts --> ntypes_ts
  ndoc_ts --> ntypes_ts
  nstore_ts --> naccess_ts
  nstore_ts --> nboards_ts
  nstore_ts --> ndoc_ts
  nstore_ts --> nschema_ts
  nstore_ts --> nsuggest_ts
  nstore_ts -.-> ntypes_ts
  nsuggest_ts --> ntypes_ts
  ntask_records_ts -.-> naccess_ts
  ntask_records_ts --> ndoc_ts
  ntask_records_ts --> nschema_ts
  ntask_records_ts --> ntasks_ts
  ntask_records_ts --> ntypes_ts
  ntasks_ts -.-> naccess_ts
  ntasks_ts --> nboards_ts
  ntasks_ts --> nposition_ts
  ntasks_ts --> nschema_ts
  ntasks_ts --> nstore_ts
  ntasks_ts --> ntypes_ts
  ntrain_ts --> nstore_ts
  ntrain_ts --> ntypes_ts
  ninbox_ts --> nschema_ts
  nmention_mail_ts -.-> naccess_ts
  nmention_mail_ts --> nschema_ts
  nmention_mail_ts --> nstore_ts
  ndocx_ts --> ntypes_ts
  nrecords_ts --> ndoc_ts
  nrecords_ts --> ninbox_ts
  nrecords_ts --> nstore_ts
  nrecords_ts --> ntask_records_ts
  nconsole_ts --> nconsole_comments_ts
  nconsole_ts --> nconsole_context_ts
  nconsole_ts --> nconsole_pages_ts
  nconsole_ts --> nconsole_records_ts
  nconsole_ts --> nconsole_routes_ts
  nconsole_ts --> nconsole_sharing_ts
  nconsole_ts --> nconsole_training_ts
  nconsole_ts --> nconsole_writes_ts
  nconsole_comments_ts --> naccess_ts
  nconsole_comments_ts --> nconsole_context_ts
  nconsole_comments_ts --> ndoc_ts
  nconsole_comments_ts --> ninbox_ts
  nconsole_comments_ts -.-> nschema_ts
  nconsole_comments_ts --> nstore_ts
  nconsole_comments_ts --> ntypes_ts
  nconsole_context_ts --> naccess_ts
  nconsole_context_ts --> nconsole_boards_ts
  nconsole_context_ts --> ndoc_ts
  nconsole_context_ts -.-> ndrive_ts
  nconsole_context_ts --> nmention_mail_ts
  nconsole_context_ts --> nschema_ts
  nconsole_context_ts --> nstore_ts
  nconsole_context_ts --> ntask_records_ts
  nconsole_context_ts -.-> ntypes_ts
  nconsole_boards_ts --> naccess_ts
  nconsole_boards_ts --> nboards_ts
  nconsole_boards_ts --> nchips_ts
  nconsole_boards_ts --> ndoc_ts
  nconsole_boards_ts --> npropose_ts
  nconsole_boards_ts -.-> nschema_ts
  nconsole_boards_ts --> nsheet_ts
  nconsole_boards_ts --> nstore_ts
  nconsole_boards_ts --> ntasks_ts
  nconsole_boards_ts --> ntypes_ts
  nconsole_pages_ts --> naccess_ts
  nconsole_pages_ts --> nboards_ts
  nconsole_pages_ts --> nconsole_context_ts
  nconsole_pages_ts --> ndiff_ts
  nconsole_pages_ts --> ndoc_ts
  nconsole_pages_ts -.-> nschema_ts
  nconsole_pages_ts --> nstore_ts
  nconsole_pages_ts --> ntypes_ts
  nconsole_records_ts -.-> nconsole_context_ts
  nconsole_records_ts --> ntask_records_ts
  nconsole_sharing_ts --> naccess_ts
  nconsole_sharing_ts --> nconsole_context_ts
  nconsole_sharing_ts --> nstore_ts
  nconsole_sharing_ts -.-> ntypes_ts
  nconsole_training_ts --> nconsole_context_ts
  nconsole_training_ts --> ndoc_ts
  nconsole_training_ts --> nstore_ts
  nconsole_writes_ts --> nconsole_context_ts
  nconsole_writes_ts --> ndoc_ts
  nconsole_writes_ts --> ndrive_ts
  nconsole_writes_ts --> nstore_ts
  nroom_ts --> ndoc_ts
  nroom_ts --> ntypes_ts
```

## Files

- access.ts
- boards.ts
- chips.ts
- console-boards.ts
- console-comments.ts
- console-context.ts
- console-pages.ts
- console-records.ts
- console-routes.ts
- console-sharing.ts
- console-training.ts
- console-writes.ts
- console.ts
- diff.ts
- doc.ts
- docx.ts
- drive.ts
- inbox.ts
- index.ts
- mention-mail.ts
- position.ts
- propose.ts
- records.ts
- room.ts
- schema.ts
- sheet.ts
- store.ts
- suggest.ts
- task-records.ts
- tasks.ts
- train.ts
- types.ts
- vitest.config.ts
