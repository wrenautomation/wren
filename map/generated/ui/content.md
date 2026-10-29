# Content: app, wren workspace

Every platform's posts: plan, make, and how each did.

Sidebar: team: Marketing.

Registered in `apps/portal/web/src/modules/marketing/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Plan | hand | `apps/portal/web/src/modules/marketing/plan.tsx` | `ConsolePortal/call`, `ConsolePortal/recordsEdit` | What to make today, what waits on you, and what went out. |
| Studio | hand | `apps/portal/web/src/modules/marketing/studio.tsx` | `ConsolePortal/call`, `ConsolePortal/recordsEdit`, `ConsolePortal/recordsGet`, `ConsolePortal/recordsUndo`, `PipelineConsole/journeysDrop`, `PipelineConsole/journeysMove`, `PipelineConsole/recordsGet`, `PipelineConsole/recordsList` | Make posts, threads, carousels, stories, blog posts and videos, and finish drafts. |
| Pieces | hand | `apps/portal/web/src/modules/marketing/pieces.tsx` | `ConsolePortal/call` | Everything you made, each with everywhere it went. |
| Posts | list of `marketing.post` | `apps/portal/web/src/records.tsx` |  | Every post that went out, best first. |
| Numbers | overview | `apps/portal/web/src/records.tsx` |  | Your marketing numbers at a glance. |
| Feed | hand | `apps/portal/web/src/modules/marketing/feed.tsx` | `ConsolePortal/call`, `LearnConsole/alerts`, `LearnConsole/bell`, `LearnConsole/bellSeen`, `LearnConsole/browse`, `LearnConsole/home`, `LearnConsole/item`, `LearnConsole/open`, `LearnConsole/progress`, `LearnConsole/rail`, `LearnConsole/seen`, `LearnConsole/today`, `LearnConsole/unseen`, `media/grant` (host) | Posts from the people and topics you follow. |
| Topics | list of `marketing.topic` | `apps/portal/web/src/records.tsx` |  | The email topics people can sign up for. |
| Facts | hand | `apps/portal/web/src/modules/marketing/facts.tsx` | `ConsolePortal/recordsEdit`, `ConsolePortal/recordsGet`, `ConsolePortal/recordsUndo` | What drafts may say about you and Wren. |
| Drafts (link only) | list of `marketing.draft` | `apps/portal/web/src/records.tsx` |  | Every post draft: edit it, approve it, it goes out. |
| Write (link only) | hand | `apps/portal/web/src/modules/marketing/studio.tsx` | `ConsolePortal/call`, `ConsolePortal/recordsEdit`, `ConsolePortal/recordsGet`, `ConsolePortal/recordsUndo`, `PipelineConsole/journeysDrop`, `PipelineConsole/journeysMove`, `PipelineConsole/recordsGet`, `PipelineConsole/recordsList` | Opens Studio's New. |
| Recordings (link only) | list of `marketing.video` | `apps/portal/web/src/records.tsx` |  | Recordings: the agent edits, you review, they go out as videos and Shorts. |
| Feed (link only) | list of `marketing.explore` | `apps/portal/web/src/records.tsx` |  | New posts the topic searches found, to reply to or follow. |
| Today (link only) | day | `apps/portal/web/src/records.tsx` |  | Each platform's day: what went out and what waits on you. |
| What worked (link only) | list of `marketing.digest` | `apps/portal/web/src/records.tsx` |  | What worked last week, by platform. |
| Every number (link only) | list of `marketing.metric` | `apps/portal/web/src/records.tsx` |  | Every number we track, and what each missing one needs. |
| Cadence (link only) | list of `marketing.cadence` | `apps/portal/web/src/records.tsx` |  | Your posting goals against what went out this week. |
| Reports (link only) | hand | `apps/portal/web/src/modules/marketing/reports.tsx` | `MarketingConsole/reports` | Your numbers by email each week or month, against the one before. |
