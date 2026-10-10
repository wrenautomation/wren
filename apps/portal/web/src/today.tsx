/**
 * "/": Today. What waits on you across every app, then how the day goes (Wren's) or the services
 * bought (a client's), then the pins. On a phone, where the sidebar hides, the apps by area too
 * (designs/2026-10-10-portal-areas.md).
 */
import {
  AppCard,
  AppGrid,
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
import { areasOf } from "./areas.js";
import { Contained } from "./contained.js";
import type { Module, OverviewPage, PageProps } from "./module.js";
import { useAccount } from "./modules/account/load.js";
import { SetupNow } from "./modules/account/Now.js";
import { AddOn } from "./modules/marketplace/AddOn.js";
import { HealthNow } from "./modules/wren/health.js";
import { TemplatePage } from "./records.js";
import { appTotal, type Waiting } from "./waiting.js";

const CALLS = "email.call";

/** Wren's day in numbers, and the next calls with their briefs one click away. */
const DAY: OverviewPage = {
  id: "overview",
  label: "Today",
  template: "overview",
  tiles: [
    { label: "Replies today", record: "email.reply", href: "/inbox/replies?view=all", period: 1 },
    {
      label: "Booked this week",
      record: CALLS,
      href: "/inbox/calls?view=booked",
      period: 7,
      at: "booked",
    },
    { label: "Upcoming calls", record: CALLS, href: "/inbox/calls?view=upcoming" },
    { label: "Calls to mark", record: CALLS, href: "/inbox/calls?view=past", needs: true },
  ],
  top: [
    {
      label: "Next calls",
      record: CALLS,
      href: "/inbox/calls?view=upcoming",
      fields: ["company", "start"],
      empty: "No call is booked.",
    },
  ],
};

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
    <Section title="Needs you" plain>
      {lines.length ? (
        <ul className="list-none border-y border-(--ui-hair)">
          {lines.map(({ m, p, n }) => (
            <Row key={`${m.id}/${p.id}`} href={pathOf(m, p.id)} icon={m.icon} count={n}>
              {p.label} <span className={MUTED}>· {m.name}</span>
            </Row>
          ))}
        </ul>
      ) : (
        <p className="text-[14.5px] text-(--ui-ink-2)">Nothing waits on you.</p>
      )}
    </Section>
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
      <PageHeader title="Today" lede={DATE.format(new Date())} />
      {props.team ? <SetupNow client={props.client} team /> : null}
      {props.team ? <HealthNow /> : null}
      <PinnedRow pins={pins} />
      <NeedsYou apps={apps} waiting={waiting} />
      <div className="mt-10">
        <TemplatePage {...props} app="" page={DAY} path="/today" id={undefined} />
      </div>
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
