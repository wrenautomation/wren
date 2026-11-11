/**
 * A client's record: its Templates, each with where it stands, and its Components, what it has
 * installed, each with its settings, prices left out. Read only: installs are the CLI's
 * (`wren clients set`, designs/2026-11-04-portal-places.md).
 */
import type { RecordAnswer, RecordsPage } from "@wren/core/records/serve";
import { Empty, LoadFailed, Loading, type SettingField, Settings } from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { LIST, QUIET } from "../work/bits.js";

const RECORD = "console.component";

async function installed(client: string) {
  const ask = { client, app: "people", asClient: false, record: RECORD };
  const page = await call<RecordsPage>("console/recordsList", { ...ask, view: "installed" });
  // A template has its own section: it's not a part with settings.
  return Promise.all(
    page.rows
      .filter((r) => r.type !== "template")
      .map((r) => call<RecordAnswer>("console/recordsGet", { ...ask, id: r.id })),
  );
}

export function ClientComponents({ client }: { client: string }) {
  const got = useCall(`installed:${client}`, () => installed(client));
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading lines={3} />;
  return (
    <div className="grid gap-3">
      {got.data.length ? (
        <ul className={LIST}>
          {got.data.map(({ row, detail }) => {
            const { values, form } = detail as {
              values?: Record<string, unknown> | null;
              form?: SettingField[] | null;
            };
            return (
              <li key={row.id} className="grid gap-2">
                <b>{String(row.name)}</b>
                {values === null ? (
                  <span className={QUIET}>Its settings don't parse.</span>
                ) : Object.keys(values ?? {}).length ? (
                  <Settings values={values} fields={form} />
                ) : (
                  <span className={QUIET}>No settings.</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty waits>No apps installed yet. Each one Wren installs lists here.</Empty>
      )}
    </div>
  );
}
