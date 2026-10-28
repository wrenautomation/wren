# Voice: app, wren workspace

An AI agent that answers the phone, books calls and takes messages.

Registered in `apps/portal/web/src/modules/voice/index.ts`.

| Page | Template | Drawn in | For |
|---|---|---|---|
| Overview | overview | `apps/portal/web/src/records.tsx` | Your phone agent at a glance. |
| Test call | hand | `apps/portal/web/src/modules/voice/test.tsx` | Call the agent the way a caller would. |
| Calls | list of `voice.call` | `apps/portal/web/src/records.tsx` | Every call the agent took, and how it went. |
| Latency | hand | `apps/portal/web/src/modules/voice/latency.tsx` | How fast the agent answers after a caller stops talking. |
| Agent | hand | `apps/portal/web/src/modules/voice/agent.tsx` | Who answers the phone, what it says and what it may do. |
