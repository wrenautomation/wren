/**
 * People → Channels (designs/2026-10-15-channel-stats.md): each channel's funnel side by side.
 * People reached, then how many saw, engaged, replied, booked and paid. Filter by a segment,
 * break it down by source or by any trait, and pick who gets credit for a booking. Each number
 * opens its people, and those people can be saved as a segment. The filters live in the address.
 */
import type { ChannelStats, StatsRow, StepPerson } from "@wren/core/channel-stats";
import {
  FUNNEL_STEP_NAMES,
  FUNNEL_STEPS,
  type FunnelStep,
  STAT_CHANNEL_NAMES,
  STAT_CHANNELS,
} from "@wren/core/channel-stats-schema";
import type { Rule } from "@wren/core/segments";
import { Button, LoadFailed, Loading, PageHeader, Section } from "@wren/ui";
import { useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { HandPage, PageProps } from "../../module.js";
import { go, href } from "../../route.js";
import { ERROR, QUIET, SELECT } from "../work/bits.js";
import { atOf, SegmentEditor } from "./segments.js";

const PATH = "/people/channels";
const DAYS: Record<string, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  "365": "Last year",
  "": "All time",
};
const CREDIT: Record<string, string> = {
  any: "Any channel that reached them",
  first: "The first channel that reached them",
  last: "The last channel before they booked",
};

interface Context {
  traits: string[];
  segments: { id: number; name: string }[];
}

