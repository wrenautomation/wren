# People: app, client workspace

Everyone you know, by every address they use, with all they did and got.

Sidebar: client: Leads.

Registered in `apps/portal/web/src/modules/people/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| People | list of `people.profile` | `apps/portal/web/src/records.tsx` | `public.profile_records` | Everyone, once each: where they stand, and whether they ever came toward us. |
| Timeline | list of `people.event` | `apps/portal/web/src/records.tsx` | `public.profile_timeline` | Everything that happened with anyone, newest first, each line linked to its source. |
| Sent | list of `people.sent` | `apps/portal/web/src/records.tsx` | `public.sent_activity`, `public.sent_records` | Everything we sent, on every channel, and how far each one got. |
| Groups | list of `people.segment` | `apps/portal/web/src/records.tsx` | `public.segment_records` | A group is a saved list of people: a live one follows its rule, a manual one holds who you put in it. |
| Channels | hand | `apps/portal/web/src/modules/people/channels.tsx` | `PeopleConsole/channelPeople`, `PeopleConsole/channelStats`, `PeopleConsole/segmentContext`, `PeopleConsole/segmentDescribe`, `PeopleConsole/segmentPreview`, `PeopleConsole/segmentSave`, `PeopleConsole/segmentVersions` | Each channel's funnel side by side, from reached to paid. |
| Broadcasts | list of `people.broadcast` | `apps/portal/web/src/records.tsx` | `public.broadcast_records` | One email or text to a group, sent once To approve says yes. |
| Recipients (link only) | list of `people.recipient` | `apps/portal/web/src/records.tsx` | `public.broadcast_recipient_records` | Each person a broadcast went to, or why it didn't. |
| Data | list of `people.datum` | `apps/portal/web/src/records.tsx` | `public.profile_keys`, `public.profile_timeline`, `public.profile_traits`, `public.profiles`, `public.segments` | Every address kind, trait and timeline kind: where it comes from, who has it, what uses it. |
| Addresses (link only) | list of `people.key` | `apps/portal/web/src/records.tsx` | `public.profile_key_records` | Every email, phone, handle and cookie a profile goes by. |
| Traits (link only) | list of `people.trait` | `apps/portal/web/src/records.tsx` | `public.profile_trait_activity`, `public.profile_trait_records` | What we know about each person, one value per trait, every change kept. |
| Merges (link only) | list of `people.merge` | `apps/portal/web/src/records.tsx` | `public.profile_merge_records` | Profiles that turned out to be one person, and what moved. |
| Members (link only) | list of `people.member` | `apps/portal/web/src/records.tsx` | `public.segment_member_records` | Who is in each group, and since when. |
| Import | list of `reactivation.import` | `apps/portal/web/src/records.tsx` |  | Load a CSV of your contacts, and see what each file added. |
