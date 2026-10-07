/**
 * A hosted form's detail in Sites (designs/2026-10-07-forms-and-pay.md, "Portal"): the builder
 * (fields in order, each with its kind, label, rules and choices; the words after a submit; a
 * booking step), a live preview on a laptop or a phone, the link and the embed tags, and its
 * numbers by day and by source. The server checks the spec again on every save.
 */
import type { FormDetail } from "@wren/sites/form-store";
import {
  FIELD_KIND_LABELS,
  FIELD_KINDS,
  FIELD_RULE_LABELS,
  FIELD_RULES,
  type FieldKind,
  type FieldRule,
  type FormField,
  type FormSpec,
  keyOf,
} from "@wren/sites/forms";
import {
  Button,
  DeviceFrame,
  Input,
  num,
  type RecordAct,
  type RecordExtras,
  Tag,
  Textarea,
  TrendChart,
} from "@wren/ui";
import { type ReactNode, useState } from "react";
import type { ListPage } from "../../module.js";
import { QUIET } from "../work/bits.js";
import { Said, Table, useRun } from "./detail.js";

const LABEL = "text-[13px] font-medium text-(--ui-ink-2)";
const HINT = "text-[12px] text-(--ui-ink-3)";
const SELECT =
  "min-h-[38px] border border-(--ui-hair) bg-(--ui-paper) px-3 py-2 text-[14.5px] text-(--ui-ink) focus:border-(--ui-accent) focus:outline-none";
const rate = (n: number | null) => (n === null ? "" : `${(n * 100).toFixed(1)}%`);

const HAS_RULES = new Set<FieldKind>(["text", "long"]);
const HAS_OPTIONS = new Set<FieldKind>(["select", "multi"]);

