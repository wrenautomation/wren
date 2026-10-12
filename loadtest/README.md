# loadtest

k6 scenarios run on a throwaway local stack. Why and the results so far: `designs/2026-10-11-load-testing.md`.

```sh
pnpm loadtest portal-reads              # 100 users, 66k firms: PASS or FAIL, exit code to match
pnpm loadtest portal-reads --vus 300    # another peak
pnpm loadtest portal-reads --stress     # 10, 20, 40… users until a threshold breaks: the breaking point
pnpm loadtest portal-reads --up         # stack seeded, no k6: EXPLAIN, try a fix
pnpm loadtest --down                    # clear a kept stack
```

Needs Docker and `k6` (`brew install k6`). Nothing reaches prod: the worker gets no `.env`.

## Add a scenario

- `scenarios/<name>.js`: a k6 script that reads `__ENV.INGRESS` and sets
  `options = shape({ ...thresholds })` from `../lib.js`, so `--stress` works on it. The
  thresholds are the success criteria, so write them first. Tag each request kind (`tags: { ask }`) and set a
  threshold per tag.
- `seeds/<name>.sql` (optional): synthetic rows only (the repo is public), shaped like prod.
  `:firms` is the size flag. A portal viewer needs an `operators` row.

Results land in `results/` (ignored): k6's summary, the profile (CPU, top statements), the
worker's log; a stress run adds k6's samples and each stair's numbers (`.stress.json`).
