/** The shell: who you are, which client, the four pages, and the demo's banner. */
import { useEffect, useState } from "react";
import { call, type Me } from "./api.js";
import { Health } from "./Health.js";
import { Overview } from "./Overview.js";
import { People } from "./People.js";
import { href, PAGES, useRoute } from "./route.js";
import { Sources } from "./Sources.js";
import { Failed, useCall } from "./ui.js";

const CLIENT_KEY = "wren.portal.client";
const remembered = () => {
  try {
    return localStorage.getItem(CLIENT_KEY);
  } catch {
    return null;
  }
};

export function App() {
  const route = useRoute();
  const me = useCall("me", () => call<Me>("me"));
  const [client, setClient] = useState<string | null>(remembered);

  const clients = me.data?.clients ?? [];
  const current = clients.find((c) => c.id === client) ?? clients[0] ?? null;
  useEffect(() => {
    if (current) document.title = `${current.name} · Wren`;
  }, [current]);

  if (me.error && !me.data)
    return (
      <Frame>
        <div className="gate">
          <h1>Your client portal</h1>
          <Failed error={me.error} />
        </div>
      </Frame>
    );
  if (!me.data) return <Frame loading />;
  if (!current)
    return (
      <Frame>
        <div className="gate">
          <h1>Nothing here yet</h1>
          <p>
            This login isn't linked to a client list. Reply to your onboarding email and we'll add
            it.
          </p>
        </div>
      </Frame>
    );

  const pick = (id: string) => {
    setClient(id);
    try {
      localStorage.setItem(CLIENT_KEY, id);
    } catch {}
  };
  const pageProps = { client: current.id, demo: me.data.demo, params: route.params };

  return (
    <Frame
      demo={me.data.demo}
      header={
        <>
          {clients.length > 1 ? (
            <select
              className="client-pick"
              value={current.id}
              onChange={(e) => pick(e.target.value)}
              aria-label="Client"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="client-name">{current.name}</span>
          )}
          <nav className="tabs" aria-label="Pages">
            {PAGES.map((p) => (
              <a
                key={p.page}
                href={href(p.page)}
                aria-current={route.page === p.page ? "page" : undefined}
              >
                {p.label}
              </a>
            ))}
          </nav>
        </>
      }
    >
      {route.page === "overview" && <Overview key={current.id} {...pageProps} />}
      {route.page === "people" && <People key={current.id} {...pageProps} />}
      {route.page === "health" && <Health key={current.id} {...pageProps} />}
      {route.page === "sources" && <Sources key={current.id} {...pageProps} />}
    </Frame>
  );
}

function Frame({
  children,
  header,
  demo,
  loading,
}: {
  children?: React.ReactNode;
  header?: React.ReactNode;
  demo?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="frame">
      <header className="bar">
        <a className="mark" href="#/overview">
          Wren
        </a>
        {header}
      </header>
      {demo ? <DemoBanner /> : null}
      <main className="main">{loading ? <div className="loading">Loading…</div> : children}</main>
    </div>
  );
}

function DemoBanner() {
  return (
    <aside className="demo-banner">
      <b>Demo.</b> Built from a real agency's public client list. <b>Real:</b> the companies, the
      people (last names shortened), their job changes, who's hiring, and every source.{" "}
      <b>Made up:</b> owners, statuses, dates and email addresses, since those live in a CRM we
      don't have.
    </aside>
  );
}
