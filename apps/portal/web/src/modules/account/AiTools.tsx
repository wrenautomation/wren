/**
 * AI tools (designs/2026-10-09-ai-tools.md): a person's access tokens for the `wren` CLI and its
 * skill, which Claude Code and other agents run. A token shows once and acts as its person, nothing more. Made in a client's Account,
 * it is pinned to that client; made on the team's page, it reaches what its operator does. Its
 * access and apps cap it lower: read only by default.
 */
import { APPS } from "@wren/core/access";
import {
  ACTIONS,
  Button,
  ChecksField,
  cx,
  Empty,
  LoadFailed,
  Loading,
  PageHeader,
  Pill,
  Section,
  SelectField,
  Tag,
  TextField,
  useEditForm,
  useNarrow,
} from "@wren/ui";
import { useRef, useState } from "react";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { PageRows, RowDoes, rowLines, useGoing } from "../../page-rows.js";
import { ERROR, Kept, QUIET, TOOLS } from "../work/bits.js";
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
const SMALL_SELECT = "h-9 min-h-0 cursor-pointer px-2 text-[13px]";
const PRE =
  "m-0 overflow-auto border border-(--ui-hair) bg-(--ui-tile) p-2.5 font-mono text-[12px] leading-[1.5] whitespace-pre-wrap break-all";

export function AiTools(props: PageProps) {
  // The team's page asks as the operator; a client's Account pins to that client.
  const where = props.team ? {} : { client: props.client, asClient: true };
  const load = useCall(`tokens:${props.client}:${props.team}`, () =>
    call<Token[]>("console/tokens", where),
  );
  const [busy, setBusy] = useState(false);
  const narrow = useNarrow();
  const { go, stateOf } = useGoing();
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  // One write at a time; a second press of the same one is one action (its request id).
  const flying = useRef(false);
  const run = async <T,>(route: string, body: Record<string, unknown>): Promise<T | null> => {
    if (flying.current) return null;
    flying.current = true;
    setBusy(true);
    setError(null);
    try {
      const got = await ACTIONS.run(
        `console/${route}:${props.client}:${JSON.stringify(body)}`,
        (requestId) => call<T>(`console/${route}`, { ...where, ...body, requestId }),
      );
      load.retry();
      return got;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return null;
    } finally {
      flying.current = false;
      setBusy(false);
    }
  };
  const form = useEditForm({
    key: `token:new:${props.client}:${props.team}`,
    defaults: { name: "", days: "90", access: "read", apps: [] as string[] },
  });
  const make = form.onSend(
    async (v) => {
      const access = ACCESS.find((a) => a.id === v.access) ?? ACCESS[0];
      const got = await run<{ token: string }>("tokenMake", {
        name: v.name.trim(),
        days: Number(v.days) || null,
        verbs: access.verbs ? [...access.verbs].sort() : null,
        apps: v.apps.length ? v.apps : null,
      });
      if (!got) return false;
      setMade(got.token);
    },
    { clear: true },
  );
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
          <PageRows<Token>
            label="Your tokens"
            noun="token"
            lines={rowLines(tokens, (t) => t.id)}
            rowState={(t) => stateOf(t.id)}
            name={{
              label: "Token",
              icon: "key",
              min: 240,
              title: (t) => t.name,
              tail: (t) => (t.client ? <Tag tone="neutral">{t.client}</Tag> : null),
              sub: (t) => (
                <span className={cx("truncate text-[12.5px]", QUIET)}>
                  <code>{t.prefix}…</code>, made {day(t.createdAt)}
                  {t.expiresAt ? `, ends ${day(t.expiresAt)}` : ""}
                </span>
              ),
            }}
            columns={[
              {
                key: "access",
                label: "Can",
                icon: "shield",
                width: 190,
                phone: true,
                cell: (t) => <Pill>{accessOf(t.verbs)}</Pill>,
              },
              {
                key: "apps",
                label: "Apps",
                icon: "apps",
                min: 150,
                className: "max-[1100px]:hidden",
                cell: (t) => (t.apps ? t.apps.map((a) => APPS[a] ?? a).join(", ") : "Every app"),
              },
              {
                key: "used",
                label: "Last used",
                icon: "clock",
                width: 130,
                quiet: true,
                className: "max-[900px]:hidden",
                cell: (t) => (t.lastUsedAt ? day(t.lastUsedAt) : "Never"),
              },
            ]}
            end={(t) => (
              <RowDoes
                title={t.name}
                lone={narrow}
                busy={busy}
                does={[
                  {
                    id: "remove",
                    label: "Remove",
                    confirm: `Remove ${t.name}? Any tool using it stops at once.`,
                    run: () => go(t.id, "Removing", () => run("tokenRevoke", { id: t.id })),
                  },
                ]}
              />
            )}
          />
        )}
        {error ? (
          <p className={ERROR} role="alert">
            {error}
          </p>
        ) : null}
      </Section>

      <Section title="Make a token" note="Name it after the tool that holds it.">
        <form className="grid gap-3" aria-label="Make a token" onSubmit={(e) => void make(e)}>
          <Kept form={form} />
          <div className="flex flex-wrap gap-3">
            <TextField
              form={form}
              name="name"
              label="Name"
              className="grow basis-[240px]"
              required
              maxLength={80}
              placeholder="Claude Code on my laptop"
            />
            <SelectField
              form={form}
              name="days"
              label="Lasts"
              className="basis-[160px]"
              box={SMALL_SELECT}
              options={LASTS.map((l) => [String(l.days), l.label] as const)}
            />
            <SelectField
              form={form}
              name="access"
              label="Can"
              className="basis-[200px]"
              box={SMALL_SELECT}
              options={ACCESS.map((a) => [a.id, a.label] as const)}
            />
          </div>
          <details>
            <summary className={cx("cursor-pointer text-[13px]", QUIET)}>
              Only some apps (every app you can open when none are ticked)
            </summary>
            <ChecksField
              form={form}
              name="apps"
              className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5"
              options={Object.entries(APPS)}
            />
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
