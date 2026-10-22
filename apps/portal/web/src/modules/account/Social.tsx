/**
 * Account → Social (designs/2026-10-07-client-social.md): the client's own social accounts, one
 * framed section per platform with its state (Not connected, Waiting on review, Connected,
 * Broken), what blocks it and the next step. Connecting sends the person to the platform to sign in.
 */
import type { SocialPageView } from "@wren/content/connect";
import {
  Button,
  Callout,
  Empty,
  LoadFailed,
  Loading,
  PageHeader,
  PlatformMark,
  Section,
  Tag,
  useNarrow,
} from "@wren/ui";
import { useState } from "react";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { PageRows, RowDoes, rowLines, useGoing } from "../../page-rows.js";
import { ERROR, QUIET } from "../work/bits.js";
import { OwnSocial } from "./OwnSocial.js";
import { socialTag } from "./setups.js";
import { AccountFace, TikTokNumbersView } from "./social-bits.js";

type View = Extract<SocialPageView, { wren: false }>;
type Platform = View["platforms"][number];
type Connection = Platform["connections"][number];

/** A write to SocialAccess: busy while it runs, its refusal shown, then a reload. */
function useSocialAct(client: string, reload: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(route: string, body: Record<string, unknown>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      const out = await call<T>(`social/${route}`, { client, ...body });
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
type Act = ReturnType<typeof useSocialAct>;

/** Off to the platform to sign in as the account. */
async function connect(act: Act, platform: string) {
  const out = await act.run<{ url?: string }>("connect", { platform });
  if (out?.url) window.location.assign(out.url);
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** What comes into the Inbox from it. */
const reads = (p: Platform) =>
  p.dms && p.comments ? "Comments and DMs" : p.comments ? "Comments" : p.dms ? "DMs" : null;

/** A platform's connected accounts, a row each: picture, state, dates; notices and numbers under it. */
function Accounts({
  connections,
  mayAct,
  act,
}: {
  connections: Connection[];
  mayAct: boolean;
  act: Act;
}) {
  const narrow = useNarrow();
  const going = useGoing();
  const whoOf = (c: Connection) => (c.handle ? `@${c.handle}` : (c.name ?? "Account"));
  return (
    <PageRows<Connection>
      label="Connected accounts"
      noun="account"
      lines={rowLines(
        connections,
        (c) => String(c.id),
        (c) =>
          (c.state === "broken" && c.why) || (c.expiring && c.expiresAt) || c.numbers ? (
            <div className="grid gap-3">
              {c.state === "broken" && c.why ? <p className="m-0">{c.why}</p> : null}
              {c.expiring && c.expiresAt ? (
                <p className="m-0">
                  Its sign-in ends {day(c.expiresAt)}. Connect again before then.
                </p>
              ) : null}
              {c.numbers ? <TikTokNumbersView n={c.numbers} /> : null}
            </div>
          ) : null,
      )}
      rowState={(c) => going.stateOf(String(c.id))}
      name={{
        label: "Account",
        icon: "people",
        min: 220,
        title: whoOf,
        mark: (c) => <AccountFace url={c.avatarUrl} name={c.name ?? whoOf(c)} />,
        sub: (c) =>
          c.handle && c.name && c.name !== c.handle ? (
            <span className={`${QUIET} truncate text-[12.5px]`}>{c.name}</span>
          ) : null,
      }}
      columns={[
        {
          key: "state",
          label: "State",
          icon: "pulse",
          width: 130,
          phone: true,
          cell: (c) => {
            const tag = socialTag(c.state);
            return <Tag tone={tag.tone}>{tag.label}</Tag>;
          },
        },
        {
          key: "connected",
          label: "Connected",
          icon: "calendar",
          width: 130,
          quiet: true,
          className: "max-[900px]:hidden",
          cell: (c) => day(c.connectedAt),
        },
        {
          key: "checked",
          label: "Checked",
          icon: "clock",
          width: 130,
          quiet: true,
          className: "max-[900px]:hidden",
          cell: (c) => (c.checkedAt ? day(c.checkedAt) : "Not yet"),
        },
      ]}
      end={
        mayAct
          ? (c) => (
              <RowDoes
                title={whoOf(c)}
                lone={narrow}
                busy={act.busy}
                does={[
                  {
                    id: "check",
                    label: "Check",
                    run: () =>
                      going.go(String(c.id), "Checking", () => act.run("check", { id: c.id })),
                  },
                  {
                    id: "off",
                    label: "Turn off",
                    confirm: `Turn off ${whoOf(c)}? Nothing posts or reads as it after this.`,
                    run: () =>
                      going.go(String(c.id), "Turning off", () =>
                        act.run("disconnect", { id: c.id }),
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

function PlatformRow({ p, mayAct, act }: { p: Platform; mayAct: boolean; act: Act }) {
  const tag = socialTag(p.state);
  const what = reads(p);
  const connected = p.state === "connected";
  return (
    // Each platform its own frame: name, state and what it brings in on the head strip.
    <Section
      title={p.label}
      cue={<PlatformMark mark={p.platform.split("_")[0] ?? p.platform} size={15} />}
      note={
        <span className="flex flex-wrap items-center gap-2">
          <Tag tone={tag.tone}>{tag.label}</Tag>
          {what ? <span>{what} come into your Inbox</span> : null}
        </span>
      }
      actions={
        mayAct && p.may.connect ? (
          <Button
            size="sm"
            tone={connected ? "quiet" : undefined}
            disabled={act.busy}
            onClick={() => void connect(act, p.platform)}
          >
            {p.state === "broken" ? "Connect again" : connected ? "Add another" : "Connect"}
          </Button>
        ) : null
      }
    >
      <div className="grid gap-3">
        {p.blocking && p.state !== "broken" ? <p>{p.blocking}</p> : null}
        {p.today ? <p className={QUIET}>Until then: {p.today}</p> : null}
        {p.connections.length ? (
          <Accounts connections={p.connections} mayAct={mayAct} act={act} />
        ) : null}
        {!connected ? (
          <p className={QUIET}>
            {p.selfServe} Rather we do it? {p.forYou}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

/** Not built: a business number's chats in the Inbox. Waits on Meta's provider review. */
function WhatsAppRow() {
  return (
    <Section
      title="WhatsApp"
      cue={<PlatformMark mark="whatsapp" size={15} />}
      note={
        <span className="flex flex-wrap items-center gap-2">
          <Tag tone="accent">In development</Tag>
          <span>Chats come into your Inbox</span>
        </span>
      }
    >
      <p className={QUIET}>
        Connect your business number here and answer its chats from the Inbox, like texts. It waits
        on Meta's review of Wren as a WhatsApp provider.
      </p>
    </Section>
  );
}

export function Social(props: PageProps) {
  const load = useCall(`social:${props.client}`, () =>
    call<SocialPageView>("social/social", { client: props.client, asClient: !props.team }),
  );
  const act = useSocialAct(props.client, load.retry);
  const data = load.data;
  const view = data && !data.wren ? (data as View) : null;
  const own = data?.wren ? data.own : null;
  return (
    <>
      <PageHeader
        title="Social"
        lede={
          own
            ? "Each channel Wren posts to, with its account, token, last post and last failure. Check asks the account if it still answers."
            : "The accounts Wren posts from and answers on. Each takes one sign-in. Posts and replies wait in To approve before they go."
        }
      />
      {load.error && !data ? (
        <LoadFailed error={load.error} onRetry={load.retry} />
      ) : !data ? (
        <Loading lines={6} />
      ) : data.wren ? (
        own ? (
          <OwnSocial own={own} client={props.client} mayAct={data.mayAct} />
        ) : (
          <Empty>Wren's own accounts are its channels. Open a client to see theirs.</Empty>
        )
      ) : view ? (
        <>
          {Object.values(view.apps).every((on) => !on) ? (
            <Callout tone="warn">Needs setup: Wren's social apps. Wren's team is on it.</Callout>
          ) : null}
          {act.error ? <p className={ERROR}>{act.error}</p> : null}
          {view.platforms.map((p) => (
            <PlatformRow key={p.platform} p={p} mayAct={view.mayAct} act={act} />
          ))}
          <WhatsAppRow />
          {view.mayAct ? null : (
            <p className={QUIET}>Ask an owner to connect or turn off an account.</p>
          )}
        </>
      ) : null}
    </>
  );
}
