/**
 * A profile's warmth (where they stand, what they did toward us, who they are), its newest lines
 * on a short rail with its timeline counted by kind, each count a link to its lines on the
 * Timeline page, and its site visits, read live from the site's log and never stored (Wren's own
 * profiles).
 */
import type { ResearchDetail } from "@wren/core/profile-findings";
import type { State } from "@wren/core/records";
import {
  Alert,
  Facts,
  type IconName,
  type PeekLine,
  PlatformMark,
  type RecordAct,
  type RecordExtras,
  TimelineMini,
} from "@wren/ui";
import { createElement, type ReactNode } from "react";
import { RESEARCH_POLL_MS, Research, researching } from "./research.js";

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
  context: string | null;
  note: string | null;
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

interface Reach {
  emails: string[];
  phones: string[];
  handles: {
    platform: string;
    label: string;
    handle: string;
    url: string | null;
    name: string | null;
  }[];
  person: {
    name: string;
    title: string | null;
    company: string | null;
    linkedinUrl: string | null;
  } | null;
}

interface Detail {
  reach?: Reach | null;
  /** Parts that failed to read. */
  failed?: string[];
  timeline: { kind: string; label: string; count: number; last: string | null; href: string }[];
  total: number;
  lines?: Line[];
  href: string;
  visits?: Visit[] | null;
  warmth?: Warmth | null;
  /** Research this person: Wren's own people only (a client's detail has none). */
  research?: ResearchDetail | null;
}

const isDetail = (d: unknown): d is Detail =>
  !!d && typeof d === "object" && Array.isArray((d as Detail).timeline);

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : null;

/** Labels once each: a second "LinkedIn" is "LinkedIn 2". */
function unique(labels: string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((l) => {
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    return n > 1 ? `${l} ${n}` : l;
  });
}

/** Who they are (the research row), then every address as a link: handles with their site's mark. */
function ReachFacts({ reach }: { reach: Reach }) {
  const { person } = reach;
  const who: [string, ReactNode][] = [];
  if (person?.title) who.push(["Title", person.title]);
  if (person?.company) who.push(["Company", person.company]);
  if (person?.linkedinUrl)
    who.push([
      "On LinkedIn",
      <a key="li" href={person.linkedinUrl} target="_blank" rel="noreferrer">
        <PlatformMark mark="linkedin" /> {person.linkedinUrl.replace(/^https?:\/\/(www\.)?/, "")}
      </a>,
    ]);
  const labels = unique(reach.handles.map((h) => h.label));
  const addresses: [string, ReactNode][] = [
    ...reach.emails.map(
      (e, i) =>
        [
          i ? `Email ${i + 1}` : "Email",
          <a key={e} href={`mailto:${e}`}>
            <PlatformMark mark="email" /> {e}
          </a>,
        ] as [string, ReactNode],
    ),
    ...reach.phones.map(
      (p, i) =>
        [
          i ? `Phone ${i + 1}` : "Phone",
          <a key={p} href={`tel:${p}`}>
            <PlatformMark mark="call" /> {p}
          </a>,
        ] as [string, ReactNode],
    ),
    ...reach.handles.map((h, i) => {
      // A LinkedIn URN means nothing to a reader: show the name, or the site's word for one.
      const handle = h.handle.startsWith("urn:") ? null : h.handle;
      const shown = h.name
        ? handle
          ? `${h.name} (${handle})`
          : h.name
        : (handle ?? `${h.label} member`);
      return [
        labels[i] ?? h.label,
        h.url ? (
          <a key={h.handle} href={h.url} target="_blank" rel="noreferrer">
            <PlatformMark mark={h.platform} /> {shown}
          </a>
        ) : (
          <span key={h.handle}>
            <PlatformMark mark={h.platform} /> {shown}
            <span className="text-(--ui-ink-2)"> (no page known)</span>
          </span>
        ),
      ] as [string, ReactNode];
    }),
  ];
  const items = [...who, ...addresses];
  if (!items.length)
    return <p className="text-(--ui-ink-2)">No email, phone or site handle yet.</p>;
  return <Facts items={items} />;
}

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
            context: l.context,
            note: l.note,
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

/** The parts of a person's page that did not read, with a way to try again. */
function NotLoaded({ parts }: { parts: string[] }) {
  return (
    <Alert onRetry={() => location.reload()}>
      {`${parts.join(", ")} didn't load. The rest is here.`}
    </Alert>
  );
}

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

/** What we did to them, not what they did: a line of these says "You". */
const OURS = /_sent$|^(voice_call|call|touch|workflow)$/;
/** A line nobody did: the profile changed. */
const SYSTEM_KINDS = new Set(["trait", "merge"]);

/** The peek's items: every line the detail holds, who did it, what kind, where, when. */
function recentOf(detail: Detail, name: string): PeekLine[] {
  return (detail.lines ?? []).map((l) => ({
    who: SYSTEM_KINDS.has(l.kind) ? undefined : OURS.test(l.kind) ? "You" : name,
    channel: [l.kindState?.label, l.channelState?.label].filter(Boolean).join(" · ") || undefined,
    at: l.at,
    text: l.summary ?? l.kindState?.label ?? cap(l.kind.replaceAll("_", " ")),
  }));
}

/**
 * The profile page's Profiles, Research, Warmth and Timeline sections, and Site visits when it
 * has a visitor key. Research shows for Wren's own people; the page reads again while a run works.
 * `name` is the person's, for the peek's newest lines.
 */
export const profileExtras = (detail: unknown, act?: RecordAct, name = "They"): RecordExtras =>
  isDetail(detail)
    ? {
        recent: recentOf(detail, name),
        ...(researching(detail.research) ? { poll: RESEARCH_POLL_MS } : {}),
        sections: [
          ...(detail.reach
            ? [
                ["Profiles", createElement(ReachFacts, { reach: detail.reach })] as [
                  string,
                  ReactNode,
                ],
              ]
            : []),
          ...(detail.research && act
            ? [
                ["Research", createElement(Research, { research: detail.research, act })] as [
                  string,
                  ReactNode,
                ],
              ]
            : []),
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
          ...(detail.failed?.length
            ? [
                ["Not loaded", createElement(NotLoaded, { parts: detail.failed })] as [
                  string,
                  ReactNode,
                ],
              ]
            : []),
        ],
      }
    : {};
