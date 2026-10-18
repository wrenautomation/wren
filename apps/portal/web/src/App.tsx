/**
 * The portal: who's signed in, whose workspace, and Wren's apps for it. "/" is Today: what waits
 * across every app. The sidebar holds every app under its area (areas.ts); the open one unfolds
 * into its pages (/<app>/<page>), tabs on a phone. A viewer with one app (the demo) skips Today
 * and lands in it. Wren's team is in Wren's own workspace, its apps on Wren's records; View as
 * opens a client, or a person there, in this tab (./view-as.tsx).
 */

import type { Permission, Who } from "@wren/core/access";
import {
  AboutProvider,
  AppShell,
  Button,
  ButtonLink,
  can,
  type DockItem,
  dropPreloadedLook,
  EDITS,
  Empty,
  Gate,
  LOOK_PREF,
  LoadFailed,
  Loading,
  moved,
  type NavArea,
  type NavItem,
  type PaletteItem,
  type PinLine,
  RAIL_PREF,
  type RailPins,
  type RailPref,
  readTheme,
  ShowRawErrors,
  SnippetsProvider,
  type SnippetsSource,
  type Theme,
  Toasts,
  themeVars,
  togglePin,
  useDisplay,
  usePref,
  type Viewer,
} from "@wren/ui";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { whoAt } from "./access.js";
import { call, ME_CHANGED, type Me, signOutUrl, viewing } from "./api.js";
import { areasOf, dockOf, phoneTabsOf } from "./areas.js";
import { Contained } from "./contained.js";
import { dictation } from "./dictation/index.js";
import { useShareFlags } from "./flags.js";
import { useCall } from "./load.js";
import { LookProvider } from "./look-pref.js";
import { type Module, type ModulePage, type PageProps, WREN } from "./module.js";
import { appsIn, MODULES } from "./modules/index.js";
import { LearnBell } from "./modules/learn/bell.js";
import { capture, makeCard, QuickNote, useQuickNoteKey } from "./modules/notes/capture.js";
import { REACTIVATION } from "./modules/reactivation/nav.js";
import { askClaude } from "./modules/wren/ask.js";
import { HandSwitch, keepOf, TemplatePage } from "./records.js";
import { href, navigate, setWorkspace, useRoute } from "./route.js";
import { SurveyCard } from "./survey.js";
import { ClientToday, WrenToday } from "./today.js";
import { openViewAs, VIEW_AS_HREF, ViewAsPicker, ViewAsStrip } from "./view-as.js";
import { appTotal, useWaiting } from "./waiting.js";

const STAMP = "/wren-icon.png";
const WORKSPACE_KEY = "wren.portal.workspace";
const THEME_KEY = "wren.portal.theme";
/** The look last shown, painted by public/look.js before `me` answers on the next load. */
const LOOK_KEY = "wren.portal.look";
/** A link under the Layout settings. */
const MORE_LINK =
  "text-(--ui-ink-2) underline decoration-(--ui-ink-3) underline-offset-[0.24em] hover:text-(--ui-ink)";

const pathOf = (m: Module, p: ModulePage) => `/${m.id}/${p.id}`;
/** A tab's link: a filter across both pages (Content's platform) goes along. */
const tabOf = (m: Module, from: ModulePage, to: ModulePage, params: URLSearchParams) => {
  const field = from.across?.field;
  if (!field || to.across?.field !== field) return pathOf(m, to);
  return href(pathOf(m, to), { [field]: params.get(field) });
};
/** An app's first tab: its first page that isn't reached by link only. */
const firstPage = (m: Module) => m.pages.find((p) => !p.hidden) ?? m.pages[0];
const firstOf = (m: Module) => {
  const p = firstPage(m);
  return p ? pathOf(m, p) : "/";
};
const teamOnly = (m: Module) => m.requires?.audience === "team";

/** ⌘K. Loaded on the first press, so cmdk stays out of the first load. */
const CommandPalette = lazy(() =>
  import("@wren/ui/palette").then((m) => ({ default: m.CommandPalette })),
);

