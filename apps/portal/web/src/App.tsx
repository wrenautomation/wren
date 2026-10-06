/**
 * The portal: who's signed in, whose workspace, and Wren's apps for it. "/" is the launcher, a
 * card per app. An open app lists its pages (/<app>/<page>) in a sidebar, as tabs on a phone. A
 * viewer with one app (the demo) skips the launcher and lands in it. Wren's team starts in Wren's
 * own workspace, its apps on Wren's records; the switcher moves to the demo or a client.
 */

import type { Permission } from "@wren/core/access";
import {
  Alert,
  AppCard,
  AppGrid,
  AppShell,
  Button,
  ButtonLink,
  can,
  Empty,
  Gate,
  Loading,
  PageHeader,
  type PaletteItem,
  readTheme,
  Tag,
  type Theme,
  Toasts,
  type Viewer,
} from "@wren/ui";
import { Component, lazy, type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { call, ME_CHANGED, type Me, signOutUrl } from "./api.js";
import { useCall } from "./load.js";
import { type Module, type ModulePage, type PageProps, WREN } from "./module.js";
import { useAccount } from "./modules/account/load.js";
import { appsIn, MODULES } from "./modules/index.js";
import { AddOn } from "./modules/marketplace/AddOn.js";
import { REACTIVATION } from "./modules/reactivation/nav.js";
import { askClaude } from "./modules/wren/ask.js";
import { TemplatePage } from "./records.js";
import { navigate, useRoute } from "./route.js";

const STAMP = "/wren-icon.png";
const WORKSPACE_KEY = "wren.portal.workspace";
const THEME_KEY = "wren.portal.theme";
const AS_CLIENT_KEY = "wren.portal.asClient";

const pathOf = (m: Module, p: ModulePage) => `/${m.id}/${p.id}`;
const firstOf = (m: Module) => (m.pages[0] ? pathOf(m, m.pages[0]) : "/");
const teamOnly = (m: Module) => m.requires?.audience === "team";

/** ⌘K. Loaded on the first press, so cmdk stays out of the first load. */
const CommandPalette = lazy(() =>
  import("@wren/ui/palette").then((m) => ({ default: m.CommandPalette })),
);

/** Open (true), shut (false), or never asked for (null): ⌘K or Ctrl+K toggles it. */
/** Each open page's waiting count, for its tab: pages with a `count`, in Wren's workspace. */
function useNavCounts(
  module: Module | undefined,
  page: string | undefined,
  on: boolean,
): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  // `module` is rebuilt every render, so its id keys the read: depending on the object looped
  // forever (React #185) wherever a page draws a map.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a tab change reads the counts again.
  useEffect(() => {
    const pages = on ? (module?.pages ?? []).filter((p) => "count" in p && p.count) : [];
    if (!pages.length) return void setCounts((c) => (Object.keys(c).length ? {} : c));
    let live = true;
    void Promise.all(
      pages.map((p) =>
        call<{ total: number }>("console/recordsList", {
          record: (p as { record: string }).record,
          where: (p as { count: unknown }).count,
          limit: 1,
        }).then(
          (r) => [p.id, r.total] as const,
          () => [p.id, 0] as const,
        ),
      ),
    ).then((all) => live && setCounts(Object.fromEntries(all)));
    return () => {
      live = false;
    };
  }, [module?.id, page, on]);
  return counts;
}

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

