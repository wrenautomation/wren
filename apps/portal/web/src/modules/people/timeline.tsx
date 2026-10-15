/**
 * A profile's warmth (where they stand, what they did toward us, who they are), its newest lines
 * on a short rail with its timeline counted by kind, each count a link to its lines on the
 * Timeline page, and its site visits, read live from the site's log and never stored (Wren's own
 * profiles).
 */
import type { State } from "@wren/core/records";
import { Facts, type IconName, type RecordExtras, TimelineMini } from "@wren/ui";
import { createElement, type ReactNode } from "react";

/** Each timeline kind's icon on its node, here and on the Timeline page. */
export const KIND_ICONS: Readonly<Record<string, IconName>> = {
  email_sent: "mail",
  email_received: "inbox",
  text_sent: "chat",
  text_received: "reply",
  call_in: "phone",
  voice_call: "mic",
  call: "phone",
  touch: "sparkle",
  consent: "shield",
  form: "doc",
  chat: "chat",
  booking: "calendar",
  payment: "card",
  workflow: "bolt",
  trait: "edit",
  merge: "merge",
};

interface Line {
  id: string;
  at: string;
  kind: string;
  summary: string | null;
  link: string | null;
  kindState: State | null;
  channelState: State | null;
}

interface Visit {
  at: string;
  text: string;
  href: string | null;
}

interface Touch {
  at: string;
  channel: string | null;
  what: string | null;
}

interface Warmth {
  stage: string;
  warmth: "warm" | "cold";
  line: string | null;
  counts: { label: string; n: number; first: string | null; last: string | null }[];
  subscriptions: string | null;
  repliedOn: string | null;
  first: Touch | null;
  last: Touch | null;
  cameFrom: string | null;
  persona: string;
  role: string;
  niche: string;
  size: string;
}

interface Detail {
  timeline: { kind: string; label: string; count: number; last: string | null; href: string }[];
  total: number;
  lines?: Line[];
  href: string;
  visits?: Visit[] | null;
  warmth?: Warmth | null;
}

const isDetail = (d: unknown): d is Detail =>
  !!d && typeof d === "object" && Array.isArray((d as Detail).timeline);

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : null;

/** Their newest lines on a short rail, then every kind counted, each a link to its lines. */
function Counts({ detail }: { detail: Detail }) {
  if (!detail.total)
    return <p className="text-(--ui-ink-2)">Nothing has happened with them yet.</p>;
  const lines = detail.lines ?? [];
  return (
    <div className="grid gap-4">
      {lines.length ? (
        <TimelineMini
          lines={lines.map((l) => ({
            id: l.id,
            at: l.at,
            summary: l.summary ?? "",
            href: `/people/timeline/${encodeURIComponent(l.id)}`,
            source: l.link,
            kind: l.kindState,
            kindKey: l.kind,
            channel: l.channelState,
          }))}
          icons={KIND_ICONS}
          all={
            detail.total > lines.length
              ? { href: detail.href, label: `See all ${detail.total} lines` }
              : { href: detail.href, label: "See them on the timeline" }
          }
        />
      ) : null}
      <KindCounts detail={detail} />
    </div>
  );
}

function KindCounts({ detail }: { detail: Detail }) {
  return (
    <Facts
      items={[
        [
          "Everything",
          <a key="all" href={detail.href}>
            {detail.total} lines
          </a>,
        ],
        ...detail.timeline.map(
          (t) =>
            [
              t.label,
              <a key={t.kind} href={t.href}>
                {t.count} {t.count === 1 ? "line" : "lines"}
                {t.last ? `, last ${day(t.last)}` : ""}
              </a>,
            ] as [string, ReactNode],
        ),
      ]}
    />
  );
}

const touch = (t: Touch) => [day(t.at), t.channel, t.what].filter(Boolean).join(", ");

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Warm or cold first, then each thing they did, how often and when. */
function WarmthFacts({ w }: { w: Warmth }) {
  const items: [string, ReactNode][] = [
    ["Stage", w.stage],
    [
      "Warmth",
      w.warmth === "warm" ? "Warm: no cold opener goes to them" : "Cold: never came toward us",
    ],
    ...w.counts.map(
      (c) =>
        [
          cap(c.label),
          `${c.n} ${c.n === 1 ? "time" : "times"}${
            c.first && c.last && day(c.first) !== day(c.last)
              ? `, ${day(c.first)} to ${day(c.last)}`
              : c.last
                ? `, ${day(c.last)}`
                : ""
          }`,
        ] as [string, ReactNode],
    ),
    ["Subscriptions", w.subscriptions ?? "None"],
  ];
  if (w.repliedOn) items.push(["Replied on", w.repliedOn]);
  if (w.first) items.push(["First touch", touch(w.first)]);
  if (w.last) items.push(["Last touch", touch(w.last)]);
  if (w.cameFrom) items.push(["Came from", w.cameFrom.replaceAll("_", " ")]);
  items.push([
    "Persona",
    w.persona === "unknown"
      ? "Unknown"
      : `${cap(w.persona)}${w.size === "unknown" ? "" : `, ${w.size} firm`}`,
  ]);
  return <Facts items={items} />;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function Visits({ visits }: { visits: Visit[] }) {
  return (
    <div className="grid gap-2">
      <p className="text-(--ui-ink-2)">
        Read live from the site's log by their visitor cookie. Not kept here.
      </p>
      {visits.length ? (
        <Facts
          items={visits.map(
            (v) =>
              [
                when(v.at),
                v.href ? (
                  <a key={`${v.at} ${v.text}`} href={v.href}>
                    {v.text}
                  </a>
                ) : (
                  v.text
                ),
              ] as [string, ReactNode],
          )}
        />
      ) : (
        <p className="text-(--ui-ink-2)">No visits found.</p>
      )}
    </div>
  );
}

/** The profile page's Warmth and Timeline sections, and Site visits when it has a visitor key. */
export const profileExtras = (detail: unknown): RecordExtras =>
  isDetail(detail)
    ? {
        sections: [
          ...(detail.warmth
            ? [["Warmth", createElement(WarmthFacts, { w: detail.warmth })] as [string, ReactNode]]
            : []),
          ["Timeline", createElement(Counts, { detail })],
          ...(detail.visits
            ? [
                ["Site visits", createElement(Visits, { visits: detail.visits })] as [
                  string,
                  ReactNode,
                ],
              ]
            : []),
        ],
      }
    : {};