/** One field's row in the builder: kind, label, then what that kind takes. */
function FieldRow({
  f,
  i,
  last,
  set,
  move,
  drop,
}: {
  f: FormField;
  i: number;
  last: boolean;
  set: (f: FormField) => void;
  move: (by: -1 | 1) => void;
  drop: () => void;
}) {
  const id = `ff-${i}`;
  const kind = (k: FieldKind) => {
    const next: FormField = { key: f.key, kind: k, label: f.label };
    if (f.required && k !== "hidden") next.required = true;
    if (HAS_OPTIONS.has(k)) next.options = f.options?.length ? f.options : ["One", "Two"];
    set(next);
  };
  return (
    <fieldset className="grid min-w-0 gap-2 border-l-2 border-(--ui-hair) pl-3">
      <legend className={LABEL}>Field {i + 1}</legend>
      <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)]">
        <select
          aria-label="Kind"
          className={SELECT}
          value={f.kind}
          onChange={(e) => kind(e.target.value as FieldKind)}
        >
          {FIELD_KINDS.map((k) => (
            <option key={k} value={k}>
              {FIELD_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        {f.kind === "consent" ? (
          <Textarea
            id={`${id}-label`}
            aria-label="Consent words"
            rows={4}
            value={f.label}
            maxLength={1000}
            onChange={(e) => set({ ...f, label: e.target.value })}
          />
        ) : (
          <Input
            id={`${id}-label`}
            aria-label={f.kind === "hidden" ? "Query key" : "Label"}
            placeholder={f.kind === "hidden" ? "utm_source" : "Label"}
            value={f.kind === "hidden" ? f.key : f.label}
            maxLength={200}
            onChange={(e) =>
              f.kind === "hidden"
                ? set({ ...f, key: e.target.value, label: e.target.value })
                : set({ ...f, label: e.target.value })
            }
          />
        )}
      </div>
      {HAS_OPTIONS.has(f.kind) ? (
        <label className="grid gap-1">
          <span className={HINT}>Choices, one per line</span>
          <Textarea
            rows={3}
            value={(f.options ?? []).join("\n")}
            onChange={(e) => set({ ...f, options: e.target.value.split("\n") })}
          />
        </label>
      ) : null}
      {HAS_RULES.has(f.kind) ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className={HINT}>Rule</span>
            <select
              className={SELECT}
              value={f.rule ?? ""}
              onChange={(e) => {
                const { rule: _r, ...rest } = f;
                set(e.target.value ? { ...rest, rule: e.target.value as FieldRule } : rest);
              }}
            >
              <option value="">Any text</option>
              {FIELD_RULES.map((r) => (
                <option key={r} value={r}>
                  {FIELD_RULE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid w-[96px] gap-1">
            <span className={HINT}>Fewest letters</span>
            <Input
              type="number"
              min={0}
              value={f.min ?? ""}
              onChange={(e) => {
                const { min: _m, ...rest } = f;
                set(e.target.value ? { ...rest, min: Number(e.target.value) } : rest);
              }}
            />
          </label>
          <label className="grid w-[96px] gap-1">
            <span className={HINT}>Most letters</span>
            <Input
              type="number"
              min={1}
              value={f.max ?? ""}
              onChange={(e) => {
                const { max: _m, ...rest } = f;
                set(e.target.value ? { ...rest, max: Number(e.target.value) } : rest);
              }}
            />
          </label>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {f.kind !== "hidden" ? (
          <label className="flex items-center gap-1.5 text-[13px]">
            <input
              type="checkbox"
              checked={!!f.required}
              onChange={(e) => {
                const { required: _q, ...rest } = f;
                set(e.target.checked ? { ...rest, required: true } : rest);
              }}
            />
            Required
          </label>
        ) : (
          <span className={HINT}>Filled from the link it was opened with.</span>
        )}
        <span className="ml-auto flex gap-1">
          <Button size="sm" tone="quiet" disabled={i === 0} onClick={() => move(-1)}>
            Up
          </Button>
          <Button size="sm" tone="quiet" disabled={last} onClick={() => move(1)}>
            Down
          </Button>
          <Button size="sm" tone="quiet" onClick={drop}>
            Remove
          </Button>
        </span>
      </div>
    </fieldset>
  );
}

/** The form as a visitor sees it, drawn from the spec as it's edited. */
function FormPreview({ spec }: { spec: FormSpec }) {
  const box = "mt-1 block w-full border border-[#cfcac0] bg-white px-3 py-2.5 text-[16px]";
  const opt = (f: FormField) =>
    f.required ? null : <span className="font-normal text-[#5b6170]"> (optional)</span>;
  return (
    <div className="grid gap-4 bg-[#fbfaf7] p-5 text-[#16181d]">
      <h2 className="m-0 text-[24px] leading-tight font-semibold">{spec.title || "Untitled"}</h2>
      {spec.intro ? <p className="m-0 text-[#5b6170]">{spec.intro}</p> : null}
      {spec.fields.map((f, i) => {
        if (f.kind === "hidden") return null;
        const key = `${f.key}-${i}`;
        if (f.kind === "consent")
          return (
            <label key={key} className="flex items-start gap-2 text-[13px] leading-snug">
              <input type="checkbox" className="mt-0.5" tabIndex={-1} />
              <span>{f.label}</span>
            </label>
          );
        if (f.kind === "multi")
          return (
            <fieldset key={key} className="m-0 grid gap-1.5 border-0 p-0">
              <legend className="mb-1 font-medium">
                {f.label}
                {opt(f)}
              </legend>
              {(f.options ?? []).filter(Boolean).map((o) => (
                <label key={o} className="flex items-center gap-2">
                  <input type="checkbox" tabIndex={-1} /> {o}
                </label>
              ))}
            </fieldset>
          );
        return (
          <label key={key} className="grid font-medium">
            <span>
              {f.label}
              {opt(f)}
            </span>
            {f.hint ? <small className="font-normal text-[#5b6170]">{f.hint}</small> : null}
            {f.kind === "long" ? (
              <textarea className={box} rows={3} tabIndex={-1} readOnly />
            ) : f.kind === "select" ? (
              <select className={box} tabIndex={-1}>
                <option>Pick one</option>
                {(f.options ?? []).filter(Boolean).map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                className={box}
                tabIndex={-1}
                readOnly
                type={f.kind === "date" ? "date" : f.kind === "email" ? "email" : "text"}
              />
            )}
          </label>
        );
      })}
      <div>
        <span className="inline-block bg-[#24594b] px-5 py-3 font-semibold text-white">
          {spec.button || "Send"}
        </span>
      </div>
      <p className="m-0 text-[13px] text-[#5b6170]">
        After a submit:{" "}
        {spec.after.kind === "redirect"
          ? `goes to ${spec.after.url || "the address you set"}`
          : `"${spec.after.text}"`}
        {spec.booking?.url ? `, then "${spec.booking.label || "Pick a time"}"` : ""}
      </p>
    </div>
  );
}

function Preview({ spec }: { spec: FormSpec }) {
  const [phone, setPhone] = useState(true);
  return (
    <div className="grid content-start gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={LABEL}>Preview</span>
        <div className="flex gap-1">
          <Button size="sm" tone={phone ? "quiet" : undefined} onClick={() => setPhone(false)}>
            Laptop
          </Button>
          <Button size="sm" tone={phone ? undefined : "quiet"} onClick={() => setPhone(true)}>
            Phone
          </Button>
        </div>
      </div>
      <DeviceFrame width={phone ? 390 : 720} label={phone ? "Phone, 390 wide" : "Laptop"}>
        <FormPreview spec={spec} />
      </DeviceFrame>
    </div>
  );
}

/** The builder: the whole spec saved at once, checked again on the server. */
function Builder({ id, d, act }: { id: string; d: FormDetail; act: RecordAct }) {
  const [spec, setSpec] = useState<FormSpec>(() => structuredClone(d.spec));
  const { said, busy, run } = useRun(act);
  const changed = JSON.stringify(spec) !== JSON.stringify(d.spec);
  const put = (patch: Partial<FormSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const setField = (i: number, f: FormField) =>
    put({ fields: spec.fields.map((x, j) => (j === i ? f : x)) });
  const move = (i: number, by: -1 | 1) => {
    const fields = [...spec.fields];
    const [f] = fields.splice(i, 1);
    if (f) fields.splice(i + by, 0, f);
    put({ fields });
  };
  const add = () => {
    const taken = new Set(spec.fields.map((f) => f.key));
    let n = spec.fields.length + 1;
    while (taken.has(`question_${n}`)) n++;
    put({ fields: [...spec.fields, { key: `question_${n}`, kind: "text", label: `Question ${n}` }] });
  };
  /** Keys follow labels for fields a person named; hidden fields keep the key they typed. */
  const toSave = (): FormSpec => ({
    ...spec,
    fields: spec.fields.map((f) =>
      f.kind === "hidden" || f.kind === "consent" || !/^question_\d+$/.test(f.key)
        ? f
        : { ...f, key: keyOf(f.label) || f.key },
    ),
  });
  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <form
        className="grid min-w-0 content-start gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void run("save", "sites.formSave", { id, spec: toSave() }, "Saved.");
        }}
      >
        <p className={`text-[13.5px] ${QUIET}`}>
          {d.status === "live"
            ? "Live. A save shows on the next load."
            : d.status === "retired"
              ? "Retired. Its link answers gone."
              : "A draft. Nobody can open it until you publish."}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 sm:col-span-2">
            <span className={LABEL}>Title</span>
            <Input value={spec.title} maxLength={200} onChange={(e) => put({ title: e.target.value })} />
          </label>
          <label className="grid gap-1.5 sm:col-span-2">
            <span className={LABEL}>
              Intro <span className={HINT}>(optional)</span>
            </span>
            <Textarea
              rows={2}
              value={spec.intro ?? ""}
              maxLength={1000}
              onChange={(e) => put({ intro: e.target.value })}
            />
          </label>
          <label className="grid gap-1.5">
            <span className={LABEL}>Button</span>
            <Input value={spec.button} maxLength={60} onChange={(e) => put({ button: e.target.value })} />
          </label>
        </div>
        <div className="grid gap-4">
          <span className={LABEL}>Fields</span>
          {spec.fields.map((f, i) => (
            <FieldRow
              // biome-ignore lint/suspicious/noArrayIndexKey: fields reorder; position is the key.
              key={i}
              f={f}
              i={i}
              last={i === spec.fields.length - 1}
              set={(next) => setField(i, next)}
              move={(by) => move(i, by)}
              drop={() => put({ fields: spec.fields.filter((_, j) => j !== i) })}
            />
          ))}
          <div>
            <Button size="sm" disabled={spec.fields.length >= 30} onClick={add}>
              Add field
            </Button>
          </div>
        </div>
        <div className="grid gap-2 border-t border-(--ui-hair) pt-4">
          <span className={LABEL}>After a submit</span>
          <div className="flex flex-wrap gap-3 text-[13.5px]">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="after"
                checked={spec.after.kind === "thanks"}
                onChange={() => put({ after: { kind: "thanks", text: "Thanks. We got it." } })}
              />
              Show a message
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="after"
                checked={spec.after.kind === "redirect"}
                onChange={() => put({ after: { kind: "redirect", url: "" } })}
              />
              Go to a page
            </label>
          </div>
          {spec.after.kind === "thanks" ? (
            <Input
              aria-label="Message"
              value={spec.after.text}
              maxLength={500}
              onChange={(e) => put({ after: { kind: "thanks", text: e.target.value } })}
            />
          ) : (
            <Input
              aria-label="Page address"
              placeholder="https://example.com/thanks"
              value={spec.after.url}
              maxLength={500}
              onChange={(e) => put({ after: { kind: "redirect", url: e.target.value } })}
            />
          )}
        </div>
        <div className="grid gap-2">
          <span className={LABEL}>
            Booking step <span className={HINT}>(optional)</span>
          </span>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px]">
            <Input
              aria-label="Booking link"
              placeholder="/book"
              value={spec.booking?.url ?? ""}
              maxLength={500}
              onChange={(e) =>
                put({
                  booking: e.target.value
                    ? { url: e.target.value, ...(spec.booking?.label ? { label: spec.booking.label } : {}) }
                    : null,
                })
              }
            />
            <Input
              aria-label="Booking button"
              placeholder="Pick a time"
              value={spec.booking?.label ?? ""}
              maxLength={60}
              disabled={!spec.booking?.url}
              onChange={(e) =>
                put({
                  booking: spec.booking
                    ? { url: spec.booking.url, ...(e.target.value ? { label: e.target.value } : {}) }
                    : null,
                })
              }
            />
          </div>
          <span className={HINT}>Shown after the thanks, with their name and email filled in.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" tone="primary" disabled={!changed} busy={busy === "save"}>
            Save
          </Button>
          {d.status !== "live" ? (
            <Button
              disabled={changed}
              busy={busy === "publish"}
              onClick={() =>
                void run("publish", "sites.formPublish", { ids: [id] }, "Live. Its link works now.")
              }
            >
              Publish
            </Button>
          ) : (
            <Button
              disabled={changed}
              busy={busy === "unpublish"}
              onClick={() =>
                void run("unpublish", "sites.formUnpublish", { ids: [id] }, "Back to a draft.")
              }
            >
              Unpublish
            </Button>
          )}
          <Said said={said} />
        </div>
      </form>
      <Preview spec={spec} />
    </div>
  );
}

function Snippet({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className={LABEL}>{label}</span>
        <Button
          size="sm"
          tone="quiet"
          onClick={() =>
            void navigator.clipboard?.writeText(code).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <code className="block overflow-x-auto bg-(--ui-fill) p-2 text-[12.5px] whitespace-pre">
        {code}
      </code>
    </div>
  );
}

function Share({ d }: { d: FormDetail }) {
  return (
    <div className="grid gap-3 text-[14px]">
      <div className="grid gap-0.5">
        <span className={LABEL}>Link</span>
        <a className="break-all underline" href={d.url} target="_blank" rel="noopener">
          {d.url}
        </a>
        {d.status !== "live" ? <span className={HINT}>Works once it's published.</span> : null}
      </div>
      <Snippet label="Embed with a frame" code={d.embed.iframe} />
      <Snippet label="Or with one script tag, sized to fit" code={d.embed.script} />
      <p className={HINT}>
        On a Sites page, put its slug in the page's Hosted form field to use it as the page's form.
      </p>
    </div>
  );
}

function Numbers({ d }: { d: FormDetail }) {
  if (!d.days.some((x) => x.views || x.submits))
    return <p className={QUIET}>No views in the last 30 days.</p>;
  return (
    <TrendChart
      label="Views"
      series={d.days.map((x) => ({ at: x.day, value: x.views }))}
      height={180}
    />
  );
}

function Sources({ d }: { d: FormDetail }) {
  if (!d.sources.length) return <p className={QUIET}>No views counted.</p>;
  return (
    <Table
      head={["Source", ["Views", "r"], ["Starts", "r"], ["Submits", "r"], ["Conversion", "r"]]}
      rows={d.sources.map((s) => [
        [s.channel, s.source, s.campaign].filter(Boolean).join(" · "),
        num(s.views),
        num(s.starts),
        num(s.submits),
        rate(s.conversion),
      ])}
    />
  );
}

function Recent({ d }: { d: FormDetail }) {
  if (!d.recent.length) return <p className={QUIET}>No submissions.</p>;
  return (
    <ul className="grid gap-3 text-[13.5px]">
      {d.recent.map((r) => (
        <li key={r.id} className="grid gap-0.5 border-l-2 border-(--ui-hair) pl-3">
          <span className={QUIET}>
            {new Date(r.at).toLocaleString()}{" "}
            {r.entered ? <Tag tone="green">In the door</Tag> : <Tag tone="neutral">Kept</Tag>}
          </span>
          {Object.entries(r.fields).map(([k, v]) => (
            <span key={k} className="break-words">
              <span className={QUIET}>{k}:</span> {v}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

export const formExtras: NonNullable<ListPage["extras"]> = (detail, { row, act }) => {
  const d = detail as FormDetail | null;
  if (!d) return {};
  const id = String(row.id);
  const sections: [string, ReactNode][] = [
    ["Link and embed", <Share key="s" d={d} />],
    ["Views, last 30 days", <Numbers key="n" d={d} />],
    ["Where visitors came from", <Sources key="src" d={d} />],
    ["Newest submissions", <Recent key="r" d={d} />],
  ];
  return {
    // Keyed by its last change: a save opens fresh.
    form: <Builder key={`${id}:${JSON.stringify(d.spec).length}:${d.status}`} id={id} d={d} act={act} />,
    sections,
  } satisfies RecordExtras;
};
