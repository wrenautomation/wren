/**
 * Marketing → Reports (designs/2026-10-09-client-reports.md): the Overview's numbers mailed to
 * members every Monday or 1st at 9:00. One framed section per report with its last runs; Run now
 * reads the period so far and mails nobody. `manage` at the client.
 */
import {
  changeOf,
  EVERY_NAMES,
  MAX_RECIPIENTS,
  REPORT_TILES,
  type ReportEvery,
  type ReportLine,
  shown,
} from "@wren/content/client-reports";
import {
  Button,
  Callout,
  cx,
  Empty,
  Input,
  LoadFailed,
  Loading,
  PageHeader,
  Section,
  Tag,
} from "@wren/ui";
import { type FormEvent, useState } from "react";
import { ApiError, call } from "../../api.js";
import { zones } from "../../book-path.js";
import { useCall } from "../../load.js";
import { type PageProps, WREN } from "../../module.js";
import { ERROR, FIELD, QUIET, SELECT } from "../work/bits.js";

interface Send {
  id: number;
  from: string;
  to: string;
  closed: boolean;
  lines: ReportLine[];
  sentTo: string[];
  why: string | null;
  by: string | null;
  at: string;
}
interface Report {
  id: number;
  name: string;
  tiles: string[];
  every: ReportEvery;
  zone: string;
  recipients: string[];
  on: boolean;
  nextAt: string | null;
  by: string;
  sends: Send[];
}
interface View {
  reports: Report[];
  members: { email: string; role: string }[];
  mail: boolean;
  zone: string;
}

const day = (iso: string, zone: string) =>
  new Date(iso).toLocaleDateString(undefined, { timeZone: zone, month: "short", day: "numeric" });
