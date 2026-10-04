/**
 * The portal: who's signed in, whose workspace, and Wren's apps for it. "/" is the launcher, a
 * card per app. An open app lists its pages (/<app>/<page>) in a sidebar, as tabs on a phone. A
 * viewer with one app (the demo) skips the launcher and lands in it. Wren's team starts in Wren's
 * own workspace, its apps on Wren's records; the switcher moves to the demo or a client.
 */
import {
  Alert,
  AppCard,
  AppGrid,
  AppShell,
  Button,
  ButtonLink,
  can,
  Gate,
  Loading,
  PageHeader,
  type PaletteItem,
  readTheme,
  type Theme,
  Toasts,
  type Viewer,
} from "@wren/ui";
import { Component, lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { call, type Me, signOutUrl } from "./api.js";
import { useCall } from "./load.js";
import { type Module, type ModulePage, type PageProps, WREN } from "./module.js";
import { useAccount } from "./modules/account/load.js";
import { MODULES } from "./modules/index.js";
import { REACTIVATION } from "./modules/reactivation/nav.js";
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

/** ⌘K's list: home, then every page this viewer may open, by app. */
const jumps = (apps: Module[], launcher: string | undefined): PaletteItem[] => [
  ...(launcher
    ? [{ label: "All apps", group: "Wren", href: launcher, icon: "apps" as const }]
    : []),
  ...apps.flatMap((m) =>
    m.pages
      .filter((p) => !p.hidden)
      .map((p) => ({ label: p.label, group: m.name, href: pathOf(m, p), icon: m.icon })),
  ),
];

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
  const apps = shown({ team, demo: onDemo !== false }).filter((m) => teamOnly(m) === wren);
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

  const clients = me.data?.clients ?? [];
  const current = wren ? WREN : (clients.find((c) => c.id === client) ?? clients[0] ?? null);
  const theme = useLook(route.params, clients.find((c) => c.id === current?.id)?.look);
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
          <ButtonLink href={signOutUrl} tone="secondary">
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
  });
  const open = at.kind === "page" ? at : null;
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
                {team ? "View as client" : "Back to team view"}
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
          <Launcher key={current.id} name={current.name} apps={cards} props={props(current.id)} />
        )}
      </AppShell>
      <Toasts />
      {jump === null ? null : (
        <Suspense fallback={null}>
          <CommandPalette
            open={jump}
            onOpenChange={setJump}
            items={jumps(apps, launcher)}
            onPick={(href) => navigate(href)}
          />
        </Suspense>
      )}
    </>
  );
}

const card = (m: Module, props?: PageProps) => (
  <AppCard key={m.id} name={m.name} icon={m.icon} href={firstOf(m)} blurb={m.blurb}>
    {m.Glance && props ? (
      <Contained quiet>
        <m.Glance {...props} />
      </Contained>
    ) : null}
  </AppCard>
);

/** A client's "/": the app each service they bought runs in (its plan and paperwork inside), then the rest. */
function Launcher({ name, apps, props }: { name: string; apps: Module[]; props: PageProps }) {
  const account = useAccount(props);
  if (!account.data && !account.error) return <Loading lines={8} heading />;
  // One heading per offer, newest first; a finished one stays, it still has its paperwork.
  const bought = [...new Map((account.data?.bought ?? []).map((b) => [b.offerId, b])).values()];
  const under = (app: string) => apps.filter((m) => m.id === app);
  const placed = new Set(bought.map((b) => b.app));
  const rest = apps.filter((m) => !m.fallback && !placed.has(m.id));
  return (
    <>
      <PageHeader title="Apps" lede={`Everything Wren runs for ${name}.`} />
      {bought.map((b) => (
        <AppGrid key={b.offerId} label={b.offer}>
          {under(b.app).map((m) => card(m, props))}
        </AppGrid>
      ))}
      {rest.length ? (
        <AppGrid label={bought.length ? "More from Wren" : undefined}>
          {rest.map((m) => card(m, props))}
        </AppGrid>
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
