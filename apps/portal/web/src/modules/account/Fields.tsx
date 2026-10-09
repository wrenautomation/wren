/**
 * Settings → Fields and Business facts (designs/2026-10-09-custom-fields.md). Fields: your own
 * fields on each list that takes them, in order; the kind is picked once, archived ones keep
 * their values. Facts: your business facts, quoted in copy as `{biz.<key>}`. Values of fields
 * are edited on each record. The console checks `manage` on every change.
 */
import type { CustomField, CustomValue } from "@wren/core/custom-schema";
import { Button, Empty, Input, LoadFailed, Loading, PageHeader, Section, Tag } from "@wren/ui";
import { type FormEvent, useState } from "react";
import { ApiError } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { consoleIn } from "../access/PersonAccess.js";
import { ERROR, FIELD, FORM, LIST, QUIET, SELECT, SPLIT, TOOLS } from "../work/bits.js";

interface FieldsView {
  records: { id: string; name: { one: string; many: string } }[];
  record: string | null;
  fields: CustomField[];
}

const KINDS: [string, string][] = [
  ["text", "Text"],
  ["number", "Number"],
  ["money", "Money"],
  ["date", "Date"],
  ["choice", "Choice"],
  ["yes_no", "Yes or no"],
  ["link", "Link"],
];
const kindName = (k: string) => KINDS.find(([id]) => id === k)?.[1] ?? k;
/** "Roof, Metal" -> options; each keeps its key when the label matches an old one. */
const optionsFrom = (s: string, old: CustomField["options"]) =>
  s
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label) => {
      const was = old?.find((o) => o.label === label);
      return was ? { key: was.key, label } : { label };
    });

