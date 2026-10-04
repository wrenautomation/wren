/** A client's record's Components: what it has installed, each with its settings, prices left out. */
import type { RecordAnswer, RecordsPage } from "@wren/core/records/serve";
import { Alert, ButtonLink, Empty, Facts, Loading } from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { LIST, QUIET } from "../work/bits.js";

const RECORD = "console.component";

async function installed(client: string) {
  const ask = { client, app: "clients", asClient: false, record: RECORD };
  const page = await call<RecordsPage>("console/recordsList", { ...ask, view: "installed" });
  return Promise.all(
    page.rows.map((r) => call<RecordAnswer>("console/recordsGet", { ...ask, id: r.id })),
  );
}

const shown = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

export function ClientComponents({ client }: { client: string }) {
  const got = useCall(`installed:${client}`, () => installed(client));
  const at = (path: string) => `/marketplace/catalog${path}?client=${encodeURIComponent(client)}`;
  if (got.error && !got.data) return <Alert onRetry={got.retry}>{got.error.message}</Alert>;
  if (!got.data) return <Loading lines={3} />;
  return (
    <div className="grid gap-3">
      {got.data.length ? (
        <ul className={LIST}>
          {got.data.map(({ row, detail }) => {
            const values = (detail as { values?: Record<string, unknown> | null }).values;
            const items = Object.entries(values ?? {}).map(([k, v]): [string, string] => [
              k,
              shown(v),
            ]);
            return (
              <li key={row.id} className="grid gap-2">
                <a href={at(`/${row.id}`)}>
                  <b>{String(row.name)}</b>
                </a>
                {values === null ? (
                  <span className={QUIET}>Its settings don't parse: open it to fix them.</span>
                ) : items.length ? (
                  <Facts items={items} />
                ) : (
                  <span className={QUIET}>No settings.</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>Nothing installed.</Empty>
      )}
      <div>
        <ButtonLink href={`${at("")}&view=ready`} size="sm" tone="quiet" arrow>
          Install
        </ButtonLink>
      </div>
    </div>
  );
}
