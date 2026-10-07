/**
 * Account → Social (designs/2026-10-07-client-social.md): the client's own social accounts, one
 * row per platform with its state (Not connected, Waiting on review, Connected, Broken), what
 * blocks it and the next step. Connecting sends the person to the platform to sign in.
 */
import type { SocialPageView } from "@wren/content/connect";
import { Alert, Button, Empty, Loading, PageHeader, Section, Tag } from "@wren/ui";
import { useState } from "react";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { ERROR, QUIET, TOOLS } from "../work/bits.js";
import { socialTag } from "./setups.js";

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

function AccountLine({ c, mayAct, act }: { c: Connection; mayAct: boolean; act: Act }) {
  const who = c.handle ? `@${c.handle}` : (c.name ?? "Account");
  return (
    <div className="grid gap-1">
      <p className="flex flex-wrap items-center gap-2">
        <b className="font-medium break-all">{who}</b>
        {c.handle && c.name && c.name !== c.handle ? <span className={QUIET}>{c.name}</span> : null}
      </p>
      {c.state === "broken" && c.why ? <p>{c.why}</p> : null}
      {c.expiring && c.expiresAt ? (
        <p>Its sign-in ends {day(c.expiresAt)}. Connect again before then.</p>
      ) : null}
      <p className={QUIET}>
        Connected {day(c.connectedAt)}
        {c.checkedAt ? `, checked ${day(c.checkedAt)}` : ""}
      </p>
      {mayAct ? (
        <div className={TOOLS}>
          <Button
            size="sm"
            tone="quiet"
            disabled={act.busy}
            onClick={() => void act.run("check", { id: c.id })}
          >
            Check
          </Button>
          <Button
            size="sm"
            tone="quiet"
            disabled={act.busy}
            onClick={() => {
              if (window.confirm(`Turn off ${who}? Nothing posts or reads as it after this.`))
                void act.run("disconnect", { id: c.id });
            }}
          >
            Turn off
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PlatformRow({ p, mayAct, act }: { p: Platform; mayAct: boolean; act: Act }) {
  const tag = socialTag(p.state);
  const what = reads(p);
  const connected = p.state === "connected";
  return (
    <div className="grid gap-2 border-(--ui-hair) border-t pt-4 first:border-t-0 first:pt-0">
      <p className="flex flex-wrap items-center gap-2">
        <b className="font-medium">{p.label}</b>
        <Tag tone={tag.tone}>{tag.label}</Tag>
        {what ? <span className={QUIET}>{what} come into your Inbox</span> : null}
      </p>
      {p.blocking && p.state !== "broken" ? <p>{p.blocking}</p> : null}
      {p.today ? <p className={QUIET}>Until then: {p.today}</p> : null}
      {p.connections.map((c) => (
        <AccountLine key={c.id} c={c} mayAct={mayAct} act={act} />
      ))}
      {!connected ? (
        <p className={QUIET}>
          {p.selfServe} Rather we do it? {p.forYou}
        </p>
      ) : null}
      {mayAct && p.may.connect ? (
        <div className={TOOLS}>
          <Button
            size="sm"
            tone={connected ? "quiet" : undefined}
            disabled={act.busy}
            onClick={() => void connect(act, p.platform)}
          >
            {p.state === "broken" ? "Connect again" : connected ? "Add another" : "Connect"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function Social(props: PageProps) {
  const [nonce, setNonce] = useState(0);
  const load = useCall(`social:${props.client}:${nonce}`, () =>
    call<SocialPageView>("social/social", { client: props.client, asClient: !props.team }),
  );
  const act = useSocialAct(props.client, () => setNonce((n) => n + 1));
  const data = load.data;
  const view = data && !data.wren ? (data as View) : null;
  return (
    <>
      <PageHeader
        title="Social"
        lede="The accounts Wren posts from and answers on. Each takes one sign-in. Posts and replies wait in To approve before they go."
      />
      {load.error && !data ? (
        <Alert onRetry={load.retry}>{load.error.message}</Alert>
      ) : !data ? (
        <Loading lines={6} />
      ) : data.wren ? (
        <Empty>Wren's own accounts are its channels. Open a client to see theirs.</Empty>
      ) : view ? (
        <>
          {Object.values(view.apps).every((on) => !on) ? (
            <Alert>Needs setup: Wren's social apps. Wren's team is on it.</Alert>
          ) : null}
          <Section title="Accounts">
            <div className="grid gap-4">
              {view.platforms.map((p) => (
                <PlatformRow key={p.platform} p={p} mayAct={view.mayAct} act={act} />
              ))}
            </div>
            {act.error ? <p className={ERROR}>{act.error}</p> : null}
          </Section>
          {view.mayAct ? null : (
            <p className={QUIET}>Ask an owner to connect or turn off an account.</p>
          )}
        </>
      ) : null}
    </>
  );
}
