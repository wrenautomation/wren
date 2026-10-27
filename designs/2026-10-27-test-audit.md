# Test audit: integration holds the deploy (WA-896)

## What the audit found (10-27)

- Integration passed in 1 of the last 50 runs on main. It held nothing, and `gates.sh changed` runs only typecheck and unit, so a change broke it unseen.
- The 3 red files (`content/loop`, `core/executor-triggers`, `outreach/reach-posts`) broke one way: WA-878 changed a default (the slot epsilon, the audience, auto-send). The unit tests changed with it; the integration tests did not.
- 63 of 2941 integration tests are synchronous. 14 read rows a `beforeAll` loaded. 49 are pure.
- Time and size are not the problem: 8 shards take about 3 minutes; integration and unit are about 96k lines each.

## Rule

An integration test owns its policy. It passes its own audience, caps, age guard and auto-send, and mocks the epsilon. It checks the wiring ("a kept post gets a draft"), not a default's value. Each default gets one unit test.

## Decision: how integration holds the deploy

Options:

1. Deploy waits on integration (chosen). The 8 shards move into `ci.yml`; `await_gates` waits for lint, unit, schema and all 8. About 3 more minutes a deploy; the deploy timeout goes from 20 to 30 minutes.
2. `push.sh` waits on integration and fails loud; the deploy still goes. A session can push past it.
3. `gates.sh changed` runs integration of touched packages on the Mac. Docker and Postgres on 16 GB; the slowest loop.

Priorities, in order: a red test is seen and fixed by the session that broke it; prod is not blocked by a flake; least wait. Option 1 meets the first; `--retry=1` covers most flakes. Options 2 and 3 leave a way past it.

## Not done

The 49 pure tests stay in their integration files. With integration holding the deploy they run before prod anyway; moving them across 38 files gains only an earlier local signal.
