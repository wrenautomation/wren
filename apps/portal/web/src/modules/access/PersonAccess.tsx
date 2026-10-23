/**
 * One person's access, as sentences: their role's grants, then their extra grants with End now,
 * Add, and the ended ones under History (designs/2026-10-06-scoped-access.md, "Person page").
 * Shown to whoever manages the workspace; the console checks each change again.
 */
import { ACCESS_CHANNELS, APPS, CHANNEL_NAMES, type Permission } from "@wren/core/access";
import type { RecordsPage } from "@wren/core/records/serve";
import {
  Alert,
  Button,
  ChecksField,
  Loading,
  SelectField,
  Tag,
  TextField,
  useEditForm,
  useNarrow,
} from "@wren/ui";
import { useState } from "react";
import { call, type Me, viewing, viewingAs } from "../../api.js";
import { useCall } from "../../load.js";
import { WREN } from "../../module.js";
import { PageRows, RowDoes, rowLines, useGoing } from "../../page-rows.js";
import { openViewAs } from "../../view-as.js";
import { ERROR, FORM, Kept, NARROW, QUIET, SPLIT } from "../work/bits.js";

type Grant = RecordsPage["rows"][number];

/** A console call in this workspace: Wren's own, or the client's. */
export const consoleIn = <T,>(client: string, handler: string, body: Record<string, unknown>) =>
  call<T>(`console/${handler}`, client === WREN.id ? body : { client, ...body });

const VERBS: [Permission, string][] = [
  ["read", "See"],
  ["comment", "Raise issues"],
  ["act", "Act"],
  ["run", "Run"],
  ["manage", "Manage access"],
];
/** Each side's own: Wren's team page, a client's money. Never more than the granter holds. */
const SIDE_VERBS: Record<"wren" | "client", [Permission, string][]> = {
  wren: [["team", "Manage the team"]],
  client: [["money", "Money"]],
};

/** The days a grant can last, from today. */
const LONG: [string, string][] = [
  ["", "No end"],
  ["1", "A day"],
  ["7", "A week"],
  ["30", "30 days"],
];

const NEW_GRANT = {
  verbs: ["act"] as string[],
  app: "",
  channel: "",
  days: "",
  uses: "",
  reason: "",
};

