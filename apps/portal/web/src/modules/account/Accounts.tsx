/**
 * Accounts (designs/2026-10-07-setup-and-vendors.md): each account the client has with Wren, what
 * its setup has done and what's left. The client marks its own steps; Wren's team adds accounts,
 * starts setups and switches who does them.
 */
import type { AccountsView } from "@wren/core/accounts/console";
import {
  Alert,
  Button,
  Callout,
  Empty,
  hostMark,
  Input,
  Loading,
  PageHeader,
  PlatformMark,
  Rail,
  Section,
  soon,
  Tag,
} from "@wren/ui";
import { useState } from "react";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import { type PageProps, WREN } from "../../module.js";
import { dayLabel, ERROR, FIELD, Form, field, QUIET, SELECT, TOOLS } from "../work/bits.js";
import { type AccountRow, currentOf, type RunRow, railOf, runTag } from "./setups.js";

/** Whose accounts: a client's, or Wren's own from its workspace. */
export const ownerOf = (client: string) => (client === WREN.id ? "wren" : client);

/** A write to AccountsConsole: busy while it runs, its refusal shown, then a reload. */
export function useAccountsAct(client: string, reload: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (route: string, body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await call(`accounts/${route}`, { client: ownerOf(client), ...body });
      reload();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}
type Act = ReturnType<typeof useAccountsAct>;

const MODE = { self: "Self-serve", for_you: "Done for you" } as const;

function Run({
  a,
  run,
  team,
  agent,
  mayAct,
  act,
}: {
  a: AccountRow;
  run: RunRow;
  team: boolean;
  agent: boolean;
  mayAct: boolean;
  act: Act;
}) {
  const tag = runTag(run.state, team);
  const now = currentOf(run);
  const on = { account: a.id, setup: run.setup };
  const other = run.mode === "self" ? "for_you" : "self";
  return (
    <div className="grid gap-3">
      <p className="flex flex-wrap items-center gap-2">
        {run.name !== a.siteLabel ? <b className="font-medium">{run.name}</b> : null}
        <Tag tone={tag.tone}>{tag.label}</Tag>
        <Tag>{MODE[run.mode]}</Tag>
      </p>
      <Rail
        groups={railOf(run, team, `${a.id}-${run.setup}`)}
        label={`${run.name} steps`}
        className="mb-2"
      />
      {now ? (
        <div className="grid gap-1.5">
          <p>
            <span className="font-medium">Now: {now.label}.</span>{" "}
            {run.mode === "for_you" || now.who !== "client" ? now.forYou : now.how}
          </p>
          {team && run.mode === "self" && now.who === "client" ? (
            <p className={QUIET}>Done for you: {now.forYou}</p>
          ) : null}
          {now.why && now.why !== now.how && now.why !== now.forYou ? (
            <p className={QUIET}>{now.why}</p>
          ) : null}
          {now.check === "live" && now.every && run.state !== "stuck" ? (
            <p className={QUIET}>Checks again every {now.every.replace(/^1 /, "")}.</p>
          ) : now.check === "development" ? (
            <p className={QUIET}>
              Its check is in development. {team ? "Mark it done once it's true." : ""}
            </p>
          ) : null}
          {team && now.buys && run.state === "waiting_wren" ? (
            <p className={QUIET}>It spends money, so it waits on an admin's yes for this client.</p>
          ) : null}
          {team && run.mode === "for_you" && now.who !== "auto" ? (
            <p className={QUIET}>
              {agent
                ? "Wren's agent tries it once. If it can't, do it by hand and mark it done."
                : "Wren's agent is off. Do it by hand, then mark it done."}
            </p>
          ) : null}
          {team && run.state === "stuck" && !now.why?.startsWith("Stuck past") ? (
            <p className={QUIET}>Past its {now.within}.</p>
          ) : null}
        </div>
      ) : run.doneAt ? (
        <p className={QUIET}>
          Set up {dayLabel(run.doneAt)}.
          {run.nextCheckAt ? ` Checked again ${soon(run.nextCheckAt) ?? "soon"}.` : ""}
        </p>
      ) : null}
      {mayAct ? (
        <div className={TOOLS}>
          {now?.mayMark ? (
            <Button
              size="dense"
              disabled={act.busy}
              onClick={() => void act.run("mark", { ...on, step: now.id })}
            >
              Mark done
            </Button>
          ) : null}
          {now?.check === "live" ? (
            <Button
              size="dense"
              tone="secondary"
              disabled={act.busy}
              onClick={() => void act.run("checkNow", on)}
            >
              Check now
            </Button>
          ) : null}
          {team && run.state !== "done" ? (
            <Button
              size="dense"
              tone="quiet"
              disabled={act.busy}
              onClick={() => {
                if (confirm(`Switch ${run.name} to ${MODE[other].toLowerCase()}? It starts over.`))
                  void act.run("start", { ...on, mode: other });
              }}
            >
              Switch to {MODE[other].toLowerCase()}
            </Button>
          ) : null}
          {team && (run.state === "lost" || run.state === "stuck") ? (
            <Button
              size="dense"
              tone="quiet"
              disabled={act.busy}
              onClick={() => void act.run("start", { ...on, mode: run.mode })}
            >
              Start over
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Account({
  a,
  team,
  agent,
  mayAct,
  act,
}: {
  a: AccountRow;
  team: boolean;
  agent: boolean;
  mayAct: boolean;
  act: Act;
}) {
  const login = (a as AccountRow & { login?: string | null }).login;
  const mark = hostMark(a.site);
  return (
    <Section
      title={a.siteLabel}
      cue={mark ? <PlatformMark mark={mark} size={15} /> : null}
      note={
        <span className="break-all">
          {a.ref}
          {a.role !== "main" ? ` · ${a.role}` : ""}
          {team && login ? ` · signs in as ${login}` : ""}
        </span>
      }
    >
      <div className="grid gap-8">
        {a.runs.map((run) => (
          <Run
            key={run.setup}
            a={a}
            run={run}
            team={team}
            agent={agent}
            mayAct={mayAct}
            act={act}
          />
        ))}
        {a.setups.map((s) => (
          <div key={s.id} className="grid gap-1.5">
            <p className="flex flex-wrap items-center gap-2">
              <b className="font-medium">{s.name}</b>
              <Tag>Not started</Tag>
            </p>
            <p className={QUIET}>{s.blurb}</p>
            {mayAct ? (
              <div className={TOOLS}>
                <Button
                  size="dense"
                  disabled={act.busy}
                  onClick={() => void act.run("start", { account: a.id, setup: s.id })}
                >
                  {team ? "Start self-serve" : "Start"}
                </Button>
                {team ? (
                  <Button
                    size="dense"
                    tone="secondary"
                    disabled={act.busy}
                    onClick={() =>
                      void act.run("start", { account: a.id, setup: s.id, mode: "for_you" })
                    }
                  >
                    Start done for you
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        {!a.runs.length && !a.setups.length ? (
          <p className={QUIET}>Nothing to set up on it.</p>
        ) : null}
        {a.paused.map((p) => (
          <p key={p.part}>
            <Tag tone="accent">{p.text}</Tag>{" "}
            <span className={QUIET}>{p.name} holds until then.</span>
          </p>
        ))}
        <Timeline items={a.timeline} />
      </div>
    </Section>
  );
}

/** What happened to an account, newest first: each alert once, open ones marked. */
function Timeline({ items }: { items: AccountRow["timeline"] }) {
  if (!items.length) return null;
  return (
    <details className="grid gap-2">
      <summary className="cursor-pointer text-[13.5px] text-(--ui-ink-2)">
        What happened ({items.length})
      </summary>
      <ol className="mt-2 grid gap-2" aria-label="What happened">
        {items.map((x) => (
          <li key={x.id} className="grid gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{x.title}</span>
              {x.open ? <Tag tone="accent">Open</Tag> : null}
            </span>
            <span className={QUIET}>
              {dayLabel(x.at)}
              {x.why ? `. ${x.why}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function AddAccount({ sites, act }: { sites: AccountsView["sites"]; act: Act }) {
  return (
    <Section
      title="Add an account"
      note="A domain, an inbox, a number or a login the client has. Its setup starts from here."
    >
      <Form
        label="Add an account"
        submit="Add"
        act={act}
        onSubmit={(f) =>
          act.run("addAccount", {
            site: field(f, "site"),
            ref: field(f, "ref"),
            role: field(f, "role") ?? null,
          })
        }
      >
        <label className={FIELD}>
          <span>Kind</span>
          <select className={SELECT} name="site" required defaultValue="">
            <option value="" disabled>
              Pick one
            </option>
            {sites.map((s) => (
              <option key={s.site} value={s.site}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className={`${FIELD} grow basis-[220px]`}>
          <span>What it is</span>
          <Input name="ref" required maxLength={200} placeholder="send.example.com" />
        </label>
        <label className={`${FIELD} basis-[140px]`}>
          <span>For</span>
          <Input name="role" maxLength={32} placeholder="main" />
        </label>
      </Form>
    </Section>
  );
}

export function Accounts(props: PageProps) {
  const [nonce, setNonce] = useState(0);
  const load = useCall(`accounts:${props.client}:${props.team}:${nonce}`, () =>
    call<AccountsView>("accounts/accounts", {
      client: ownerOf(props.client),
      asClient: !props.team,
    }),
  );
  const act = useAccountsAct(props.client, () => setNonce((n) => n + 1));
  const d = load.data;
  const team = !!d?.team;
  return (
    <>
      <PageHeader
        title="Accounts"
        lede={
          team
            ? "Each account the client has with us, what its setup has done and what's left."
            : "Each account Wren works in for you, what's set up and what's left."
        }
      />
      {load.error && !d ? (
        <Alert onRetry={load.retry}>{load.error.message}</Alert>
      ) : !d ? (
        <Loading lines={4} />
      ) : (
        <>
          {d.paused.length ? (
            <Callout>
              {d.paused.map((p) => `${p.name}: ${p.text}.`).join(" ")} It starts again once that's
              back.
            </Callout>
          ) : null}
          {!team && d.accounts.some((a) => a.runs.some((r) => r.state === "waiting_client")) ? (
            <Callout>Steps marked Your turn wait on you. Mark each one done when it is.</Callout>
          ) : null}
          {d.accounts.length === 0 ? (
            <Empty>
              {team
                ? "No accounts yet. Add the first below."
                : "No accounts yet. Wren's team adds each one as you connect it."}
            </Empty>
          ) : (
            d.accounts.map((a) => (
              <Account key={a.id} a={a} team={team} agent={d.agent} mayAct={d.mayAct} act={act} />
            ))
          )}
          {act.error && !team ? <p className={ERROR}>{act.error}</p> : null}
          {team ? <AddAccount sites={d.sites} act={act} /> : null}
        </>
      )}
    </>
  );
}
