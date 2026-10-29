# Reactivation: app, client workspace

Checks your past clients for a reason to call now. Each gets a brief and an email that waits for your OK.

Sidebar: client: Leads.

Registered in `apps/portal/web/src/modules/reactivation/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Overview | overview | `apps/portal/web/src/records.tsx` |  | How winning back your past customers is going. |
| Run | hand | `apps/portal/web/src/modules/reactivation/Run.tsx` | `ReactivationPortal/overview`, `ReactivationPortal/run`, `ReactivationPortal/work` | Watch the campaign's work as it runs, line by line. |
| People | list of `reactivation.person` | `apps/portal/web/src/records.tsx` | `public.reactivation_people`, `public.reactivation_person_activity` | Everyone on your list, ranked by why to call them now. |
| Emails | queue of `reactivation.email` | `apps/portal/web/src/records.tsx` | `public.reactivation_emails` | Emails to past customers, waiting for your OK. |
| Replies | queue of `reactivation.reply` | `apps/portal/web/src/records.tsx` | `public.reactivation_replies` | Replies from past customers, ready for you to answer. |
| Keep | list of `reactivation.keep` | `apps/portal/web/src/records.tsx` | `public.reactivation_keep` | Current customers who may go quiet, riskiest first. |
| Setup | form of `reactivation.setting` | `apps/portal/web/src/records.tsx` | `public.client_profile`, `public.imports` | Who your campaign writes to, and how. |
| What's real (link only) | hand | `apps/portal/web/src/modules/reactivation/Real.tsx` |  | What in this sample is real and what is made up. |
| Plan | list of `delivery.step` | `apps/portal/web/src/records.tsx` | `delivery.access_requests`, `delivery.agreements`, `delivery.asks`, `delivery.comments`, `delivery.deliverables`, `delivery.engagements`, `delivery.interests`, `delivery.invoices`, `delivery.milestones`, `delivery.moments`, `delivery.pulses`, `delivery.results`, `delivery.reviews`, `delivery.updates`, `pipeline.terms_versions`, `public.clients` | Every step of your project, with its dates. |
| Updates | list of `delivery.update` | `apps/portal/web/src/records.tsx` | `delivery.access_requests`, `delivery.agreements`, `delivery.asks`, `delivery.comments`, `delivery.deliverables`, `delivery.engagements`, `delivery.interests`, `delivery.invoices`, `delivery.milestones`, `delivery.moments`, `delivery.pulses`, `delivery.results`, `delivery.reviews`, `delivery.updates`, `pipeline.terms_versions`, `public.clients` | What we've done on your project, as we post it. |
| Needs you | queue of `delivery.ask` | `apps/portal/web/src/records.tsx` | `delivery.access_requests`, `delivery.agreements`, `delivery.asks`, `delivery.comments`, `delivery.deliverables`, `delivery.engagements`, `delivery.interests`, `delivery.invoices`, `delivery.milestones`, `delivery.moments`, `delivery.pulses`, `delivery.results`, `delivery.reviews`, `delivery.updates`, `pipeline.terms_versions`, `public.clients` | Questions and files we need from you. |
| Paperwork | list of `delivery.paperwork` | `apps/portal/web/src/records.tsx` | `delivery.access_requests`, `delivery.agreements`, `delivery.asks`, `delivery.comments`, `delivery.deliverables`, `delivery.engagements`, `delivery.interests`, `delivery.invoices`, `delivery.milestones`, `delivery.moments`, `delivery.pulses`, `delivery.results`, `delivery.reviews`, `delivery.updates`, `pipeline.terms_versions`, `public.clients` | Your contract, the setup fee and the access we need. |
| Deliverables (link only) | queue of `delivery.deliverable` | `apps/portal/web/src/records.tsx` | `delivery.access_requests`, `delivery.agreements`, `delivery.asks`, `delivery.comments`, `delivery.deliverables`, `delivery.engagements`, `delivery.interests`, `delivery.invoices`, `delivery.milestones`, `delivery.moments`, `delivery.pulses`, `delivery.results`, `delivery.reviews`, `delivery.updates`, `pipeline.terms_versions`, `public.clients` | What we hand over, waiting for your OK. |
| Results (link only) | list of `delivery.result` | `apps/portal/web/src/records.tsx` | `delivery.access_requests`, `delivery.agreements`, `delivery.asks`, `delivery.comments`, `delivery.deliverables`, `delivery.engagements`, `delivery.interests`, `delivery.invoices`, `delivery.milestones`, `delivery.moments`, `delivery.pulses`, `delivery.results`, `delivery.reviews`, `delivery.updates`, `pipeline.terms_versions`, `public.clients` | The numbers that show whether the work paid off. |
| Contract (link only) | hand | `apps/portal/web/src/modules/work/Contract.tsx` | `DeliveryPortal/contract`, `DeliveryPortal/sign` | Your contract with Wren, to read and sign. |
| Welcome guide (link only) | hand | `apps/portal/web/src/modules/work/Welcome.tsx` |  | How this works, who does what, and where to find us. |