/** The add form: what they can do, where, for how long and why. Cancel keeps what was typed. */
function AddGrant({
  client,
  email,
  busy,
  run,
  done,
}: {
  client: string;
  email: string;
  busy: boolean;
  run: (handler: string, body: Record<string, unknown>) => Promise<boolean>;
  done: () => void;
}) {
  const form = useEditForm({ key: `grant:new:${client}:${email}`, defaults: NEW_GRANT });
  const add = form.onSend(
    async (v) => {
      const ok = await run("grantAdd", {
        email,
        verbs: v.verbs,
        apps: v.app,
        channels: v.channel,
        ...(v.days ? { until: new Date(Date.now() + Number(v.days) * 864e5).toISOString() } : {}),
        ...(v.uses ? { uses: Number(v.uses) } : {}),
        reason: v.reason,
      });
      if (ok) done();
      return ok;
    },
    { clear: true },
  );
  return (
    <form className={FORM} onSubmit={(e) => void add(e)} aria-label="Add a grant">
      <Kept form={form} />
      <ChecksField
        form={form}
        name="verbs"
        label="They can"
        className="basis-full flex-wrap gap-3"
        options={[...VERBS, ...SIDE_VERBS[client === WREN.id ? "wren" : "client"]]}
      />
      <SelectField
        form={form}
        name="app"
        label="In"
        className={NARROW}
        options={[["", "Every app"], ...Object.entries(APPS)]}
      />
      <SelectField
        form={form}
        name="channel"
        label="On"
        className={NARROW}
        options={[
          ["", "Every channel"],
          ...ACCESS_CHANNELS.map((c) => [c, CHANNEL_NAMES[c]] as const),
        ]}
      />
      <SelectField form={form} name="days" label="For" className={NARROW} options={LONG} />
      <TextField
        form={form}
        name="uses"
        label="Uses"
        className={`${NARROW} w-28`}
        type="number"
        min={1}
        max={1000}
        placeholder="Any"
      />
      <TextField
        form={form}
        name="reason"
        label="Why"
        className={`${NARROW} grow basis-[220px]`}
        maxLength={500}
      />
      <div className="flex basis-full gap-2">
        <Button tone="primary" type="submit" size="sm" busy={busy}>
          Add grant
        </Button>
        <Button size="sm" tone="quiet" onClick={done}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function PersonAccess({
  client,
  email,
  role,
}: {
  /** The web's workspace id: a client's, or `@wren`. */
  client: string;
  email: string;
  role: string;
}) {
  const me = useCall("me", () => call<Me>("delivery/me"));
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const narrow = useNarrow();
  const going = useGoing();
  const [error, setError] = useState<string | null>(null);
  // One key per read: a change re-reads the grants under it (roles never change here).
  const roles = useCall(`access-roles:${client}`, () =>
    consoleIn<RecordsPage>(client, "recordsList", { record: "access.role", limit: 200 }),
  );
  const grants = useCall(`access-grants:${client}:${email}`, () =>
    consoleIn<RecordsPage>(client, "recordsList", {
      record: "access.grant",
      where: { email },
      sort: "-at",
      limit: 200,
    }),
  );
  const run = async (handler: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await consoleIn(client, handler, body);
      grants.retry();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  if ((roles.error && !roles.data) || (grants.error && !grants.data))
    return (
      <Alert
        onRetry={() => {
          roles.retry();
          grants.retry();
        }}
      >
        {(roles.error ?? grants.error)?.message}
      </Alert>
    );
  if (!roles.data || !grants.data) return <Loading lines={3} />;
  const theirs = roles.data.rows.find((r) => r.id === role || r.name === role);
  const lines = String(theirs?.grants ?? "")
    .split("\n")
    .filter(Boolean);
  const live = grants.data.rows.filter((g) => g.state === "live");
  const ended = grants.data.rows.filter((g) => g.state !== "live");

  return (
    <div className="grid gap-4 text-[14px]">
      <section className="grid gap-1">
        <div className={SPLIT}>
          <h2 className="m-0 text-[13px] font-medium text-(--ui-ink-2)">
            Role: {String(theirs?.name ?? role)}
          </h2>
          {/* View as is Wren's team's: the picker opens on this person. */}
          {me.data?.operator && !viewing ? (
            <Button
              size="sm"
              tone="quiet"
              onClick={() => openViewAs({ client: client === WREN.id ? "wren" : client, email })}
            >
              View as
            </Button>
          ) : null}
        </div>
        {lines.length ? (
          lines.map((l) => <p key={l}>{l}</p>)
        ) : (
          <p className={QUIET}>A built-in role.</p>
        )}
      </section>
      <section className="grid gap-2">
        <h2 className="m-0 text-[13px] font-medium text-(--ui-ink-2)">Extra grants</h2>
        {live.length ? (
          <PageRows<Grant>
            label="Extra grants"
            noun="grant"
            lines={rowLines(live, (g) => String(g.id))}
            rowState={(g) => going.stateOf(String(g.id))}
            name={{
              label: "Grant",
              icon: "key",
              min: 240,
              title: (g) => String(g.what),
              sub: (g) =>
                g.reason ? (
                  <span className={`${QUIET} wrap-anywhere whitespace-normal text-[12.5px]`}>
                    {String(g.reason)}
                  </span>
                ) : null,
            }}
            columns={[]}
            end={
              viewingAs
                ? undefined
                : (g) => (
                    <RowDoes
                      title={String(g.what)}
                      lone={narrow}
                      busy={busy}
                      does={[
                        {
                          id: "end",
                          label: "End now",
                          confirm: "End this grant now?",
                          run: () =>
                            going.go(String(g.id), "Ending", () => run("grantEnd", { id: g.id })),
                        },
                      ]}
                    />
                  )
            }
          />
        ) : (
          <p className={QUIET}>None.</p>
        )}
        {error ? <p className={ERROR}>{error}</p> : null}
        {viewingAs ? null : adding ? (
          <AddGrant
            client={client}
            email={email}
            busy={busy}
            run={run}
            done={() => setAdding(false)}
          />
        ) : (
          <div>
            <Button size="sm" tone="secondary" onClick={() => setAdding(true)}>
              Add
            </Button>
          </div>
        )}
      </section>
      {ended.length ? (
        <section className="grid gap-2">
          <button
            type="button"
            className="cursor-pointer justify-self-start border-0 bg-transparent p-0 text-[13px] font-medium text-(--ui-ink-2) hover:text-(--ui-ink)"
            aria-expanded={history}
            onClick={() => setHistory((h) => !h)}
          >
            History ({ended.length})
          </button>
          {history ? (
            <PageRows<Grant>
              label="Ended grants"
              noun="ended grant"
              lines={rowLines(ended, (g) => String(g.id))}
              name={{
                label: "Grant",
                icon: "key",
                min: 240,
                title: (g) => String(g.what),
              }}
              columns={[
                {
                  key: "state",
                  label: "State",
                  icon: "pulse",
                  width: 110,
                  phone: true,
                  cell: (g) => <Tag tone="neutral">{g.state === "used" ? "Used up" : "Ended"}</Tag>,
                },
                {
                  key: "by",
                  label: "Given by",
                  icon: "user",
                  min: 180,
                  quiet: true,
                  className: "max-[900px]:hidden",
                  cell: (g) => String(g.by),
                },
              ]}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
