/**
 * Account → Social in Wren's own workspace, for the team: each channel Wren posts to, with its
 * account, how it posts, its token, its last post and last failure, and a Check that asks
 * autobrowse whether the account still answers. Nothing here shows a token or a setting's value.
 */
import type { OwnCheck, OwnView } from "@wren/content/connect";
import {
  ACTIONS,
  Button,
  dateTip,
  Empty,
  exact,
  Facts,
  PlatformMark,
  relative,
  Section,
  Tag,
  type TagTone,
} from "@wren/ui";
import { type ReactNode, useState } from "react";
import { ApiError, call } from "../../api.js";
import { ERROR, QUIET } from "../work/bits.js";

type Channel = OwnView["channels"][number];

function When({ at }: { at: string }) {
  const d = new Date(at);
  return <span {...dateTip(d)}>{relative(d)}</span>;
}

/** A bare date ("2026-11-02") or a moment, as a day. */
const dayOf = (s: string) => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  // A bare date is a day, not midnight UTC shown in the reader's zone.
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? d.toLocaleDateString(undefined, { timeZone: "UTC", dateStyle: "medium" })
    : exact(d);
};

/** The head strip's state: the newest of its last post and last failure. */
function stateOf(c: Channel): { label: string; tone: TagTone } {
  const post = c.lastPost ? Date.parse(c.lastPost.at) : 0;
  const fail = c.lastFailure ? Date.parse(c.lastFailure.at) : 0;
  if (fail > post) return { label: "Failed last", tone: "warn" };
  if (post) return { label: "Posting", tone: "green" };
  return { label: "No posts yet", tone: "neutral" };
}

function tokenLine(c: Channel, next: string | null): ReactNode {
  const t = c.token;
  if (t.kind === "none") return "None. It posts in the browser.";
  if (t.kind === "wren") return "Kept in Wren's settings. Autobrowse doesn't renew it.";
  const lapse = t.lapses
    ? `Lapses ${dayOf(t.lapses)}.`
    : next
      ? `Lapses no sooner than ${dayOf(next)}.`
      : "No lapse date on record.";
  const renewed = t.renewal ? (
    t.renewal.ok ? (
      <>
        Renewed <When at={t.renewal.at} />.
      </>
    ) : (
      <>
        Renewal failed <When at={t.renewal.at} />: {t.renewal.said}
      </>
    )
  ) : (
    "Not renewed yet."
  );
  return (
    <span className="grid gap-0.5">
      <span>{lapse}</span>
      <span className={t.renewal && !t.renewal.ok ? "text-(--ui-bad)" : QUIET}>{renewed}</span>
    </span>
  );
}

function CheckLine({ r }: { r: OwnCheck }) {
  const tone: TagTone = r.ok === true ? "green" : r.ok === false ? "warn" : "neutral";
  const label = r.ok === true ? "Answering" : r.ok === false ? "Not answering" : "Not checked";
  const routes = r.routes
    ? [
        r.routes.api ? `${r.routes.api} on the API` : null,
        r.routes.browser ? `${r.routes.browser} in the browser` : null,
        r.routes.none ? `${r.routes.none} not ready` : null,
      ].filter(Boolean)
    : [];
  return (
    <span className="grid gap-0.5">
      <span className="flex flex-wrap items-center gap-2">
        <Tag tone={tone}>{label}</Tag>
        <span>{r.said}</span>
      </span>
      <span className={QUIET}>
        <When at={r.at} />
        {r.ms !== null ? `, ${r.ms} ms` : ""}
        {r.handle ? `, as ${r.handle}` : ""}
        {r.authed === false ? ". Autobrowse holds no token for it" : ""}
        {r.lapses ? `. Token lapses ${dayOf(r.lapses)}` : ""}
        {routes.length ? `. Calls: ${routes.join(", ")}` : ""}.
      </span>
    </span>
  );
}

