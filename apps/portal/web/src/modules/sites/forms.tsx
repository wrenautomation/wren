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
  SHOW_OP_LABELS,
  SHOW_OPS,
  type ShowOp,
  type ShowRule,
  STEPS_MAX,
} from "@wren/sites/forms";
import {
  Button,
  CodeBlock,
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
/** Kinds a show rule can sit on: everything a visitor sees. */
const CAN_HIDE = (k: FieldKind) => k !== "hidden" && k !== "step";

/** "Show only when": an earlier field, a test, and for is or is not the answers that count. */
function ShowRow({
  f,
  above,
  set,
}: {
  f: FormField;
  above: FormField[];
  set: (f: FormField) => void;
}) {
  const sources = above.filter((a) => a.kind !== "step");
  const { show: _s, ...rest } = f;
  const put = (show: ShowRule | null) => set(show ? { ...rest, show } : rest);
  if (!f.show)
    return (
      <div>
        <Button
          size="sm"
          tone="quiet"
          disabled={!sources.length}
          onClick={() => {
            const src = sources[sources.length - 1];
            if (src) put({ key: src.key, op: src.options ? "is" : "filled" });
          }}
        >
          Show only when…
        </Button>
      </div>
    );
  const rule = f.show;
  const src = sources.find((a) => a.key === rule.key);
  const wantsValues = rule.op === "is" || rule.op === "not";
  return (
    <div className="grid gap-2 bg-(--ui-fill) p-2">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className={HINT}>Show only when</span>
        <select
          aria-label="Field it reads"
          className={SELECT}
          value={rule.key}
          onChange={(e) => {
            const next = sources.find((a) => a.key === e.target.value);
            put({ key: e.target.value, op: next?.options ? "is" : "filled" });
          }}
        >
          {src ? null : <option value={rule.key}>(a field below this one)</option>}
          {sources.map((a) => (
            <option key={a.key} value={a.key}>
              {a.kind === "hidden" ? a.key : a.label.slice(0, 40) || a.key}
            </option>
          ))}
        </select>
        <select
          aria-label="Test"
          className={SELECT}
          value={rule.op}
          onChange={(e) => {
            const op = e.target.value as ShowOp;
            put(op === "is" || op === "not" ? { ...rule, op } : { key: rule.key, op });
          }}
        >
          {SHOW_OPS.map((o) => (
            <option key={o} value={o}>
              {SHOW_OP_LABELS[o]}
            </option>
          ))}
        </select>
        <Button size="sm" tone="quiet" onClick={() => put(null)}>
          Always show
        </Button>
      </div>
      {wantsValues && src?.options ? (
        <div className="flex flex-wrap gap-3 text-[13px]">
          {src.options.filter(Boolean).map((o) => (
            <label key={o} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={!!rule.values?.includes(o)}
                onChange={(e) => {
                  const have = (rule.values ?? []).filter((v) => v !== o);
                  put({ ...rule, values: e.target.checked ? [...have, o] : have });
                }}
              />
              {o}
            </label>
          ))}
        </div>
      ) : wantsValues ? (
        <label className="grid gap-1">
          <span className={HINT}>Answers that count, one per line (any case)</span>
          <Textarea
            rows={2}
            value={(rule.values ?? []).join("\n")}
            onChange={(e) => put({ ...rule, values: e.target.value.split("\n") })}
          />
        </label>
      ) : null}
    </div>
  );
}

/** One field's row in the builder: kind, label, then what that kind takes. */
function FieldRow({
  f,
  i,
  above,
  last,
  set,
  move,
  drop,
}: {
  f: FormField;
  i: number;
  above: FormField[];
  last: boolean;
  set: (f: FormField) => void;
  move: (by: -1 | 1) => void;
  drop: () => void;
}) {
  const id = `ff-${i}`;
  const kind = (k: FieldKind) => {
    if (k === "step") return set({ key: f.key, kind: k, label: "" });
    const next: FormField = { key: f.key, kind: k, label: f.label };
    if (f.required && k !== "hidden") next.required = true;
    if (f.show && CAN_HIDE(k)) next.show = f.show;
    if (HAS_OPTIONS.has(k)) next.options = f.options?.length ? f.options : ["One", "Two"];
    set(next);
  };
  return (
    <fieldset
      className={`grid min-w-0 gap-2 border-l-2 pl-3 ${f.kind === "step" ? "border-(--ui-accent)" : "border-(--ui-hair)"}`}
    >
      <legend className={LABEL}>{f.kind === "step" ? "New step" : `Field ${i + 1}`}</legend>
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
        ) : f.kind === "step" ? (
          <Input
            id={`${id}-label`}
            aria-label="Step heading"
            placeholder="Step heading (optional): A few more details"
            value={f.label}
            maxLength={200}
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
      {CAN_HIDE(f.kind) ? <ShowRow f={f} above={above} set={set} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        {f.kind === "step" ? (
          <span className={HINT}>Back and Next show here; the fields below are the next step.</span>
        ) : f.kind !== "hidden" ? (
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
          <span className={HINT}>Filled from the link the visitor opened.</span>
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

/** A show rule in words over its field: "Shown when Service is Repair". */
function ShownWhen({ rule, fields }: { rule: ShowRule; fields: FormField[] }) {
  const src = fields.find((f) => f.key === rule.key);
  const name = src ? (src.kind === "hidden" ? src.key : src.label.slice(0, 40)) : rule.key;
  const vals = rule.op === "is" || rule.op === "not" ? ` ${(rule.values ?? []).join(" or ")}` : "";
  return (
    <span className="text-[12px] text-[#5b6170]">
      Shown when {name} {SHOW_OP_LABELS[rule.op]}
      {vals}
    </span>
  );
}

/** One field as a visitor sees it. */
function FieldPreview({ f }: { f: FormField }) {
  const box = "mt-1 block w-full border border-[#cfcac0] bg-white px-3 py-2.5 text-[16px]";
  const opt = f.required ? null : <span className="font-normal text-[#5b6170]"> (optional)</span>;
  if (f.kind === "consent")
    return (
      <label className="flex items-start gap-2 text-[13px] leading-snug">
        <input type="checkbox" className="mt-0.5" tabIndex={-1} />
        <span>{f.label}</span>
      </label>
    );
  if (f.kind === "multi")
    return (
      <fieldset className="m-0 grid gap-1.5 border-0 p-0">
        <legend className="mb-1 font-medium">
          {f.label}
          {opt}
        </legend>
        {(f.options ?? []).filter(Boolean).map((o) => (
          <label key={o} className="flex items-center gap-2">
            <input type="checkbox" tabIndex={-1} /> {o}
          </label>
        ))}
      </fieldset>
    );
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the input below, picked by the field's kind
    <label className="grid font-medium">
      <span>
        {f.label}
        {opt}
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
}

/** The form as a visitor sees it, drawn from the spec as it's edited. */
function FormPreview({ spec }: { spec: FormSpec }) {
  return (
    <div className="grid gap-4 bg-[#fbfaf7] p-5 text-[#16181d]">
      <h2 className="m-0 text-[24px] leading-tight font-semibold">{spec.title || "Untitled"}</h2>
      {spec.intro ? <p className="m-0 text-[#5b6170]">{spec.intro}</p> : null}
      {spec.fields.map((f, i) => {
        if (f.kind === "hidden") return null;
        const key = `${f.key}-${i}`;
        if (f.kind === "step")
          return (
            <div key={key} className="grid gap-1 border-t border-dashed border-[#cfcac0] pt-3">
              <span className="text-[12px] tracking-wide text-[#5b6170] uppercase">Next step</span>
              {f.label ? <h3 className="m-0 text-[18px] font-semibold">{f.label}</h3> : null}
            </div>
          );
        const when = f.show ? <ShownWhen rule={f.show} fields={spec.fields} /> : null;
        if (when)
          return (
            <div key={key} className="grid gap-1 border-l-2 border-[#cfcac0] pl-2">
              {when}
              <FieldPreview f={f} />
            </div>
          );
        return <FieldPreview key={key} f={f} />;
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
      <DeviceFrame width={phone ? 390 : 720} label={phone ? "Phone width" : "Laptop"}>
        <FormPreview spec={spec} />
      </DeviceFrame>
    </div>
  );
}

/** The builder: the whole spec saved at once, checked again on the server. */
type FormSplit = FormDetail["splits"][number];

/**
 * The builder. With a test running it edits A (the form) or B, picked at the top; B saves to the
 * test and goes live to its share of new visitors at once.
 */
function Builder({ id, d, act }: { id: string; d: FormDetail; act: RecordAct }) {
  const test = d.splits[0]?.state === "running" ? d.splits[0] : null;
  const [arm, setArm] = useState<"A" | "B">("A");
  if (!test) return <Editor id={id} d={d} base={d.spec} act={act} />;
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center gap-3 text-[13.5px]">
        <span className={LABEL}>Editing</span>
        {(["A", "B"] as const).map((a) => (
          <label key={a} className="flex items-center gap-1.5">
            <input type="radio" name="arm" checked={arm === a} onChange={() => setArm(a)} />
            {a === "A" ? "A, the form" : `B, the test (${test.weight}% of new visitors)`}
          </label>
        ))}
      </div>
      {arm === "A" ? (
        <Editor key="A" id={id} d={d} base={d.spec} act={act} />
      ) : (
        <Editor key="B" id={id} d={d} base={test.b} test={test} act={act} />
      )}
    </div>
  );
}

function Editor({
  id,
  d,
  base,
  test,
  act,
}: {
  id: string;
  d: FormDetail;
  /** The spec this edits: the form's, or B's. */
  base: FormSpec;
  /** Set when this edits B: saves go to the test. */
  test?: FormSplit;
  act: RecordAct;
}) {
  const [spec, setSpec] = useState<FormSpec>(() => structuredClone(base));
  const { said, busy, run } = useRun(act);
  const changed = JSON.stringify(spec) !== JSON.stringify(base);
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
    put({
      fields: [...spec.fields, { key: `question_${n}`, kind: "text", label: `Question ${n}` }],
    });
  };
  /**
   * Keys follow labels for fields a person named; hidden fields keep the key they typed. A show
   * rule follows its field's key when that changes.
   */
  const toSave = (): FormSpec => {
    const renamed = new Map<string, string>();
    const fields = spec.fields.map((f) => {
      if (f.kind === "hidden" || f.kind === "consent" || f.kind === "step") return f;
      if (!/^question_\d+$/.test(f.key)) return f;
      const key = keyOf(f.label) || f.key;
      renamed.set(f.key, key);
      return { ...f, key };
    });
    return {
      ...spec,
      fields: fields.map((f) =>
        f.show && renamed.has(f.show.key)
          ? { ...f, show: { ...f.show, key: renamed.get(f.show.key) as string } }
          : f,
      ),
    };
  };
  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <form
        className="grid min-w-0 content-start gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void (test
            ? run(
                "save",
                "sites.formSplitSave",
                { id: test.id, spec: toSave() },
                "Saved. B's visitors see it on their next visit.",
              )
            : run("save", "sites.formSave", { id, spec: toSave() }, "Saved."));
        }}
      >
        <p className={`text-[13.5px] ${QUIET}`}>
          {test
            ? "B. Saved changes show to B's visitors on their next visit. A page's form section always shows A."
            : d.status === "live"
              ? "Live. Saved changes show on the next visit."
              : d.status === "retired"
                ? "Retired. Its link no longer works."
                : "A draft. Nobody can open it until you publish."}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 sm:col-span-2">
            <span className={LABEL}>Title</span>
            <Input
              value={spec.title}
              maxLength={200}
              onChange={(e) => put({ title: e.target.value })}
            />
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
            <Input
              value={spec.button}
              maxLength={60}
              onChange={(e) => put({ button: e.target.value })}
            />
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
              above={spec.fields.slice(0, i)}
              last={i === spec.fields.length - 1}
              set={(next) => setField(i, next)}
              move={(by) => move(i, by)}
              drop={() => put({ fields: spec.fields.filter((_, j) => j !== i) })}
            />
          ))}
          <div>
            <Button size="sm" disabled={spec.fields.length >= 30} onClick={add}>
              Add field
            </Button>{" "}
            <Button
              size="sm"
              tone="quiet"
              disabled={
                spec.fields.length >= 30 ||
                spec.fields.filter((f) => f.kind === "step").length >= STEPS_MAX
              }
              onClick={() =>
                put({ fields: [...spec.fields, { key: "step_new", kind: "step", label: "" }] })
              }
            >
              Add step
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
                    ? {
                        url: e.target.value,
                        ...(spec.booking?.label ? { label: spec.booking.label } : {}),
                      }
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
                    ? {
                        url: spec.booking.url,
                        ...(e.target.value ? { label: e.target.value } : {}),
                      }
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
          {test ? null : d.status !== "live" ? (
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
      <CodeBlock label="Embed with a frame" code={d.embed.iframe} />
      <CodeBlock label="Or with one script tag, sized to fit" code={d.embed.script} />
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

const day = (at: unknown) => new Date(String(at)).toLocaleDateString("en-CA");

/**
 * A/B per form: start a test (B starts as a copy of A), then each version's numbers, the call
 * on sends per view, B's share, ship B or stop. Direct: a form only collects.
 */
function Test({ id, d, act }: { id: string; d: FormDetail; act: RecordAct }) {
  const { said, busy, run } = useRun(act);
  const test = d.splits[0]?.state === "running" ? d.splits[0] : null;
  const [share, setShare] = useState(String(test?.weight ?? 50));
  const valid = /^\d{1,2}$/.test(share) && +share >= 1 && +share <= 99;
  const past = d.splits.filter((s) => s.state !== "running");
  if (!test)
    return (
      <div className="grid gap-3">
        {d.status === "retired" ? (
          <p className={`text-[13.5px] ${QUIET}`}>A retired form can't be tested.</p>
        ) : (
          <>
            <p className="text-[13.5px]">
              B starts as a copy of this form. Change it above, and new visitors to the form's link
              get A or B. Each keeps the one they saw.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-[13px]">
                B's share, %
                <Input
                  className="w-[80px]"
                  inputMode="numeric"
                  value={share}
                  onChange={(e) => setShare(e.target.value.trim())}
                />
              </label>
              <Button
                tone="primary"
                disabled={!valid}
                busy={busy === "start"}
                onClick={() =>
                  void run(
                    "start",
                    "sites.formSplitStart",
                    { id, weight: Number(share) },
                    "Test started. Pick B at the top to change it.",
                  )
                }
              >
                Start a test
              </Button>
              <Said said={said} />
            </div>
          </>
        )}
        {past.map((s) => (
          <p key={s.id} className={`text-[13px] ${QUIET}`}>
            {day(s.startedAt)} to {day(s.endedAt)}: {s.call.words}.{" "}
            {s.state === "shipped" ? "B became the form." : "Stopped, A kept."}
          </p>
        ))}
      </div>
    );
  return (
    <div className="grid gap-4">
      <p className="flex flex-wrap items-center gap-2 text-[18px] font-medium">
        {test.call.words}
        <Tag
          tone={
            test.call.kind === "settled"
              ? "green"
              : test.call.kind === "leading"
                ? "accent"
                : "neutral"
          }
        >
          {test.call.kind === "settled"
            ? "Settled"
            : test.call.kind === "leading"
              ? "Ahead"
              : "Waiting"}
        </Tag>
      </p>
      <p className={`text-[13px] ${QUIET}`}>
        Judged on sends per view. Started {day(test.startedAt)} by {test.startedBy}. Bots see A and
        aren't counted.
      </p>
      <Table
        head={[
          "Version",
          ["Views", "r"],
          ["Started", "r"],
          ["Sent", "r"],
          ["Rate", "r"],
          ["Chance best", "r"],
        ]}
        rows={test.arms.map((a, i) => [
          <span key="v" className="flex items-center gap-2">
            <span className="font-medium">{a.label}</span>
            {a.label === test.call.leader ? <Tag tone="accent">Leads</Tag> : null}
          </span>,
          num(a.views),
          num(a.starts),
          num(a.submits),
          rate(a.rate),
          test.call.kind === "too_early"
            ? ""
            : `${Math.min(99, Math.floor((test.call.sure[i] ?? 0) * 100))}%`,
        ])}
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-[13px]">
          B's share, %
          <Input
            className="w-[80px]"
            inputMode="numeric"
            value={share}
            onChange={(e) => setShare(e.target.value.trim())}
          />
        </label>
        <Button
          disabled={!valid || Number(share) === test.weight}
          busy={busy === "share"}
          onClick={() =>
            void run(
              "share",
              "sites.formSplitSave",
              { id: test.id, weight: Number(share) },
              "Saved. New visitors get it; others keep their version.",
            )
          }
        >
          Save share
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-(--ui-hair) pt-4">
        <Button
          tone={test.call.leader === "B" ? "primary" : undefined}
          busy={busy === "ship"}
          onClick={() =>
            void run("ship", "sites.formSplitShip", { id: test.id }, "B is the form now.")
          }
        >
          Make B the form
        </Button>
        <Button
          tone="quiet"
          busy={busy === "stop"}
          onClick={() =>
            void run("stop", "sites.formSplitStop", { id: test.id }, "Stopped. Everyone sees A.")
          }
        >
          Stop, keep A
        </Button>
        <Said said={said} />
      </div>
    </div>
  );
}

/** Views, starts, each step reached, submits: where people stop, last 30 days. */
function Steps({ d }: { d: FormDetail }) {
  const sum = (k: "views" | "starts" | "submits") => d.days.reduce((t, x) => t + x[k], 0);
  const views = sum("views");
  const rows: [string, number][] = [
    ["Opened", views],
    ["Started", sum("starts")],
    ...d.steps.map((x): [string, number] => [`Reached step ${x.step}`, x.views]),
    ["Sent", sum("submits")],
  ];
  return (
    <Table
      head={["", ["Views", "r"], ["Of opened", "r"]]}
      rows={rows.map(([what, n]) => [what, num(n), views ? rate(n / views) : ""])}
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
    [
      "A/B test",
      <Test
        key={`t:${d.splits[0]?.id ?? ""}:${d.splits[0]?.weight ?? ""}`}
        id={id}
        d={d}
        act={act}
      />,
    ],
    ...(d.spec.fields.some((f) => f.kind === "step")
      ? ([["Where people stop, last 30 days", <Steps key="st" d={d} />]] as [string, ReactNode][])
      : []),
    ["Where visitors came from", <Sources key="src" d={d} />],
    ["Newest submissions", <Recent key="r" d={d} />],
  ];
  return {
    // Keyed by its last change: a save opens fresh.
    form: (
      <Builder
        key={`${id}:${JSON.stringify(d.spec).length}:${d.status}:${d.splits[0]?.state === "running" ? JSON.stringify(d.splits[0].b).length : ""}`}
        id={id}
        d={d}
        act={act}
      />
    ),
    sections,
  } satisfies RecordExtras;
};
