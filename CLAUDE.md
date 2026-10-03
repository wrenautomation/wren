# wren

New session: read in this order, stop when you have enough.

1. `docs/restate-operations.md`: where everything runs (hosts table), how to reach prod, every loop's controls.
2. `README.md`: the CLI by area.
3. `map/CLAUDE.md` before editing code: what each table, type and loop is, and what a change hits.
4. `designs/` for why (dated, with decision logs). `deploy/README.md` to rebuild infra.

Prod from here: `node scripts/prod-sql.mjs "<sql>"` (read only), `node scripts/ingress.mjs <Service/key/handler> [json]`,
`node scripts/prod-wren.mjs <cmd>`. Never print `deploy/prod.env`, the database URL or tokens; never source an env file.

Shipping: `./scripts/gates.sh`, commit with `git commit -- <paths>` (other sessions stage files here), push.
CI deploys `main`. An env change: `deploy/scripts/push-secrets.sh` (diff SSM first, it overwrites the whole parameter),
then `gh workflow run deploy.yml --ref main`.

Hard rules: repo is public (no lead data, amounts, client names, secrets; tests use synthetic data).
Never `tofu apply -target` the Lambda. Never call `Resolution/default/resolve` by hand; queue it.
Money and spend are William's call.
