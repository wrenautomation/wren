/**
 * Documents → Documents and Templates (designs/2026-10-09-documents.md, "Portal"): contracts,
 * proposals and estimates written here, from a template or blank, sent by email or text to be
 * signed. A draft's detail is its editor; every document's is how it reads and each step it took.
 * Totals here are a preview: the server works them out again on save.
 */

import type { Row } from "@wren/core/records/serve";
import {
  DOC_KINDS,
  type DocKind,
  type DocLine,
  depositOf,
  KIND_NAME,
  money,
  SIGN_LABEL,
  SLOT_NAMES,
  slotsLeft,
  totalsOf,
} from "@wren/documents/lines";
import type { Action, RecordAct, RecordExtras } from "@wren/ui";
import { Button, CopyButton, cx, Input, Section, Tag, Textarea } from "@wren/ui";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import type { ListPage } from "../../module.js";
import { ERROR, FIELD, QUIET, SELECT } from "../work/bits.js";

const said = (line: string) => () => line;
const OPEN = ["sent", "viewed"];

interface Template {
  id: string;
  kind: DocKind;
  name: string;
  body: string;
  lines: DocLine[];
  depositPct: number | null;
  expiresDays: number;
}
interface Templates {
  templates: Template[];
  approves: boolean;
}
/** A document as its editor holds it: `load`'s `edit`. */
interface Editable {
  kind: DocKind;
  template: string | null;
  title: string;
  body: string;
  lines: DocLine[];
  name: string | null;
  email: string | null;
  contact: number | null;
  channel: "email" | "sms";
  depositPct: number | null;
  expiresDays: number;
  currency: string;
}
interface Detail {
  steps?: { step: string; at: string; by: string | null; from: string | null }[];
  deposit?: { status: string; url: string | null; paid_at: string | null } | null;
  edit?: Editable;
}
interface Sent {
  id: string;
  status: string;
  url?: string | null;
}

/** `send`'s answer, alone or as one record's action gives it back: `url` only when it went now. */
interface SendAnswer {
  docs?: Sent[];
  url?: string | null;
}
const sentOf = (a: unknown): Sent | null => {
  const raw = a as (SendAnswer & { answer?: SendAnswer }) | null;
  const out = raw?.answer ?? raw;
  const d = out?.docs?.[0];
  return d ? { ...d, url: out?.url ?? null } : null;
};
const sentLine = (d: Sent | null) =>
  !d
    ? "Nothing sent."
    : d.status === "waiting"
      ? "Waiting in To approve."
      : d.status === "failed"
        ? "It didn't go. Its page says why."
        : "On its way.";

// ---- Actions ----

export const DOC_ACTIONS: Action[] = [
  {
    id: "documents.send",
    label: "Send",
    handler: "documents/send",
    confirm: "Send it to be signed? If you can't approve, it waits in To approve.",
    when: { status: ["draft", "failed"] },
    key: "s",
    done: (a) => sentLine(sentOf(a)),
  },
  {
    id: "documents.approve",
    label: "Approve",
    handler: "documents/approve",
    confirm: "Send this document to be signed?",
    when: { status: ["waiting"] },
    sets: { status: "sending" },
    key: "a",
    bulk: true,
    done: said("Approved. It's on its way."),
  },
  {
    id: "documents.decline",
    label: "Decline",
    handler: "documents/decline",
    when: { status: ["waiting"] },
    sets: { status: "draft" },
    key: "x",
    bulk: true,
    done: said("Declined. It's a draft again."),
  },
  {
    id: "documents.remind",
    label: "Remind",
    handler: "documents/remind",
    when: { status: OPEN },
    key: "r",
    done: said("Reminder on its way."),
  },
  {
    id: "documents.duplicate",
    label: "Duplicate",
    handler: "documents/duplicate",
    done: said("Copied as a new draft."),
  },
  {
    id: "documents.void",
    label: "Void",
    handler: "documents/void",
    confirm: "Void it? Its link stops working. It stays here, marked void.",
    when: { status: ["draft", "waiting", "failed", ...OPEN] },
    sets: { status: "void" },
    bulk: true,
    done: said("Voided."),
  },
  // The draft editor's save, from inside the record only.
  { id: "documents.save", label: "Save", handler: "documents/update", inline: true },
];