/** One console write, the error to show, and a reload after. */
function useWrite(client: string, reload: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (handler: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await consoleIn(client, handler, body);
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

function FieldRow({
  f,
  at,
  last,
  record,
  write,
  move,
}: {
  f: CustomField;
  at: number;
  last: boolean;
  record: string;
  write: ReturnType<typeof useWrite>;
  move: (from: number, to: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const ok = await write.run("customFieldSave", {
      id: f.id,
      record,
      label: String(d.get("label") ?? "").trim(),
      ...(f.kind === "choice"
        ? { options: optionsFrom(String(d.get("options") ?? ""), f.options) }
        : {}),
    });
    if (ok) setOpen(false);
  };
  return (
    <li>
      <div className={SPLIT}>
        <span className="flex flex-wrap items-center gap-2">
          <b className={f.archivedAt ? QUIET : ""}>{f.label}</b>
          <Tag tone="neutral">{kindName(f.kind)}</Tag>
          {f.archivedAt ? <Tag tone="neutral">Archived</Tag> : null}
          <code className={`text-[12px] ${QUIET}`}>{`{field.${f.key}}`}</code>
        </span>
        <span className="flex gap-1">
          {!f.archivedAt ? (
            <>
              <Button
                size="sm"
                tone="quiet"
                disabled={write.busy || at === 0}
                onClick={() => move(at, at - 1)}
              >
                Up
              </Button>
              <Button
                size="sm"
                tone="quiet"
                disabled={write.busy || last}
                onClick={() => move(at, at + 1)}
              >
                Down
              </Button>
              <Button size="sm" tone="quiet" onClick={() => setOpen((o) => !o)}>
                {open ? "Close" : "Edit"}
              </Button>
            </>
          ) : null}
          <Button
            size="sm"
            tone="quiet"
            disabled={write.busy}
            onClick={() =>
              void write.run("customFieldSave", {
                id: f.id,
                record,
                label: f.label,
                archived: !f.archivedAt,
              })
            }
          >
            {f.archivedAt ? "Bring back" : "Archive"}
          </Button>
        </span>
      </div>
      {f.kind === "choice" && f.options?.length ? (
        <p className={`m-0 mt-1 text-[13px] ${QUIET}`}>
          {f.options.map((o) => o.label).join(", ")}
        </p>
      ) : null}
      {open ? (
        <form className={FORM} onSubmit={save}>
          <label className={FIELD}>
            Name
            <Input name="label" defaultValue={f.label} maxLength={80} required />
          </label>
          {f.kind === "choice" ? (
            <label className={FIELD}>
              Options, comma between
              <Input
                name="options"
                defaultValue={f.options?.map((o) => o.label).join(", ") ?? ""}
              />
            </label>
          ) : null}
          <Button type="submit" size="sm" busy={write.busy}>
            Save
          </Button>
        </form>
      ) : null}
    </li>
  );
}

export function Fields(props: PageProps) {
  const [record, setRecord] = useState<string | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  const load = useCall(`fields:${props.client}:${record}:${nonce}`, () =>
    consoleIn<FieldsView>(props.client, "customFields", record ? { record } : {}),
  );
  const write = useWrite(props.client, () => setNonce((n) => n + 1));
  const [kind, setKind] = useState("text");
  const data = load.data;
  const here = data?.record ?? null;
  const live = data?.fields.filter((f) => !f.archivedAt) ?? [];
  const archived = data?.fields.filter((f) => f.archivedAt) ?? [];

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const ok = await write.run("customFieldSave", {
      record: here,
      label: String(d.get("label") ?? "").trim(),
      kind,
      ...(kind === "choice" ? { options: optionsFrom(String(d.get("options") ?? ""), null) } : {}),
    });
    if (ok) {
      form.reset();
      setKind("text");
    }
  };
  const move = (from: number, to: number) => {
    const ids = live.map((f) => f.id);
    const [id] = ids.splice(from, 1);
    if (!id) return;
    ids.splice(to, 0, id);
    void write.run("customFieldOrder", { record: here, ids });
  };

  return (
    <>
      <PageHeader
        title="Fields"
        lede="Your own fields on your lists, like Roof age on deals. They show, filter and sort like the rest, and copy quotes them."
      />
      <Section>
        {load.error && !data ? (
          <LoadFailed error={load.error} onRetry={load.retry} />
        ) : !data ? (
          <Loading lines={3} />
        ) : !here ? (
          <Empty>No list here takes fields yet.</Empty>
        ) : (
          <>
            {data.records.length > 1 ? (
              <label className={FIELD}>
                List
                <select className={SELECT} value={here} onChange={(e) => setRecord(e.target.value)}>
                  {data.records.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name.many}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {live.length === 0 ? (
              <Empty>No fields yet.</Empty>
            ) : (
              <ul className={`m-0 list-none p-0 ${LIST}`}>
                {live.map((f, i) => (
                  <FieldRow
                    key={f.id}
                    f={f}
                    at={i}
                    last={i === live.length - 1}
                    record={here}
                    write={write}
                    move={move}
                  />
                ))}
              </ul>
            )}
            <form className={FORM} onSubmit={add}>
              <label className={FIELD}>
                Name
                <Input name="label" maxLength={80} placeholder="Roof age" required />
              </label>
              <label className={FIELD}>
                Kind (fixed once added)
                <select className={SELECT} value={kind} onChange={(e) => setKind(e.target.value)}>
                  {KINDS.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              {kind === "choice" ? (
                <label className={FIELD}>
                  Options, comma between
                  <Input name="options" placeholder="Shingle, Metal, Tile" required />
                </label>
              ) : null}
              <Button type="submit" busy={write.busy}>
                Add field
              </Button>
            </form>
            {write.error ? <p className={ERROR}>{write.error}</p> : null}
            {archived.length ? (
              <details className="mt-6">
                <summary className={`cursor-pointer text-[13.5px] ${QUIET}`}>
                  Archived ({archived.length})
                </summary>
                <ul className={`m-0 list-none p-0 ${LIST}`}>
                  {archived.map((f, i) => (
                    <FieldRow
                      key={f.id}
                      f={f}
                      at={i}
                      last
                      record={here}
                      write={write}
                      move={move}
                    />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </Section>
    </>
  );
}

export function Facts(props: PageProps) {
  const [nonce, setNonce] = useState(0);
  const load = useCall(`facts:${props.client}:${nonce}`, () =>
    consoleIn<CustomValue[]>(props.client, "businessFacts", {}),
  );
  const write = useWrite(props.client, () => setNonce((n) => n + 1));
  const [copied, setCopied] = useState<string | null>(null);
  const facts = load.data;

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const ok = await write.run("businessFactSave", {
      label: String(d.get("label") ?? "").trim(),
      value: String(d.get("value") ?? "").trim(),
    });
    if (ok) form.reset();
  };
  const copy = (key: string) =>
    void navigator.clipboard.writeText(`{biz.${key}}`).then(() => setCopied(key));

  return (
    <>
      <PageHeader
        title="Business facts"
        lede="Your phone, address, hours and the like, kept once. Copy quotes each by its mark, so a change here changes every text that uses it."
      />
      <Section>
        {load.error && !facts ? (
          <LoadFailed error={load.error} onRetry={load.retry} />
        ) : !facts ? (
          <Loading lines={3} />
        ) : facts.length === 0 ? (
          <Empty>No facts yet.</Empty>
        ) : (
          <ul className={`m-0 list-none p-0 ${LIST}`}>
            {facts.map((f) => (
              <li key={f.id}>
                <div className={SPLIT}>
                  <span className="grid gap-0.5">
                    <b>{f.label}</b>
                    <span className="break-words">{f.value}</span>
                  </span>
                  <span className="flex gap-1">
                    <Button size="sm" tone="quiet" onClick={() => copy(f.key)}>
                      {copied === f.key ? "Copied" : `{biz.${f.key}}`}
                    </Button>
                    <Button
                      size="sm"
                      tone="quiet"
                      disabled={write.busy}
                      onClick={() => {
                        if (confirm(`Remove ${f.label}? Copy that quotes it will refuse to send.`))
                          void write.run("businessFactSave", {
                            key: f.key,
                            label: f.label,
                            value: "",
                          });
                      }}
                    >
                      Remove
                    </Button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form className={FORM} onSubmit={add}>
          <label className={FIELD}>
            Name
            <Input name="label" maxLength={80} placeholder="Phone" required />
          </label>
          <label className={FIELD}>
            Value (same name replaces it)
            <Input name="value" maxLength={2000} placeholder="(416) 555-0100" required />
          </label>
          <Button type="submit" busy={write.busy}>
            Save fact
          </Button>
        </form>
        {write.error ? <p className={ERROR}>{write.error}</p> : null}
        <p className={`${TOOLS} text-[13px] ${QUIET}`}>
          A list's own fields are quoted the same way, as {"{field.<key>}"}.
        </p>
      </Section>
    </>
  );
}
