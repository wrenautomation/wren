/**
 * One person's access, as sentences: their role's grants, then their extra grants with End now,
 * Add, and the ended ones under History (designs/2026-10-06-scoped-access.md, "Person page").
 * Shown to whoever manages the workspace; the console checks each change again.
 */
import { ACCESS_CHANNELS, APPS, CHANNEL_NAMES, type Permission } from "@wren/core/access";
import type { RecordsPage } from "@wren/core/records/serve";
import { Alert, Button, Input, Loading } from "@wren/ui";
import { type FormEvent, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { WREN } from "../../module.js";
import { ERROR, FIELD, FORM, LIST, QUIET, SELECT, SPLIT } from "../work/bits.js";

/** A console call in this workspace: Wren's own, or the client's. */
export const consoleIn = <T,>(client: string, handler: string, body: Record<string, unknown>) =>
  call<T>(`console/${handler}`, client === WREN.id ? body : { client, ...body });

const VERBS: [Permission, string][] = [
  ["read", "See"],
  ["comment", "Raise issues"],
  ["act", "Act"],
  ["run", "Run"],
];

/** The days a grant can last, from today. */
const LONG: [string, string][] = [
  ["", "No end"],
  ["1", "A day"],
  ["7", "A week"],
  ["30", "30 days"],
];

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
  const [nonce, setNonce] = useState(0);
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roles = useCall(`access-roles:${client}:${nonce}`, () =>
    consoleIn<RecordsPage>(client, "recordsList", { record: "access.role", limit: 200 }),
  );
  const grants = useCall(`access-grants:${client}:${email}:${nonce}`, () =>
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
      setNonce((n) => n + 1);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const verbs = f.getAll("verbs").map(String);
    const days = String(f.get("days") ?? "");
    const uses = String(f.get("uses") ?? "");
    const ok = await run("grantAdd", {
      email,
      verbs,
      apps: String(f.get("app") ?? ""),
      channels: String(f.get("channel") ?? ""),
      ...(days ? { until: new Date(Date.now() + Number(days) * 864e5).toISOString() } : {}),
      ...(uses ? { uses: Number(uses) } : {}),
      reason: String(f.get("reason") ?? ""),
    });
    if (ok) setAdding(false);
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
        <h4 className="text-[13px] font-medium text-(--ui-ink-2)">
          Role: {String(theirs?.name ?? role)}
        </h4>
        {lines.length ? (
          lines.map((l) => <p key={l}>{l}.</p>)
        ) : (
          <p className={QUIET}>A built-in role.</p>
        )}
      </section>
      <section className="grid gap-2">
        <h4 className="text-[13px] font-medium text-(--ui-ink-2)">Extra grants</h4>
        {live.length ? (
          <ul className={LIST}>
            {live.map((g) => (
              <li key={String(g.id)} className={SPLIT}>
                <span>
                  {String(g.what)}.
                  {g.reason ? (
                    <span className={`${QUIET} block text-[13px]`}>{String(g.reason)}</span>
                  ) : null}
                </span>
                <Button
                  size="sm"
                  tone="quiet"
                  disabled={busy}
                  onClick={() => {
                    if (confirm("End this grant now?")) void run("grantEnd", { id: g.id });
                  }}
                >
                  End now
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={QUIET}>None.</p>
        )}
        {error ? <p className={ERROR}>{error}</p> : null}
        {adding ? (
          <form className={FORM} onSubmit={(e) => void add(e)} aria-label="Add a grant">
            <fieldset className={`${FIELD} basis-full`}>
              <legend className="mb-1.5">They can</legend>
              <div className="flex flex-wrap gap-3 text-[14px] text-(--ui-ink)">
                {VERBS.map(([v, label]) => (
                  <label key={v} className="flex items-center gap-1.5">
                    <input type="checkbox" name="verbs" value={v} defaultChecked={v === "act"} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className={FIELD}>
              <span>In</span>
              <select className={SELECT} name="app" defaultValue="">
                <option value="">Every app</option>
                {Object.entries(APPS).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className={FIELD}>
              <span>On</span>
              <select className={SELECT} name="channel" defaultValue="">
                <option value="">Every channel</option>
                {ACCESS_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_NAMES[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className={FIELD}>
              <span>For</span>
              <select className={SELECT} name="days" defaultValue="">
                {LONG.map(([v, label]) => (
                  <option key={label} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${FIELD} w-28`}>
              <span>Uses</span>
              <Input name="uses" type="number" min={1} max={1000} placeholder="Any" />
            </label>
            <label className={`${FIELD} grow basis-[220px]`}>
              <span>Why</span>
              <Input name="reason" maxLength={500} />
            </label>
            <div className="flex basis-full gap-2">
              <Button type="submit" size="sm" busy={busy}>
                Add grant
              </Button>
              <Button size="sm" tone="quiet" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
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
            className="justify-self-start text-[13px] font-medium text-(--ui-ink-2) hover:text-(--ui-ink)"
            aria-expanded={history}
            onClick={() => setHistory((h) => !h)}
          >
            History ({ended.length})
          </button>
          {history ? (
            <ul className={LIST}>
              {ended.map((g) => (
                <li key={String(g.id)} className={QUIET}>
                  {String(g.what)}. {g.state === "used" ? "Used up." : "Ended."} Given by{" "}
                  {String(g.by)}.
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