/**
 * The open app's tabs read from its data (Learn's places and collections), in the workspace on
 * screen: again on every move, and when the app says they changed.
 */
function useModuleNav(
  module: Module | undefined,
  client: string | undefined,
  team: boolean,
  at: string,
): NavItem[] {
  const nav = module?.nav;
  const key = nav && client ? `${module.id}:${client}:${team}` : "";
  const [again, setAgain] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names the module and workspace.
  useEffect(() => (key ? nav?.changed?.(() => setAgain((n) => n + 1)) : undefined), [key]);
  // A move reads them again. Not kept on the device: a tab can carry its drop handler.
  const got = useCall(
    key && nav && client ? `nav:${key}:${at}:${again}` : null,
    async () => ({ key, items: client ? await (nav?.load(client, team) ?? []) : [] }),
    { kept: false },
  );
  // The answer before stays while the next loads: never another app's tabs.
  return got.data?.key === key ? got.data.items : [];
}

/** Open (true), shut (false), or never asked for (null): ⌘K or Ctrl+K toggles it. */
function usePaletteKey() {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return [open, setOpen] as const;
}

/**
 * G then a letter opens a page of the app you're in: each page takes the first letter of its
 * label no page before it took, so the letters hold while the pages do.
 */
export function goKeys(m: Module | undefined): Map<string, string> {
  const keys = new Map<string, string>();
  for (const p of m?.pages.filter((x) => !x.hidden) ?? []) {
    const free = [...p.label.toLowerCase()].find((c) => /[a-z]/.test(c) && !keys.has(c));
    if (free) keys.set(free, pathOf(m as Module, p));
  }
  return keys;
}

function useGoKeys(keys: Map<string, string>) {
  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        t?.closest("input, textarea, select, [contenteditable]")
      )
        return;
      const k = e.key.toLowerCase();
      if (Date.now() - armed < 1000 && keys.has(k)) {
        armed = 0;
        e.preventDefault();
        e.stopImmediatePropagation();
        navigate(keys.get(k) as string);
      } else armed = k === "g" ? Date.now() : 0;
    };
    // Capture: the letter after G is the jump's, not a list action's.
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [keys]);
}

/** ⌘K's list: Today, then every page this viewer may open, by app, with its G key if it has one. */
const jumps = (
  apps: Module[],
  launcher: string | undefined,
  keys: Map<string, string>,
): PaletteItem[] => {
  const keyOf = new Map([...keys].map(([k, href]) => [href, `G ${k.toUpperCase()}`]));
  return [
    ...(launcher ? [{ label: "Today", group: "Wren", href: launcher, icon: "home" as const }] : []),
    ...apps.flatMap((m) =>
      m.pages
        .filter((p) => !p.hidden)
        .map((p) => ({
          label: p.label,
          group: m.name,
          href: pathOf(m, p),
          icon: m.icon,
          hint: keyOf.get(pathOf(m, p)),
        })),
    ),
  ];
};

/**
 * The apps and pages this viewer may see (`requires`): the team's own only in team view, a
 * client's own never on the demo. Until the server says which host this is, it counts as the
 * demo, so a client's own waits.
 */
const shown = (viewer: Viewer) =>
  MODULES.filter((m) => can(viewer, m.requires)).map((m) => ({
    ...m,
    pages: m.pages.filter((p) => can(viewer, p.requires)),
  }));

const withCan = (can: readonly Permission[] | undefined) => (can ? { can } : {});
const withWho = (who: Who | undefined) => (who !== undefined ? { who } : {});

/** His pins that still open a page he may see, named by their app; the rest wait unshown. */
export function pinLines(pins: readonly string[], apps: Module[]): PinLine[] {
  return pins.flatMap((href) => {
    const at = place(href.split("/").filter(Boolean), apps, true);
    if (at.kind !== "page") return [];
    const first = firstPage(at.module)?.id === at.page.id;
    return [{ href, label: first ? at.module.name : at.page.label, icon: at.module.icon }];
  });
}

