/**
 * AI tools (designs/2026-10-09-ai-tools.md): a person's access tokens for the `wren` CLI and its
 * skill, which Claude Code and other agents run. A token shows once and acts as its person, nothing more. Made in a client's Account,
 * it is pinned to that client; made on the team's page, it reaches what its operator does. Its
 * access and apps cap it lower: read only by default.
 */
import { APPS } from "@wren/core/access";
import { Button, cx, Empty, Input, LoadFailed, Loading, PageHeader, Section, Tag } from "@wren/ui";
import { type FormEvent, useState } from "react";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { ERROR, FIELD, QUIET, TOOLS } from "../work/bits.js";
import { Secret } from "./Webhooks.js";

interface Token {
  id: string;
  name: string;
  prefix: string;
  client: string | null;
  verbs: string[] | null;
  apps: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

const LASTS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: 0, label: "Until removed" },
] as const;
/** What a token may do. Read only is the default: an agent that only answers questions needs no more. */
const ACCESS = [
  { id: "read", label: "Read only", verbs: ["read"] },
  { id: "work", label: "Read and work", verbs: ["read", "comment", "act", "run"] },
  { id: "all", label: "Everything you can", verbs: null },
] as const;
const accessOf = (verbs: string[] | null) =>
  verbs === null
    ? "Everything you can"
    : (ACCESS.find((a) => a.verbs?.join() === [...verbs].sort().join())?.label ?? verbs.join(", "));
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const PRE =
  "m-0 overflow-auto border border-(--ui-hair) bg-(--ui-tile) p-2.5 font-mono text-[12px] leading-[1.5] whitespace-pre-wrap break-all";

export function AiTools(props: PageProps) {
  const [nonce, setNonce] = useState(0);
  // The team's page asks as the operator; a client's Account pins to that client.
  const where = props.team ? {} : { client: props.client, asClient: true };
  const load = useCall(`tokens:${props.client}:${props.team}:${nonce}`, () =>
    call<Token[]>("console/tokens", where),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const run = async <T,>(route: string, body: Record<string, unknown>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      const got = await call<T>(`console/${route}`, { ...where, ...body });
      setNonce((n) => n + 1);
      return got;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const make = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const days = Number(f.get("days"));
    const access = ACCESS.find((a) => a.id === f.get("access")) ?? ACCESS[0];
    const apps = f.getAll("apps").map(String);
    const got = await run<{ token: string }>("tokenMake", {
      name: String(f.get("name") ?? "").trim(),
      days: days || null,
      verbs: access.verbs ? [...access.verbs].sort() : null,
      apps: apps.length ? apps : null,
    });
    if (got) {
      setMade(got.token);
      form.reset();
    }
  };
  const host = location.origin;
  const tokens = load.data;

  if (props.demo)
    return (
      <>
        <PageHeader title="AI tools" />
        <Empty>Sign in to connect your AI tools.</Empty>
      </>
    );
  return (
    <>
      <PageHeader
        title="AI tools"
        lede="Let Claude Code, another agent or your own script use your Wren. A token reads only unless you say more, never does more than you can, and stops the moment you remove it."
      />
      {made ? <Secret key={made} secret={made} what="token" onClose={() => setMade(null)} /> : null}
      <Section title="Your tokens">
        {load.error && !tokens ? (
          <LoadFailed error={load.error} onRetry={load.retry} />
        ) : !tokens ? (
          <Loading lines={2} />
        ) : tokens.length === 0 ? (
          <Empty>No tokens yet.</Empty>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {tokens.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-hair) pb-3"
              >
                <span className="grid gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <b>{t.name}</b>
                    <code className={cx("text-[12px]", QUIET)}>{t.prefix}…</code>
                    {t.client ? <Tag tone="neutral">{t.client}</Tag> : null}
                    <Tag tone="neutral">{accessOf(t.verbs)}</Tag>
                  </span>
                  {t.apps ? (
                    <span className={cx("text-[13px]", QUIET)}>
                      Only {t.apps.map((a) => APPS[a] ?? a).join(", ")}
                    </span>
                  ) : null}
                  <span className={cx("text-[13px]", QUIET)}>
                    Made {day(t.createdAt)}
                    {t.lastUsedAt ? `, last used ${day(t.lastUsedAt)}` : ", never used"}
                    {t.expiresAt ? `, ends ${day(t.expiresAt)}` : ""}
                  </span>
                </span>
                <Button
                  size="sm"
                  tone="quiet"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Remove ${t.name}? Any tool using it stops at once.`))
                      void run("tokenRevoke", { id: t.id });
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <p className={ERROR} role="alert">
            {error}
          </p>
        ) : null}
      </Section>

      <Section title="Make a token" note="Name it after the tool that holds it.">
        <form className="grid gap-3" aria-label="Make a token" onSubmit={(e) => void make(e)}>
          <div className="flex flex-wrap gap-3">
            <label className={`${FIELD} grow basis-[240px]`}>
              <span>Name</span>
              <Input name="name" required maxLength={80} placeholder="Claude Code on my laptop" />
            </label>
            <label className={`${FIELD} basis-[160px]`}>
              <span>Lasts</span>
              <select
                name="days"
                defaultValue="90"
                className="h-9 cursor-pointer border border-(--ui-hair) bg-(--ui-paper) px-2 text-[13px] outline-none"
              >
                {LASTS.map((l) => (
                  <option key={l.days} value={l.days}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${FIELD} basis-[200px]`}>
              <span>Can</span>
              <select
                name="access"
                defaultValue="read"
                className="h-9 cursor-pointer border border-(--ui-hair) bg-(--ui-paper) px-2 text-[13px] outline-none"
              >
                {ACCESS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <details>
            <summary className={cx("cursor-pointer text-[13px]", QUIET)}>
              Only some apps (every app you can open when none are ticked)
            </summary>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[13.5px]">
              {Object.entries(APPS).map(([id, name]) => (
                <label key={id} className="flex items-center gap-1.5">
                  <input type="checkbox" name="apps" value={id} />
                  {name}
                </label>
              ))}
            </div>
          </details>
          <div className={TOOLS}>
            <Button tone="primary" type="submit" size="dense" busy={busy}>
              Make token
            </Button>
          </div>
        </form>
      </Section>

      <Section title="Connect" note="Run these in a terminal. Login asks for your token.">
        <div className="grid gap-3 text-[13.5px]">
          <p className="m-0">1. Add the Wren skill and its CLI:</p>
          <pre className={PRE}>
            {`mkdir -p ~/.claude/skills/wren && cd ~/.claude/skills/wren \\
  && curl -fsSLO ${host}/agent/SKILL.md && curl -fsSLO ${host}/agent/wren.mjs`}
          </pre>
          <p className="m-0">2. Sign it in:</p>
          <pre className={PRE}>{`node ~/.claude/skills/wren/wren.mjs login ${host}`}</pre>
          <p className="m-0">
            3. Ask Claude Code about your Wren, for example "which leads replied this week". Other
            agents that run commands can use the same folder. Point them at SKILL.md.
          </p>
          <p className="m-0">Or call it from any script, as an API key:</p>
          <pre className={PRE}>
            {`curl -X POST ${host}/api/agent/types \\
  -H "Authorization: Bearer wren_…"`}
          </pre>
          <p className={cx("m-0", QUIET)}>
            It reads your records. A token that can work also acts on them, and Wren's team can run
            handlers with it. A handler that sends, spends or posts runs only when the agent
            confirms it by name, and the skill tells the agent to ask you first.
          </p>
        </div>
      </Section>
    </>
  );
}
