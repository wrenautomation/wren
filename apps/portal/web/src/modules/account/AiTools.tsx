/**
 * AI tools (designs/2026-10-09-mcp.md): a person's access tokens for Claude, Cursor and other MCP
 * clients. A token shows once and acts as its person, nothing more. Made in a client's Account,
 * it is pinned to that client; made on the team's page, it reaches what its operator does.
 */
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
    const got = await run<{ token: string }>("tokenMake", {
      name: String(f.get("name") ?? "").trim(),
      days: days || null,
    });
    if (got) {
      setMade(got.token);
      form.reset();
    }
  };
  const url = `${location.origin}/api/mcp`;
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
        lede="Connect Claude, Cursor or any MCP client. A token sees and does only what you can, and stops working the moment you remove it."
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
                  </span>
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
          </div>
          <div className={TOOLS}>
            <Button type="submit" size="dense" busy={busy}>
              Make token
            </Button>
          </div>
        </form>
      </Section>

      <Section title="Connect" note="Paste your token in place of the one shown.">
        <div className="grid gap-3 text-[13.5px]">
          <p className="m-0">Claude Code:</p>
          <pre className={PRE}>
            {`claude mcp add --transport http wren ${url} --header "Authorization: Bearer wren_…"`}
          </pre>
          <p className="m-0">Cursor and other clients, in their MCP settings:</p>
          <pre className={PRE}>
            {JSON.stringify(
              {
                mcpServers: {
                  wren: { url, headers: { Authorization: "Bearer wren_…" } },
                },
              },
              null,
              2,
            )}
          </pre>
          <p className={cx("m-0", QUIET)}>
            It reads your records. For Wren's team it can also run handlers; one that sends, spends
            or posts runs only when the tool confirms it by name.
          </p>
        </div>
      </Section>
    </>
  );
}
