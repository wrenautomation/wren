/**
 * Account → Mail (designs/2026-10-07-mail-access.md): the client's mailboxes, each with its state,
 * what blocks it and the next step; above them, each domain's one admin step as a checklist with
 * the links and the ID to paste. Connecting sends the person to Google or Microsoft to sign in.
 */
import type { MailPageView } from "@wren/channel-email/access/console";
import {
  Button,
  Callout,
  Copyable,
  Empty,
  Facts,
  LoadFailed,
  Loading,
  PageHeader,
  Section,
  SelectField,
  Tag,
  TextField,
  useEditForm,
  useNarrow,
} from "@wren/ui";
import { type ReactNode, useState } from "react";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { PageRows, type RowDo, RowDoes, rowLines, useGoing } from "../../page-rows.js";
import { ERROR, Form, NARROW, QUIET, TOOLS, trimmed } from "../work/bits.js";
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

/** Off to Google or Microsoft to sign in as the mailbox. */
async function connect(act: Act, account: number, want: "send" | "read") {
  const out = await act.run<{ url?: string }>("connect", { account, want });
  if (out?.url) window.location.assign(out.url);
}

const PROVIDER = { google: "Google", microsoft: "Microsoft 365" } as const;

/** The mailboxes, a row each: state and who hosts it; what blocks one and its next step under it. */
function Mailboxes({
  mailboxes,
  mayAct,
  act,
}: {
  mailboxes: Mailbox[];
  mayAct: boolean;
  act: Act;
}) {
  const narrow = useNarrow();
  const going = useGoing();
  const does = (m: Mailbox): RowDo[] => {
    const connected = m.state === "send_only" || m.state === "read_send";
    const out: RowDo[] = [];
    if (m.may.connectRead && m.state !== "read_send")
      out.push({
        id: "read",
        label: connected ? "Connect to read" : "Connect to read and send",
        icon: "link",
        run: () => going.go(String(m.id), "Connecting", () => connect(act, m.id, "read")),
      });
    if (m.may.connectSend && !connected)
      out.push({
        id: "send",
        label: m.state === "broken" ? "Connect again" : "Connect to send",
        icon: "link",
        run: () => going.go(String(m.id), "Connecting", () => connect(act, m.id, "send")),
      });
    if (connected || m.state === "broken")
      out.push({
        id: "check",
        label: "Check",
        run: () => going.go(String(m.id), "Checking", () => act.run("check", { account: m.id })),
      });
    return out;
  };
  return (
    <PageRows<Mailbox>
      label="Mailboxes"
      noun="mailbox"
      lines={rowLines(
        mailboxes,
        (m) => String(m.id),
        (m) =>
          m.blocking || m.next ? (
            <div className="grid gap-1 text-[13.5px]">
              {m.blocking ? <p className="m-0">{m.blocking}</p> : null}
              {m.next ? <p className={`m-0 ${QUIET}`}>Next: {m.next}</p> : null}
            </div>
          ) : null,
      )}
      rowState={(m) => going.stateOf(String(m.id))}
      name={{
        label: "Mailbox",
        icon: "mail",
        min: 240,
        title: (m) => m.address,
      }}
      columns={[
        {
          key: "state",
          label: "State",
          icon: "pulse",
          width: 150,
          phone: true,
          cell: (m) => {
            const tag = mailTag(m.state);
            return <Tag tone={tag.tone}>{tag.label}</Tag>;
          },
        },
        {
          key: "via",
          label: "Hosted by",
          icon: "globe",
          min: 200,
          className: "max-[1000px]:hidden",
          cell: (m) =>
            `${m.personal ? "Personal Gmail" : PROVIDER[m.provider]}${
              m.want === "read" ? ", to read and send" : ", to send"
            }`,
        },
      ]}
      end={
        mayAct
          ? (m) => <RowDoes title={m.address} lone={narrow} busy={act.busy} does={does(m)} />
          : undefined
      }
    />
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
        ) : mayAct && !o.ready ? (
          <span>
            <Button
              tone="primary"
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
          : "Once per Microsoft 365 organization. Your admin consents once for everyone, so Wren can read and send from your mailboxes."
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

const PROVIDERS = [
  ["google", "Google"],
  ["microsoft", "Microsoft 365"],
] as const;
const WANTS = [
  ["read", "Read and send"],
  ["send", "Send only"],
] as const;

/** The add form: an address, who hosts it, and how much Wren may do with it. */
function AddMailbox({ client, act }: { client: string; act: Act }) {
  const form = useEditForm({
    key: `mailbox:new:${client}`,
    defaults: { address: "", provider: "google", want: "read" },
  });
  return (
    <Form
      label="Add a mailbox"
      submit="Add"
      act={act}
      form={form}
      onSubmit={async (v) =>
        !!(await act.run("addMailbox", {
          address: trimmed(v.address),
          provider: trimmed(v.provider),
          want: trimmed(v.want),
        }))
      }
    >
      <TextField
        form={form}
        name="address"
        label="Address"
        className={`${NARROW} grow basis-[240px]`}
        type="email"
        required
        maxLength={320}
        placeholder="ann@yourfirm.com"
      />
      <SelectField
        form={form}
        name="provider"
        label="Provider"
        className={NARROW}
        options={PROVIDERS}
      />
      <SelectField form={form} name="want" label="Wren may" className={NARROW} options={WANTS} />
    </Form>
  );
}

export function Mail(props: PageProps) {
  const load = useCall(`mail:${props.client}`, () =>
    call<MailPageView>("mail/mail", { client: props.client, asClient: !props.team }),
  );
  const act = useMailAct(props.client, load.retry);
  const data = load.data;
  const view = data && !data.wren ? (data as View) : null;
  return (
    <>
      <PageHeader
        title="Mail"
        lede="The mailboxes Wren sends from and reads. Sending takes one sign-in per mailbox. Reading also needs your admin, once per domain."
      />
      {load.error && !data ? (
        <LoadFailed error={load.error} onRetry={load.retry} />
      ) : !data ? (
        <Loading lines={4} />
      ) : data.wren ? (
        <Empty>Wren's own mail is the Monitor's. Open a client to see theirs.</Empty>
      ) : view ? (
        <>
          {!view.apps.google && !view.apps.microsoft ? (
            <Callout tone="warn">Needs setup: Wren's mail apps. Wren's team is on it.</Callout>
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
              <Mailboxes mailboxes={view.mailboxes} mayAct={view.mayAct} act={act} />
            )}
            {act.error ? <p className={ERROR}>{act.error}</p> : null}
          </Section>
          {view.mayAct ? (
            <Section
              title="Add a mailbox"
              note="Personal Gmail can send but not be read. Personal Outlook isn't supported yet."
            >
              <AddMailbox client={props.client} act={act} />
            </Section>
          ) : (
            <p className={QUIET}>Ask an owner to add or connect a mailbox.</p>
          )}
        </>
      ) : null}
    </>
  );
}
