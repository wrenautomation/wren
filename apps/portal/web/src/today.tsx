/**
 * "/": Today. Wren's (designs/2026-10-13-primitives-first.md): what to make, then what waits on
 * you as the things themselves (pieces with every platform they go to, then each other kind with
 * the first names in it), then what went out. A client's: what waits, a card per service bought.
 * On a phone, where the sidebar hides, the apps by area too (designs/2026-10-10-portal-areas.md).
 */
import {
  AppCard,
  AppGrid,
  cx,
  Icon,
  type IconName,
  Loading,
  PageHeader,
  type PinLine,
  PinnedRow,
  Section,
  Tag,
} from "@wren/ui";
import type { ReactNode } from "react";
import { call } from "./api.js";
import { areasOf } from "./areas.js";
import { Contained } from "./contained.js";
import { useCall } from "./load.js";
import type { Module, PageProps } from "./module.js";
import { useAccount } from "./modules/account/load.js";
import { SetupNow } from "./modules/account/Now.js";
import { SetupCard } from "./modules/account/SetupCard.js";
import {
  allWaiting,
  happenings,
  PieceCard,
  usePieces,
  WhatHappened,
} from "./modules/marketing/pieces.js";
import { goalsOf, MakeList, usePlan } from "./modules/marketing/plan.js";
import { AddOn } from "./modules/marketplace/AddOn.js";
import { HealthNow } from "./modules/wren/health.js";
import { appTotal, type Waiting } from "./waiting.js";

const ROW =
  "flex min-h-11 items-center gap-3 border-b border-(--ui-hair) px-1 text-[14.5px] text-(--ui-ink) no-underline transition-colors duration-150 ease-(--ui-ease) last:border-b-0 hover:bg-(--ui-hover)";
const COUNT =
  "ml-auto min-w-6 bg-(--ui-warn-tint) px-1.5 text-center text-[13px]/6 font-semibold text-(--ui-warn-ink) [font-variant-numeric:tabular-nums]";
const MUTED = "text-[13px] text-(--ui-ink-3)";

const pathOf = (m: Module, page: string) => `/${m.id}/${page}`;
const firstOf = (m: Module) => {
  const p = m.pages.find((x) => !x.hidden) ?? m.pages[0];
  return p ? pathOf(m, p.id) : "/";
};

function Row({
  href,
  icon,
  children,
  count,
}: {
  href: string;
  icon: IconName;
  children: ReactNode;
  count?: number | undefined;
}) {
  return (
    <li>
      <a className={ROW} href={href}>
        <Icon name={icon} className="text-(--ui-ink-2)" />
        <span className="min-w-0 truncate">{children}</span>
        {count ? <span className={COUNT}>{count}</span> : null}
      </a>
    </li>
  );
}

