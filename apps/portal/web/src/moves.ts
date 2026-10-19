/**
 * What waits on Wren's team, as moves (designs/2026-10-19-portal-reshape.md, Today): one line per
 * thing to do, each from a record a page already counts. Read in `useWaiting`, grouped here: a
 * move for a person with an open journey sits under that journey's line, the rest under Others.
 */
import type { IconName } from "@wren/ui";
import { call } from "./api.js";
import type { Module, ModulePage } from "./module.js";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

/** Where each kind of move opens. The reshape's addresses; `moved.ts` holds the old ones. */
const AT = {
  call: "/pipelines/calls",
  approve: "/engage/approve",
  inbox: "/engage/inbox",
  reply: "/inbox/replies",
  ask: "/inbox/asks",
  stale: "/pipelines/journeys?view=stale",
} as const;

/** To approve's kinds: their name and the view they list under. */
export const ASKS: Record<string, { label: string; view: string; person?: boolean }> = {
  invite: { label: "First messages to new connections", view: "invites", person: true },
  connect: { label: "Connection notes", view: "invites", person: true },
  thread: { label: "Reddit thread comments", view: "threads" },
  onpost: { label: "Comments on others' posts", view: "comments" },
  reply: { label: "Inbox replies", view: "replies", person: true },
  video: { label: "Videos", view: "videos" },
  template: { label: "Template versions", view: "templates" },
  workflow: { label: "Client workflows", view: "workflows" },
  page: { label: "Pages", view: "pages" },
  payment: { label: "Payment links", view: "payments" },
  swap: { label: "Title and thumbnail swaps", view: "swaps" },
};

export interface Move {
  key: string;
  icon: IconName;
  /** "Reply", "Approve": what to do. */
  verb: string;
  /** Whom or what it is about. */
  what: string;
  href: string;
  /** Rows behind this line (a kind of approval holds many). */
  n: number;
  /** The addresses the row goes by, to find its person's journey. */
  emails: string[];
  /** The journey it is about, when the row is one. */
  journey?: string;
}

export interface JourneyHead {
  id: string;
  person: string;
  /** The node it stands at, by name. */
  node: string;
}
export type JourneyLine = JourneyHead & { emails: string[] };

export interface MoveGroup {
  key: string;
  head: JourneyHead | null;
  moves: Move[];
}

export interface Moves {
  groups: MoveGroup[];
  /** Move lines, not rows behind them: the number on the Today tab. */
  count: number;
}

const OTHERS = "others";

/** A move source: its record, and how many rows to read from the page that counts it. */
interface Source {
  id: "call" | "approve" | "inbox" | "reply" | "ask" | "stale";
  record: string;
  limit: number;
  /** Rows to moves. */
  make: (rows: Row[]) => Move[];
}

const str = (v: unknown) => String(v ?? "").trim();
const lower = (v: unknown) => str(v).toLowerCase();
const clip = (s: string) => (s.length > 42 ? `${s.slice(0, 41).trimEnd()}…` : s);

/** A name for a line: the first word of a person's, the whole of anything else. */
export const nameOf = (v: unknown, person = false) => {
  const t = str(v);
  if (!t) return "";
  return clip(person ? (t.split(/\s+/)[0] ?? t) : t);
};

/** "Sam, Priya, Ana and 9 more". */
export const namesLine = (names: string[], n: number) => {
  const shown = names.slice(0, 3);
  if (!shown.length) return "";
  const rest = n - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
};

const TIME = new Intl.DateTimeFormat("en-CA", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Toronto",
});
const timeOf = (v: unknown) => {
  const d = new Date(str(v));
  return Number.isNaN(d.getTime()) ? "" : TIME.format(d);
};

const emailsOf = (...v: unknown[]) => v.map(lower).filter(Boolean);

/** In the order they show. */
export const SOURCES: readonly Source[] = [
  {
    id: "call",
    record: "email.call",
    limit: 20,
    make: (rows) =>
      [...rows]
        .sort((a, b) => str(a.start).localeCompare(str(b.start)))
        .map((r) => ({
          key: `call:${str(r.id)}`,
          icon: "phone",
          verb: "Prepare call",
          what: [nameOf(r.who), timeOf(r.start)].filter(Boolean).join(", "),
          href: `${AT.call}/${encodeURIComponent(str(r.id))}`,
          n: 1,
          emails: emailsOf(r.email),
        })),
  },
  {
    id: "approve",
    record: "marketing.approval",
    limit: 200,
    // Post drafts show as the Write list; every other kind gets its own line.
    make: (rows) => {
      const by = new Map<string, Row[]>();
      for (const r of rows) {
        const t = str(r.type);
        if (t === "draft") continue;
        by.set(t, [...(by.get(t) ?? []), r]);
      }
      return [...by].map(([t, rs]) => {
        const a = ASKS[t] ?? { label: t, view: "waiting" };
        const names = [...new Set(rs.map((r) => nameOf(r.who, a.person)).filter(Boolean))];
        return {
          key: `approve:${t}`,
          icon: "check",
          verb: "Approve",
          what: [a.label, namesLine(names, rs.length)].filter(Boolean).join(", "),
          href: `${AT.approve}?view=${a.view}`,
          n: rs.length,
          emails: [],
        };
      });
    },
  },
  {
    id: "inbox",
    record: "marketing.inbox",
    limit: 50,
    // A person wrote. Activity is a notice; an email reply with an invite shows with the
    // replies below.
    make: (rows) =>
      rows
        .filter(
          (r) =>
            str(r.type) !== "activity" &&
            !(str(r.type) === "email" && str(r.url).startsWith("/inbox/replies/")),
        )
        .map((r) => ({
          key: `inbox:${str(r.id)}`,
          icon: "inbox",
          verb: "Reply",
          what: nameOf(r.who, true),
          href: AT.inbox,
          n: 1,
          emails: [],
        })),
  },
  {
    id: "reply",
    record: "email.reply",
    limit: 50,
    make: (rows) =>
      rows.map((r) => ({
        key: `reply:${str(r.id)}`,
        icon: "mail",
        verb: "Reply",
        what: nameOf(r.who, true),
        href: AT.reply,
        n: 1,
        emails: emailsOf(r.email),
      })),
  },
  {
    id: "ask",
    record: "access.ask",
    limit: 20,
    make: (rows) =>
      rows.map((r) => ({
        key: `ask:${str(r.id)}`,
        icon: "shield",
        verb: "Answer",
        what: nameOf(r.email),
        href: AT.ask,
        n: 1,
        emails: [],
      })),
  },
  {
    id: "stale",
    record: "pipeline.journey",
    limit: 50,
    make: (rows) =>
      rows.map((r) => ({
        key: `stale:${str(r.id)}`,
        icon: "target",
        verb: "Nudge or drop",
        what: [nameOf(r.name), str(r.nodeName), `${Number(r.daysAtNode) || 0} days`]
          .filter(Boolean)
          .join(", "),
        href: AT.stale,
        n: 1,
        emails: emailsOf(...str(r.email).split(/\s+/)),
        journey: str(r.id),
      })),
  },
];

