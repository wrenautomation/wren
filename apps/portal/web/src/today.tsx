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
  Section,
  Tag,
} from "@wren/ui";
import type { ReactNode } from "react";
import { areasOf } from "./areas.js";
import { Contained } from "./contained.js";
import type { Module, PageProps } from "./module.js";
import { useAccount } from "./modules/account/load.js";
import { SetupNow } from "./modules/account/Now.js";
import { SetupCard } from "./modules/account/SetupCard.js";
import { goalsOf, makeAt, usePlan } from "./modules/marketing/plan.js";
import { AddOn } from "./modules/marketplace/AddOn.js";
import { HealthNow } from "./modules/wren/health.js";
import type { Move } from "./moves.js";
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
 * Every page with rows waiting, by area then app: one line each, its count, a link. A failed
 * count says so above the lines it has, never "Nothing waits on you."
 */
function NeedsYou({
  apps,
  waiting,
  read,
}: {
  apps: Module[];
  waiting: Waiting;
  read: WaitingRead;
}) {
  // A client's Today only: Wren's lists its own waiting pages in WrenWork.
  const lines = areasOf(apps, false).flatMap(({ apps }) =>
    apps.flatMap((m) =>
      m.pages
        .filter((p) => !p.hidden && (waiting[m.id]?.[p.id] ?? 0) > 0)
        .map((p) => ({ m, p, n: waiting[m.id]?.[p.id] ?? 0 })),
    ),
  );
  return (
    <Section
      title="Needs you"
      count={lines.length ? lines.reduce((t, l) => t + l.n, 0) : undefined}
    >
      {read.error ? <LoadFailed error={read.error} onRetry={read.retry} what="list" /> : null}
      {lines.length ? (
        <ul className="-my-2 list-none">
          {lines.map(({ m, p, n }) => (
            <Row key={`${m.id}/${p.id}`} href={pathOf(m, p.id)} icon={m.icon} count={n}>
              {p.label} <span className={MUTED}>· {m.name}</span>
            </Row>
          ))}
        </ul>
      ) : read.error ? null : read.loading ? (
        <Loading lines={3} />
      ) : (
        <NothingWaits />
      )}
    </Section>
  );
}

const MORE = cx("text-[13px] underline", MUTED);

/** A quota as words: "1 of 3 today". */
const quotaLine = (l: WriteLine) => `${Math.min(l.have, l.want)} of ${l.want} today`;

/** One platform's line: what is left of today's quota, and where to make the next one. */
function WriteRow({ l }: { l: WriteLine }) {
  const done = met(l);
  const auto = l.id === "autopilot";
  const href = auto ? "/content/plan" : makeAt(l.next.piece, [l.next]).href;
  return (
    <li>
      <a className={ROW} href={href}>
        {done ? (
          <Icon name="check" className="text-(--ui-good)" />
        ) : auto ? (
          <Icon name="bolt" className="text-(--ui-ink-2)" />
        ) : (
          <PlatformMark mark={l.id} />
        )}
        <span className="min-w-0 truncate">
          <span className="font-medium">{l.label}</span>
          <span className={MUTED}>
            {" "}
            · {quotaLine(l)}
            {auto && l.folded.length ? ` · ${l.folded.join(", ")}` : ""}
          </span>
        </span>
      </a>
    </li>
  );
}

/**
 * Write: today's quota per platform from the content plan. Platforms still short come first;
 * those that met theirs fold under one line. X, TikTok and Threads run on their own, one line.
 */
function WriteList() {
  const plan = usePlan();
  const { lines, autopilot } = writeOf(goalsOf(plan.data?.rows));
  const all = [...lines, ...(autopilot ? [autopilot] : [])];
  const short = all.filter((l) => !met(l));
  const done = all.filter(met);
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
        <Loading lines={4} />
      ) : !all.length ? (
        <p className="text-[14.5px] text-(--ui-ink-2)">Nothing is due today.</p>
      ) : (
        <>
          {short.length ? (
            <ul className="-my-2 list-none">
              {short.map((l) => (
                <WriteRow key={l.id} l={l} />
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2.5 text-[14.5px] text-(--ui-ink-2)">
              <Icon name="check" className="text-(--ui-good)" />
              Today's quota is met.
            </p>
          )}
          {done.length ? (
            <details className="mt-3 border-t border-(--ui-hair) pt-3">
              <summary className={cx("cursor-pointer", MUTED)}>Met today · {done.length}</summary>
              <ul className="mt-2 list-none">
                {done.map((l) => (
                  <WriteRow key={l.id} l={l} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </Section>
  );
}

/** One thing to do: the verb, then whom or what it is about. */
function MoveRow({ m }: { m: Move }) {
  return (
    <li>
      <a className={ROW} href={m.href}>
        <Icon name={m.icon} className="text-(--ui-ink-2)" />
        <span className="min-w-0 truncate">
          <span className="font-medium">{m.verb}</span>
          <span className={MUTED}>: </span>
          {m.what}
        </span>
        {m.n > 1 ? <span className={COUNT}>{m.n}</span> : null}
      </a>
    </li>
  );
}

/**
 * Move: what waits on you, grouped by the person's journey (person, funnel, stage), then
 * everything else. A failed read says so above what did load, never "Nothing waits on you."
 */
function MoveList({ moves, read }: { moves: MovesRead; read: WaitingRead }) {
  const error = moves.error ?? read.error;
  const retry = () => {
    read.retry();
    moves.retry();
  };
  const loading = !error && moves.loading;
  const none = !error && !loading && !moves.groups.length;
  const journeys = moves.groups.some((g) => g.head);
  return (
    <Section title="Move" count={loading || none || error ? undefined : moves.count}>
      {error ? <LoadFailed error={error} onRetry={retry} what="list" /> : null}
      {loading ? (
        <Loading lines={5} />
      ) : none ? (
        <NothingWaits />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {moves.groups.map((g) => (
            <div key={g.key}>
              {g.head ? (
                <p className="mb-1 text-[13px] font-medium">
                  {g.head.person}
                  <span className={MUTED}>
                    {" "}
                    · {[g.head.funnel, g.head.stage].filter(Boolean).join(" · ")}
                  </span>
                </p>
              ) : journeys ? (
                <p className={cx("mb-1 font-medium", MUTED)}>Others</p>
              ) : null}
              <ul className="-my-2 list-none">
                {g.moves.map((m) => (
                  <MoveRow key={m.key} m={m} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** The apps by area, for a phone, where the sidebar hides. */
function AppsByArea({ apps, waiting, team }: { apps: Module[]; waiting: Waiting; team: boolean }) {
  return (
    <div className="mt-12 min-[901px]:hidden">
      {areasOf(apps, team).map(({ area, apps }) => (
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
  read,
  moves,
  pins,
  props,
}: {
  apps: Module[];
  waiting: Waiting;
  read: WaitingRead;
  moves: MovesRead;
  pins: PinLine[];
  props: PageProps;
}) {
  return (
    <>
      <PageHeader
        title="Today"
        lede={`${DATE.format(new Date())}. What to write, what to move, then every app.`}
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
      <WriteList />
      <MoveList moves={moves} read={read} />
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
}: {
  name: string;
  apps: Module[];
  waiting: Waiting;
  read: WaitingRead;
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
      <NeedsYou apps={apps} waiting={waiting} read={read} />
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