/** Every page with rows waiting, by area then app: one line each, its count, a link. */
function NeedsYou({ apps, waiting }: { apps: Module[]; waiting: Waiting }) {
  const lines = areasOf(apps).flatMap(({ apps }) =>
    apps.flatMap((m) =>
      m.pages
        .filter((p) => !p.hidden && (waiting[m.id]?.[p.id] ?? 0) > 0)
        .map((p) => ({ m, p, n: waiting[m.id]?.[p.id] ?? 0 })),
    ),
  );
  return (
    <Section title="Needs you">
      {lines.length ? (
        <ul className="-my-4 list-none border-y border-(--ui-hair)">
          {lines.map(({ m, p, n }) => (
            <Row key={`${m.id}/${p.id}`} href={pathOf(m, p.id)} icon={m.icon} count={n}>
              {p.label} <span className={MUTED}>· {m.name}</span>
            </Row>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2.5 text-[14.5px] text-(--ui-ink-2)">
          <Icon name="check" className="text-(--ui-good)" />
          Nothing waits on you.
        </p>
      )}
    </Section>
  );
}

/** To approve's other kinds: their name, where they list, and whether `who` is a person. */
const ASKS: Record<string, { label: string; view: string; person?: boolean }> = {
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
const APPROVAL = "marketing.approval";

interface Ask {
  key: string;
  href: string;
  icon: IconName;
  label: string;
  names: string[];
  n: number;
}
type Row = Record<string, unknown>;
type Meta = { id: string; title: string };

const nameOf = (v: unknown, person = false) => {
  const t = String(v ?? "").trim();
  if (!t) return "";
  const s = person ? (t.split(/\s+/)[0] ?? t) : t;
  return s.length > 42 ? `${s.slice(0, 41).trimEnd()}…` : s;
};

/** Each waiting page as its items: the first names in it, not just a count. */
async function asksOf(apps: Module[], waiting: Waiting): Promise<Ask[]> {
  const metas = await call<Meta[]>("console/recordsTypes", {}).catch(() => [] as Meta[]);
  const titleOf = (record: string) => metas.find((m) => m.id === record)?.title ?? "name";
  const pages = areasOf(apps).flatMap(({ apps }) =>
    apps.flatMap((m) =>
      m.pages
        .filter((p) => !p.hidden && (waiting[m.id]?.[p.id] ?? 0) > 0)
        .map((p) => ({ m, p, n: waiting[m.id]?.[p.id] ?? 0 })),
    ),
  );
  const got = await Promise.all(
    pages.map(async ({ m, p, n }): Promise<Ask[]> => {
      const href = `/${m.id}/${p.id}`;
      const record = "record" in p ? p.record : null;
      const where = "count" in p ? p.count : null;
      if (!record || !where)
        return [{ key: href, href, icon: m.icon, label: p.label, names: [], n }];
      if (record === APPROVAL) {
        // Post drafts show as pieces above; every other kind gets its own line.
        const { rows } = await call<{ rows: Row[] }>("console/recordsList", {
          record,
          where,
          limit: 200,
        });
        const by = new Map<string, Row[]>();
        for (const r of rows) {
          const t = String(r.type);
          if (t === "draft") continue;
          by.set(t, [...(by.get(t) ?? []), r]);
        }
        return [...by].map(([t, rs]) => {
          const a = ASKS[t] ?? { label: t, view: "waiting" };
          return {
            key: `${href}/${t}`,
            href: `${href}?view=${a.view}`,
            icon: m.icon,
            label: a.label,
            names: [...new Set(rs.map((r) => nameOf(r.who, a.person)).filter(Boolean))],
            n: rs.length,
          };
        });
      }
      const { rows } = await call<{ rows: Row[] }>("console/recordsList", {
        record,
        where,
        limit: 4,
      });
      const key = titleOf(record);
      return [
        {
          key: href,
          href,
          icon: m.icon,
          label: p.label,
          names: rows.map((r) => nameOf(r[key])).filter(Boolean),
          n,
        },
      ];
    }),
  );
  return got.flat().sort((a, b) => b.n - a.n);
}

/** "Sam, Priya, Ana and 9 more". */
const namesLine = (names: string[], n: number) => {
  const shown = names.slice(0, 3);
  if (!shown.length) return "";
  const rest = n - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
};

function AskRow({ a }: { a: Ask }) {
  const names = namesLine(a.names, a.n);
  return (
    <li>
      <a className={ROW} href={a.href}>
        <Icon name={a.icon} className="text-(--ui-ink-2)" />
        <span className="min-w-0 truncate">
          {a.label}
          {names ? <span className={MUTED}> · {names}</span> : null}
        </span>
        <span className={COUNT}>{a.n}</span>
      </a>
    </li>
  );
}

const PIECES_SHOWN = 3;

/** Wren's work: make, what waits (pieces, then each other kind), what went out. */
function WrenWork({ apps, waiting }: { apps: Module[]; waiting: Waiting }) {
  const plan = usePlan();
  const work = usePieces();
  const key = JSON.stringify(waiting);
  const asks = useCall(`today-asks:${key}`, () => asksOf(apps, waiting));
  const goals = goalsOf(plan.data?.rows);
  const pieces = (work.data?.pieces ?? []).filter((p) => allWaiting(p).length);
  const lines = asks.data ?? [];
  const none = work.data && asks.data && !pieces.length && !lines.length;
  return (
    <>
      {goals.length ? (
        <Section
          title="Make"
          note="This week's goals, by what you make"
          actions={
            <a className={cx("text-[13px] underline", MUTED)} href="/marketing/plan">
              Marketing
            </a>
          }
        >
          <MakeList goals={goals} reload={plan.retry} />
        </Section>
      ) : null}
      <Section
        title="Waiting on you"
        actions={
          pieces.length > PIECES_SHOWN ? (
            <a className={cx("text-[13px] underline", MUTED)} href="/marketing/pieces?show=waiting">
              All {pieces.length} pieces
            </a>
          ) : null
        }
      >
        {!work.data || !asks.data ? (
          <Loading lines={5} />
        ) : none ? (
          <p className="flex items-center gap-2.5 text-[14.5px] text-(--ui-ink-2)">
            <Icon name="check" className="text-(--ui-good)" />
            Nothing waits on you.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {pieces.slice(0, PIECES_SHOWN).map((p) => (
              <PieceCard key={p.id} piece={p} reload={work.retry} />
            ))}
            {lines.length ? (
              <ul className="m-0 list-none border-y border-(--ui-hair) p-0">
                {lines.map((a) => (
                  <AskRow key={a.key} a={a} />
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </Section>
      {work.data ? <WhatHappened items={happenings(work.data.pieces)} /> : null}
    </>
  );
}

/** The apps by area, for a phone, where the sidebar hides. */
function AppsByArea({ apps, waiting }: { apps: Module[]; waiting: Waiting }) {
  return (
    <div className="mt-12 min-[901px]:hidden">
      {areasOf(apps).map(({ area, apps }) => (
        <Section key={area.id} title={area.label} plain>
          <ul className="list-none border-y border-(--ui-hair)">
            {apps.map((m) => (
              <Row key={m.id} href={firstOf(m)} icon={m.icon} count={appTotal(waiting[m.id])}>
                {m.name}
              </Row>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}

const DATE = new Intl.DateTimeFormat("en-CA", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "America/Toronto",
});

/** Wren's Today. */
export function WrenToday({
  apps,
  waiting,
  pins,
  props,
}: {
  apps: Module[];
  waiting: Waiting;
  pins: PinLine[];
  props: PageProps;
}) {
  return (
    <>
      <PageHeader
        title="Today"
        lede={`${DATE.format(new Date())}. What waits on you, then every app.`}
      />
      {props.team ? (
        <SetupCard
          client={props.client}
          team
          href={apps.some((m) => m.id === "account") ? "/account/accounts" : null}
        />
      ) : null}
      {props.team ? <SetupNow client={props.client} team /> : null}
      {props.team ? <HealthNow /> : null}
      <PinnedRow pins={pins} />
      <WrenWork apps={apps} waiting={waiting} />
      <AppsByArea apps={apps} waiting={waiting} />
    </>
  );
}

/** A client's Today: what waits, a card per service they bought (its app's glance), the add-on. */
export function ClientToday({
  name,
  apps,
  waiting,
  installed,
  pins,
  props,
}: {
  name: string;
  apps: Module[];
  waiting: Waiting;
  installed: ReadonlySet<string>;
  pins: PinLine[];
  props: PageProps;
}) {
  const account = useAccount(props);
  if (!account.data && !account.error) return <Loading lines={8} heading />;
  // One line per offer with its app here, newest first; a finished one stays, it has paperwork.
  const bought = [
    ...new Map((account.data?.bought ?? []).map((b) => [b.offerId, b])).values(),
  ].flatMap((b) => {
    const m = apps.find((x) => x.id === b.app);
    return m ? [{ b, m }] : [];
  });
  return (
    <>
      <PageHeader title="Today" lede={`Everything Wren runs for ${name}.`} />
      {props.demo ? null : (
        <SetupCard client={props.client} team={props.team} href="/account/accounts" />
      )}
      {props.demo ? null : <SetupNow client={props.client} team={props.team} />}
      <PinnedRow pins={pins} />
      {/* Installing needs `manage`: a viewer or member never sees the offer. */}
      {props.team || props.demo || !props.can?.includes("manage") ? null : (
        <AddOn
          offered={(account.data?.bought ?? []).map((b) => b.addOn)}
          installed={installed}
          props={props}
        />
      )}
      <NeedsYou apps={apps} waiting={waiting} />
      {bought.length ? (
        <AppGrid label="Your services">
          {bought.map(({ b, m }) => (
            <AppCard key={b.offerId} name={b.offer} icon={m.icon} href={firstOf(m)} blurb={m.blurb}>
              {/* The team sees an app this client hasn't installed, marked. */}
              {m.component && !installed.has(m.component) ? (
                <Tag>Not installed</Tag>
              ) : m.Glance ? (
                <Contained quiet>
                  <m.Glance {...props} />
                </Contained>
              ) : null}
            </AppCard>
          ))}
        </AppGrid>
      ) : null}
      <AppsByArea apps={apps} waiting={waiting} />
    </>
  );
}