/** Every record a move reads: a page for it counts even where the tab is hidden. */
export const MOVE_RECORDS: ReadonlySet<string> = new Set(SOURCES.map((s) => s.record));

/** A source's page: the one that counts its record, a tab before a hidden page. */
export function pageOf(apps: readonly Module[], record: string) {
  const all = apps
    .filter((m) => !m.parked)
    .flatMap((m) =>
      m.pages.flatMap((p) =>
        "record" in p && p.record === record && "count" in p && p.count ? [{ m, p }] : [],
      ),
    );
  return all.find((x) => !x.p.hidden) ?? all[0] ?? null;
}

/** The page's `count` filter, as the records api takes it. */
export const whereOf = (p: ModulePage): Where | null =>
  "count" in p && p.count ? (p.count as Where) : null;

/** What reads for each source: its page's filter, and rows waiting there by the page's count. */
export function sourcesOf(
  apps: readonly Module[],
  waiting: Readonly<Record<string, Record<string, number>>>,
) {
  return SOURCES.flatMap((s) => {
    const at = pageOf(apps, s.record);
    const where = at ? whereOf(at.p) : null;
    const n = at ? (waiting[at.m.id]?.[at.p.id] ?? 0) : 0;
    return where && n > 0 ? [{ s, where, n }] : [];
  });
}

/** Moves under their journey, strangers last. Order inside a group is the order of the sources. */
export function groupMoves(moves: readonly Move[], journeys: readonly JourneyLine[]): MoveGroup[] {
  const byId = new Map(journeys.map((j) => [j.id, j]));
  const byEmail = new Map<string, JourneyLine>();
  for (const j of journeys) for (const e of j.emails) if (!byEmail.has(e)) byEmail.set(e, j);
  const groups = new Map<string, MoveGroup>();
  const put = (key: string, head: JourneyHead | null, m: Move) => {
    const g = groups.get(key) ?? { key, head, moves: [] };
    g.moves.push(m);
    groups.set(key, g);
  };
  for (const m of moves) {
    const j =
      (m.journey ? byId.get(m.journey) : undefined) ??
      m.emails.map((e) => byEmail.get(e)).find(Boolean);
    if (!j) put(OTHERS, null, m);
    else put(j.id, { id: j.id, person: j.person, node: j.node }, m);
  }
  const others = groups.get(OTHERS);
  groups.delete(OTHERS);
  return [...groups.values(), ...(others ? [others] : [])];
}

const lineOf = (r: Row): JourneyLine => ({
  id: str(r.id),
  person: nameOf(r.name),
  node: str(r.nodeName),
  emails: str(r.email).split(/\s+/).filter(Boolean).map(lower),
});

/**
 * Every move: each source with rows waiting is read through its page's filter, together; the
 * open journeys are read too when a move might belong to one. A failed read fails them all.
 */
export async function movesOf(
  apps: readonly Module[],
  waiting: Readonly<Record<string, Record<string, number>>>,
): Promise<Moves> {
  const live = sourcesOf(apps, waiting);
  const lists = await Promise.all(
    live.map(({ s, where }) =>
      call<{ rows: Row[] }>("console/recordsList", {
        record: s.record,
        where,
        limit: s.limit,
      }).then((r) => ({ s, rows: r.rows })),
    ),
  );
  const moves = lists.flatMap(({ s, rows }) => s.make(rows));
  const stale = lists.find((l) => l.s.id === "stale")?.rows ?? [];
  const needs = moves.some((m) => m.emails.length && !m.journey);
  const open = needs
    ? (
        await call<{ rows: Row[] }>("console/recordsList", {
          record: "pipeline.journey",
          where: { status: ["open"] },
          limit: 500,
        })
      ).rows
    : [];
  const journeys = [...new Map([...open, ...stale].map((r) => [str(r.id), lineOf(r)])).values()];
  return { groups: groupMoves(moves, journeys), count: moves.length };
}
