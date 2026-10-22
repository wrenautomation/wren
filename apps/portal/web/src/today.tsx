/**
 * "/": Today. Wren's (designs/2026-10-19-portal-reshape.md): Write, today's quota per platform,
 * then Move, what waits on you grouped by the person's journey. The two never mix. A client's:
 * what waits, a card per service bought. On a phone, where the sidebar hides, the apps by area
 * too (designs/2026-10-10-portal-areas.md).
 */
import {
  AppCard,
  AppGrid,
  cx,
  Icon,
  type IconName,
  LoadFailed,
  Loading,
  PageHeader,
  type PinLine,
  PinnedRow,
  PlatformMark,
  Rows,
  type RowsColumn,
  type RowsLine,
  type RowsName,
  Section,
  Tag,
  useNarrow,
} from "@wren/ui";
import type { ReactNode } from "react";
import { areasOf } from "./areas.js";
import { Contained } from "./contained.js";
import { proposalsLine } from "./map/drafts.js";
import { useProposals } from "./map/read.js";
import type { Module, PageProps } from "./module.js";
import { useAccount } from "./modules/account/load.js";
import { SetupNow } from "./modules/account/Now.js";
import { SetupCard } from "./modules/account/SetupCard.js";
import { atOf } from "./modules/deals/board.js";
import { goalsOf, makeAt, usePlan } from "./modules/marketing/plan.js";
import { AddOn } from "./modules/marketplace/AddOn.js";
import { HealthNow } from "./modules/wren/health.js";
import type { Move, Moves } from "./moves.js";
import { href, navigate } from "./route.js";
import { useFolds } from "./use-folds.js";
import { appTotal, type MovesRead, type Waiting, type WaitingRead } from "./waiting.js";
import { met, type WriteLine, writeOf } from "./write.js";

const ROW =
  "flex min-h-11 items-center gap-3 border-b border-(--ui-hair) px-1 text-[14.5px] text-(--ui-ink) no-underline transition-colors duration-150 ease-(--ui-ease) last:border-b-0 hover:bg-(--ui-hover)";
const COUNT =
  "ml-auto min-w-6 rounded-full bg-(--ui-warn-tint) px-2 text-center text-[13px]/6 font-semibold text-(--ui-warn-ink) [font-variant-numeric:tabular-nums]";
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

/**
 * "N shape proposals wait", linking to the Map's History on Drafts. One small read of the proposed
 * drafts' count (a page for it would add a sidebar tab, and a client's waiting counts come from
 * page badges). Team only: the Map is the team's; nothing shows while none wait.
 */
function ProposalsLine({ props }: { props: PageProps }) {
  const proposals = useProposals(atOf(props.client), props.team);
  const text = proposalsLine(proposals.data ?? 0);
  if (!props.team || !text) return null;
  return (
    <ul className="mt-4 list-none">
      <Row
        href={href("/", { history: "drafts", ...atOf(props.client) })}
        icon="stack"
        count={proposals.data ?? 0}
      >
        {text}
      </Row>
    </ul>
  );
}

/** Nothing waits on you: said only once every read is in and none failed. */
function NothingWaits() {
  return (
    <p className="flex items-center gap-2.5 text-[14.5px] text-(--ui-ink-2)">
      <Icon name="check" className="text-(--ui-good)" />
      Nothing waits on you.
    </p>
  );
}

/**
 * One digest's rows on the shared `Rows`: the title links, and a press anywhere on the row goes
 * there too (the line was one link before). Page-scrolled, always: a digest is short.
 */
function Digest<T>({
  label,
  noun,
  narrow,
  lines,
  name,
  columns,
  group,
}: {
  label: string;
  noun: string;
  narrow: boolean;
  lines: RowsLine<T>[];
  name: Omit<RowsName<T>, "href"> & { href: (row: T) => string };
  columns: RowsColumn<T>[];
  group?: { folded: ReadonlySet<string>; toggle: (key: string) => void } | undefined;
}) {
  return (
    <Rows<T>
      label={label}
      noun={noun}
      narrow={narrow}
      scroller="window"
      lines={lines}
      name={name}
      columns={columns}
      group={group}
      open={{ id: null, onOpen: (row) => navigate(name.href(row)) }}
    />
  );
}

const PLAIN_COUNT = "tabular-nums";

interface Waits {
  m: Module;
  p: Module["pages"][number];
  n: number;
}

/**
 * Every page with rows waiting, by area then app: one row each, its count, a link. A failed
 * count says so above the rows it has, never "Nothing waits on you."
 */