function ChannelRow({
  c,
  next,
  mayCheck,
  check,
  result,
  busy,
  error,
}: {
  c: Channel;
  next: string | null;
  mayCheck: boolean;
  check: () => void;
  result: OwnCheck | undefined;
  busy: boolean;
  error: string | undefined;
}) {
  const state = stateOf(c);
  const items: [string, ReactNode][] = [
    [
      "Account",
      <span key="a" className="grid gap-0.5">
        <span className="break-all">{c.handle ?? "Not known yet"}</span>
        {c.login ? <span className={QUIET}>Signs in as {c.login}</span> : null}
      </span>,
    ],
    [
      "Posts by",
      <span key="p" className="grid gap-0.5">
        <span>{c.posts.how}.</span>
        {c.posts.switches.length ? (
          <span className={`${QUIET} break-all`}>Set by {c.posts.switches.join(", ")}</span>
        ) : null}
      </span>,
    ],
    ["Token", tokenLine(c, next)],
    [
      "Last post",
      c.lastPost ? (
        <span key="lp">
          <When at={c.lastPost.at} />
          {c.lastPost.url ? (
            <>
              {" · "}
              <a href={c.lastPost.url} target="_blank" rel="noreferrer" className="underline">
                Open
              </a>
            </>
          ) : null}
        </span>
      ) : (
        <span key="lp" className={QUIET}>
          Nothing posted
        </span>
      ),
    ],
    [
      "Last failure",
      c.lastFailure ? (
        <span key="lf" className="grid gap-0.5">
          <span>
            {c.lastFailure.what} failed <When at={c.lastFailure.at} />.
          </span>
          <span className={QUIET}>{c.lastFailure.why}</span>
        </span>
      ) : (
        <span key="lf" className={QUIET}>
          None
        </span>
      ),
    ],
  ];
  if (result) items.push(["Check", <CheckLine key="c" r={result} />]);
  return (
    <Section
      title={c.label}
      cue={<PlatformMark mark={c.platform} size={15} />}
      note={<Tag tone={state.tone}>{state.label}</Tag>}
      actions={
        mayCheck && c.checkable ? (
          <Button size="sm" tone="quiet" disabled={busy} onClick={check}>
            {busy ? "Checking…" : "Check"}
          </Button>
        ) : null
      }
    >
      <Facts items={items} />
      {error ? <p className={`${ERROR} mt-2`}>{error}</p> : null}
    </Section>
  );
}

export function OwnSocial({
  own,
  client,
  mayAct,
}: {
  own: OwnView;
  client: string;
  mayAct: boolean;
}) {
  const [results, setResults] = useState<Record<string, OwnCheck>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const check = (platform: string) => {
    const key = `social/ownCheck:${platform}`;
    setBusy((b) => ({ ...b, [platform]: true }));
    setErrors(({ [platform]: _, ...rest }) => rest);
    // One check per press: a second press while it runs gets the same answer.
    ACTIONS.run(key, (requestId) =>
      call<OwnCheck>("social/ownCheck", { client, platform, requestId }),
    )
      .then((r) => setResults((all) => ({ ...all, [platform]: r })))
      .catch((err: unknown) =>
        setErrors((all) => ({
          ...all,
          [platform]: err instanceof ApiError ? err.message : String(err),
        })),
      )
      .finally(() => setBusy((b) => ({ ...b, [platform]: false })));
  };
  const r = own.renewal;
  return (
    <>
      {r ? (
        <p className={r.ok ? QUIET : ERROR}>
          {r.ok ? (
            <>
              Tokens last looked at <When at={r.at} />
              {r.next ? `. The next lapse is ${dayOf(r.next)}.` : "."}
            </>
          ) : (
            <>
              Token renewal failed <When at={r.at} />. {r.why}
            </>
          )}
        </p>
      ) : (
        <p className={QUIET}>Token renewal hasn't run yet.</p>
      )}
      {own.channels.length ? (
        own.channels.map((c) => (
          <ChannelRow
            key={c.platform}
            c={c}
            next={r?.next ?? null}
            mayCheck={mayAct}
            check={() => check(c.platform)}
            result={results[c.platform]}
            busy={busy[c.platform] === true}
            error={errors[c.platform]}
          />
        ))
      ) : (
        <Empty>Wren posts to no channels yet.</Empty>
      )}
      {own.off.length ? <p className={QUIET}>Off: {own.off.join(", ")}.</p> : null}
    </>
  );
}
