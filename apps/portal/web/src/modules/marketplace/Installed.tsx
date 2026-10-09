/**
 * A client's record: its Templates, each with where it stands, and its Components, what it has
 * installed, each with its settings, prices left out.
 */
import type { RecordAnswer, RecordsPage } from "@wren/core/records/serve";
import { ButtonLink, Empty, LoadFailed, Loading, type SettingField, Settings, Tag } from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { LIST, QUIET } from "../work/bits.js";

const RECORD = "console.component";

async function installed(client: string) {
  const ask = { client, app: "clients", asClient: false, record: RECORD };
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
  const at = (path: string) => `/marketplace/catalog${path}?client=${encodeURIComponent(client)}`;
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
                <a href={at(`/${row.id}`)}>
                  <b>{String(row.name)}</b>
                </a>
                {values === null ? (
                  <span className={QUIET}>Its settings don't parse: open it to fix them.</span>
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
        <Empty>Nothing installed.</Empty>
      )}
      <div>
        <ButtonLink href={`${at("")}&type=part&ready=ready`} size="sm" tone="quiet" arrow>
          Install
        </ButtonLink>
      </div>
    </div>
  );
}

interface InstalledTemplate {
  template: string;
  name: string;
  state: "draft" | "waiting" | "live" | "off";
  current: boolean;
  parts: number;
  at: string;
}

const STATE = {
  draft: { label: "Not live yet", tone: "neutral" },
  waiting: { label: "Waiting on approval", tone: "accent" },
  live: { label: "Live", tone: "green" },
  off: { label: "Uninstalled", tone: "neutral" },
} as const;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** A client's templates: each one's state, how many parts it put on, and when. */
export function ClientTemplates({ client }: { client: string }) {
  const got = useCall(`templates:${client}`, () =>
    call<InstalledTemplate[]>("console/templateInstalls", { client }),
  );
  const at = (path: string) => `/marketplace/catalog${path}?client=${encodeURIComponent(client)}`;
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading lines={2} />;
  return (
    <div className="grid gap-3">
      {got.data.length ? (
        <ul className={LIST}>
          {got.data.map((t) => (
            <li key={t.template} className="grid gap-1">
              <span className="flex items-center justify-between gap-3">
                <a href={at(`/${t.template}`)} className="min-w-0">
                  <b>{t.name}</b>
                </a>
                <Tag tone={STATE[t.state].tone}>{STATE[t.state].label}</Tag>
              </span>
              <span className={QUIET}>
                {t.state === "off"
                  ? `Uninstalled ${day(t.at)}. Data and copy kept.`
                  : `${t.parts} ${t.parts === 1 ? "part" : "parts"}, installed ${day(t.at)}.`}
                {t.current || t.state === "off" ? "" : " The template changed: open it to update."}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No templates yet.</Empty>
      )}
      <div>
        <ButtonLink href={`${at("")}&type=template`} size="sm" tone="quiet" arrow>
          Templates
        </ButtonLink>
      </div>
    </div>
  );
}
