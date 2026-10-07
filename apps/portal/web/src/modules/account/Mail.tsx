/**
 * Account → Mail (designs/2026-10-07-mail-access.md): the client's mailboxes, each with its state,
 * what blocks it and the next step; above them, each domain's one admin step as a checklist with
 * the links and the ID to paste. Connecting sends the person to Google or Microsoft to sign in.
 */
import type { MailPageView } from "@wren/channel-email/access/console";
import { Alert, Button, Empty, Facts, Input, Loading, PageHeader, Section, Tag } from "@wren/ui";
import { type ReactNode, useState } from "react";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { ERROR, FIELD, Form, field, QUIET, SELECT, TOOLS } from "../work/bits.js";
import { mailTag } from "./setups.js";

type View = Extract<MailPageView, { wren: false }>;
type Mailbox = View["mailboxes"][number];
type Org = View["orgs"][number];

/** A write to MailAccess: busy while it runs, its refusal shown, then a reload. */
function useMailAct(client: string, reload: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(route: string, body: Record<string, unknown>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      const out = await call<T>(`mail/${route}`, { client, ...body });
      reload();
      return out;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}
type Act = ReturnType<typeof useMailAct>;

function Copyable({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <code className="break-all text-[13.5px]">{text}</code>
      <Button
        size="sm"
        tone="quiet"
        onClick={() =>
          void navigator.clipboard.writeText(text).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
        }
      >
        {done ? "Copied" : "Copy"}
      </Button>
    </span>
  );
}

/** Off to Google or Microsoft to sign in as the mailbox. */
async function connect(act: Act, account: number, want: "send" | "read") {
  const out = await act.run<{ url?: string }>("connect", { account, want });
  if (out?.url) window.location.assign(out.url);
}

const PROVIDER = { google: "Google", microsoft: "Microsoft 365" } as const;

function MailboxRow({ m, mayAct, act }: { m: Mailbox; mayAct: boolean; act: Act }) {
  const tag = mailTag(m.state);
  const connected = m.state === "send_only" || m.state === "read_send";
  return (
    <div className="grid gap-1.5 border-(--ui-hair) border-t pt-3 first:border-t-0 first:pt-0">
      <p className="flex flex-wrap items-center gap-2">
        <b className="font-medium break-all">{m.address}</b>
        <Tag tone={tag.tone}>{tag.label}</Tag>
        <span className={QUIET}>
          {m.personal ? "Personal Gmail" : PROVIDER[m.provider]}
          {m.want === "read" ? ", to read and send" : ", to send"}
        </span>
      </p>
      {m.blocking ? <p>{m.blocking}</p> : null}
      {m.next ? <p className={QUIET}>Next: {m.next}</p> : null}
      {mayAct ? (
        <div className={TOOLS}>
          {m.may.connectRead && m.state !== "read_send" ? (
            <Button size="sm" disabled={act.busy} onClick={() => void connect(act, m.id, "read")}>
              {connected ? "Connect again to read" : "Connect to read and send"}
            </Button>
          ) : null}
          {m.may.connectSend && !connected ? (
            <Button
              size="sm"
              tone={m.may.connectRead ? "quiet" : undefined}
              disabled={act.busy}
              onClick={() => void connect(act, m.id, "send")}
            >
              {m.state === "broken" ? "Connect again" : "Connect to send"}
            </Button>
          ) : null}
          {connected || m.state === "broken" ? (
            <Button
              size="sm"
              tone="quiet"
              disabled={act.busy}
              onClick={() => void act.run("check", { account: m.id })}
            >
              Check
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** One numbered step of the admin's checklist. */
function Item({ n, done, children }: { n: number; done?: boolean; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[1.75rem_1fr] gap-2">
      <span
        className={`grid size-6 place-items-center text-[12.5px] tabular-nums ${done ? "bg-(--ui-good-tint) text-(--ui-good-ink)" : "bg-(--ui-fill) text-(--ui-ink-2)"}`}
        aria-hidden="true"
      >
        {done ? "✓" : n}
      </span>
      <span className="sr-only">{done ? "Done." : `Step ${n}.`}</span>
      <div className="grid gap-1.5">{children}</div>
    </li>
  );
}

function GoogleSteps({ o, view }: { o: Org; view: View }) {
  const id = view.googleClientId;
  return (
    <ol className="grid gap-3">
      <Item n={1}>
        <p>Sign in to the Google Admin console as a super admin.</p>
      </Item>
      <Item n={2}>
        <p>
          Go to Security → Access and data control → API controls → App access control.{" "}
          <a className="underline" href={view.googleAdminUrl} target="_blank" rel="noreferrer">
            Open it
          </a>
        </p>
      </Item>
      <Item n={3}>
        <p>Choose Manage third-party app access → Add app → OAuth app name or client ID. Paste:</p>
        {id ? (
          <Copyable text={id} />
        ) : (
          <p className={QUIET}>Wren's app ID shows here once it's set up.</p>
        )}
      </Item>
      <Item n={4}>
        <p>
          Pick Wren, choose who it covers (everyone, or the team whose mail Wren reads), and set it
          to Trusted.
        </p>
      </Item>
      <Item n={5} done={o.ready}>
        <p>
          Connect one {o.domain} mailbox to read below, then press Check. Trust can take a few
          minutes to reach every mailbox.
        </p>
      </Item>
    </ol>
  );
}

function MicrosoftSteps({ o, mayAct, act }: { o: Org; mayAct: boolean; act: Act }) {
  const [link, setLink] = useState<string | null>(null);
  return (
    <ol className="grid gap-3">
      <Item n={1} done={!!link || o.ready}>
        <p>Get the consent link. Send it to your Microsoft 365 admin, or open it if you are one.</p>
        {link ? (
          <span className="grid gap-1.5">
            <Copyable text={link} />
            <a className="underline" href={link} target="_blank" rel="noreferrer">
              Open it
            </a>
          </span>
        ) : mayAct ? (
          <span>
            <Button
              size="sm"
              disabled={act.busy}
              onClick={() =>
                void act
                  .run<{ url?: string }>("consent", { account: o.id })
                  .then((r) => r?.url && setLink(r.url))
              }
            >
              Get consent link
            </Button>
          </span>
        ) : null}
      </Item>
      <Item n={2} done={o.ready}>
        <p>
          The admin signs in and accepts: read mail, send mail, and stay signed in. It covers your
          whole organization. The link brings them back here.
        </p>
      </Item>
      <Item n={3} done={o.ready}>
        <p>Press Check. Then each person connects their own mailbox below.</p>
      </Item>
    </ol>
  );
}

function OrgCard({ o, view, act }: { o: Org; view: View; act: Act }) {
  const google = o.provider === "google";
  const appSet = google ? view.apps.google : view.apps.microsoft;
  return (
    <Section
      title={`${google ? "Trust Wren's app" : "Admin consent"}: ${o.domain}`}
      note={
        google
          ? "Once per Google Workspace domain. Your admin trusts Wren's app, so mailboxes can be read. Sending works without it."
          : "Once per Microsoft 365 organization. Your admin consents for everyone, so mailboxes can be read and send."
      }
    >
      <p className="flex flex-wrap items-center gap-2">
        {o.ready ? (
          <Tag tone="green">Done</Tag>
        ) : !appSet ? (
          <Tag tone="warn">Needs setup: Wren's {google ? "Google" : "Microsoft"} app</Tag>
        ) : (
          <Tag tone="accent">Waiting on admin</Tag>
        )}
        {o.why ? <span className={QUIET}>{o.why}</span> : null}
      </p>
      {!appSet ? (
        <p className={QUIET}>
          Wren's team is setting up its app. Nothing for your admin to do yet.
        </p>
      ) : google ? (
        <GoogleSteps o={o} view={view} />
      ) : (
        <MicrosoftSteps o={o} mayAct={view.mayAct} act={act} />
      )}
      {o.steps.find((s) => !s.done && s.who === "client")?.forYou ? (
        <p className={QUIET}>
          Rather we do it? {o.steps.find((s) => !s.done && s.who === "client")?.forYou}
        </p>
      ) : null}
      {view.mayAct && appSet ? (
        <div className={TOOLS}>
          <Button
            size="sm"
            tone="quiet"
            disabled={act.busy}
            onClick={() => void act.run("check", { account: o.id })}
          >
            Check
          </Button>
        </div>
      ) : null}
      {o.tenant ? <Facts items={[["Tenant", <code key="t">{o.tenant}</code>]]} /> : null}
    </Section>
  );
}

export function Mail(props: PageProps) {
  const [nonce, setNonce] = useState(0);
  const load = useCall(`mail:${props.client}:${nonce}`, () =>
    call<MailPageView>("mail/mail", { client: props.client, asClient: !props.team }),
  );
  const act = useMailAct(props.client, () => setNonce((n) => n + 1));
  const data = load.data;
  const view = data && !data.wren ? (data as View) : null;
  return (
    <>
      <PageHeader
        title="Mail"
        lede="The mailboxes Wren sends from and reads. Sending takes one sign-in per mailbox. Reading also needs your admin, once per domain."
      />
      {load.error && !data ? (
        <Alert onRetry={load.retry}>{load.error.message}</Alert>
      ) : !data ? (
        <Loading lines={4} />
      ) : data.wren ? (
        <Empty>Wren's own mail is the Monitor's. Open a client to see theirs.</Empty>
      ) : view ? (
        <>
          {!view.apps.google && !view.apps.microsoft ? (
            <Alert>Needs setup: Wren's mail apps. Wren's team is on it.</Alert>
          ) : null}
          {view.orgs
            .filter((o) => o.readers > 0)
            .map((o) => (
              <OrgCard key={o.id} o={o} view={view} act={act} />
            ))}
          <Section title="Mailboxes">
            {view.mailboxes.length === 0 ? (
              <Empty>No mailboxes yet. Add the ones Wren should send from or read.</Empty>
            ) : (
              <div className="grid gap-3">
                {view.mailboxes.map((m) => (
                  <MailboxRow key={m.id} m={m} mayAct={view.mayAct} act={act} />
                ))}
              </div>
            )}
            {act.error ? <p className={ERROR}>{act.error}</p> : null}
          </Section>
          {view.mayAct ? (
            <Section
              title="Add a mailbox"
              note="Personal Gmail can send but not be read. Personal Outlook isn't supported yet."
            >
              <Form
                label="Add a mailbox"
                submit="Add"
                act={{ busy: act.busy, error: act.error, run: async () => false }}
                onSubmit={async (f) =>
                  !!(await act.run("addMailbox", {
                    address: field(f, "address"),
                    provider: field(f, "provider"),
                    want: field(f, "want"),
                  }))
                }
              >
                <label className={`${FIELD} grow basis-[240px]`}>
                  <span>Address</span>
                  <Input
                    name="address"
                    type="email"
                    required
                    maxLength={320}
                    placeholder="ann@yourfirm.com"
                  />
                </label>
                <label className={FIELD}>
                  <span>Provider</span>
                  <select name="provider" className={SELECT} defaultValue="google">
                    <option value="google">Google</option>
                    <option value="microsoft">Microsoft 365</option>
                  </select>
                </label>
                <label className={FIELD}>
                  <span>Wren may</span>
                  <select name="want" className={SELECT} defaultValue="read">
                    <option value="read">Read and send</option>
                    <option value="send">Send only</option>
                  </select>
                </label>
              </Form>
            </Section>
          ) : (
            <p className={QUIET}>Ask an owner to add or connect a mailbox.</p>
          )}
        </>
      ) : null}
    </>
  );
}
