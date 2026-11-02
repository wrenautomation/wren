/**
 * The Map's details for one part (a pick), a card over the canvas. A station: its numbers, the
 * people on it newest first with a link to each journey, the tracks in and out, and the way into
 * the app that manages it. A track: who moves it, its promise, who waits and the crossings. A line:
 * its numbers and its stations. The hub: its leads and a link to People. A station and a line
 * link to their focus page. A campaign: its numbers, fields, CTA ladder, stations and people; an
 * edit to it saves as a draft for review.
 */
import type { BlameLine } from "@wren/pipeline/history";
import type { MetroStation, MetroTrack } from "@wren/pipeline/metro";
import { type Campaign, campaignsOf } from "@wren/pipeline/metro-campaigns";
import { Button, ButtonLink, Facts, Icon, num } from "@wren/ui";
import type { MetroPart } from "@wren/ui/metro";
import { type ReactNode, useState } from "react";
import { href } from "../route.js";
import { BlameList } from "./BlameList.js";
import { CampaignForm } from "./CampaignForm.js";
import { focusHref } from "./focus.js";
import {
  campaignSays,
  DEFAULT_WINDOW,
  lineSays,
  type MapData,
  type Person,
  stationSays,
  type Window,
  windowSays,
} from "./model.js";
import { OVER_RIGHT } from "./overlay.js";
import { opensOf, type PanelRef, type Place } from "./routes.js";
import { waitsOf } from "./tasks.js";

/** The people listed before "and N more". */
const SHOWN = 12;

const STATION_WORD: Record<MetroStation["kind"], string> = {
  att: "Step",
  time: "Wait",
  cash: "Money",
  exit: "Exit",
  hub: "Hub",
  condition: "Decision",
  race: "Race",
  split: "Split",
  join: "Join",
  ab: "A/B test",
  approval: "Approval",
  link: "Link",
  find: "Find",
  read: "Read",
  extract: "Extract",
  call: "Your call",
  measure: "Measure",
};

const TIER_WORD = {
  out: "Source line",
  front: "Front line",
  core: "Core line",
  content: "Content line",
} as const;

const h3 = "mb-1.5 text-[13px] font-semibold text-(--ui-ink-2)";

/** The frame every panel shares: the name, what it is, and Close. */
function Card({
  name,
  kind,
  onClose,
  children,
}: {
  name: string;
  kind: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={`${name}, details`}
      className={`${OVER_RIGHT} text-[14px] text-(--ui-ink)`}
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="wrap-anywhere whitespace-normal text-[17px]/6 font-semibold">{name}</h2>
          <p className="text-[13px] text-(--ui-ink-3)">{kind}</p>
        </div>
        <Button tone="quiet" size="dense" icon="close" onClick={onClose}>
          Close
        </Button>
      </header>
      {children}
    </section>
  );
}

/** A list of lines of text under a heading, with the window said once under it. */
export function Numbers({ lines, window }: { lines: readonly string[]; window: Window }) {
  return (
    <section aria-label="Numbers">
      <ul className="list-none space-y-0.5 text-(--ui-ink-2)">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="mt-1 text-[12.5px] text-(--ui-ink-3)">Numbers {windowSays(window)}.</p>
    </section>
  );
}

