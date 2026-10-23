/**
 * Clients → Health and Flags (designs/2026-10-07-health.md): each client's score with its four
 * parts, the rows behind each, its days, and the override beside the model's; one list of flags.
 * Wren's home carries the clients at risk and the urgent flags.
 */
import type { State } from "@wren/core/records";
import type { RecordsPage, Row } from "@wren/core/records/serve";
import { type Action, dateOf, FactsTable, relative, Section, StateMark } from "@wren/ui";
import type { ReactNode } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { QUIET } from "../work/bits.js";
import { RowsPanel } from "../work/rows-panel.js";

const said = (line: string) => () => line;
const SIDES = ["risk", "opportunity"] as const;
const SIDE_LABELS = { risk: "Risk", opportunity: "Opportunity" };

/** On a client's health: rate it, set or clear a score by hand, raise a flag about it. */
export const HEALTH_ACTIONS: Action[] = [
  {
    id: "health.rate",
    label: "Rate",
    handler: "health/rate",
    each: true,
    form: [
      {
        field: "score",
        label: "How it's going, 1 to 5",
        type: "select",
        options: ["1", "2", "3", "4", "5"],
        labels: { "1": "1, about to leave", "3": "3, fine", "5": "5, thrilled" },
      },
      { field: "note", label: "Why", optional: true },
    ],
    done: said("Rated"),
  },
  {
    id: "health.override",
    label: "Set by hand",
    handler: "health/override",
    each: true,
    form: [
      { field: "score", label: "Score, 0 to 100", type: "number" },
      { field: "reason", label: "Why", hint: "Shown beside the model's score until cleared." },
    ],
    done: said("Set"),
  },
  {
    id: "health.clearOverride",
    label: "Back to the model",
    handler: "health/clearOverride",
    when: { hand: ["yes"] },
    confirm: "Clear the score set by hand? The model's score shows again.",
    done: said("Cleared"),
  },
  {
    id: "health.flagRaise",
    label: "Raise a flag",
    handler: "health/flagRaise",
    each: true,
    form: [
      { field: "side", label: "Kind", type: "select", options: SIDES, labels: SIDE_LABELS },
      { field: "what", label: "What's going on" },
      { field: "owner", label: "Owner", optional: true, hint: "Their email. Blank is the team's." },
    ],
    done: said("Raised"),
  },
];

/** On the flags list: raise one, take or assign it, mark it addressed, clear it. */
export const CLIENT_FLAG_ACTIONS: Action[] = [
  {
    id: "health.flagRaise",
    label: "Raise a flag",
    handler: "health/flagRaise",
    form: [
      { field: "clientId", label: "Client id" },
      { field: "side", label: "Kind", type: "select", options: SIDES, labels: SIDE_LABELS },
      { field: "what", label: "What's going on" },
      { field: "owner", label: "Owner", optional: true, hint: "Their email. Blank is the team's." },
    ],
    done: said("Raised"),
  },
  {
    id: "health.flagTake",
    label: "Take it",
    handler: "health/flagTake",
    bulk: true,
    when: { state: ["open", "addressed"] },
    done: said("Yours"),
  },
  {
    id: "health.flagOwn",
    label: "Assign",
    handler: "health/flagOwn",
    each: true,
    when: { state: ["open", "addressed"] },
    form: [
      { field: "owner", label: "Owner", optional: true, hint: "Their email. Blank is the team's." },
    ],
    done: said("Assigned"),
  },
  {
    id: "health.flagAddress",
    label: "Addressed",
    handler: "health/flagAddress",
    each: true,
    when: { state: ["open"] },
    form: [{ field: "note", label: "What was done", optional: true }],
    done: said("Marked addressed"),
  },
  {
    id: "health.flagClear",
    label: "Clear",
    handler: "health/flagClear",
    bulk: true,
    when: { state: ["open", "addressed"] },
    confirm: "Clear it? It's kept with who cleared it.",
    done: said("Cleared"),
  },
];

const BAND: Record<string, State> = {
  risk: { label: "At risk", tone: "bad" },
  watch: { label: "Watch", tone: "warn" },
  healthy: { label: "Healthy", tone: "good" },
  none: { label: "No data", tone: "neutral" },
};
const PARTS = ["results", "engagement", "sentiment", "money"] as const;
const PART_LABEL = {
  results: "Results",
  engagement: "Engagement",
  sentiment: "Sentiment",
  money: "Money",
};
const enc = encodeURIComponent;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const numOf = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/** "Results 40% · Engagement 20%" → { results: 40, engagement: 20 }. */
export function weightsOf(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of text.matchAll(/([A-Za-z]+) (\d+)%/g))
    out[String(m[1]).toLowerCase()] = Number(m[2]);
  return out;
}