/** ⌘K's list: home, then every page this viewer may open, by app, with its G key if it has one. */
const jumps = (
  apps: Module[],
  launcher: string | undefined,
  keys: Map<string, string>,
): PaletteItem[] => {
  const keyOf = new Map([...keys].map(([k, href]) => [href, `G ${k.toUpperCase()}`]));
  return [
    ...(launcher
      ? [{ label: "All apps", group: "Wren", href: launcher, icon: "apps" as const }]
      : []),
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

/** Where an address goes: an app's page, the launcher, or elsewhere (`to`) once the viewer is known. */
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
  // Wren's team can look as the client would: no internal notes, no team tools.
  const [asClient, setAsClient] = useState(() => recall(AS_CLIENT_KEY) === "1");
  const [jump, setJump] = usePaletteKey();
  const operator = me.data?.operator ?? false;
  // An address names its app, and the app its workspace; else the last one picked (Wren first).
  const kind = MODULES.find((m) => m.id === route.path[0]);
  const wren =
    operator && (kind ? teamOnly(kind) : !named && (client === null || client === WREN.id));
  const team = operator && (wren || !asClient);
  const onDemo = me.data ? me.data.demo : null;
  const clients = me.data?.clients ?? [];
  const current = wren ? WREN : (clients.find((c) => c.id === client) ?? clients[0] ?? null);
  const installed = new Set(current && "installed" in current ? current.installed : []);
  // What this login holds here: in Wren's apps its team role's, in a client's that client's.
  const canAt = (id: string | undefined) =>
    onDemo !== false
      ? undefined
      : id === WREN.id
        ? me.data?.team?.wren
        : clients.find((c) => c.id === id)?.can;
  const held = canAt(current?.id);
  const apps = appsIn(shown({ team, demo: onDemo !== false, ...withCan(held) }), {
    wren,
    team,
    installed,
  });
  const here = apps.find((m) => m.id === route.path[0]);
  const pages = here?.pages.map((p) => p.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pages` names what `here` gives.
  const keys = useMemo(() => goKeys(here), [here?.id, pages]);
  useGoKeys(keys);
  // Menu apps (the account) are reached from the client's name, not a card.
  const cards = apps.filter((m) => !m.menu);
  const [only] = cards;
  // One app needs no launcher: its first page is home.
  const launcher = cards.length > 1 ? "/" : undefined;
  const home = launcher ?? (only ? firstOf(only) : "/");
  const account = apps.find((m) => m.menu);

  const at = place(route.path, apps, me.data !== null);
  const to = at.kind === "go" ? at.to : null;
  useEffect(() => {
    if (to) navigate(to, true);
  }, [to]);

  useEffect(() => {
    if (!named) return;
    setClient(named);
    keep(WORKSPACE_KEY, named);
  }, [named]);

  const theme = useLook(route.params, clients.find((c) => c.id === current?.id)?.look);
  const counts = useNavCounts(
    at.kind === "page" ? at.module : undefined,
    at.kind === "page" ? at.page.id : undefined,
    wren,
  );
  const label = at.kind === "page" ? at.page.label : at.kind === "launcher" ? "Apps" : null;
  useEffect(() => {
    if (label && current) document.title = `${label} · ${current.name} · Wren Client Portal`;
  }, [label, current]);

  if (me.error && !me.data)
    return (
      <Gate stamp={STAMP} title="Your client portal" theme={theme}>
        <Alert onRetry={me.retry}>{me.error.message}</Alert>
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

  const pick = (id: string) => {
    setClient(id);
    keep(WORKSPACE_KEY, id);
    // Wren's apps and a client's never share an address: the other kind starts at its launcher.
    if ((id === WREN.id) !== wren) navigate("/");
  };
  const demo = onDemo ?? false;
  const flip = () => {
    setAsClient(team);
    keep(AS_CLIENT_KEY, team ? "1" : "0");
  };
  // The demo firm stays the demo on the app host too: its actions run in the browser.
  const props = (id: string): PageProps => ({
    client: id,
    demo: demo || !!clients.find((c) => c.id === id)?.demo,
    team,
    params: route.params,
    ...withCan(canAt(id)),
  });
  const open = at.kind === "page" ? at : null;
  // The team sees every app; one this client hasn't installed points at its Marketplace row.
  const missing =
    !wren && open?.module.component && !installed.has(open.module.component)
      ? open.module.component
      : null;
  const action = open?.module.action;

  return (
    <>
      <AppShell
        brand={{ name: "Wren", href: home, stamp: STAMP }}
        workspace={{
          current,
          options: operator ? [WREN, ...clients] : clients,
          chip: demo ? { label: "Sample firm", href: `/${REACTIVATION}/real` } : undefined,
          href: account ? firstOf(account) : undefined,
          label: operator ? "Workspace" : clients.length > 1 ? "Client" : "Account",
          onPick: pick,
        }}
        launcher={launcher}
        app={
          open
            ? {
                name: open.module.name,
                icon: open.module.icon,
                href: firstOf(open.module),
                tabs: open.module.pages
                  .filter((p) => !p.hidden || p.id === open.page.id)
                  .map((p) => ({
                    id: p.id,
                    label: p.label,
                    href: pathOf(open.module, p),
                    ...(p.group ? { group: p.group } : {}),
                    ...(counts[p.id] ? { count: counts[p.id] } : {}),
                  })),
                current: open.page.id,
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
            {operator && !wren ? (
              <Button tone="quiet" size="sm" onClick={flip}>
                {/* A phone's top bar keeps room for the workspace's name. */}
                <span className="sm:hidden">{team ? "As client" : "Team view"}</span>
                <span className="max-sm:hidden">
                  {team ? "View as client" : "Back to team view"}
                </span>
              </Button>
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
        wide={!!open && "template" in open.page}
      >
        {!current ? (
          <Loading lines={8} heading />
        ) : open && missing ? (
          <Empty
            action={
              <ButtonLink size="dense" href={`/marketplace/catalog/${encodeURIComponent(missing)}`}>
                Open in Marketplace
              </ButtonLink>
            }
          >
            {open.module.name} isn't installed for {current.name}.
          </Empty>
        ) : open ? (
          <Contained key={`${current.id}/${open.module.id}/${open.page.id}`}>
            <Suspense fallback={<Loading lines={8} heading />}>
              {"Page" in open.page ? (
                <open.page.Page {...props(current.id)} />
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
          </Contained>
        ) : wren ? (
          <>
            <PageHeader title="Wren" lede="Wren's own outreach, replies, loops and money." />
            <AppGrid>{cards.map((m) => card(m))}</AppGrid>
          </>
        ) : (
          <Launcher
            key={current.id}
            name={current.name}
            apps={cards}
            installed={installed}
            props={props(current.id)}
          />
        )}
      </AppShell>
      <Toasts />
      {jump === null ? null : (
        <Suspense fallback={null}>
          <CommandPalette
            open={jump}
            onOpenChange={setJump}
            items={jumps(apps, launcher, keys)}
            onPick={(href) => navigate(href)}
            ask={
              me.data?.team?.wren.includes("run")
                ? (q) => void askClaude(q, location.pathname + location.search)
                : undefined
            }
          />
        </Suspense>
      )}
    </>
  );
}

/** `off`: the team sees an app whose component this client hasn't installed, marked. */
const card = (m: Module, props?: PageProps, off = false) => (
  <AppCard key={m.id} name={m.name} icon={m.icon} href={firstOf(m)} blurb={m.blurb}>
    {off ? (
      <Tag>Not installed</Tag>
    ) : m.Glance && props ? (
      <Contained quiet>
        <m.Glance {...props} />
      </Contained>
    ) : null}
  </AppCard>
);

/** A client's "/": the app each service they bought runs in (its plan and paperwork inside), then the rest. */
function Launcher({
  name,
  apps,
  installed,
  props,
}: {
  name: string;
  apps: Module[];
  installed: ReadonlySet<string>;
  props: PageProps;
}) {
  const account = useAccount(props);
  if (!account.data && !account.error) return <Loading lines={8} heading />;
  const under = (app: string) => apps.filter((m) => m.id === app);
  // One heading per offer with its app here, newest first; a finished one stays, it still has its paperwork.
  const bought = [
    ...new Map((account.data?.bought ?? []).map((b) => [b.offerId, b])).values(),
  ].filter((b) => under(b.app).length);
  const shown = (m: Module) =>
    card(m, props, m.component !== undefined && !installed.has(m.component));
  const placed = new Set(bought.map((b) => b.app));
  const rest = apps.filter((m) => !m.fallback && !placed.has(m.id));
  return (
    <>
      <PageHeader title="Apps" lede={`Everything Wren runs for ${name}.`} />
      {props.team || props.demo ? null : (
        <AddOn
          offered={(account.data?.bought ?? []).map((b) => b.addOn)}
          installed={installed}
          props={props}
        />
      )}
      {bought.map((b) => (
        <AppGrid key={b.offerId} label={b.offer}>
          {under(b.app).map(shown)}
        </AppGrid>
      ))}
      {rest.length ? (
        <AppGrid label={bought.length ? "More from Wren" : undefined}>{rest.map(shown)}</AppGrid>
      ) : null}
    </>
  );
}

/** A page that throws breaks itself, never the shell around it. A card's glance just goes blank. */
class Contained extends Component<{ quiet?: boolean; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  // The console keeps what broke, so a report can name it.
  override componentDidCatch(error: unknown) {
    console.error(error);
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.quiet) return null;
    return (
      <Alert onRetry={() => this.setState({ failed: false })}>
        This page hit a problem. Try again, or open another app.
      </Alert>
    );
  }
}