export const TEMPLATE_ACTIONS: Action[] = [
  {
    id: "documents.templateArchive",
    label: "Archive",
    handler: "documents/templateArchive",
    confirm: "Archive it? New documents can't start from it. Sent ones keep their words.",
    bulk: true,
    done: said("Archived."),
  },
  { id: "documents.templateSave", label: "Save", handler: "documents/templateSave", inline: true },
];

/** On a texting thread (Texts): an estimate to that number, opened in Documents to finish. */
export const THREAD_ESTIMATE: Action = {
  id: "documents.fromThread",
  label: "Send estimate",
  handler: "documents/fromThread",
  each: true,
  form: [{ field: "title", label: "What it's for", hint: "Like: Kitchen repaint" }],
  done: said("Drafted. Finish it under Documents."),
};

// ---- The editor ----

interface LineDraft {
  name: string;
  detail: string;
  qty: string;
  price: string;
  tax: string;
}
const blankLine = (): LineDraft => ({ name: "", detail: "", qty: "1", price: "", tax: "" });
const draftOf = (l: DocLine): LineDraft => ({
  name: l.name,
  detail: l.detail ?? "",
  qty: String(l.qty),
  price: (l.unit_cents / 100).toFixed(2),
  tax: l.tax_pct === null || l.tax_pct === undefined ? "" : String(l.tax_pct),
});
/** As sent: the server checks each again. A row with no name is left out. */
const linesFrom = (ls: LineDraft[]) =>
  ls
    .filter((l) => l.name.trim())
    .map((l) => ({
      name: l.name.trim(),
      detail: l.detail.trim() || null,
      qty: Number(l.qty || 1),
      price: l.price,
      tax_pct: l.tax.trim() === "" ? null : Number(l.tax),
    }));
/** For the preview's totals: what doesn't read as a number counts as 0. */
const previewLines = (ls: LineDraft[]): DocLine[] =>
  ls
    .filter((l) => l.name.trim())
    .map((l) => ({
      name: l.name.trim(),
      detail: l.detail.trim() || null,
      qty: Number(l.qty) > 0 ? Number(l.qty) : 0,
      unit_cents: Math.round((Number(l.price.replace(/[$,\s]/g, "")) || 0) * 100),
      tax_pct: Number(l.tax) || null,
    }));

