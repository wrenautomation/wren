# lake

The warehouse's models. Why and how the lake works: `designs/2026-10-11-lake.md`.

```sh
node scripts/prod-wren.mjs lake status                      # tables, size, newest snapshot
node scripts/prod-wren.mjs lake sql "FROM warehouse.outbound_daily ORDER BY day DESC LIMIT 7"
node scripts/prod-wren.mjs lake sql --at 2026-10-01T00:00:00Z "SELECT count(*) FROM wren.leads"
node scripts/prod-wren.mjs lake sync --main --table runs    # one table now
```

## Add a model

`models/<name>.sql`: one `CREATE OR REPLACE TABLE warehouse.<name> AS ...` over `wren.*` or
`client_<id>.*`. Models run in name order, so one can read an earlier one. CI rebuilds them
nightly after the sync.