const at = (iso: string, zone: string) =>
  new Date(iso).toLocaleString(undefined, {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** A write to reports: busy while it runs, its refusal shown, then a reload. */
function useReportAct(client: string, reload: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (route: string, body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await call(`marketing/${route}`, { client, ...body });
      reload();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}
type Act = ReturnType<typeof useReportAct>;

function ReportForm({
  view,
  report,
  act,
  done,
}: {
  view: View;
  report?: Report;
  act: Act;
  done: () => void;
}) {
  const [zone, setZone] = useState(report?.zone ?? view.zone);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ok = await act.run("reportSave", {
      id: report?.id ?? null,
      name: String(f.get("name") ?? ""),
      tiles: f.getAll("tiles").map(String),
      every: String(f.get("every")),
      zone,
      recipients: f.getAll("recipients").map(String),
      on: f.get("on") === "on",
    });
    if (ok) done();
  };
  const label = report ? `Change ${report.name}` : "New report";
  return (
    <form className="grid gap-4" aria-label={label} onSubmit={(e) => void submit(e)}>
      <div className="flex flex-wrap gap-3">
        <label className={`${FIELD} grow basis-[260px]`}>
          <span>Name</span>
          <Input
            name="name"
            required
            maxLength={120}
            defaultValue={report?.name ?? ""}
            placeholder="Weekly numbers"
          />
        </label>
        <label className={FIELD}>
          <span>When</span>
          <select className={SELECT} name="every" defaultValue={report?.every ?? "week"}>
            {Object.entries(EVERY_NAMES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className={FIELD}>
          <span>At 9:00 in</span>
          <select className={SELECT} value={zone} onChange={(e) => setZone(e.target.value)}>
            {zones(zone).map((z) => (
              <option key={z} value={z}>
                {z.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="m-0 grid gap-1.5 border-0 p-0">
        <legend className="mb-1 text-[13px] font-medium">Numbers</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {REPORT_TILES.map((t) => (
            <label key={t.id} className="flex items-baseline gap-2 text-[13.5px]">
              <input
                type="checkbox"
                name="tiles"
                value={t.id}
                defaultChecked={report ? report.tiles.includes(t.id) : true}
              />
              <span>{t.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="m-0 grid gap-1.5 border-0 p-0">
        <legend className="mb-1 text-[13px] font-medium">
          Who gets it <span className={QUIET}>({MAX_RECIPIENTS} at most)</span>
        </legend>
        {view.members.length ? (
          view.members.map((m) => (
            <label key={m.email} className="flex items-baseline gap-2 text-[13.5px]">
              <input
                type="checkbox"
                name="recipients"
                value={m.email}
                defaultChecked={report?.recipients.includes(m.email) ?? false}
              />
              <span className="break-all">
                {m.email} <span className={QUIET}>{m.role}</span>
              </span>
            </label>
          ))
        ) : (
          <p className={QUIET}>
            Nobody in this workspace yet. Invite people under Account → People.
          </p>
        )}
        <p className={cx("text-[12.5px]", QUIET)}>
          Each person gets the numbers their access lets them see.
        </p>
      </fieldset>
      <label className="flex items-baseline gap-2 text-[13.5px]">
        <input type="checkbox" name="on" defaultChecked={report?.on ?? true} />
        <span>On</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="dense" busy={act.busy}>
          {report ? "Save" : "Add report"}
        </Button>
        {report ? (
          <Button type="button" size="dense" tone="quiet" onClick={done}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function SendRow({ s, zone }: { s: Send; zone: string }) {
  return (
    <li className="grid gap-2 border-(--ui-hair) border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <b className="font-medium">
          {day(s.from, zone)} to {day(s.to, zone)}
          {s.closed ? null : <span className={cx("ml-2 font-normal", QUIET)}>so far</span>}
        </b>
        <span className={cx("text-[13px]", QUIET)}>
          {s.sentTo.length ? `Mailed to ${s.sentTo.join(", ")}` : (s.why ?? "Kept")}
        </span>
      </div>
      {s.sentTo.length && s.why ? <p className={ERROR}>{s.why}</p> : null}
      <dl className="m-0 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {s.lines.map((l) => {
          const c = changeOf(l);
          return (
            <div key={l.tile} className="flex items-baseline justify-between gap-3 text-[14px]">
              <dt className={QUIET}>{l.label}</dt>
              <dd className="m-0 tabular-nums">
                {l.error ? (
                  <span className={ERROR}>Couldn't read</span>
                ) : (
                  <>
                    {shown(l)}
                    {c && c !== "same" ? (
                      <span className={cx("ml-2 text-[12.5px]", QUIET)}>{c}</span>
                    ) : null}
                  </>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </li>
  );
}

function ReportSection({ r, view, act }: { r: Report; view: View; act: Act }) {
  const [editing, setEditing] = useState(false);
  const labels = REPORT_TILES.filter((t) => r.tiles.includes(t.id)).map((t) => t.label);
  return (
    <Section
      title={r.name}
      note={
        <span className="flex flex-wrap items-center gap-2">
          <Tag tone={r.on ? "green" : "neutral"}>{r.on ? "On" : "Off"}</Tag>
          <span>
            {EVERY_NAMES[r.every]}
            {r.nextAt ? `. Next ${at(r.nextAt, r.zone)}` : ""}
          </span>
        </span>
      }
      actions={
        editing ? null : (
          <span className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              tone="quiet"
              disabled={act.busy}
              onClick={() => void act.run("reportRun", { id: r.id })}
            >
              Run now
            </Button>
            <Button size="sm" tone="quiet" onClick={() => setEditing(true)}>
              Change
            </Button>
            <Button
              size="sm"
              tone="quiet"
              disabled={act.busy}
              onClick={() => {
                if (window.confirm(`Delete ${r.name} and its past runs?`))
                  void act.run("reportDelete", { id: r.id });
              }}
            >
              Delete
            </Button>
          </span>
        )
      }
    >
      {editing ? (
        <ReportForm view={view} report={r} act={act} done={() => setEditing(false)} />
      ) : (
        <div className="grid gap-4">
          <p className={QUIET}>
            {labels.join(", ")}. To {r.recipients.length ? r.recipients.join(", ") : "nobody yet"}.
          </p>
          {r.sends.length ? (
            <ul className="m-0 grid list-none gap-3 p-0">
              {r.sends.map((s) => (
                <SendRow key={s.id} s={s} zone={r.zone} />
              ))}
            </ul>
          ) : (
            <Empty>No runs yet. Run now shows this period so far.</Empty>
          )}
        </div>
      )}
    </Section>
  );
}

export function ReportsPage(props: PageProps) {
  const [nonce, setNonce] = useState(0);
  const wren = props.client === WREN.id;
  const load = useCall(`reports:${props.client}:${nonce}`, () =>
    wren ? Promise.resolve(null) : call<View>("marketing/reports", { client: props.client }),
  );
  const act = useReportAct(props.client, () => setNonce((n) => n + 1));
  const [adding, setAdding] = useState(false);
  const data = load.data;
  return (
    <>
      <PageHeader
        title="Reports"
        lede="Your numbers by mail every Monday or on the 1st, each against the period before. Every run stays here."
      />
      {wren ? (
        <Empty>Reports are per client. Open a client to see theirs.</Empty>
      ) : load.error && !data ? (
        <LoadFailed error={load.error} onRetry={load.retry} />
      ) : !data ? (
        <Loading lines={6} />
      ) : (
        <>
          {!data.mail ? (
            <Callout tone="warn">
              Report mail isn't switched on yet. Each run is kept here until it is.
            </Callout>
          ) : null}
          {act.error ? <p className={ERROR}>{act.error}</p> : null}
          {data.reports.map((r) => (
            <ReportSection key={r.id} r={r} view={data} act={act} />
          ))}
          {props.demo ? null : adding || !data.reports.length ? (
            <Section title="New report" note="Runs at 9:00 on its day, for the period before.">
              <ReportForm view={data} act={act} done={() => setAdding(false)} />
            </Section>
          ) : (
            <div>
              <Button size="dense" onClick={() => setAdding(true)}>
                New report
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