/** The words box and its slot picker: a slot goes in where the cursor is. */
function Words({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const box = useRef<HTMLTextAreaElement | null>(null);
  const put = (slot: string) => {
    const el = box.current;
    const at = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    const text = `{${slot}}`;
    onChange(value.slice(0, at) + text + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + text.length, at + text.length);
    });
  };
  return (
    <label className={cx(FIELD, "basis-full")}>
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span>Words</span>
        <select
          className={cx(SELECT, "min-h-[32px] py-1 text-[13px]")}
          value=""
          aria-label="Add a slot"
          onChange={(e) => e.target.value && put(e.target.value)}
        >
          <option value="">Add a slot…</option>
          {Object.entries(SLOT_NAMES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </span>
      <Textarea
        ref={box}
        rows={10}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="The terms, the scope, what happens next. Slots fill in when it's sent."
      />
    </label>
  );
}

const CELL = "min-w-0 border border-(--ui-hair) bg-(--ui-paper) px-2 py-1.5 text-[14px]";

/** Line items: name, detail, how many, unit price, tax. */
function Lines({
  lines,
  set,
  currency,
}: {
  lines: LineDraft[];
  set: (ls: LineDraft[]) => void;
  currency: string;
}) {
  const change = (i: number, k: keyof LineDraft, v: string) =>
    set(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const shown = previewLines(lines);
  const t = totalsOf(shown);
  return (
    <fieldset className="m-0 grid basis-full gap-2 border-0 p-0">
      <legend className="mb-1 text-[13px] font-medium">Line items</legend>
      {lines.length ? (
        <div className="grid gap-2">
          {lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id until saved
            <div key={i} className="grid gap-1.5 border-(--ui-hair) border-b pb-2">
              <div className="grid grid-cols-[1fr_4.5rem_6.5rem_4.5rem_auto] gap-1.5 max-[560px]:grid-cols-[1fr_1fr_1fr]">
                <input
                  className={cx(CELL, "max-[560px]:col-span-3")}
                  value={l.name}
                  onChange={(e) => change(i, "name", e.target.value)}
                  placeholder="What it is"
                  aria-label={`Line ${i + 1} name`}
                />
                <input
                  className={CELL}
                  value={l.qty}
                  inputMode="decimal"
                  onChange={(e) => change(i, "qty", e.target.value)}
                  aria-label={`Line ${i + 1} quantity`}
                  title="How many"
                />
                <input
                  className={CELL}
                  value={l.price}
                  inputMode="decimal"
                  onChange={(e) => change(i, "price", e.target.value)}
                  placeholder="Price"
                  aria-label={`Line ${i + 1} unit price`}
                />
                <input
                  className={CELL}
                  value={l.tax}
                  inputMode="decimal"
                  onChange={(e) => change(i, "tax", e.target.value)}
                  placeholder="Tax %"
                  aria-label={`Line ${i + 1} tax percent`}
                />
                <Button
                  type="button"
                  size="dense"
                  tone="quiet"
                  onClick={() => set(lines.filter((_, j) => j !== i))}
                  aria-label={`Remove line ${i + 1}`}
                >
                  Remove
                </Button>
              </div>
              <input
                className={cx(CELL, "text-[13px]")}
                value={l.detail}
                onChange={(e) => change(i, "detail", e.target.value)}
                placeholder="Detail, if any"
                aria-label={`Line ${i + 1} detail`}
              />
            </div>
          ))}
        </div>
      ) : (
        <p className={QUIET}>No line items. A contract may need none.</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          size="dense"
          tone="quiet"
          onClick={() => set([...lines, blankLine()])}
        >
          Add a line
        </Button>
        {shown.length ? (
          <span className="text-[13.5px] tabular-nums">
            <span className={QUIET}>Subtotal</span> {money(t.subtotalCents, currency)}
            {t.taxCents ? (
              <>
                {" "}
                <span className={QUIET}>· Tax</span> {money(t.taxCents, currency)}
              </>
            ) : null}{" "}
            <span className={QUIET}>· Total</span> <b>{money(t.totalCents, currency)}</b>
          </span>
        ) : null}
      </div>
    </fieldset>
  );
}

/**
 * A new document or a draft: its words, lines, deposit and who it goes to. Saves, then sends
 * when asked. `save` writes it and answers its id.
 */
function DocForm({
  doc,
  templates,
  save,
  send,
  cancel,
}: {
  doc: Editable | null;
  templates: Template[];
  save: (fields: Record<string, unknown>) => Promise<string>;
  /** Left out on a draft's page: its head's Send sends it. */
  send?: (id: string) => Promise<Sent | null>;
  cancel?: () => void;
}) {
  const [template, setTemplate] = useState(doc?.template ?? "");
  const [kind, setKind] = useState<DocKind>(doc?.kind ?? "estimate");
  const [title, setTitle] = useState(doc?.title ?? "");
  const [body, setBody] = useState(doc?.body ?? "");
  const [lines, setLines] = useState<LineDraft[]>(doc ? doc.lines.map(draftOf) : [blankLine()]);
  const [deposit, setDeposit] = useState(doc?.depositPct ? String(doc.depositPct) : "");
  const [expires, setExpires] = useState(String(doc?.expiresDays ?? 30));
  const [channel, setChannel] = useState<"email" | "sms">(doc?.channel ?? "email");
  const [name, setName] = useState(doc?.name ?? "");
  const [email, setEmail] = useState(doc?.email ?? "");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<Sent | null>(null);
  /** Which button submitted: Save, or Save and send. */
  const andSend = useRef(false);
  const currency = doc?.currency ?? "usd";

  const pick = (id: string) => {
    setTemplate(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setKind(t.kind);
    setTitle((was) => was || t.name);
    setBody(t.body);
    setLines(t.lines.length ? t.lines.map(draftOf) : [blankLine()]);
    setDeposit(t.depositPct ? String(t.depositPct) : "");
    setExpires(String(t.expiresDays));
  };
  const total = totalsOf(previewLines(lines)).totalCents;
  const pct = Number(deposit);
  const depositCents =
    deposit.trim() && Number.isInteger(pct) && pct >= 1 && pct <= 100
      ? depositOf(total, pct)
      : null;
  const left = slotsLeft(title, body).filter(
    (s) => !(s.slice(1, -1) in SLOT_NAMES) && !s.startsWith("{biz."),
  );

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setOut(null);
    try {
      const id = await save({
        ...(doc ? {} : { template: template || null, kind }),
        title,
        body,
        lines: linesFrom(lines),
        depositPct: deposit.trim() ? pct : null,
        expiresDays: Number(expires),
        name: name.trim() || null,
        email: email.trim() || null,
        channel,
        ...(!doc?.contact && channel === "sms" && phone.trim() ? { phone: phone.trim() } : {}),
      });
      if (andSend.current && send) setOut(await send(id));
      else if (!doc) cancel?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-4"
      aria-label={doc ? "Change this draft" : "New document"}
      onSubmit={(e) => void submit(e)}
    >
      <div className="flex flex-wrap gap-3">
        {doc ? null : (
          <label className={FIELD}>
            <span>Start from</span>
            <select className={SELECT} value={template} onChange={(e) => pick(e.target.value)}>
              <option value="">Blank</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name === KIND_NAME[t.kind] ? t.name : `${t.name} (${KIND_NAME[t.kind]})`}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={FIELD}>
          <span>Kind</span>
          <select
            className={SELECT}
            value={kind}
            disabled={!!doc}
            onChange={(e) => setKind(e.target.value as DocKind)}
          >
            {DOC_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_NAME[k]}
              </option>
            ))}
          </select>
        </label>
        <label className={cx(FIELD, "grow basis-[260px]")}>
          <span>Title</span>
          <Input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Kitchen repaint"
          />
        </label>
      </div>

      <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
        <legend className="mb-1 text-[13px] font-medium">Who signs</legend>
        <label className={FIELD}>
          <span>Send by</span>
          <select
            className={SELECT}
            value={channel}
            onChange={(e) => setChannel(e.target.value as "email" | "sms")}
          >
            <option value="email">Email</option>
            <option value="sms">Text</option>
          </select>
        </label>
        <label className={cx(FIELD, "grow basis-[180px]")}>
          <span>Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </label>
        <label className={cx(FIELD, "grow basis-[220px]")}>
          <span>Email</span>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={channel === "email" ? "Required to send by email" : "Optional"}
          />
        </label>
        {channel === "sms" ? (
          doc?.contact ? (
            <p className={cx("basis-full text-[13px]", QUIET)}>
              Goes to the texting thread it was made from.
            </p>
          ) : (
            <label className={cx(FIELD, "grow basis-[180px]")}>
              <span>Mobile</span>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="A number you've texted"
              />
            </label>
          )
        ) : null}
      </fieldset>

      <Words value={body} onChange={setBody} />
      {left.length ? (
        <p className={cx("text-[12.5px]", QUIET)}>
          Not a slot we know: {left.join(", ")}. It stays as typed.
        </p>
      ) : null}

      <Lines lines={lines} set={setLines} currency={currency} />

      <div className="flex flex-wrap gap-3">
        <label className={FIELD}>
          <span>Deposit %</span>
          <Input
            inputMode="numeric"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            placeholder="None"
            className="w-28"
          />
        </label>
        <label className={FIELD}>
          <span>Expires after (days)</span>
          <Input
            inputMode="numeric"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            className="w-28"
          />
        </label>
        <p className={cx("self-end pb-2 text-[13px]", QUIET)}>
          {depositCents
            ? `A ${money(depositCents, currency)} deposit is asked once it's signed.`
            : "No deposit."}
        </p>
      </div>

      {error ? <p className={ERROR}>{error}</p> : null}
      {out ? <SentLine sent={out} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="dense"
          tone={send ? "quiet" : undefined}
          busy={busy}
          onClick={() => {
            andSend.current = false;
          }}
        >
          {doc ? "Save" : "Save as draft"}
        </Button>
        {send ? (
          <Button
            type="submit"
            size="dense"
            busy={busy}
            onClick={() => {
              andSend.current = true;
            }}
          >
            Save and send
          </Button>
        ) : null}
        {cancel ? (
          <Button type="button" size="dense" tone="quiet" onClick={cancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** What a send did; a link that went out now can be copied once. */
function SentLine({ sent }: { sent: Sent }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-[13.5px]">
      <Tag tone={sent.status === "failed" ? "warn" : "neutral"}>{sentLine(sent)}</Tag>
      {sent.url ? <CopyButton text={sent.url} label="Copy signing link" size="dense" /> : null}
    </p>
  );
}

/** The New document head: the client's templates, then the form in a framed section. */
function NewDocument({ client, reload }: { client: string; reload: () => void }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <NewDocumentForm client={client} reload={reload} close={() => setOpen(false)} />
  ) : (
    <Button size="dense" onClick={() => setOpen(true)}>
      New document
    </Button>
  );
}

function NewDocumentForm({
  client,
  reload,
  close,
}: {
  client: string;
  reload: () => void;
  close: () => void;
}) {
  const t = useCall(`doc-templates:${client}`, () =>
    call<Templates>("documents/templates", { client }),
  );
  return (
    <div className="w-full basis-full">
      <Section title="New document" note="Saved as a draft. Send it now or from its page.">
        {t.error ? (
          <p className={ERROR}>{t.error.message}</p>
        ) : !t.data ? (
          <p className={QUIET}>Reading your templates…</p>
        ) : (
          <DocForm
            doc={null}
            templates={t.data.templates}
            save={async (f) => {
              const r = await call<{ doc: { id: string } }>("documents/create", { client, ...f });
              reload();
              return r.doc.id;
            }}
            send={async (id) => {
              const r = await call<SendAnswer>("documents/send", { client, id });
              reload();
              return sentOf(r);
            }}
            cancel={close}
          />
        )}
      </Section>
    </div>
  );
}

// ---- A document's page ----

/** The signer page's light marks (`# `, `## `, `- `) as it draws them (`marksHtml`). */
function Marks({ body }: { body: string }) {
  const out: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (!items.length) return;
    out.push(
      <ul key={out.length} className="m-0 list-disc pl-5">
        {items.map((t, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
          <li key={i}>{t}</li>
        ))}
      </ul>,
    );
    items = [];
  };
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("- ")) {
      items.push(line.slice(2));
      continue;
    }
    flush();
    if (!line.trim()) continue;
    if (line.startsWith("## "))
      out.push(
        <h4 key={out.length} className="m-0 mt-1 text-[14px] font-semibold">
          {line.slice(3)}
        </h4>,
      );
    else if (line.startsWith("# "))
      out.push(
        <h3 key={out.length} className="m-0 text-[16px] font-semibold">
          {line.slice(2)}
        </h3>,
      );
    else
      out.push(
        <p key={out.length} className="m-0 leading-[1.55]">
          {line}
        </p>,
      );
  }
  flush();
  return <div className="grid gap-2">{out}</div>;
}

/** How it reads to the signer: its words, its lines and totals, its button. */
function DocPreview({ d, row }: { d: Editable; row: Row }) {
  const lines = d.lines;
  const t = totalsOf(lines);
  const dep = depositOf(t.totalCents, d.depositPct);
  return (
    <article className="grid gap-3 border border-(--ui-hair) bg-(--ui-paper) p-4 text-[14px]">
      <header className="grid gap-0.5">
        <span className={cx("text-[12px] uppercase tracking-wide", QUIET)}>
          {KIND_NAME[d.kind]} {String(row.number ?? "")}
        </span>
        <b className="text-[17px] font-semibold">{d.title || "Untitled"}</b>
        {d.name ? <span className={QUIET}>For {d.name}</span> : null}
      </header>
      {d.body ? <Marks body={d.body} /> : null}
      {lines.length ? (
        <table className="w-full border-collapse text-[13.5px] tabular-nums">
          <tbody>
            {lines.map((l, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
              <tr key={i} className="border-(--ui-hair) border-t align-top">
                <td className="py-1.5 pr-3">
                  {l.name}
                  <span className={cx("block text-[12.5px]", QUIET)}>
                    {l.qty} × {money(l.unit_cents, d.currency)}
                    {l.tax_pct ? `, ${l.tax_pct}% tax` : ""}
                    {l.detail ? `. ${l.detail}` : ""}
                  </span>
                </td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  {money(Math.round(l.qty * l.unit_cents), d.currency)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {t.taxCents ? (
              <tr className="border-(--ui-hair) border-t">
                <td className={cx("py-1 pr-3 text-right", QUIET)}>Tax</td>
                <td className="py-1 text-right whitespace-nowrap">
                  {money(t.taxCents, d.currency)}
                </td>
              </tr>
            ) : null}
            <tr className="border-(--ui-hair) border-t">
              <td className="py-1 pr-3 text-right font-medium">Total</td>
              <td className="py-1 text-right font-semibold whitespace-nowrap">
                {money(t.totalCents, d.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      ) : null}
      {dep ? (
        <p className={QUIET}>A {money(dep, d.currency)} deposit is asked once it's signed.</p>
      ) : null}
      <span className="inline-flex w-fit border border-(--ui-hair) px-3 py-1.5 text-[13px] text-(--ui-ink-3)">
        {SIGN_LABEL[d.kind]}
      </span>
    </article>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** Every step, oldest first: who did it and from where. */
function Steps({ steps }: { steps: NonNullable<Detail["steps"]> }) {
  if (!steps.length) return <p className={QUIET}>Nothing yet.</p>;
  return (
    <ol className="m-0 grid list-none gap-2 border-(--ui-hair) border-l p-0 pl-4">
      {steps.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: steps are append-only, in order
        <li key={i} className="grid gap-0.5 text-[14px]">
          <span>
            <b className="font-medium">{s.step}</b> <span className={QUIET}>{when(s.at)}</span>
          </span>
          {s.by || s.from ? (
            <span className={cx("text-[12.5px] break-all", QUIET)}>
              {[s.by, s.from].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** The signed copy: a PDF the server draws, saved by the browser. */
function PdfButton({ client, id }: { client: string; id: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const get = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ name: string; base64: string }>("documents/pdf", { client, id });
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button size="dense" tone="quiet" busy={busy} onClick={() => void get()}>
        Download PDF
      </Button>
      {error ? <span className={ERROR}>{error}</span> : null}
    </span>
  );
}

/** A draft's editor: saved in place, the record read again; Send is in its head. */
function DraftEditor({ d, act, id }: { d: Editable; act: RecordAct; id: string }) {
  return (
    <DocForm
      key={id}
      doc={d}
      templates={[]}
      save={async (f) => {
        await act("documents.save", f);
        return id;
      }}
    />
  );
}

export const docExtras: NonNullable<ListPage["extras"]> = (detail, { row, act, client }) => {
  const d = (detail ?? {}) as Detail;
  const id = String(row.id);
  const status = String(row.status ?? "");
  const out: RecordExtras = { sections: [] };
  const sections = out.sections as [string, ReactNode][];
  if (d.edit && status === "draft") out.form = <DraftEditor d={d.edit} act={act} id={id} />;
  if (d.edit) {
    out.aside = <DocPreview d={d.edit} row={row} />;
    out.drawn = ["body"];
  }
  if (d.deposit)
    sections.push([
      "Deposit",
      <p key="dep" className="flex flex-wrap items-center gap-2 text-[14px]">
        <Tag tone={d.deposit.status === "paid" ? "green" : "neutral"}>
          {d.deposit.status === "paid" ? "Paid" : "Not paid yet"}
        </Tag>
        {d.deposit.paid_at ? <span className={QUIET}>{when(d.deposit.paid_at)}</span> : null}
      </p>,
    ]);
  if (status === "signed")
    sections.push(["Signed copy", <PdfButton key="pdf" client={client} id={id} />]);
  sections.push(["Steps", <Steps key="steps" steps={d.steps ?? []} />]);
  return out;
};

export const documentsHead: NonNullable<ListPage["head"]> = (_meta, reload, at) =>
  at.demo ? null : <NewDocument client={at.client} reload={reload} />;

// ---- Templates ----

function TemplateForm({
  t,
  save,
  cancel,
}: {
  t: Template | null;
  save: (fields: Record<string, unknown>) => Promise<void>;
  cancel?: () => void;
}) {
  const [kind, setKind] = useState<DocKind>(t?.kind ?? "estimate");
  const [name, setName] = useState(t?.name ?? "");
  const [body, setBody] = useState(t?.body ?? "");
  const [lines, setLines] = useState<LineDraft[]>(t ? t.lines.map(draftOf) : []);
  const [deposit, setDeposit] = useState(t?.depositPct ? String(t.depositPct) : "");
  const [expires, setExpires] = useState(String(t?.expiresDays ?? 30));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await save({
        ...(t ? { id: t.id } : {}),
        kind,
        name,
        body,
        lines: linesFrom(lines),
        depositPct: deposit.trim() ? Number(deposit) : null,
        expiresDays: Number(expires),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="grid gap-4"
      aria-label={t ? `Change ${t.name}` : "New template"}
      onSubmit={(e) => void submit(e)}
    >
      <div className="flex flex-wrap gap-3">
        <label className={cx(FIELD, "grow basis-[240px]")}>
          <span>Name</span>
          <Input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={FIELD}>
          <span>Kind</span>
          <select
            className={SELECT}
            value={kind}
            onChange={(e) => setKind(e.target.value as DocKind)}
          >
            {DOC_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_NAME[k]}
              </option>
            ))}
          </select>
        </label>
        <label className={FIELD}>
          <span>Deposit %</span>
          <Input
            inputMode="numeric"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            placeholder="None"
            className="w-28"
          />
        </label>
        <label className={FIELD}>
          <span>Expires after (days)</span>
          <Input
            inputMode="numeric"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            className="w-28"
          />
        </label>
      </div>
      <Words value={body} onChange={setBody} />
      <Lines lines={lines} set={setLines} currency="usd" />
      {error ? <p className={ERROR}>{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="dense" busy={busy}>
          {t ? "Save" : "Add template"}
        </Button>
        {saved ? <span className={QUIET}>Saved. New documents start from this.</span> : null}
        {cancel ? (
          <Button type="button" size="dense" tone="quiet" onClick={cancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** A template's editor: its lines are read from the picker list, which carries them whole. */
function TemplateEditor({ client, id, act }: { client: string; id: string; act: RecordAct }) {
  const [nonce, setNonce] = useState(0);
  const got = useCall(`doc-template:${client}:${id}:${nonce}`, () =>
    call<Templates>("documents/templates", { client }),
  );
  const t = got.data?.templates.find((x) => x.id === id);
  if (got.error) return <p className={ERROR}>{got.error.message}</p>;
  if (!got.data) return <p className={QUIET}>Reading it…</p>;
  if (!t) return <p className={QUIET}>Archived.</p>;
  return (
    <TemplateForm
      key={`${t.id}:${nonce}`}
      t={t}
      save={async (f) => {
        await act("documents.templateSave", f);
        setNonce((n) => n + 1);
      }}
    />
  );
}

export const templateExtras: NonNullable<ListPage["extras"]> = (
  _detail,
  { row, act, client, demo },
) => (demo ? {} : { form: <TemplateEditor client={client} id={String(row.id)} act={act} /> });

function NewTemplate({ client, reload }: { client: string; reload: () => void }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="dense" onClick={() => setOpen(true)}>
        New template
      </Button>
    );
  return (
    <div className="w-full basis-full">
      <Section
        title="New template"
        note="Words, line items and a deposit that new documents start from."
      >
        <TemplateForm
          t={null}
          save={async (f) => {
            await call("documents/templateSave", { client, ...f });
            reload();
            setOpen(false);
          }}
          cancel={() => setOpen(false)}
        />
      </Section>
    </div>
  );
}

export const templatesHead: NonNullable<ListPage["head"]> = (_meta, reload, at) =>
  at.demo ? null : <NewTemplate client={at.client} reload={reload} />;
