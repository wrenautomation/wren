/**
 * Raise an issue and ask for access on any record (designs/2026-10-06-scoped-access.md): an
 * Issues tab beside History, and a quiet "Ask for access" under the head's actions where the
 * login can read but not act. What shows is what the server would allow (`canAt`, the same check
 * the guard makes); the server checks again.
 */
import { type AccessChannel, CHANNEL_NAMES, type Permission, type Target } from "@wren/core/access";
import type { Cell, RecordMeta } from "@wren/core/records";
import { cn } from "cn";
import { useId, useState } from "react";
import { toast } from "sonner";
import { canAt, type Viewer } from "./access.js";
import { Textarea } from "./components/ui/textarea.js";
import { Button, Tag } from "./controls.js";

export interface IssueLine {
  id: number;
  body: string;
  by: string;
  at: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

/** Where the workspace keeps issues and asks: the console, for Wren or the client looked at. */
export interface AccessApi {
  /** The workspace: a client id, or `wren`. */
  client: string;
  issues(a: { record: string; id: string }): Promise<IssueLine[]>;
  raise(a: {
    record: string;
    id: string;
    body: string;
    title?: string;
    channel?: string | null;
  }): Promise<unknown>;
  resolve(id: number): Promise<unknown>;
  ask(a: {
    verbs: Permission[];
    apps?: string[];
    channels?: string[];
    record?: string;
    until?: string;
    reason: string;
  }): Promise<unknown>;
}

/** Where one row sits, as a check's target: the type's app, its channel or the row's, the row. */
export function rowTarget(
  meta: Pick<RecordMeta, "id" | "app" | "channel">,
  row: Record<string, Cell>,
  client: string,
): Target {
  const c = meta.channel;
  const channel =
    c === null || typeof c === "string"
      ? c
      : typeof row[c.field] === "string"
        ? (row[c.field] as string)
        : null;
  return { client, app: meta.app, channel, record: `${meta.id}:${String(row.id)}` };
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** The Issues tab: each note, Resolve for whoever can act, and a box for whoever can comment. */
export function RecordIssues({
  meta,
  row,
  title,
  access,
  viewer,
  lines,
  reload,
}: {
  meta: RecordMeta;
  row: Record<string, Cell>;
  title: string;
  access: AccessApi;
  viewer: Viewer;
  lines: IssueLine[];
  reload(): void;
}) {
  const at = rowTarget(meta, row, access.client);
  const mayRaise = canAt(viewer, "comment", at);
  const mayResolve = canAt(viewer, "act", at);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const id = useId();
  const raise = async () => {
    const said = body.trim();
    if (!said || busy) return;
    setBusy("raise");
    try {
      await access.raise({
        record: meta.id,
        id: String(row.id),
        body: said,
        title,
        channel: at.channel ?? null,
      });
      setBody("");
      toast.success("Issue raised");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const resolve = async (n: number) => {
    setBusy(`r${n}`);
    try {
      await access.resolve(n);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="grid min-w-0 gap-4" aria-label="Issues">
      {lines.length ? (
        <ol className="grid list-none gap-4 p-0 text-[14px]">
          {lines.map((i) => (
            <li key={i.id} className="grid min-w-0 gap-1.5">
              <span className="flex flex-wrap items-center gap-2 text-[13px] text-(--ui-ink-2)">
                {i.by} · {when(i.at)}
                <Tag tone={i.resolvedAt ? "neutral" : "accent"}>
                  {i.resolvedAt ? "Resolved" : "Open"}
                </Tag>
              </span>
              <span className="whitespace-pre-wrap break-words">{i.body}</span>
              {i.resolvedAt ? (
                <span className="text-[13px] text-(--ui-ink-3)">
                  Resolved by {i.resolvedBy} · {when(i.resolvedAt)}
                </span>
              ) : mayResolve ? (
                <div>
                  <Button
                    size="dense"
                    tone="secondary"
                    busy={busy === `r${i.id}`}
                    disabled={busy !== null}
                    onClick={() => void resolve(i.id)}
                  >
                    Resolve
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-2 text-[14px] text-(--ui-ink-2)">No issues on this {meta.name.one}.</p>
      )}
      {mayRaise ? (
        <div className="grid gap-2">
          <label htmlFor={id} className="text-[13px] font-medium text-(--ui-ink-2)">
            Raise issue
          </label>
          <Textarea
            id={id}
            value={body}
            maxLength={1000}
            rows={3}
            placeholder="What's wrong? Whoever can fix it sees it in their Inbox."
            onChange={(e) => setBody(e.target.value)}
          />
          <div>
            <Button
              size="dense"
              busy={busy === "raise"}
              disabled={!body.trim() || busy !== null}
              onClick={() => void raise()}
            >
              Raise issue
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const SELECT =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const LONG: [string, string][] = [
  ["1", "A day"],
  ["7", "A week"],
  ["30", "30 days"],
  ["", "No end"],
];

/**
 * "Ask for access", quiet under the actions: what to do, where, for how long, and why. It goes
 * to the Inbox of whoever could grant it.
 */
export function AskAccess({
  meta,
  row,
  access,
  viewer,
}: {
  meta: RecordMeta;
  row: Record<string, Cell>;
  access: AccessApi;
  viewer: Viewer;
}) {
  const at = rowTarget(meta, row, access.client);
  const [open, setOpen] = useState(false);
  const [verb, setVerb] = useState<Permission>("act");
  const [where, setWhere] = useState<"record" | "channel">("record");
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  if (!canAt(viewer, "read", at) || canAt(viewer, "act", at)) return null;
  const channel = typeof at.channel === "string" ? at.channel : null;
  const send = async () => {
    if (!reason.trim() || busy) return;
    setBusy(true);
    try {
      await access.ask({
        verbs: [verb],
        apps: [meta.app],
        ...(where === "record" || !channel
          ? { record: at.record as string }
          : { channels: [channel] }),
        ...(days ? { until: new Date(Date.now() + Number(days) * 864e5).toISOString() } : {}),
        reason: reason.trim(),
      });
      toast.success("Asked. You'll hear back in your Inbox.");
      setOpen(false);
      setReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  if (!open)
    return (
      <button
        type="button"
        className="justify-self-start text-[13px] text-(--ui-ink-3) underline-offset-2 hover:text-(--ui-ink) hover:underline"
        onClick={() => setOpen(true)}
      >
        Ask for access
      </button>
    );
  return (
    <section
      className="grid gap-3 rounded-(--ui-radius) border border-(--ui-hair) p-3"
      aria-label="Ask for access"
    >
      <h3 className="text-[13px] font-medium text-(--ui-ink-2)">Ask for access</h3>
      <div className={cn("grid gap-3", "sm:grid-cols-3")}>
        <label className="grid gap-1 text-[13px] text-(--ui-ink-2)">
          To
          <select
            className={SELECT}
            value={verb}
            onChange={(e) => setVerb(e.target.value as Permission)}
          >
            <option value="act">Act on it</option>
            <option value="comment">Raise issues</option>
          </select>
        </label>
        <label className="grid gap-1 text-[13px] text-(--ui-ink-2)">
          On
          <select
            className={SELECT}
            value={where}
            onChange={(e) => setWhere(e.target.value as "record" | "channel")}
          >
            <option value="record">This {meta.name.one}</option>
            {channel ? (
              <option value="channel">
                All of {CHANNEL_NAMES[channel as AccessChannel] ?? channel}
              </option>
            ) : null}
          </select>
        </label>
        <label className="grid gap-1 text-[13px] text-(--ui-ink-2)">
          For
          <select className={SELECT} value={days} onChange={(e) => setDays(e.target.value)}>
            {LONG.map(([v, label]) => (
              <option key={label} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label htmlFor={id} className="text-[13px] text-(--ui-ink-2)">
        Why
      </label>
      <Textarea
        id={id}
        rows={2}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="dense" busy={busy} disabled={!reason.trim()} onClick={() => void send()}>
          Ask
        </Button>
        <Button size="dense" tone="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