const when = (v: unknown) => {
  const d = dateOf(str(v));
  return d ? relative(d) : "";
};

function Bar({ value }: { value: number | null }) {
  return (
    <span aria-hidden className="block h-1 w-full overflow-hidden bg-(--ui-fill)">
      <span
        className="block h-full bg-(--ui-ink-2)"
        style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
      />
    </span>
  );
}

/** A client's last 90 days of shown score, a line with the risk and healthy cuts marked. */
function Trend({ client }: { client: string }) {
  const got = useCall(`health-days:${client}`, () =>
    call<RecordsPage>("console/recordsList", {
      record: "console.health_day",
      view: "all",
      where: { client },
      limit: 90,
    }),
  );
  const days = [...(got.data?.rows ?? [])].reverse();
  if (days.length < 2) return null;
  const W = 320;
  const H = 56;
  const x = (i: number) => (i / (days.length - 1)) * W;
  const y = (s: number) => H - (s / 100) * H;
  const points = days.map((d, i) => `${x(i).toFixed(1)},${y(Number(d.score ?? 0)).toFixed(1)}`);
  const first = days[0] as Row;
  const last = days[days.length - 1] as Row;
  return (
    <a
      href={`/clients/days?view=all&client=${enc(client)}`}
      className="grid gap-1 text-[13px] text-(--ui-ink-2) hover:text-(--ui-ink)"
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-14 w-full max-w-[420px] overflow-visible"
        role="img"
        aria-label={`Score from ${str(first.score)} to ${str(last.score)} over ${days.length} days`}
      >
        <line x1="0" x2={W} y1={y(40)} y2={y(40)} stroke="var(--ui-hair)" strokeDasharray="3 3" />
        <line x1="0" x2={W} y1={y(70)} y2={y(70)} stroke="var(--ui-hair)" strokeDasharray="3 3" />
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="var(--ui-ink)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span>
        {days.length} days, {str(first.score)} to {str(last.score)}
      </span>
    </a>
  );
}

const staleOf = (row: Row) =>
  new Set(
    str(row.staleParts)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

/** One part's score: its bar and number, its weight, and stale when it is. */
function PartScore({ row, part }: { row: Row; part: (typeof PARTS)[number] }) {
  const v = numOf(row[part]);
  const w = weightsOf(str(row.weights))[part];
  return (
    <span className="flex items-center gap-3 text-[13.5px]">
      <span className="w-24">
        <Bar value={v} />
      </span>
      <span className="min-w-[3ch] font-medium tabular-nums">{v ?? "–"}</span>
      <span className={QUIET}>{w ? `counts ${w}%` : "not counted"}</span>
      {staleOf(row).has(part) ? <StateMark state={{ label: "Stale", tone: "warn" }} /> : null}
    </span>
  );
}

/** One part's why, a link to the rows behind it. */
const PartWhy = ({ row, part }: { row: Row; part: (typeof PARTS)[number] }) => (
  <a href={`/clients/inputs?view=all&client=${enc(str(row.id))}&part=${part}`}>
    {str(row[`${part}Why`]) || "No input yet."}
  </a>
);

/** One part: its score and bar, its weight, why, stale or not, and a link to its rows. */
function PartLine({ row, part }: { row: Row; part: (typeof PARTS)[number] }) {
  return (
    <span className="grid gap-1.5">
      <PartScore row={row} part={part} />
      <PartWhy row={row} part={part} />
    </span>
  );
}

/** The model's score beside one set by hand, when it was scored, and the trend. */
function Summary({ row }: { row: Row }) {
  const model = numOf(row.model);
  const override = numOf(row.override);
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px]">
        <dt className={QUIET}>Model</dt>
        <dd className="tabular-nums">{model ?? "–"}</dd>
        {override !== null ? (
          <>
            <dt className={QUIET}>Set by hand</dt>
            <dd>
              <span className="tabular-nums">{override}</span>
              {row.reason ? <span className={QUIET}> · {str(row.reason)}</span> : null}
            </dd>
          </>
        ) : null}
        <dt className={QUIET}>Scored</dt>
        <dd>{when(row.updated)}</dd>
      </dl>
      <Trend client={str(row.id)} />
    </div>
  );
}

/**
 * The score as shown with its band, the model's beside a score set by hand, then each part with
 * its weight, why, and a link to the rows behind it. Stale parts say so.
 */
