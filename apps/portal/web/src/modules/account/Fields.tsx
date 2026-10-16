/**
 * Settings → Fields and Business facts (designs/2026-10-09-custom-fields.md). Fields: your own
 * fields on each list that takes them, in order; the kind is picked once, archived ones keep
 * their values. Facts: your business facts, quoted in copy as `{biz.<key>}`. Values of fields
 * are edited on each record. The console checks `manage` on every change.
 */
import type { CustomField, CustomValue } from "@wren/core/custom-schema";
import {
  ACTIONS,
  Button,
  Empty,
  LoadFailed,
  Loading,
  PageHeader,
  Section,
  SelectField,
  Tag,
  TextField,
  useEditForm,
} from "@wren/ui";
import { useRef, useState } from "react";
import { ApiError } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { consoleIn } from "../access/PersonAccess.js";
import {
  ERROR,
  FIELD,
  FORM,
  Kept,
  LIST,
  NARROW,
  QUIET,
  SELECT,
  SPLIT,
  TOOLS,
} from "../work/bits.js";

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
  // One write at a time; a second press of the same one is one action (its request id).
  const flying = useRef(false);
  const run = async (handler: string, body: Record<string, unknown>) => {
    if (flying.current) return false;
    flying.current = true;
    setBusy(true);
    setError(null);
    try {
      await ACTIONS.run(`console/${handler}:${client}:${JSON.stringify(body)}`, (requestId) =>
        consoleIn(client, handler, { ...body, requestId }),
      );
      reload();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return false;
    } finally {
      flying.current = false;
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** A field's name, and its options when it is a choice; starts from what is saved. */
function EditField({
  f,
  record,
  write,
  done,
}: {
  f: CustomField;
  record: string;
  write: ReturnType<typeof useWrite>;
  done: () => void;
}) {
  const form = useEditForm({
    key: `field:${record}:${f.id}`,
    defaults: { label: f.label, options: f.options?.map((o) => o.label).join(", ") ?? "" },
  });
  const save = form.onSend(async (v) => {
    const ok = await write.run("customFieldSave", {
      id: f.id,
      record,
      label: v.label.trim(),
      ...(f.kind === "choice" ? { options: optionsFrom(v.options, f.options) } : {}),
    });
    if (ok) done();
    return ok;
  });
  return (
    <form className={FORM} onSubmit={(e) => void save(e)}>
      <Kept form={form} />
      <TextField form={form} name="label" label="Name" className={NARROW} maxLength={80} required />
      {f.kind === "choice" ? (
        <TextField form={form} name="options" label="Options, comma between" className={NARROW} />
      ) : null}
      <Button tone="primary" type="submit" size="sm" busy={write.busy}>
        Save
      </Button>
    </form>
  );
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
      {open ? <EditField f={f} record={record} write={write} done={() => setOpen(false)} /> : null}
    </li>
  );
}

/** The add form: a name, a kind picked once, and the options of a choice. */
function AddField({
  client,
  record,
  write,
}: {
  client: string;
  record: string;
  write: ReturnType<typeof useWrite>;
}) {
  const form = useEditForm({
    key: `field:new:${client}:${record}`,
    defaults: { label: "", kind: "text", options: "" },
  });
  const add = form.onSend(
    async (v) =>
      write.run("customFieldSave", {
        record,
        label: v.label.trim(),
        kind: v.kind,
        ...(v.kind === "choice" ? { options: optionsFrom(v.options, null) } : {}),
      }),
    { clear: true },
  );
  return (
    <form className={FORM} onSubmit={(e) => void add(e)}>
      <Kept form={form} />
      <TextField
        form={form}
        name="label"
        label="Name"
        className={NARROW}
        maxLength={80}
        placeholder="Roof age"
        required
      />
      <SelectField
        form={form}
        name="kind"
        label="Kind (fixed once added)"
        className={NARROW}
        options={KINDS}
      />
      {form.watch("kind") === "choice" ? (
        <TextField
          form={form}
          name="options"
          label="Options, comma between"
          className={NARROW}
          placeholder="Shingle, Metal, Tile"
          required
        />
      ) : null}
      <Button tone="primary" type="submit" busy={write.busy}>
        Add field
      </Button>
    </form>
  );
}

export function Fields(props: PageProps) {
  const [record, setRecord] = useState<string | undefined>(undefined);
  const load = useCall(`fields:${props.client}:${record}`, () =>
    consoleIn<FieldsView>(props.client, "customFields", record ? { record } : {}),
  );
  const write = useWrite(props.client, load.retry);
  const data = load.data;
  const here = data?.record ?? null;
  const live = data?.fields.filter((f) => !f.archivedAt) ?? [];
  const archived = data?.fields.filter((f) => f.archivedAt) ?? [];

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
            <AddField client={props.client} record={here} write={write} />
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

/** The add form: a name and its value; the same name replaces the old value. */
function AddFact({ client, write }: { client: string; write: ReturnType<typeof useWrite> }) {
  const form = useEditForm({ key: `fact:new:${client}`, defaults: { label: "", value: "" } });
  const add = form.onSend(
    async (v) => write.run("businessFactSave", { label: v.label.trim(), value: v.value.trim() }),
    { clear: true },
  );
  return (
    <form className={FORM} onSubmit={(e) => void add(e)}>
      <Kept form={form} />
      <TextField
        form={form}
        name="label"
        label="Name"
        className={NARROW}
        maxLength={80}
        placeholder="Phone"
        required
      />
      <TextField
        form={form}
        name="value"
        label="Value (same name replaces it)"
        className={NARROW}
        maxLength={2000}
        placeholder="(416) 555-0100"
        required
      />
      <Button tone="primary" type="submit" busy={write.busy}>
        Save fact
      </Button>
    </form>
  );
}

export function Facts(props: PageProps) {
  const load = useCall(`facts:${props.client}`, () =>
    consoleIn<CustomValue[]>(props.client, "businessFacts", {}),
  );
  const write = useWrite(props.client, load.retry);
  const [copied, setCopied] = useState<string | null>(null);
  const facts = load.data;

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
        <AddFact client={props.client} write={write} />
        {write.error ? <p className={ERROR}>{write.error}</p> : null}
        <p className={`${TOOLS} text-[13px] ${QUIET}`}>
          A list's own fields are quoted the same way, as {"{field.<key>}"}.
        </p>
      </Section>
    </>
  );
}
