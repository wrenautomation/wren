/** The portal: who's signed in, whose list, and each product's pages inside Wren's app frame. */
import {
  Alert,
  AppShell,
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

const pathOf = (m: Module, p: ModulePage) => `/${m.id}/${p.id}`;
const [first] = MODULES;
const HOME = first?.pages[0] ? pathOf(first, first.pages[0]) : "/";

const NAV: NavGroup[] = MODULES.map((m) => ({
  id: m.id,
  label: m.name,
  items: m.pages.map((p) => ({
    id: pathOf(m, p),
    label: p.label,
    href: pathOf(m, p),
    icon: p.icon,
  })),
}));

function find(path: string[]): { module: Module; page: ModulePage } | null {
  const module = MODULES.find((m) => m.id === path[0]);
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
  const me = useCall("me", () => call<Me>("me"));
  const [client, setClient] = useState<string | null>(() => recall(CLIENT_KEY));
  const theme = useLook(route.params);

  const at = find(route.path);
  const lost = !at;
  // An unknown address (or just "/") lands on the first page.
  useEffect(() => {
    if (lost) navigate(HOME, true);
  }, [lost]);

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
  const demo = me.data?.demo ?? false;
  const action = module.action;

  return (
    <AppShell
      brand={{ name: "Wren", href: HOME, stamp: STAMP }}
      workspace={{
        current,
        options: clients,
        caption: demo ? "Demo workspace" : "Workspace",
        onPick: pick,
      }}
      nav={NAV}
      current={pathOf(module, page)}
      crumbs={[
        ...(current ? [{ label: current.name, href: HOME }] : []),
        { label: module.name, href: module.pages[0] ? pathOf(module, module.pages[0]) : HOME },
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
        <page.Page key={current.id} client={current.id} demo={demo} params={route.params} />
      ) : (
        <Loading lines={8} heading />
      )}
    </AppShell>
  );
}
