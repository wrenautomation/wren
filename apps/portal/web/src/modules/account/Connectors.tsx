/**
 * Account → Connectors (designs/2026-10-09-connectors.md): the client's HubSpot, QuickBooks and
 * Jobber, one framed section each with its state (Needs setup, Not connected, Connected, Broken),
 * what it reads and what it tells workflows. Connecting sends the person to the app to sign in.
 */
import type { ConnectorsPageView } from "@wren/connectors";
import {
  Button,
  Callout,
  Empty,
  LoadFailed,
  Loading,
  PageHeader,
  Section,
  Tag,
  type TagTone,
  useNarrow,
} from "@wren/ui";
import { useState } from "react";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { PageRows, RowDoes, rowLines, useGoing } from "../../page-rows.js";
import { ERROR, QUIET } from "../work/bits.js";

type View = Extract<ConnectorsPageView, { wren: false }>;
type App = View["apps"][number];
type Link = App["links"][number];

const TAGS: Record<App["state"], { label: string; tone: TagTone }> = {
  connected: { label: "Connected", tone: "green" },
  not_connected: { label: "Not connected", tone: "neutral" },
  broken: { label: "Broken", tone: "warn" },
  needs_setup: { label: "In development", tone: "accent" },
};

/** A write to Connectors: busy while it runs, its refusal shown, then a reload. */
function useConnectorAct(client: string, reload: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const run = async <T,>(route: string, body: Record<string, unknown>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    setSaid(null);
    try {
      const out = await call<T>(`connectors/${route}`, { client, ...body });
      reload();
      return out;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, said, setSaid, run };
}
type Act = ReturnType<typeof useConnectorAct>;

async function connect(act: Act, app: string) {
  const out = await act.run<{ url?: string }>("connect", { app });
  if (out?.url) window.location.assign(out.url);
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** An app's connected accounts, a row each: state, what it brought in, when it was last read. */
function Links({ links, mayAct, act }: { links: Link[]; mayAct: boolean; act: Act }) {
  const narrow = useNarrow();
  const going = useGoing();
  const whoOf = (l: Link) => l.name ?? `Account ${l.externalId}`;
  return (
    <PageRows<Link>
      label="Connected accounts"
      noun="account"
      lines={rowLines(
        links,
        (l) => String(l.id),
        (l) => (l.why ? <p className={l.state === "broken" ? ERROR : QUIET}>{l.why}</p> : null),
      )}
      rowState={(l) => going.stateOf(String(l.id))}
      name={{
        label: "Account",
        icon: "link",
        min: 220,
        title: whoOf,
        sub: (l) => (
          <span className={`${QUIET} wrap-anywhere whitespace-normal text-[12.5px]`}>
            Connected by {l.by}
          </span>
        ),
      }}
      columns={[
        {
          key: "state",
          label: "State",
          icon: "pulse",
          width: 130,
          phone: true,
          cell: (l) => <Tag tone={TAGS[l.state].tone}>{TAGS[l.state].label}</Tag>,
        },
        {
          key: "brought",
          label: "Brought in",
          icon: "people",
          min: 190,
          className: "max-[1000px]:hidden",
          cell: (l) => `${l.people} people, ${l.fired} told to workflows`,
        },
        {
          key: "read",
          label: "Last read",
          icon: "clock",
          width: 150,
          quiet: true,
          className: "max-[900px]:hidden",
          cell: (l) => (l.syncedAt ? when(l.syncedAt) : "On its way"),
        },
      ]}
      end={
        mayAct
          ? (l) => (
              <RowDoes
                title={whoOf(l)}
                lone={narrow}
                busy={act.busy}
                does={[
                  ...(l.state === "connected"
                    ? [
                        {
                          id: "sync",
                          label: "Read now",
                          run: () =>
                            going.go(String(l.id), "Reading", async () => {
                              if (await act.run("syncNow", { id: l.id }))
                                act.setSaid("Reading now. New people show up in a minute or two.");
                            }),
                        },
                      ]
                    : []),
                  {
                    id: "disconnect",
                    label: "Disconnect",
                    confirm: `Disconnect ${whoOf(l)}? Wren stops reading it. The people it brought in stay.`,
                    run: () =>
                      going.go(String(l.id), "Disconnecting", () =>
                        act.run("disconnect", { id: l.id }),
                      ),
                  },
                ]}
              />
            )
          : undefined
      }
    />
  );
}

function AppRow({ a, mayAct, act }: { a: App; mayAct: boolean; act: Act }) {
  const tag = TAGS[a.state];
  const may = mayAct && a.state !== "needs_setup";
  return (
    <Section
      title={a.label}
      note={
        <span className="flex flex-wrap items-center gap-2">
          <Tag tone={tag.tone}>{tag.label}</Tag>
          <span>Reads {a.reads.charAt(0).toLowerCase() + a.reads.slice(1)}</span>
        </span>
      }
      actions={
        may ? (
          <Button
            size="sm"
            tone={a.state === "connected" ? "quiet" : undefined}
            disabled={act.busy}
            onClick={() => void connect(act, a.app)}
          >
            {a.state === "broken"
              ? "Connect again"
              : a.state === "connected"
                ? "Add another"
                : "Connect"}
          </Button>
        ) : null
      }
    >
      <div className="grid gap-3">
        <p className={QUIET}>Tells workflows: {a.fires} Pick it in a Connected app trigger.</p>
        {a.state === "needs_setup" ? (
          <p className={QUIET}>
            Wren's {a.label} app is being set up. It opens here when it's ready.
          </p>
        ) : null}
        {a.links.length ? <Links links={a.links} mayAct={mayAct} act={act} /> : null}
      </div>
    </Section>
  );
}

export function Connectors(props: PageProps) {
  const load = useCall(`connectors:${props.client}`, () =>
    call<ConnectorsPageView>("connectors/connectors", {
      client: props.client,
      asClient: !props.team,
    }),
  );
  const act = useConnectorAct(props.client, load.retry);
  const data = load.data;
  const view = data && !data.wren ? (data as View) : null;
  return (
    <>
      <PageHeader
        title="Connectors"
        lede="Bring in the apps you already run on. Wren reads them every hour, never writes, and adds new people to your CRM."
      />
      {load.error && !data ? (
        <LoadFailed error={load.error} onRetry={load.retry} />
      ) : !data ? (
        <Loading lines={6} />
      ) : data.wren ? (
        <Empty>Connectors are per client. Open a client to see theirs.</Empty>
      ) : view ? (
        <>
          {!view.ready ? (
            <Callout tone="warn">Connectors aren't switched on here yet.</Callout>
          ) : null}
          {act.error ? <p className={ERROR}>{act.error}</p> : null}
          {act.said ? <p className={QUIET}>{act.said}</p> : null}
          {view.apps.map((a) => (
            <AppRow key={a.app} a={a} mayAct={view.mayAct} act={act} />
          ))}
          {view.mayAct ? null : (
            <p className={QUIET}>Ask an owner to connect or disconnect an app.</p>
          )}
        </>
      ) : null}
    </>
  );
}
