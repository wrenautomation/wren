/**
 * A Webhook or Form node's door, in its panel and over the canvas (designs/2026-10-06-workflow-
 * editor.md, step 5): the URL, its token masked with Show and Copy for a teammate with `manage`,
 * Rotate, and its calls. Publish makes the door once; it keeps its URL on every publish. Also the
 * field map: where each lead fact sits in what the form posts.
 */
import { COMMON, DOOR_URL, LEAD_FIELDS, type LeadField, mapKey, NAMES } from "@wren/core/door";
import { Button, cx, Input, LoadFailed, StateMark, say } from "@wren/ui";
import { useId, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { QUIET } from "../work/bits.js";
import type { With } from "./wiring.js";

export interface Door {
  id: string;
  node: string;
  name: string;
  subject: string;
  open: boolean;
  calls: number;
  lastAt: string | null;
  createdAt: string;
  masked: string | null;
}

/** Tokens made by the last publish, by node: shown once, whole. */
export type Fresh = Readonly<Record<string, string>>;

const FACT_LABEL: Record<LeadField, string> = {
  name: "Name",
  phone: "Phone",
  email: "Email",
  consent: "Text consent",
  source: "Source",
  zone: "Time zone",
  niche: "Market",
};

/** Where each lead fact sits in the payload; blank reads the common names. */
export function FieldMapForm({
  values,
  set,
}: {
  values: With;
  set: ((field: string, v: string) => void) | null;
}) {
  const base = useId();
  return (
    <div className="grid gap-2">
      <p className={cx("m-0 text-[12.5px]", QUIET)}>
        Where each fact sits in what's posted, dotted. Blank reads the usual names.
      </p>
      {LEAD_FIELDS.map((f) => {
        const at = `${base}-${f}`;
        const usual = f === "name" ? NAMES : COMMON[f];
        return (
          <label
            key={f}
            htmlFor={at}
            className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2"
          >
            <span className="text-[12.5px] text-(--ui-ink-2)">{FACT_LABEL[f]}</span>
            <Input
              id={at}
              value={String(values[mapKey(f)] ?? "")}
              readOnly={!set}
              maxLength={120}
              placeholder={usual.slice(0, 2).join(", ")}
              onChange={(e) => set?.(mapKey(f), e.target.value.trim())}
              className="h-8 font-mono text-[12px]"
            />
          </label>
        );
      })}
    </div>
  );
}

/** The doors into a workflow, read once per open and after each change. */
export function useDoors(workflow: string, client: string | null, nonce = 0) {
  return useCall(`doors:${client ?? ""}:${workflow}:${nonce}`, () =>
    call<Door[]>("console/workflowDoors", { workflow, ...(client ? { client } : {}) }),
  );
}

const copy = (text: string) =>
  navigator.clipboard
    ?.writeText(text)
    .then(() => say.done("Copied."))
    .catch(() => say.failed("Couldn't copy: select it instead."));

/** One door: its URL, Show, Copy and Rotate, its state and calls. */
export function DoorLine({
  door,
  workflow,
  client,
  mayManage,
  fresh,
  onRotated,
}: {
  door: Door;
  workflow: string;
  client: string | null;
  mayManage: boolean;
  fresh?: string | undefined;
  onRotated: (token: string) => void;
}) {
  const [shown, setShown] = useState<string | null>(fresh ?? null);
  const [busy, setBusy] = useState<"show" | "rotate" | null>(null);
  const [asking, setAsking] = useState(false);
  const ask = { workflow, id: door.id, ...(client ? { client } : {}) };
  const token = shown ?? fresh ?? null;
  const url = `${DOOR_URL}${token ?? door.masked ?? "••••••••••••••"}`;
  const reveal = async () => {
    setBusy("show");
    try {
      setShown((await call<{ token: string }>("console/doorReveal", ask)).token);
    } catch (err) {
      say.failed(err);
    }
    setBusy(null);
  };
  const rotate = async () => {
    setBusy("rotate");
    try {
      const got = await call<{ token: string }>("console/doorRotate", ask);
      setShown(got.token);
      setAsking(false);
      onRotated(got.token);
      say.done("Rotated. The old URL stopped working.");
    } catch (err) {
      say.failed(err);
    }
    setBusy(null);
  };
  return (
    <div className="grid gap-2">
      <code className="block min-w-0 bg-(--ui-tile) px-2.5 py-2 font-mono text-[12px] leading-[1.5] break-all text-(--ui-ink)">
        {url}
      </code>
      <span className="flex flex-wrap items-center gap-2">
        {mayManage ? (
          <>
            {token ? (
              <Button tone="secondary" size="dense" onClick={() => setShown(null)}>
                Hide
              </Button>
            ) : door.masked ? (
              <Button tone="secondary" size="dense" busy={busy === "show"} onClick={reveal}>
                Show
              </Button>
            ) : null}
            <Button
              tone="secondary"
              size="dense"
              disabled={!token && !door.masked}
              onClick={async () => {
                if (token) return copy(`${DOOR_URL}${token}`);
                try {
                  const got = await call<{ token: string }>("console/doorReveal", ask);
                  await copy(`${DOOR_URL}${got.token}`);
                } catch (err) {
                  say.failed(err);
                }
              }}
            >
              Copy URL
            </Button>
            <Button tone="quiet" size="dense" onClick={() => setAsking(!asking)}>
              Rotate
            </Button>
          </>
        ) : (
          <span className={cx("text-[12.5px]", QUIET)}>
            Showing the token takes manage on Workflows.
          </span>
        )}
        <StateMark
          state={door.open ? { label: "Open", tone: "good" } : { label: "Shut", tone: "neutral" }}
        />
      </span>
      {fresh && !door.masked ? (
        <p className="m-0 text-[12.5px] text-(--warn)">Shown once. Copy it now.</p>
      ) : !door.masked && !token ? (
        <p className={cx("m-0 text-[12.5px]", QUIET)}>
          It was shown once and isn't kept. Rotate for a new one.
        </p>
      ) : null}
      {asking ? (
        <div className="grid gap-2 border border-(--warn) p-2.5 text-[13px]">
          <span>
            A new token. The old URL stops at once, so anything posting to it needs the new one.
          </span>
          <span className="flex gap-2">
            <Button size="dense" busy={busy === "rotate"} onClick={rotate}>
              Rotate now
            </Button>
            <Button tone="quiet" size="dense" onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </span>
        </div>
      ) : null}
      <span className={cx("text-[12.5px] tabular-nums", QUIET)}>
        {door.calls.toLocaleString("en-US")} call{door.calls === 1 ? "" : "s"}
        {door.lastAt ? `, last ${new Date(door.lastAt).toLocaleString()}` : ""}. POST JSON or a
        form. About {door.subject}.
      </span>
    </div>
  );
}

/** A door node's door in its panel: the line once published, else what Publish does. */
export function DoorBlock({
  workflow,
  client,
  node,
  mayManage,
  fresh,
}: {
  workflow: string;
  client: string | null;
  node: string;
  mayManage: boolean;
  fresh?: Fresh;
}) {
  const [nonce, setNonce] = useState(0);
  const got = useDoors(workflow, client, nonce);
  if (got.error) return <LoadFailed error={got.error} onRetry={got.retry} what="door" />;
  if (!got.data) return <p className={QUIET}>Reading…</p>;
  const door = got.data.find((d) => d.node === node);
  if (!door)
    return (
      <p className={QUIET}>Publish to get its URL. It keeps the same URL on every publish after.</p>
    );
  return (
    <DoorLine
      door={door}
      workflow={workflow}
      client={client}
      mayManage={mayManage}
      fresh={fresh?.[node]}
      onRotated={() => setNonce((n) => n + 1)}
    />
  );
}

/** Over the canvas: each live door node's door, so its URL is one look away after Publish. */
export function DoorStrip({
  workflow,
  client,
  nodes,
  mayManage,
  fresh,
}: {
  workflow: string;
  client: string | null;
  nodes: readonly { id: string; name: string }[];
  mayManage: boolean;
  fresh?: Fresh;
}) {
  const [nonce, setNonce] = useState(0);
  const got = useDoors(workflow, client, nonce);
  const doors = (got.data ?? []).filter((d) => nodes.some((n) => n.id === d.node));
  if (!doors.length) return null;
  return (
    <section
      aria-label="Doors"
      className="mb-3 grid gap-3 border border-(--ui-hair) bg-(--ui-paper) px-3 py-2.5 text-[13.5px]"
    >
      {doors.map((d) => (
        <div key={d.id} className="grid gap-1.5">
          <span className="font-semibold">
            {nodes.find((n) => n.id === d.node)?.name ?? d.node}: door
          </span>
          <DoorLine
            door={d}
            workflow={workflow}
            client={client}
            mayManage={mayManage}
            fresh={fresh?.[d.node]}
            onRotated={() => setNonce((n) => n + 1)}
          />
        </div>
      ))}
    </section>
  );
}
