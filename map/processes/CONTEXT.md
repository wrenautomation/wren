# processes/

One card per movement that actually runs in prod or by a person's command. Each names what it consumes and produces as object cards, with numbered steps cited to source.

| Card | Movement |
|---|---|
| `import` | a file or a discovery batch → companies, people, leads |
| `pool-feed` | the research chain, one stage per pass → proven leads |
| `compose` | the queue-keeper → enrollments full of approved drafts |
| `send-tick` | one paced walk of the outbox → sent, failed, unknown |
| `inbox-sync` | mailboxes → thread events → stops, suppressions, labels |
| `content-loop` | idea → drafts → approval → slot → published → metrics |
| `ads-launch-watch` | spec → paused ladder → start with budget → daily guard |
| `sms-tick` | lift, enroll, send tick, webhooks, daily labels and health |
| `delivery-watch` | hourly: client mail (welcome, needs you, Friday digest) → health scores and the flags list |
| `deploy` | push to main → migrate → Lambda version → Restate register → phone Worker |
| `migrate` | a schema edit → a SQL file → prod on the next deploy |