/** The people at a station, newest first, each a link to the journey. */
export function PeopleHere({
  people,
  at,
  level = 3,
}: {
  people: readonly Person[];
  /** The workspace as a link's params. */
  at: Record<string, string>;
  /** The heading's level: 3 under a panel's name, 2 under a page's. */
  level?: 2 | 3;
}) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <section aria-label="People here">
      <H className={h3}>People here</H>
      {people.length ? (
        <ul className="list-none">
          {people.slice(0, SHOWN).map((p) => (
            <li key={p.id}>
              <a
                href={href(`/pipelines/journeys/${encodeURIComponent(p.id)}`, at)}
                className="flex min-h-9 items-center gap-2 text-(--ui-ink) no-underline hover:bg-(--ui-hover)"
              >
                <span className="min-w-0 flex-1 wrap-anywhere whitespace-normal">{p.name}</span>
                <span className="text-[12.5px] text-(--ui-ink-3)">
                  {p.daysAtNode < 1 ? "today" : `${num(p.daysAtNode)} d`}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-(--ui-ink-3)">Nobody is here.</p>
      )}
      {people.length > SHOWN ? (
        <p className="mt-1 text-[12.5px] text-(--ui-ink-3)">
          and {num(people.length - SHOWN)} more
        </p>
      ) : null}
    </section>
  );
}

/** The tracks into and out of a station, with the people who crossed each in the window. */
function Tracks({
  data,
  id,
  window,
  onOpen,
}: {
  data: MapData;
  id: string;
  window: Window;
  onOpen: (p: PanelRef) => void;
}) {
  const metro = data.metro;
  if (!metro) return null;
  const nameOf = (n: string) => metro.stations.find((s) => s.id === n)?.label ?? n;
  const rows = (dir: "in" | "out") =>
    metro.tracks
      .filter((t) => (dir === "in" ? t.to === id : t.from === id))
      .map((t) => ({
        id: t.id,
        who: nameOf(dir === "in" ? t.from : t.to),
        n: data.tracks.get(t.id) ?? 0,
        back: t.kind === "back",
      }));
  const lists = { in: rows("in"), out: rows("out") };
  return (
    <section aria-label="Tracks">
      <h3 className={h3}>Crossings {windowSays(window)}</h3>
      {(["in", "out"] as const).map((dir) =>
        lists[dir].length ? (
          <ul key={dir} className="mb-2 list-none space-y-0.5 text-(--ui-ink-2)">
            {lists[dir].map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  aria-label={`Track ${dir === "in" ? "from" : "to"} ${r.who}`}
                  onClick={() => onOpen({ kind: "track", id: r.id })}
                  className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-(--ui-ink-2) hover:bg-(--ui-hover)"
                >
                  <Icon name={dir === "in" ? "left" : "right"} size={14} />
                  <span className="min-w-0 flex-1 wrap-anywhere whitespace-normal">
                    {dir === "in" ? "from" : "to"} {r.who}
                    {r.back ? " (back)" : ""}
                  </span>
                  <span className="[font-variant-numeric:tabular-nums]">{num(r.n)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null,
      )}
      {lists.in.length + lists.out.length === 0 ? (
        <p className="text-(--ui-ink-3)">No tracks.</p>
      ) : null}
    </section>
  );
}

/** A button that opens the panel of the line a part sits on. */
function LineChip({
  data,
  line,
  onOpen,
}: {
  data: MapData;
  line: string | undefined;
  onOpen: (p: PanelRef) => void;
}) {
  const l = data.metro?.lines.find((x) => x.id === line);
  if (!l) return null;
  return (
    <div>
      <Button
        tone="quiet"
        size="dense"
        aria-label={`Line ${l.label}`}
        onClick={() => onOpen({ kind: "line", id: l.id })}
      >
        <Icon name="workflow" size={14} /> {l.label}
      </Button>
    </div>
  );
}

interface PartProps {
  data: MapData;
  window: Window;
  place: Place;
  /** The client's id, or null in Wren's own workspace. */
  client: string | null;
  /** The workspace as a link's params. */
  at: Record<string, string>;
  /** The time the late mark counts from. */
  now: Date;
  /** Another part's panel was asked for (a track, a line). */
  onOpen: (p: PanelRef) => void;
  /** A line of the part's history was picked: History opens on its version. */
  onHistory: (line: BlameLine) => void;
  onClose: () => void;
  /** The viewer may change the shape: a campaign shows Edit. */
  canEdit?: boolean | undefined;
  /** A draft was made from the panel: open it for review. */
  onOpenDraft?: ((id: string) => void) | undefined;
}

function HubPanel({ data, client, window, onClose }: PartProps) {
  const hub = data.metro?.stations.find((s) => s.kind === "hub");
  const leads = data.stations.get(hub?.id ?? "hub");
  return (
    <Card name={hub?.label ?? "Hub"} kind="Where leads start" onClose={onClose}>
      <Numbers lines={stationSays("hub", leads)} window={window} />
      <footer className="flex flex-wrap items-center gap-2">
        <ButtonLink href={href("/people/people", { client })} tone="primary" size="dense">
          Open People
        </ButtonLink>
      </footer>
    </Card>
  );
}

function StationPanel(p: PartProps & { id: string }) {
  const { data, id, place, client, at, window } = p;
  const station = data.metro?.stations.find((s) => s.id === id);
  const ghost = data.ghosts.find((g) => g.id === id);
  if (!station && !ghost) return null;
  // The graph node an id carries over to: where the app that manages it is found.
  const node = data.body.nodes.find((n) => n.id === id);
  const people = station ? data.people.filter((x) => x.node === id) : (ghost?.people ?? []);
  const [main, ...more] = node ? opensOf(node, place, client) : [];
  const word = station
    ? station.planned
      ? "Planned"
      : station.deal
        ? "Offer"
        : STATION_WORD[station.kind]
    : "Dropped from the newest version";
  const onSource = station
    ? data.metro?.lines.find((l) => l.id === station.line)?.tier === "out"
    : false;
  return (
    <Card name={station?.label ?? ghost?.name ?? id} kind={word} onClose={p.onClose}>
      <LineChip data={data} line={station?.line} onOpen={p.onOpen} />
      <Numbers lines={stationSays(station?.kind ?? "att", data.stations.get(id))} window={window} />
      {onSource ? null : <PeopleHere people={people} at={at} />}
      {station ? <Tracks data={data} id={id} window={window} onOpen={p.onOpen} /> : null}
      {station ? (
        <BlameList at={at} ask={{ station: id }} label="Station history" onOpen={p.onHistory} />
      ) : null}
      {main || station ? (
        <footer className="flex flex-wrap items-center gap-2">
          {main ? (
            <ButtonLink href={main.href} tone="primary" size="dense">
              Open
            </ButtonLink>
          ) : null}
          {more.map((o) => (
            <ButtonLink key={o.href} href={o.href} tone="quiet" size="dense">
              {o.label}
            </ButtonLink>
          ))}
          {station ? <FocusLink part={{ kind: "station", id }} at={at} window={window} /> : null}
          {main ? <span className="text-[12.5px] text-(--ui-ink-3)">in {main.label}</span> : null}
        </footer>
      ) : null}
    </Card>
  );
}

function TrackPanel(p: PartProps & { id: string }) {
  const { data, id, at, window, now } = p;
  const metro = data.metro;
  const t: MetroTrack | undefined = metro?.tracks.find((x) => x.id === id);
  if (!metro || !t) return null;
  const nameOf = (n: string) => metro.stations.find((s) => s.id === n)?.label ?? n;
  const waits = t.by === "person" ? waitsOf(t, data.people, now) : null;
  const facts = [
    t.by === "person" ? `Moved by ${t.owner ?? "a person"}` : "Moved by the system",
    t.promise ? `Promise ${t.promise}` : "",
    t.cond ?? t.label ?? "",
  ].filter(Boolean);
  return (
    <Card name={`${nameOf(t.from)} to ${nameOf(t.to)}`} kind="Track" onClose={p.onClose}>
      <LineChip data={data} line={t.line} onOpen={p.onOpen} />
      <ul className="list-none space-y-0.5 text-(--ui-ink-2)">
        {facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
        {waits ? (
          <li>
            {num(waits.waiting)} waiting at {nameOf(t.from)}
            {waits.medianHours != null ? `, median ${num(Math.round(waits.medianHours))} h` : ""}
            {waits.late ? ". Late." : ""}
          </li>
        ) : null}
      </ul>
      <Numbers lines={[`Crossed: ${num(data.tracks.get(id) ?? 0)}`]} window={window} />
      <BlameList at={at} ask={{ track: id }} label="Track history" onOpen={p.onHistory} />
    </Card>
  );
}

function LinePanel(p: PartProps & { id: string }) {
  const { data, id, at, window } = p;
  const metro = data.metro;
  const line = metro?.lines.find((l) => l.id === id);
  if (!metro || !line) return null;
  const stations = metro.stations.filter((s) => s.line === id);
  return (
    <Card name={line.label} kind={TIER_WORD[line.tier]} onClose={p.onClose}>
      <Numbers lines={lineSays(data.lines.get(id))} window={window} />
      <section aria-label="Stations">
        <h3 className={h3}>Stations</h3>
        {stations.length ? (
          <ul className="list-none">
            {stations.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  aria-label={`Station ${s.label}`}
                  onClick={() => p.onOpen({ kind: "station", id: s.id })}
                  className="flex min-h-9 w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-(--ui-ink) hover:bg-(--ui-hover)"
                >
                  <span className="min-w-0 flex-1 wrap-anywhere whitespace-normal">{s.label}</span>
                  <span className="text-[12.5px] text-(--ui-ink-3)">{STATION_WORD[s.kind]}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-(--ui-ink-3)">No stations.</p>
        )}
      </section>
      <BlameList at={at} ask={{ line: id }} label="Line history" onOpen={p.onHistory} />
      <footer>
        <FocusLink part={{ kind: "line", id }} at={at} window={window} />
      </footer>
    </Card>
  );
}

const STATUS_WORD = { live: "Live", paused: "Paused", ended: "Ended" } as const;

/** Buttons that open parts, one per line, under a heading. */
function Opens({
  label,
  rows,
  empty,
}: {
  label: string;
  rows: { key: string; name: string; aside?: string | undefined; open: () => void }[];
  empty: string;
}) {
  return (
    <section aria-label={label}>
      <h3 className={h3}>{label}</h3>
      {rows.length ? (
        <ul className="list-none">
          {rows.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                aria-label={`${label}: ${r.name}`}
                onClick={r.open}
                className="flex min-h-9 w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-(--ui-ink) hover:bg-(--ui-hover)"
              >
                <span className="min-w-0 flex-1 wrap-anywhere whitespace-normal">{r.name}</span>
                {r.aside ? (
                  <span className="text-[12.5px] text-(--ui-ink-3)">{r.aside}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-(--ui-ink-3)">{empty}</p>
      )}
    </section>
  );
}

/** A campaign's facts; a value its group does not set says where it comes from. */
function campaignFacts(c: Campaign, all: readonly Campaign[], lineOf: (id: string) => string) {
  const up = all.find((x) => x.id === c.parent)?.label;
  const from = (own: boolean, v: string) => (own || !up ? v : `${v}, from ${up}`);
  const o = c.own;
  const rows: [string, string][] = [
    ["Status", from(!!o.status, STATUS_WORD[c.status])],
    ...(c.from || c.until
      ? [
          [
            "Dates",
            from(!!(o.from || o.until), `${c.from ?? "any day"} to ${c.until ?? "no end"}`),
          ] as [string, string],
        ]
      : []),
    ...(c.offer ? [["Offer", from(!!o.offer, c.offer)] as [string, string]] : []),
    ...(c.audience?.segment
      ? [["Segment", from(!!o.audience?.segment, c.audience.segment)] as [string, string]]
      : []),
    ...(c.audience?.lines?.length
      ? [
          ["Source lines", from(!!o.audience?.lines, c.audience.lines.map(lineOf).join(", "))] as [
            string,
            string,
          ],
        ]
      : []),
    ...Object.entries(c.accounts).map(
      ([ch, a]) => [`Account, ${ch}`, from(!!o.accounts?.[ch], a)] as [string, string],
    ),
    ...Object.entries(c.caps).map(
      ([k, n]) => [`Cap, ${k}`, from(o.caps?.[k] != null, `${num(n)} a day`)] as [string, string],
    ),
  ];
  return rows;
}

function CampaignPanel(p: PartProps & { id: string }) {
  const { data, id, at, window } = p;
  const [editing, setEditing] = useState(false);
  const metro = data.metro;
  const all = metro ? campaignsOf(metro) : [];
  const c = all.find((x) => x.id === id);
  if (!metro || !c) return null;
  const nameOf = (s: string) => metro.stations.find((x) => x.id === s)?.label ?? s;
  const lineOf = (l: string) => metro.lines.find((x) => x.id === l)?.label ?? l;
  // Its own stations and those of the campaigns inside it.
  const inside = new Set([id]);
  for (const x of all) if (x.parent && inside.has(x.parent)) inside.add(x.id);
  const stations = new Set(all.filter((x) => inside.has(x.id)).flatMap((x) => x.stations));
  const children = all.filter((x) => x.parent === id);
  return (
    <Card name={c.label} kind={`Campaign · ${STATUS_WORD[c.status]}`} onClose={p.onClose}>
      <Numbers lines={campaignSays(data.campaigns.get(id))} window={window} />
      {editing && p.onOpenDraft ? (
        <CampaignForm
          metro={metro}
          campaign={c}
          at={at}
          onDraft={(d) => {
            setEditing(false);
            p.onOpenDraft?.(d);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <Facts items={campaignFacts(c, all, lineOf)} />
      )}
      <Opens
        label="CTA ladder"
        empty="No CTAs."
        rows={c.ctas.map((x, i) => ({
          key: `${i}:${x.station}`,
          name: x.label,
          aside: nameOf(x.station),
          open: () => p.onOpen({ kind: "station", id: x.station }),
        }))}
      />
      {children.length ? (
        <Opens
          label="Campaigns inside"
          empty=""
          rows={children.map((x) => ({
            key: x.id,
            name: x.label,
            aside: STATUS_WORD[x.status],
            open: () => p.onOpen({ kind: "campaign", id: x.id }),
          }))}
        />
      ) : null}
      <Opens
        label="Stations"
        empty="No stations."
        rows={metro.stations
          .filter((s) => stations.has(s.id))
          .map((s) => ({
            key: s.id,
            name: s.label,
            aside: STATION_WORD[s.kind],
            open: () => p.onOpen({ kind: "station", id: s.id }),
          }))}
      />
      <PeopleHere people={data.people.filter((x) => stations.has(x.node))} at={at} />
      <BlameList at={at} ask={{ group: id }} label="Campaign history" onOpen={p.onHistory} />
      {p.canEdit && p.onOpenDraft && !editing ? (
        <footer className="flex flex-wrap items-center gap-2">
          <Button tone="primary" size="dense" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <span className="text-[12.5px] text-(--ui-ink-3)">Saves as a draft for review.</span>
        </footer>
      ) : null}
    </Card>
  );
}

/** "Focus": the part's own page (`/map/<kind>/<id>`), in the same workspace and window. */
function FocusLink({
  part,
  at,
  window,
}: {
  part: MetroPart;
  at: Record<string, string>;
  window: Window;
}) {
  const keep = new URLSearchParams({ ...at, ...(window === DEFAULT_WINDOW ? {} : { window }) });
  return (
    <ButtonLink href={focusHref(part, keep)} tone="quiet" size="dense">
      Focus
    </ButtonLink>
  );
}

/** The panel of the picked part. Nothing for a part the shape does not hold. */
export function NodePanel({ part, ...p }: PartProps & { part: PanelRef }) {
  if (part.kind === "line") return <LinePanel {...p} id={part.id} />;
  if (part.kind === "track") return <TrackPanel {...p} id={part.id} />;
  if (part.kind === "campaign") return <CampaignPanel key={part.id} {...p} id={part.id} />;
  const hub = p.data.metro?.stations.find((s) => s.id === part.id)?.kind === "hub";
  return hub ? <HubPanel {...p} /> : <StationPanel {...p} id={part.id} />;
}

/** Whether the shape holds the part: a station or ghost, a track, a line, a campaign. */
export function holds(data: MapData, part: PanelRef): boolean {
  const m = data.metro;
  if (part.kind === "station")
    return !!m?.stations.some((s) => s.id === part.id) || data.ghosts.some((g) => g.id === part.id);
  if (part.kind === "track") return !!m?.tracks.some((t) => t.id === part.id);
  if (part.kind === "campaign") return !!m?.groups.some((g) => g.id === part.id && g.campaign);
  return !!m?.lines.some((l) => l.id === part.id);
}