/** Where an address goes: an app's page, Today (`launcher`), or elsewhere (`to`) once the viewer is known. */
type Place =
  | { kind: "page"; module: Module; page: ModulePage }
  | { kind: "launcher" }
  | { kind: "go"; to: string }
  | { kind: "wait" };

function place(path: string[], apps: Module[], known: boolean): Place {
  const cards = apps.filter((m) => !m.menu);
  const [only] = cards;
  const home = cards.length === 1 && only ? firstOf(only) : "/";
  if (!path.length) {
    if (!known) return { kind: "wait" };
    return home === "/" ? { kind: "launcher" } : { kind: "go", to: home };
  }
  const module = apps.find((m) => m.id === path[0]);
  const page = module?.pages.find((p) => p.id === path[1]);
  if (module && page) return { kind: "page", module, page };
  // "/reactivation" alone opens the app; anything else unknown goes home.
  if (module && path.length === 1) return { kind: "go", to: firstOf(module) };
  return known ? { kind: "go", to: home } : { kind: "wait" };
}

const recall = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const keep = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

/**
 * The workspace's look (`clients.look`), or Wren's. `?theme=night` tries a preset over it and
 * remembers the try; `?theme=` drops the try.
 */
function useLook(params: URLSearchParams, look: unknown): Theme {
  const asked = params.get("theme");
  useEffect(() => {
    if (asked !== null) keep(THEME_KEY, asked);
  }, [asked]);
  return readTheme((asked ?? recall(THEME_KEY)) || look);
}