function Pick({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Readonly<Record<string, string>>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[13px] text-(--ui-ink-2) max-sm:basis-full">
      {label}
      <select
        className={`${SELECT} min-w-0 max-sm:w-full`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}

const pct = (v: number | null) =>
  v === null ? "" : v > 0 && v < 0.01 ? "<1%" : `${Math.round(v * 100)}%`;
const usd = (v: number | null) => (v === null ? "—" : `$${v.toFixed(2)}`);

/** A row and step as a live segment's rule: who that number lists, kept up to date. */
function stepRule(row: StatsRow, step: FunnelStep, days: number | null): Rule {
  return {
    kind: "group",
    match: "all",
    of: [
      {
        kind: "step",
        step,
        ...(row.channel ? { channel: row.channel } : {}),
        ...(row.source ? { source: row.source } : {}),
        days,
      },
    ],
  };
}

export function Channels(props: PageProps) {
  const p = props.params;
  const at = atOf(props.client);
  const by = p.get("by") || "channel";
  const channel = p.get("channel") || "";
  const days = p.get("days") ?? "30";
  const segment = p.get("segment") || "";
  const credit = p.get("credit") || "any";
  const set = (k: string, v: string) => go(PATH, { [k]: v }, p);
  const ask = {
    ...at,
    by,
    ...(channel ? { channel } : {}),
    ...(days ? { days: Number(days) } : {}),
    ...(segment ? { segment: Number(segment) } : {}),
    attribution: credit,
  };
  const ctx = useCall(`people-segment-context:${props.client}`, () =>
    call<Context>("people/segmentContext", at),
  );
  const got = useCall(`people-channels:${props.client}:${JSON.stringify(ask)}`, () =>
    call<ChannelStats>("people/channelStats", ask),
  );
  const [open, setOpen] = useState<{ row: StatsRow; step: FunnelStep } | null>(null);

  const bys: Record<string, string> = {
    channel: "Channel",
    source: "Campaign, post or link",
    ...Object.fromEntries((ctx.data?.traits ?? []).map((t) => [`trait:${t}`, `Trait: ${t}`])),
  };
  const segments: Record<string, string> = {
    "": "Everyone",
    ...Object.fromEntries((ctx.data?.segments ?? []).map((s) => [String(s.id), s.name])),
  };
  const channels: Record<string, string> = {
    "": "Every channel",
    ...Object.fromEntries(STAT_CHANNELS.map((c) => [c, STAT_CHANNEL_NAMES[c]])),
  };

  return (
    <>
      <PageHeader
        title="Channels"
        lede="Who each channel reached, and how far they got. A dash means the channel can't show that step."
      />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Pick label="Rows" value={by} options={bys} onChange={(v) => set("by", v)} />
        <Pick
          label="Channel"
          value={channel}
          options={channels}
          onChange={(v) => set("channel", v)}
        />
        <Pick label="First reached" value={days} options={DAYS} onChange={(v) => set("days", v)} />
        <Pick
          label="People"
          value={segment}
          options={segments}
          onChange={(v) => set("segment", v)}
        />
        <Pick
          label="A booking counts for"
          value={credit}
          options={CREDIT}
          onChange={(v) => set("credit", v)}
        />
      </div>
      {got.error && !got.data ? (
        <LoadFailed error={got.error} onRetry={got.retry} />
      ) : !got.data ? (
        <Loading lines={6} />
      ) : (
        <Section plain>
          <Table
            stats={got.data}
            by={by}
            onDrill={(row) => go(PATH, { by: "source", channel: row.key }, p)}
            onOpen={(row, step) => setOpen({ row, step })}
          />
        </Section>
      )}
      {open ? (
        <People
          client={props.client}
          demo={props.demo}
          ask={ask}
          row={open.row}
          step={open.step}
          days={days ? Number(days) : null}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

function Table({
  stats,
  by,
  onDrill,
  onOpen,
}: {
  stats: ChannelStats;
  by: string;
  onDrill: (row: StatsRow) => void;
  onOpen: (row: StatsRow, step: FunnelStep) => void;
}) {
  if (!stats.rows.length)
    return (
      <p className={`m-0 text-[14px] ${QUIET}`}>
        Nobody was reached in this window. Rows show once we reach someone by message, DM, comment
        or form.
      </p>
    );
  const views = stats.rows.some((r) => r.views !== null || r.visits !== null);
  const TH = "py-1.5 pr-3 text-right font-normal";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13.5px]">
        <thead className={QUIET}>
          <tr className="border-b border-(--ui-hair)">
            <th className="py-1.5 pr-3 font-normal">
              {by === "channel" ? "Channel" : by === "source" ? "Source" : by.slice(6)}
            </th>
            {FUNNEL_STEPS.map((s) => (
              <th key={s} className={TH}>
                {FUNNEL_STEP_NAMES[s]}
              </th>
            ))}
            <th className={TH}>Sends</th>
            <th className={TH}>Cost</th>
            {views ? (
              <>
                <th className={TH}>Views</th>
                <th className={TH}>Visits</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {stats.rows.map((r) => (
            <tr key={r.key} className="border-b border-(--ui-hair) align-top">
              <td className="py-1.5 pr-3">
                {by === "channel" ? (
                  <button
                    type="button"
                    className="text-left underline decoration-(--ui-hair) underline-offset-2 hover:decoration-current"
                    title="By campaign, post or link"
                    onClick={() => onDrill(r)}
                  >
                    {r.label}
                  </button>
                ) : (
                  <span className="break-words">{r.label}</span>
                )}
                {by === "source" && r.channel ? (
                  <span className={`block text-[12.5px] ${QUIET}`}>
                    {STAT_CHANNEL_NAMES[r.channel as keyof typeof STAT_CHANNEL_NAMES] ?? r.channel}
                    {r.sourceKind ? `, ${r.sourceKind}` : ""}
                  </span>
                ) : null}
              </td>
              {FUNNEL_STEPS.map((s) => {
                const n = r.people[s];
                return (
                  <td key={s} className="py-1.5 pr-3 text-right tabular-nums">
                    {n === null ? (
                      <span className={QUIET}>—</span>
                    ) : n === 0 ? (
                      "0"
                    ) : (
                      <button
                        type="button"
                        className="tabular-nums underline decoration-(--ui-hair) underline-offset-2 hover:decoration-current"
                        title={`See the ${n.toLocaleString()} ${n === 1 ? "person" : "people"}`}
                        onClick={() => onOpen(r, s)}
                      >
                        {n.toLocaleString()}
                      </button>
                    )}
                    {s !== "reached" && n ? (
                      <span className={`block text-[12px] ${QUIET}`}>{pct(r.rates[s])}</span>
                    ) : null}
                  </td>
                );
              })}
              <td className="py-1.5 pr-3 text-right tabular-nums">{r.sends.toLocaleString()}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{usd(r.costUsd)}</td>
              {views ? (
                <>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {r.views?.toLocaleString() ?? "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {r.visits?.toLocaleString() ?? "—"}
                  </td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`mt-3 text-[13px] ${QUIET}`}>
        Each row counts people first reached there in the window, then what they did after. Views
        and visits aren't tied to a person, so they're not in the funnel.
      </p>
    </div>
  );
}

/** The people behind one number, and Save as segment. */
function People({
  client,
  demo,
  ask,
  row,
  step,
  days,
  onClose,
}: {
  client: string;
  demo: boolean;
  ask: Record<string, unknown>;
  row: StatsRow;
  step: FunnelStep;
  days: number | null;
  onClose: () => void;
}) {
  const key = `people-channel-people:${client}:${JSON.stringify(ask)}:${row.key}:${step}`;
  const got = useCall(key, () =>
    call<{ people: StepPerson[] }>("people/channelPeople", { ...ask, key: row.key, step }),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const title = `${row.label}: ${FUNNEL_STEP_NAMES[step].toLowerCase()}`;
  return (
    <Section
      title={title}
      count={got.data?.people.length}
      actions={
        <div className="flex flex-wrap gap-2">
          {!demo && !saving ? (
            <Button size="dense" tone="quiet" onClick={() => setSaving(true)}>
              Save as segment
            </Button>
          ) : null}
          <Button size="dense" tone="quiet" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {saving ? (
        <div className="mb-4">
          <SegmentEditor
            client={client}
            start={{
              name: title,
              kind: "live",
              rule: stepRule(row, step, days),
              words: null,
            }}
            onDone={(ok) => {
              setSaving(false);
              setSaved(ok);
            }}
          />
        </div>
      ) : null}
      {saved ? (
        <p className="m-0 mb-3 text-[14px]" role="status">
          Saved. It's in Segments now.
        </p>
      ) : null}
      {got.error && !got.data ? (
        <p className={`m-0 ${ERROR}`} role="alert">
          {got.error.message}
        </p>
      ) : !got.data ? (
        <Loading lines={3} />
      ) : (
        <ul className="m-0 grid list-none gap-1 p-0 text-[14px]">
          {got.data.people.map((x) => (
            <li key={x.id} className="flex flex-wrap gap-x-3">
              <a href={href(x.link, atOf(client))}>{x.name}</a>
              {x.email ? <span className={QUIET}>{x.email}</span> : null}
              <span className={`tabular-nums ${QUIET}`}>
                {new Date(x.at).toLocaleDateString("en-CA")}
              </span>
            </li>
          ))}
          {got.data.people.length >= 500 ? (
            <li className={QUIET}>The latest 500. Save as segment to see them all.</li>
          ) : null}
        </ul>
      )}
    </Section>
  );
}

export const channelsPage: HandPage = {
  id: "channels",
  label: "Channels",
  about: "Each channel's funnel side by side, from reached to paid.",
  Page: Channels,
  wide: true,
};