function NeedsYou({
  apps,
  waiting,
  read,
  narrow,
}: {
  apps: Module[];
  waiting: Waiting;
  read: WaitingRead;
  narrow: boolean;
}) {
  // A client's Today only: Wren's lists its own waiting pages in WrenWork.
  const waits: Waits[] = areasOf(apps, false).flatMap(({ apps }) =>
    apps.flatMap((m) =>
      m.pages
        .filter((p) => !p.hidden && (waiting[m.id]?.[p.id] ?? 0) > 0)
        .map((p) => ({ m, p, n: waiting[m.id]?.[p.id] ?? 0 })),
    ),
  );
  const lines: RowsLine<Waits>[] = waits.map((row, index) => ({
    kind: "row",
    key: `${row.m.id}/${row.p.id}`,
    index,
    row,
  }));
  return (
    <Section
      title="Needs you"
      count={waits.length ? waits.reduce((t, l) => t + l.n, 0) : undefined}
    >
      {read.error ? <LoadFailed error={read.error} onRetry={read.retry} what="list" /> : null}
      {waits.length ? (
        <Digest<Waits>
          label="pages waiting"
          noun="page"
          narrow={narrow}
          lines={lines}
          name={{
            label: "Page",
            icon: "text",
            title: ({ p }) => p.label,
            href: ({ m, p }) => pathOf(m, p.id),
            mark: ({ m }) => <Icon name={m.icon} className="text-(--ui-ink-2)" />,
            // A phone has no App column: the app goes under the page.
            sub: narrow ? ({ m }) => <span className={MUTED}>{m.name}</span> : undefined,
          }}
          columns={[
            { key: "app", label: "App", icon: "stack", cell: ({ m }) => m.name },
            {
              key: "n",
              label: "Waiting",
              icon: "hash",
              align: "end",
              width: 110,
              phone: true,
              cell: ({ n }) => <span className={PLAIN_COUNT}>{n}</span>,
            },
          ]}
        />
      ) : read.error ? null : read.loading ? (
        <Loading shape="rows" lines={3} />
      ) : (
        <NothingWaits />
      )}
    </Section>
  );
}

const MORE = cx("text-[13px] underline", MUTED);

/** A quota as words: "1 of 3 today". */
const quotaLine = (l: WriteLine) => `${Math.min(l.have, l.want)} of ${l.want} today`;

/** The mark before a platform's name: a check once its quota is met. */
function WriteMark({ l }: { l: WriteLine }) {
  if (met(l)) return <Icon name="check" className="text-(--ui-good)" />;
  if (l.id === "autopilot") return <Icon name="bolt" className="text-(--ui-ink-2)" />;
  return <PlatformMark mark={l.id} />;
}

/** Where to make the next piece for a platform's line. */
const writeAt = (l: WriteLine) =>
  l.id === "autopilot" ? "/content/plan" : makeAt(l.next.piece, [l.next]).href;

const MET = "met";

/**
 * Write: today's quota per platform from the content plan. Platforms still short come first;
 * those that met theirs fold under one line. X, TikTok and Threads run on their own, one line.
 */
function WriteList({ narrow }: { narrow: boolean }) {
  const plan = usePlan();
  // Met quotas start folded away.
  const folds = useFolds([MET]);
  const { lines, autopilot } = writeOf(goalsOf(plan.data?.rows));
  const all = [...lines, ...(autopilot ? [autopilot] : [])];
  const short = all.filter((l) => !met(l));
  const done = all.filter(met);
  const drawn: RowsLine<WriteLine>[] = [];
  for (const l of short) drawn.push({ kind: "row", key: l.id, index: drawn.length, row: l });
  if (done.length) {
    drawn.push({ kind: "group", key: MET, label: "Met today" });
    for (const l of done) drawn.push({ kind: "row", key: l.id, index: drawn.length, row: l });
  }
  return (
    <Section
      title="Write"
      note="Today's quota, by platform"
      count={plan.data && !plan.error ? short.length : undefined}
      actions={
        <a className={MORE} href="/content/plan">
          Plan
        </a>
      }
    >
      {plan.error ? <LoadFailed error={plan.error} onRetry={plan.retry} what="list" /> : null}
      {plan.error ? null : !plan.data ? (
        <Loading shape="rows" lines={4} />
      ) : !all.length ? (
        <p className="text-[14.5px] text-(--ui-ink-2)">Nothing is due today.</p>
      ) : (
        <>
          {short.length ? null : (
            <p className="mb-3 flex items-center gap-2.5 text-[14.5px] text-(--ui-ink-2)">
              <Icon name="check" className="text-(--ui-good)" />
              Today's quota is met.
            </p>
          )}
          <Digest<WriteLine>
            label="platform quotas"
            noun="platform"
            narrow={narrow}
            lines={drawn}
            group={folds}
            name={{
              label: "Platform",
              icon: "text",
              title: (l) => l.label,
              href: writeAt,
              mark: (l) => <WriteMark l={l} />,
              // Autopilot names the platforms it runs.
              sub: (l) =>
                l.id === "autopilot" && l.folded.length ? (
                  <span className={MUTED}>{l.folded.join(", ")}</span>
                ) : null,
            }}
            columns={[
              {
                key: "quota",
                label: "Quota",
                icon: "gauge",
                phone: true,
                cell: (l) => quotaLine(l),
              },
            ]}
          />
        </>
      )}
    </Section>
  );
}