export function App() {
  const route = useRoute();
  const me = useCall("me", () => call<Me>("delivery/me"));
  // A saved look or a changed install reaches the open workspace without a reload.
  useEffect(() => {
    const again = () => me.retry();
    addEventListener(ME_CHANGED, again);
    return () => removeEventListener(ME_CHANGED, again);
  });
  // A link in our mail names its client (`?client=acme`): open that one, and stay on it.
  const named = route.params.get("client");
  const [client, setClient] = useState<string | null>(() => named ?? recall(WORKSPACE_KEY));
  const [jump, setJump] = usePaletteKey();
  const operator = me.data?.operator ?? false;
  // Dictation's timings go to Voice > Latency, for Wren's team only (`voice/dictated`).
  useEffect(() => {
    if (!dictation) return;
    dictation.report =
      operator && !me.data?.demo
        ? (run) => void call("voice/dictated", { run }).catch(() => {})
        : null;
  }, [operator, me.data?.demo]);
  // An address names its app, and the app its workspace. Wren's team is at Wren unless a link
  // names a client; a client's person, at the last one opened.
  const atWren = !named && (operator || client === null || client === WREN.id);
  // Marketing is both a client's app and Wren's: the one for the workspace already picked.
  const kind =
    MODULES.find((m) => m.id === route.path[0] && teamOnly(m) === atWren) ??
    MODULES.find((m) => m.id === route.path[0]);
  const wren = operator && (kind ? teamOnly(kind) : atWren);
  const team = operator;
  const onDemo = me.data ? me.data.demo : null;
  const clients = me.data?.clients ?? [];
  const current = wren
    ? WREN
    : (clients.find((c) => c.id === (operator ? named : client)) ?? clients[0] ?? null);
  const installed = new Set(current && "installed" in current ? current.installed : []);
  // What this login holds here: in Wren's apps its team role's, in a client's that client's.
  const canAt = (id: string | undefined) =>
    onDemo !== false
      ? undefined
      : id === WREN.id
        ? me.data?.team?.wren
        : clients.find((c) => c.id === id)?.can;
  const held = canAt(current?.id);
  // Its flags here, as the server evaluated them; none on the demo.
  const flags =
    (onDemo === false &&
      (current?.id === WREN.id
        ? me.data?.team?.flags
        : clients.find((c) => c.id === current?.id)?.flags)) ||
    {};
  useShareFlags(flags);
  const apps = appsIn(shown({ team, demo: onDemo !== false, flags, ...withCan(held) }), {
    wren,
    team,
    installed,
  });
  const here = apps.find((m) => m.id === route.path[0]);
  const pages = here?.pages.map((p) => p.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pages` names what `here` gives.
  const keys = useMemo(() => goKeys(here), [here?.id, pages]);
  useGoKeys(keys);
  // Menu apps (the account) are reached from the client's name, not the sidebar.
  const cards = apps.filter((m) => !m.menu);
  const [only] = cards;
  // One app needs no Today: its first page is home.
  const launcher = cards.length > 1 ? "/" : undefined;
  const home = launcher ?? (only ? firstOf(only) : "/");
  const account = apps.find((m) => m.menu);

  const at = place(route.path, apps, me.data !== null);
  // What he keeps here (pins, tiles): Wren's apps, or this client; never on a demo.
  const sample = onDemo !== false || !!clients.find((c) => c.id === current?.id)?.demo;
  const keeper =
    current && !sample ? keepOf(wren ? null : current.id, { app: "", asClient: !team }) : undefined;
  const rail = usePref<RailPref>(keeper, RAIL_PREF);
  // Wren's team keeps one layout and one look of his own at Wren, in every workspace; a client
  // keeps a layout per workspace. A sample keeps it in the browser.
  const mine = operator ? keepOf(null, { app: "", asClient: false }) : keeper;
  const display = useDisplay(mine);
  const myLook = usePref<unknown>(operator ? mine : undefined, LOOK_PREF);
  // Quick capture (N, ⌘K "Note: …") where this login has Notes, never on a sample or under View as.
  const noteAt =
    current && !sample && !viewing && apps.some((m) => m.id === "notes") ? current.id : null;
  const [quick, setQuick] = useQuickNoteKey(noteAt !== null);
  // ⌘K finds records as you type in each app here that can (`find`: people, clients, deals,
  // workflows, templates, pages, Learn's items); never on a sample.
  const finders = apps.filter((m) => m.find);
  const finder =
    current && !sample && finders.length
      ? async (q: string): Promise<PaletteItem[]> =>
          (
            await Promise.all(
              finders.map((m) =>
                (m.find?.(q, current.id) ?? Promise.resolve([]))
                  .then((rows) => rows.map((r) => ({ ...r, group: m.name, icon: m.icon })))
                  .catch(() => []),
              ),
            )
          ).flat()
      : undefined;
  // The team's snippets, inserted in any draft it writes: Wren's, wherever it drafts.
  const snippets = useMemo(
    () => (team && onDemo === false ? snippetsFor(wren ? null : (current?.id ?? null)) : null),
    [team, onDemo, wren, current?.id],
  );
  const pinned = rail.value?.pins ?? [];
  const pins = pinLines(pinned, apps);
  const onPage = at.kind === "page" ? pathOf(at.module, at.page) : undefined;
  const setPins = (next: string[]) => rail.set(next.length ? { pins: next } : null);
  const railPins: RailPins | undefined =
    keeper && rail.ready
      ? {
          pins,
          here: !!onPage && pinned.includes(onPage),
          current: onPage,
          onToggle: () => onPage && setPins(togglePin(pinned, onPage)),
          // Moves count among the shown pins; one he can't see now keeps its place after them.
          onMove: (from, to) => {
            const shown = pins.map((p) => p.href);
            setPins([...moved(shown, from, to), ...pinned.filter((h) => !shown.includes(h))]);
          },
          onRemove: (href) => setPins(pinned.filter((h) => h !== href)),
          onClear: () => setPins([]),
        }
      : undefined;
  const to = at.kind === "go" ? at.to : null;
  useEffect(() => {
    if (to) navigate(to, true);
  }, [to]);

  useEffect(() => {
    if (!named) return;
    setClient(named);
    keep(WORKSPACE_KEY, named);
  }, [named]);

  const theme = useLook(
    route.params,
    wren ? myLook.value : clients.find((c) => c.id === current?.id)?.look,
  );
  // Once this login's look is known, it replaces the preloaded one and is kept for the next load.
  const lookKnown = me.data !== null && (!operator || myLook.ready);
  const lookVars = JSON.stringify(themeVars(theme));
  useEffect(() => {
    if (!lookKnown) return;
    dropPreloadedLook();
    keep(LOOK_KEY, lookVars);
  }, [lookKnown, lookVars]);
  const { waiting, read: waitRead } = useWaiting(
    cards,
    current?.id,
    wren,
    team,
    at.kind === "page" ? at.module.id : undefined,
    at.kind === "page" ? at.page.id : "",
  );
  const extra = useModuleNav(
    at.kind === "page" ? at.module : undefined,
    current?.id,
    team,
    `${route.path.join("/")}?${route.params}`,
  );
  // Words typed from here on wait under the client on screen (set before its boxes read them).
  EDITS.setClient(current?.id ?? null);
  // A route's loader reads ahead in this workspace; a sample reads nothing ahead.
  setWorkspace(current && me.data ? { id: current.id, team, demo: sample } : null);
  const label = at.kind === "page" ? at.page.label : at.kind === "launcher" ? "Today" : null;
  useEffect(() => {
    if (label && current) document.title = `${label} · ${current.name} · Wren Client Portal`;
  }, [label, current]);

  if (me.error && !me.data)
    return (
      <Gate stamp={STAMP} title="Your client portal" theme={theme}>
        <LoadFailed error={me.error} onRetry={me.retry} />
      </Gate>
    );
  if (me.data && !current)
    return (
      <Gate stamp={STAMP} title="Nothing here yet" theme={theme}>
        <p>
          This login isn't linked to a client list. Reply to your onboarding email and we'll add it.
        </p>
        {signOutUrl ? (
          <ButtonLink size="dense" href={signOutUrl} tone="secondary">
            Use another email
          </ButtonLink>
        ) : null}
      </Gate>
    );
  if (at.kind !== "page" && at.kind !== "launcher") return null;

  const demo = onDemo ?? false;
  // A client's person in more than one opens another from ⌘K.
  const others: PaletteItem[] = operator
    ? []
    : clients
        .filter((c) => c.id !== current?.id)
        .map((c) => ({ label: `Open ${c.name}`, group: "Clients", href: `/?client=${c.id}` }));
  const viewAsItem: PaletteItem[] =
    operator || viewing
      ? [
          {
            label: "View as…",
            group: "Wren",
            href: VIEW_AS_HREF,
            hint: "A client or a person there",
          },
        ]
      : [];
  // The demo firm stays the demo on the app host too: its actions run in the browser.
  const props = (id: string): PageProps => ({
    client: id,
    demo: demo || !!clients.find((c) => c.id === id)?.demo,
    team,
    params: route.params,
    ...withCan(canAt(id)),
    ...withWho(whoAt(me.data, id)),
  });
  const open = at.kind === "page" ? at : null;
  // The tab lit: one the app reads from its data, else the page's own.
  const lit = open
    ? (open.module.nav?.here(route.path, route.params) ?? open.page.lights ?? open.page.id)
    : "";
  // The team sees every app; one this client hasn't installed points at its Marketplace row.
  const missing =
    !wren && open?.module.component && !installed.has(open.module.component)
      ? open.module.component
      : null;
  const action = open?.module.action;
  const counts = open ? (waiting[open.module.id] ?? {}) : {};
  // Every app by area, what waits in each beside it; none with one app (the demo).
  const areas: NavArea[] | undefined = launcher
    ? areasOf(cards).map(({ area, apps }) => ({
        id: area.id,
        label: area.label,
        ...(area.shut ? { shut: true } : {}),
        apps: apps.map((m) => ({
          id: m.id,
          name: m.name,
          icon: m.icon,
          href: firstOf(m),
          count: appTotal(waiting[m.id]),
          off: !wren && !!m.component && !installed.has(m.component),
          pages: m.pages
            .filter((p) => !p.hidden && p.id !== m.action?.page)
            .map((p) => ({
              id: p.id,
              label: p.label,
              href: pathOf(m, p),
              ...(p.group ? { group: p.group } : {}),
              ...(waiting[m.id]?.[p.id] ? { count: waiting[m.id]?.[p.id] } : {}),
            })),
        })),
      }))
    : undefined;

  // A phone's bottom tabs at home: Home (Today), then what he opens every day; Apps comes after.
  const dock: DockItem[] | undefined = launcher
    ? [
        // Today holds no number: counts sit only where something waits on him (Inbox, To approve).
        { id: "home", label: "Today", icon: "home", href: launcher, on: !open },
        ...dockOf(cards).map(({ app: m, pick }) => {
          const page = pick.page ? m.pages.find((p) => p.id === pick.page) : undefined;
          return {
            id: page ? `${m.id}/${page.id}` : m.id,
            label: pick.label ?? page?.label ?? m.name,
            icon: pick.icon ?? m.icon,
            href: page ? pathOf(m, page) : firstOf(m),
            count: page ? waiting[m.id]?.[page.id] : appTotal(waiting[m.id]),
            on: open?.module.id === m.id && (!page || lit === page.id),
          };
        }),
      ]
    : undefined;

  // The app's action opens its page: one way in, not a tab as well.
  const openTabs = open
    ? open.module.pages
        .filter((p) => (!p.hidden && p.id !== action?.page) || p.id === lit)
        .flatMap((p) => [
          {
            id: p.id,
            label: p.label,
            href: tabOf(open.module, open.page, p, route.params),
            ...(p.group ? { group: p.group } : {}),
            ...(counts[p.id] ? { count: counts[p.id] } : {}),
          },
          ...(p.id === open.module.nav?.after ? extra : []),
        ])
    : [];

  return (
    <SnippetsProvider source={snippets}>
      {/* A failure's raw text, under its plain sentence: Wren's team only. */}
      <ShowRawErrors value={team}>
        <AppShell
          brand={{ name: "Wren", href: home, stamp: STAMP }}
          workspace={{
            current,
            chip: demo ? { label: "Sample company", href: `/${REACTIVATION}/real` } : undefined,
            href: account ? firstOf(account) : undefined,
            label: "Account",
          }}
          launcher={launcher}
          home={launcher ? { label: "Today", href: launcher } : undefined}
          areas={areas}
          dock={dock}
          bar={viewing ? <ViewAsStrip me={me.data} /> : undefined}
          pins={railPins}
          app={
            open
              ? {
                  id: open.module.id,
                  name: open.module.name,
                  icon: open.module.icon,
                  href: firstOf(open.module),
                  tabs: openTabs,
                  dock: phoneTabsOf(open.module.id, openTabs),
                  current: lit,
                  action:
                    action && action.page !== open.page.id ? (
                      <ButtonLink
                        href={`/${open.module.id}/${action.page}`}
                        tone="quiet"
                        size="sm"
                        icon={action.icon}
                      >
                        {action.label}
                      </ButtonLink>
                    ) : undefined,
                }
              : null
          }
          actions={
            <>
              {operator && !viewing && onDemo === false ? (
                <Button tone="quiet" size="sm" onClick={() => openViewAs()}>
                  View as
                </Button>
              ) : null}
              {/* The bell: Learn's alerts for you here. Real workspaces only, never the sample. */}
              {current && onDemo === false && apps.some((m) => m.id === "learn") ? (
                <LearnBell key={current.id} client={current.id} />
              ) : null}
              {account ? (
                <ButtonLink href={firstOf(account)} tone="quiet" size="sm">
                  Account
                </ButtonLink>
              ) : null}
              {signOutUrl ? (
                <ButtonLink href={signOutUrl} tone="quiet" size="sm">
                  Sign out
                </ButtonLink>
              ) : null}
            </>
          }
          page={open ? pathOf(open.module, open.page) : "/"}
          theme={theme}
          display={display}
          customize={
            wren ? (
              <a className={MORE_LINK} href="/settings/look">
                Colors and type
              </a>
            ) : null
          }
          onGo={navigate}
          at={`${location.pathname}${location.search}`}
          deep={!!open && route.path.length > 2}
          wide={!!open && ("template" in open.page || ("wide" in open.page && !!open.page.wide))}
        >
          {!current ? (
            <Loading lines={8} heading />
          ) : open && missing ? (
            <Empty
              action={
                <ButtonLink
                  tone="primary"
                  size="dense"
                  href={`/marketplace/catalog/${encodeURIComponent(missing)}`}
                >
                  Open in Marketplace
                </ButtonLink>
              }
            >
              {open.module.name} isn't installed for {current.name}.
            </Empty>
          ) : open ? (
            <Contained key={`${current.id}/${open.module.id}/${open.page.id}`}>
              <LookProvider value={wren ? myLook : null}>
                <AboutProvider value={open.page.about}>
                  <Suspense fallback={<Loading lines={8} heading />}>
                    {"Page" in open.page ? (
                      open.page.across ? (
                        <HandSwitch
                          {...props(current.id)}
                          across={open.page.across}
                          path={pathOf(open.module, open.page)}
                        >
                          <open.page.Page {...props(current.id)} />
                        </HandSwitch>
                      ) : (
                        <open.page.Page {...props(current.id)} />
                      )
                    ) : (
                      <TemplatePage
                        {...props(current.id)}
                        app={open.module.name}
                        page={open.page}
                        path={pathOf(open.module, open.page)}
                        id={route.path[2]}
                      />
                    )}
                  </Suspense>
                </AboutProvider>
              </LookProvider>
            </Contained>
          ) : wren ? (
            <WrenToday
              apps={cards}
              waiting={waiting}
              read={waitRead}
              pins={pins}
              props={props(current.id)}
            />
          ) : (
            <ClientToday
              key={current.id}
              name={current.name}
              apps={cards}
              waiting={waiting}
              read={waitRead}
              installed={installed}
              props={props(current.id)}
              pins={pins}
            />
          )}
        </AppShell>
      </ShowRawErrors>
      <Toasts />
      {operator || viewing ? <ViewAsPicker /> : null}
      {noteAt && quick ? <QuickNote client={noteAt} open={quick} onOpenChange={setQuick} /> : null}
      {!operator && onDemo === false && current && current.id !== WREN.id ? (
        <SurveyCard client={current.id} />
      ) : null}
      {jump === null ? null : (
        <Suspense fallback={null}>
          <CommandPalette
            open={jump}
            onOpenChange={setJump}
            items={[...jumps(apps, launcher, keys), ...viewAsItem, ...others]}
            onPick={(href) => (href === VIEW_AS_HREF ? openViewAs() : navigate(href))}
            capture={noteAt ? (words) => void capture(noteAt, words) : undefined}
            card={noteAt ? (title) => void makeCard(noteAt, title) : undefined}
            find={finder}
            recentKey={finder ? current?.id : undefined}
            ask={
              me.data?.team?.wren.includes("run")
                ? (q) => void askClaude(q, location.pathname + location.search)
                : undefined
            }
          />
        </Suspense>
      )}
    </SnippetsProvider>
  );
}

const FAVORITES = "favorites:library.snippet";
const SNIPPETS = new Map<string, SnippetsSource>();
/** Wren's snippets, read in the workspace on screen; favorites are kept at Wren, one list. */
function snippetsFor(client: string | null): SnippetsSource {
  const key = client ?? WREN.id;
  let source = SNIPPETS.get(key);
  if (!source) {
    const wren = keepOf(null, { app: "", asClient: false });
    source = {
      list: () => call("console/snippets", client ? { client } : {}),
      favorites: async () => {
        const got = (await wren.prefs([FAVORITES]))[FAVORITES];
        return Array.isArray(got) ? got.filter(Number.isSafeInteger) : [];
      },
      setFavorites: (ids) => wren.setPref(FAVORITES, ids.length ? ids : null),
    };
    SNIPPETS.set(key, source);
  }
  return source;
}
