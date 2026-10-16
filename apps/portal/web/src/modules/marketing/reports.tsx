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
  CheckField,
  ChecksField,
  cx,
  Empty,
  LoadFailed,
  Loading,
  PageHeader,
  Section,
  SelectField,
  Tag,
  TextField,
  useEditForm,
} from "@wren/ui";
import { useState } from "react";
import { ApiError, call } from "../../api.js";
import { zones } from "../../book-path.js";
import { useCall } from "../../load.js";
import { type PageProps, WREN } from "../../module.js";
import { ERROR, Kept, NARROW, QUIET } from "../work/bits.js";

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

/** What a report form holds; a saved report is its starting point. */
type ReportValues = {
  name: string;
  tiles: string[];
  every: string;
  zone: string;
  recipients: string[];
  on: boolean;
};

function ReportForm({
  client,
  view,
  report,
  act,
  done,
}: {
  client: string;
  view: View;
  report?: Report;
  act: Act;
  done: () => void;
}) {
  const form = useEditForm<ReportValues>({
    key: `report:${client}:${report?.id ?? "new"}`,
    defaults: {
      name: report?.name ?? "",
      tiles: report?.tiles ?? REPORT_TILES.map((t) => t.id),
      every: report?.every ?? "week",
      zone: report?.zone ?? view.zone,
      recipients: report?.recipients ?? [],
      on: report?.on ?? true,
    },
  });
  const submit = form.onSend(
    async (v) => {
      const ok = await act.run("reportSave", {
        id: report?.id ?? null,
        name: v.name,
        // Only the boxes drawn count, as when the form read them off the page.
        tiles: v.tiles.filter((id) => REPORT_TILES.some((t) => t.id === id)),
        every: v.every,
        zone: v.zone,
        recipients: v.recipients.filter((e) => view.members.some((m) => m.email === e)),
        on: v.on,
      });
      if (ok) done();
      return ok;
    },
    { clear: !report },
  );
  const label = report ? `Change ${report.name}` : "New report";
  return (
    <form className="grid gap-4" aria-label={label} onSubmit={(e) => void submit(e)}>
      <Kept form={form} />
      <div className="flex flex-wrap gap-3">
        <TextField
          form={form}
          name="name"
          label="Name"
          className={`${NARROW} grow basis-[260px]`}
          required
          maxLength={120}
          placeholder="Weekly numbers"
        />
        <SelectField
          form={form}
          name="every"
          label="When"
          className={NARROW}
          options={Object.entries(EVERY_NAMES)}
        />
        <SelectField
          form={form}
          name="zone"
          label="At 9:00 in"
          className={NARROW}
          options={zones(form.watch("zone")).map((z) => [z, z.replaceAll("_", " ")] as const)}
        />
      </div>
      <ChecksField
        form={form}
        name="tiles"
        label="Numbers"
        className="sm:grid-cols-2"
        options={REPORT_TILES.map((t) => [t.id, t.label] as const)}
      />
      <div className="grid gap-1.5">
        <ChecksField
          form={form}
          name="recipients"
          label={
            <>
              Who gets it <span className={QUIET}>({MAX_RECIPIENTS} at most)</span>
            </>
          }
          options={view.members.map(
            (m) =>
              [
                m.email,
                <span key={m.email} className="break-all">
                  {m.email} <span className={QUIET}>{m.role}</span>
                </span>,
              ] as const,
          )}
        />
        {view.members.length ? null : (
          <p className={QUIET}>
            Nobody in this workspace yet. Invite people under Account → People.
          </p>
        )}
        <p className={cx("text-[12.5px]", QUIET)}>
          Each person gets the numbers their access lets them see.
        </p>
      </div>
      <CheckField form={form} name="on" label="On" />
      <div className="flex flex-wrap items-center gap-2">
        <Button tone="primary" type="submit" size="dense" busy={act.busy}>
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

function ReportSection({
  client,
  r,
  view,
  act,
}: {
  client: string;
  r: Report;
  view: View;
  act: Act;
}) {
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
        <ReportForm
          client={client}
          view={view}
          report={r}
          act={act}
          done={() => setEditing(false)}
        />
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
  const wren = props.client === WREN.id;
  // One key for every read: a reload replaces the kept answer, never adds a new one.
  const load = useCall(`reports:${props.client}`, () =>
    wren ? Promise.resolve(null) : call<View>("marketing/reports", { client: props.client }),
  );
  const act = useReportAct(props.client, load.retry);
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
            <ReportSection key={r.id} client={props.client} r={r} view={data} act={act} />
          ))}
          {props.demo ? null : adding || !data.reports.length ? (
            <Section title="New report" note="Runs at 9:00 on its day, for the period before.">
              <ReportForm
                client={props.client}
                view={data}
                act={act}
                done={() => setAdding(false)}
              />
            </Section>
          ) : (
            <div>
              <Button tone="primary" size="dense" onClick={() => setAdding(true)}>
                New report
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