const OTHERS = "others";

/** The lines `Rows` draws: each journey's moves under its fold, the rest under Others. */
function moveLines(groups: Moves["groups"]): RowsLine<Move>[] {
  const journeys = groups.some((g) => g.head);
  const out: RowsLine<Move>[] = [];
  for (const g of groups) {
    if (g.head)
      out.push({
        kind: "group",
        key: g.key,
        label: (
          <>
            {g.head.person}
            {g.head.node ? <span className="font-normal"> · {g.head.node}</span> : null}
          </>
        ),
      });
    else if (journeys) out.push({ kind: "group", key: g.key || OTHERS, label: "Others" });
    for (const m of g.moves) out.push({ kind: "row", key: m.key, index: out.length, row: m });
  }
  return out;
}

/**
 * Move: what waits on you, grouped by the person's journey (person, node), then
 * everything else. A failed read says so above what did load, never "Nothing waits on you."
 */
function MoveList({
  moves,
  read,
  narrow,
}: {
  moves: MovesRead;
  read: WaitingRead;
  narrow: boolean;
}) {
  const folds = useFolds();
  const error = moves.error ?? read.error;
  const retry = () => {
    read.retry();
    moves.retry();
  };
  const loading = !error && moves.loading;
  const none = !error && !loading && !moves.groups.length;
  return (
    <Section title="Move" count={loading || none || error ? undefined : moves.count}>
      {error ? <LoadFailed error={error} onRetry={retry} what="list" /> : null}
      {loading ? (
        <Loading shape="rows" lines={5} />
      ) : none ? (
        <NothingWaits />
      ) : (
        <Digest<Move>
          label="moves"
          noun="move"
          narrow={narrow}
          lines={moveLines(moves.groups)}
          group={folds}
          name={{
            label: "Do",
            icon: "text",
            title: (m) => m.verb,
            href: (m) => m.href,
            mark: (m) => <Icon name={m.icon} className="text-(--ui-ink-2)" />,
            // A phone has no About column: whom it is about goes under the verb.
            sub: narrow ? (m) => <span className={MUTED}>{m.what}</span> : undefined,
          }}
          columns={[
            { key: "what", label: "About", icon: "user", cell: (m) => m.what },
            {
              key: "n",
              label: "Rows",
              icon: "hash",
              align: "end",
              width: 90,
              phone: true,
              cell: (m) => (m.n > 1 ? <span className={PLAIN_COUNT}>{m.n}</span> : null),
            },
          ]}
        />
      )}
    </Section>
  );
}

/** The apps by area, for a phone, where the sidebar hides. */
function AppsByArea({ apps, waiting, team }: { apps: Module[]; waiting: Waiting; team: boolean }) {
  return (
    <div className="mt-12 min-[901px]:hidden">
      {areasOf(apps, team).map(({ area, apps }) => (
        <Section key={area.id} title={area.label}>
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
  read,
  moves,
  pins,
  props,
  docked,
}: {
  apps: Module[];
  waiting: Waiting;
  read: WaitingRead;
  moves: MovesRead;
  pins: PinLine[];
  props: PageProps;
  /** In the Map's sheet, which has the title: no header of its own. */
  docked?: true | undefined;
}) {
  // The Map's sheet is 460px wide: its rows draw as a phone's do.
  const narrow = useNarrow() || !!docked;
  return (
    <>
      {docked ? null : (
        <PageHeader
          title="Today"
          lede={`${DATE.format(new Date())}. What to write, what to move, then every app.`}
        />
      )}
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
      <WriteList narrow={narrow} />
      <ProposalsLine props={props} />
      <MoveList moves={moves} read={read} narrow={narrow} />
      <AppsByArea apps={apps} waiting={waiting} team />
    </>
  );
}

/** A client's Today: what waits, a card per service they bought (its app's glance), the add-on. */
export function ClientToday({
  name,
  apps,
  waiting,
  read,
  installed,
  pins,
  props,
  docked,
}: {
  name: string;
  apps: Module[];
  waiting: Waiting;
  read: WaitingRead;
  installed: ReadonlySet<string>;
  pins: PinLine[];
  props: PageProps;
  /** In the Map's sheet, which has the title: no header of its own. */
  docked?: true | undefined;
}) {
  const account = useAccount(props);
  const narrow = useNarrow() || !!docked;
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
      {docked ? null : <PageHeader title="Today" lede={`Everything Wren runs for ${name}.`} />}
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
      <ProposalsLine props={props} />
      <NeedsYou apps={apps} waiting={waiting} read={read} narrow={narrow} />
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
      <AppsByArea apps={apps} waiting={waiting} team={false} />
    </>
  );
}
