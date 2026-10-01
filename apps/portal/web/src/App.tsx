/** The portal: who's signed in, whose list, and each product's pages inside Wren's app frame. */
import {
  Alert,
  AppShell,
  Button,
  ButtonLink,
  Gate,
  Loading,
  type NavGroup,
  readTheme,
  type ShellNotice,
  type Theme,
} from "@wren/ui";
import { useEffect, useState } from "react";
import { call, type Me, signOutUrl } from "./api.js";
import { useCall } from "./load.js";
import type { Module, ModulePage } from "./module.js";
import { MODULES } from "./modules/index.js";
import { navigate, useRoute } from "./route.js";

const STAMP = "/wren-icon.png";
const CLIENT_KEY = "wren.portal.client";
const THEME_KEY = "wren.portal.theme";
const AS_CLIENT_KEY = "wren.portal.asClient";

const pathOf = (m: Module, p: ModulePage) => `/${m.id}/${p.id}`;

/**
 * The sections this viewer sees: the team's own only in team view, and a
 * client's own project never on the demo. `demo` is null until the server says
 * which host this is; those sections wait for it.
 */
const shown = (team: boolean, demo: boolean | null) =>
  MODULES.filter((m) => (team || !m.team) && (demo === false || !m.noDemo));

/** The first page of the first section this viewer sees. */
const homeOf = (team: boolean, demo: boolean | null) => {
  const [first] = shown(team, demo);
  return first?.pages[0] ? pathOf(first, first.pages[0]) : "/";
};

const navOf = (team: boolean, demo: boolean | null): NavGroup[] =>
  shown(team, demo).map((m) => ({
    id: m.id,
    label: m.name,
    items: m.pages.map((p) => ({
      id: pathOf(m, p),
      label: p.label,
      href: pathOf(m, p),
      icon: p.icon,
    })),
  }));

function find(
  path: string[],
  team: boolean,
  demo: boolean | null,
): { module: Module; page: ModulePage } | null {
  const module = shown(team, demo).find((m) => m.id === path[0]);
  const page = module?.pages.find((p) => p.id === path[1]);
  return module && page ? { module, page } : null;
}

const DEMO: ShellNotice = {
  label: "Demo",
  lead: "Built from a real agency's public client list.",
  body: (
    <>
      <b>Real:</b> the companies, the people (last names shortened), their job changes, who's
      hiring, and every source. <b>Made up:</b> owners, statuses, dates and email addresses, since
      those live in a CRM we don't have.
    </>
  ),
  more: "What's real",
};

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

/** `?theme=night` tries a preset look and remembers it; `?theme=wren` goes back to Wren's. */
function useLook(params: URLSearchParams): Theme {
  const asked = params.get("theme");
  useEffect(() => {
    if (asked !== null) keep(THEME_KEY, asked);
  }, [asked]);
  return readTheme(asked ?? recall(THEME_KEY));
}

export function App() {
  const route = useRoute();
  const me = useCall("me", () => call<Me>("delivery/me"));
  // A link in our mail names its client (`?client=acme`): open that one, and stay on it.
  const named = route.params.get("client");
  const [client, setClient] = useState<string | null>(() => named ?? recall(CLIENT_KEY));
  // Wren's team can look as the client would: no internal notes, no team tools.
  const [asClient, setAsClient] = useState(() => recall(AS_CLIENT_KEY) === "1");
  const theme = useLook(route.params);
  const operator = me.data?.operator ?? false;
  const team = operator && !asClient;
  const onDemo = me.data ? me.data.demo : null;
  const home = homeOf(team, onDemo);

  const at = find(route.path, team, onDemo);
  // An unknown address (or just "/") lands on this viewer's first page, once
  // the server says who's asking and on which host.
  const lost = !at && me.data !== null;
  useEffect(() => {
    if (lost) navigate(home, true);
  }, [lost, home]);

  useEffect(() => {
    if (!named) return;
    setClient(named);
    keep(CLIENT_KEY, named);
  }, [named]);

  const clients = me.data?.clients ?? [];
  const current = clients.find((c) => c.id === client) ?? clients[0] ?? null;
  useEffect(() => {
    if (at && current) document.title = `${at.page.label} · ${current.name} · Wren Client Portal`;
  }, [at, current]);

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
  if (!at) return null;

  const pick = (id: string) => {
    setClient(id);
    keep(CLIENT_KEY, id);
  };
  const { module, page } = at;
  const demo = onDemo ?? false;
  const action = module.action;
  const flip = () => {
    setAsClient(team);
    keep(AS_CLIENT_KEY, team ? "1" : "0");
  };

  return (
    <AppShell
      brand={{ name: "Wren", href: home, stamp: STAMP }}
      workspace={{
        current,
        options: clients,
        caption: demo ? "Demo workspace" : "Workspace",
        onPick: pick,
      }}
      nav={navOf(team, onDemo)}
      current={pathOf(module, page)}
      crumbs={[
        ...(current && !module.team ? [{ label: current.name, href: home }] : []),
        { label: module.name, href: module.pages[0] ? pathOf(module, module.pages[0]) : home },
        { label: page.label },
      ]}
      notice={demo ? DEMO : undefined}
      actions={
        <>
          {action && action.page !== page.id ? (
            <ButtonLink
              href={`/${module.id}/${action.page}`}
              tone="quiet"
              size="sm"
              icon={action.icon}
            >
              {action.label}
            </ButtonLink>
          ) : null}
          {operator ? (
            <Button tone="quiet" size="sm" onClick={flip}>
              {team ? "View as client" : "Back to team view"}
            </Button>
          ) : null}
          {signOutUrl ? (
            <ButtonLink href={signOutUrl} tone="quiet" size="sm">
              Sign out
            </ButtonLink>
          ) : null}
        </>
      }
      page={pathOf(module, page)}
      theme={theme}
    >
      {current ? (
        <page.Page
          key={current.id}
          client={current.id}
          demo={demo}
          team={team}
          params={route.params}
        />
      ) : (
        <Loading lines={8} heading />
      )}
    </AppShell>
  );
}