export function HealthCard({ row }: { row: Row }) {
  const score = numOf(row.score);
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div className="grid gap-1">
          <span className="text-[44px]/[1] font-semibold tabular-nums">{score ?? "–"}</span>
          <StateMark state={BAND[str(row.band)] ?? (BAND.none as State)} />
        </div>
        <Summary row={row} />
      </div>
      {/* Four fixed parts with their numbers: facts, so a table, not rows. */}
      <FactsTable
        head={["Part", "Score", "Why"]}
        rows={PARTS.map((p) => [
          <span key={p} className="font-medium">
            {PART_LABEL[p]}
          </span>,
          <PartScore key="score" row={row} part={p} />,
          <PartWhy key="why" row={row} part={p} />,
        ])}
        stack
      />
    </div>
  );
}

/**
 * A client's health detail: the trend leads (the header has the scores); each part is one line named like its
 * fields, so it takes the place of both its score and its why.
 */
export const healthExtras = (_: unknown, { row }: { row: Row }) => ({
  lead: <Trend client={str(row.id)} />,
  facts: PARTS.map((p): [string, ReactNode] => [
    PART_LABEL[p],
    <PartLine key={p} row={row} part={p} />,
  ]),
});

/** A client at risk or an urgent flag, as one row of Wren's home. */
interface NowLine {
  id: string;
  name: string;
  href: string;
  state: State;
  /** A client's score; none on a flag. */
  score: string;
  detail: string;
}

function HealthRows({ rows }: { rows: NowLine[] }) {
  return (
    <RowsPanel<NowLine>
      rows={rows}
      rowKey={(r) => r.id}
      label="Client health"
      noun="row"
      // Home lists it in Today's 440px sheet: the phone's shape, name over why, at any screen.
      narrow
      name={{
        label: "Client or flag",
        icon: "text",
        title: (r) => r.name,
        href: (r) => r.href,
        sub: (r) => {
          const why = [r.score ? `Score ${r.score}` : null, r.detail].filter(Boolean).join(" · ");
          return why ? <span className="text-[12.5px] text-(--ui-ink-3)">{why}</span> : null;
        },
      }}
      columns={[
        {
          key: "state",
          label: "State",
          icon: "selected",
          phone: true,
          cell: (r) => <StateMark state={r.state} />,
        },
      ]}
    />
  );
}

/**
 * Wren's home: clients at risk and urgent open risks, each a link to its page. A failed read or
 * nothing at risk shows no section.
 */
export function HealthNow() {
  const got = useCall("health-now", () =>
    Promise.all([
      call<RecordsPage>("console/recordsList", {
        record: "console.health",
        view: "risk",
        limit: 5,
      }),
      call<RecordsPage>("console/recordsList", {
        record: "console.flag",
        view: "risks",
        where: { urgent: ["yes"] },
        limit: 5,
      }),
    ]),
  );
  const [risk, flags] = got.data ?? [];
  if (!risk?.rows.length && !flags?.rows.length) return null;
  const lines: NowLine[] = [
    ...(risk?.rows ?? []).map(
      (r): NowLine => ({
        id: `h${str(r.id)}`,
        name: str(r.name),
        href: `/clients/health/${enc(str(r.id))}`,
        state: BAND.risk as State,
        score: str(r.score),
        detail: [
          str(r.weakest),
          r.hand === "yes" ? "Set by hand" : null,
          Number(r.risks) ? `${str(r.risks)} open risk${Number(r.risks) === 1 ? "" : "s"}` : null,
          Number(r.stale) ? `Stale: ${str(r.staleParts)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      }),
    ),
    ...(flags?.rows ?? []).map(
      (f): NowLine => ({
        id: `f${str(f.id)}`,
        name: str(f.what),
        href: `/clients/flags/${enc(str(f.id))}`,
        state: { label: "Urgent", tone: "bad" },
        score: "",
        detail: [str(f.name), str(f.owner), when(f.raised)].filter(Boolean).join(" · "),
      }),
    ),
  ];
  return (
    <Section
      title="Client health"
      note="Clients at risk and urgent flags."
      actions={
        <a href="/clients/health?view=risk" className="text-[13px] text-(--ui-ink-2)">
          All
        </a>
      }
    >
      <HealthRows rows={lines} />
    </Section>
  );
}

/** A client's page in Clients → all: its health card, or why there's none yet. */
export function ClientHealth({ client }: { client: string }) {
  const got = useCall(`client-health:${client}`, () =>
    call<{ row: Row | null }>("console/recordsGet", { record: "console.health", id: client }),
  );
  if (!got.data && !got.error) return null;
  const row = got.data?.row;
  if (!row) return <p className={QUIET}>Scored after the first nightly pass.</p>;
  return (
    <div className="grid gap-3">
      <HealthCard row={row} />
      <a href={`/clients/health/${enc(client)}`} className="text-[13.5px] text-(--ui-ink-2)">
        Inputs, flags and every day
      </a>
    </div>
  );
}
