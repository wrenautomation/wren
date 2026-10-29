# Documents: app, client workspace

Send an estimate or a contract to sign. See who signed and who paid the deposit.

Sidebar: client: Business.

Registered in `apps/portal/web/src/modules/documents/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Documents | list of `documents.document` | `apps/portal/web/src/records.tsx` | `public.clients`, `public.doc_templates`, `public.docs` | Estimates and contracts you sent, and whether they're signed. |
| Templates | list of `documents.template` | `apps/portal/web/src/records.tsx` | `public.clients`, `public.doc_templates` | Saved documents to start an estimate or contract from. |
