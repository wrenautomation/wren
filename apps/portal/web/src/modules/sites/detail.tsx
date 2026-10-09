/**
 * A page's detail in Sites (designs/2026-10-07-sites.md, "Portal"): the draft in a frame beside
 * the details, its copy as a form from the template's fields, then its numbers, where visits came
 * from, the ads that link to it, its variants side by side and its versions. A code page shows
 * where its code lives and the tag that counts it; it's edited in the repo, never here.
 */
import type { Row } from "@wren/core/records/serve";
import type { AdIn, PageDetail, Variant } from "@wren/sites/detail";
import { renderPage } from "@wren/sites/render";
import {
  type Content,
  ContentProblem,
  type CopyField,
  checkContent,
  type ItemValue,
  partsOf,
  SECTIONS,
  type SectionValue,
  sectionOf,
  templateOf,
} from "@wren/sites/templates";
import {
  Button,
  Fieldset,
  FRAME,
  FRAME_BODY,
  FRAME_HEAD,
  GROUP_LABEL,
  Input,
  money,
  num,
  type RecordAct,
  type RecordExtras,
  Tag,
  Textarea,
  TrendChart,
} from "@wren/ui";
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ListPage } from "../../module.js";
import { QUIET } from "../work/bits.js";
import { Split } from "./split.js";

const LABEL = "text-[13px] font-medium text-(--ui-ink-2)";
const HINT = "text-[12px] text-(--ui-ink-3)";
const TH = "py-1.5 pr-3 font-normal";
const TD = "py-1.5 pr-3 tabular-nums";

const SELECT =
  "min-h-[34px] border border-(--ui-hair) bg-(--ui-paper) px-2.5 py-1.5 text-[14px] text-(--ui-ink) focus:border-(--ui-accent) focus:outline-none";
const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
const rate = (n: number | null) => (n === null ? "" : `${(n * 100).toFixed(1)}%`);
const usd = (n: number) => (n ? money(n, "USD") : "");
const day = (at: string) => new Date(at).toLocaleDateString("en-CA");

/** A line under a control: working, done, or why not. */
export function useRun(act: RecordAct) {
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (name: string, action: string, input: Record<string, unknown>, ok: string) => {
    setBusy(name);
    setSaid(null);
    try {
      await act(action, input);
      setSaid({ text: ok, bad: false });
    } catch (err) {
      setSaid({ text: errorOf(err), bad: true });
    } finally {
      setBusy(null);
    }
  };
  return { said, busy, run };
}

export function Said({ said }: { said: { text: string; bad: boolean } | null }) {
  return (
    <span
      aria-live="polite"
      className={said?.bad ? "text-[13px] text-(--ui-bad)" : "text-[13px] text-(--ui-ink-2)"}
    >
      {said?.text ?? ""}
    </span>
  );
}

/** A new section's id: short, lowercase, unique enough on one page. */
const newSectionId = () => crypto.randomUUID().slice(0, 8);

/**
 * A Sections page's blocks, each framed with its name and its own fields: move it up or down,
 * remove it, or add one from the library under it. One form per page; the library says so.
 */
function SectionsBox({
  id,
  f,
  value,
  onChange,
}: {
  id: string;
  f: CopyField;
  value: Content[string] | undefined;
  onChange: (v: Content[string]) => void;
}) {
  const list = (Array.isArray(value) ? value : []) as SectionValue[];
  const [adding, setAdding] = useState(SECTIONS[1]?.type ?? "text");
  const hasForm = list.some((s) => s.type === "form");
  const move = (i: number, by: -1 | 1) => {
    const next = [...list];
    const [s] = next.splice(i, 1);
    if (s) next.splice(i + by, 0, s);
    onChange(next);
  };
  const add = () => {
    const block = sectionOf(adding);
    if (!block) return;
    onChange([...list, { id: newSectionId(), type: block.type, ...block.sample } as SectionValue]);
  };
  return (
    <div className="grid min-w-0 gap-3">
      {list.map((s, i) => {
        const block = sectionOf(s.type);
        return (
          <section key={s.id} className={FRAME} aria-label={`Section ${i + 1}`}>
            <div className={FRAME_HEAD}>
              <span className={GROUP_LABEL}>
                {i + 1}. {block?.name ?? s.type}
              </span>
              <span className="flex gap-1.5">
                <Button size="sm" tone="quiet" disabled={i === 0} onClick={() => move(i, -1)}>
                  Up
                </Button>
                <Button
                  size="sm"
                  tone="quiet"
                  disabled={i === list.length - 1}
                  onClick={() => move(i, 1)}
                >
                  Down
                </Button>
                <Button
                  size="sm"
                  tone="quiet"
                  disabled={list.length === 1}
                  onClick={() => onChange(list.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </span>
            </div>
            <div className={`${FRAME_BODY} grid gap-3`}>
              {block ? (
                block.fields.map((sub) => (
                  <FieldBox
                    key={sub.key}
                    id={`${id}-${s.id}-${sub.key}`}
                    f={sub}
                    value={s[sub.key]}
                    onChange={(v) =>
                      onChange(
                        list.map((x, j) =>
                          j === i ? ({ ...x, [sub.key]: v } as SectionValue) : x,
                        ),
                      )
                    }
                  />
                ))
              ) : (
                <p className={HINT}>Not a block this editor knows. Remove it to save.</p>
              )}
            </div>
          </section>
        );
      })}
      {list.length < f.max ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-add`} className={LABEL}>
            Add a section
          </label>
          <select
            id={`${id}-add`}
            className={SELECT}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          >
            {SECTIONS.map((b) => (
              <option key={b.type} value={b.type} disabled={b.type === "form" && hasForm}>
                {b.name}
                {b.type === "form" && hasForm ? " (one per page)" : ""}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={adding === "form" && hasForm} onClick={add}>
            Add
          </Button>
          <span className={HINT}>{sectionOf(adding)?.blurb}</span>
        </div>
      ) : (
        <span className={HINT}>{f.max} sections is the most a page holds.</span>
      )}
    </div>
  );
}

/** One copy field as a box: a line, a paragraph, one per line, or a list of small groups. */
function FieldBox({
  id,
  f,
  value,
  onChange,
}: {
  id: string;
  f: CopyField;
  value: Content[string] | undefined;
  onChange: (v: Content[string]) => void;
}) {
  if (f.kind === "sections") return <SectionsBox id={id} f={f} value={value} onChange={onChange} />;
  if (f.kind === "items") {
    const items = (Array.isArray(value) ? value : []) as ItemValue[];
    const set = (i: number, k: string, v: string) =>
      onChange(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
    return (
      <fieldset className="grid min-w-0 gap-3">
        <legend className={LABEL}>{f.label}</legend>
        {items.map((it, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: items have no id; order is the key.
          <div key={i} className="grid gap-2 border-l-2 border-(--ui-hair) pl-3">
            {(f.items ?? []).map((sub) => (
              <FieldBox
                key={sub.key}
                id={`${id}-${i}-${sub.key}`}
                f={sub}
                value={it[sub.key] ?? ""}
                onChange={(v) => set(i, sub.key, String(v))}
              />
            ))}
            <div>
              <Button
                size="sm"
                tone="quiet"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
        {items.length < f.max ? (
          <div>
            <Button size="sm" onClick={() => onChange([...items, {}])}>
              Add one
            </Button>
          </div>
        ) : null}
        {f.hint ? <span className={HINT}>{f.hint}</span> : null}
      </fieldset>
    );
  }
  const text = Array.isArray(value) ? (value as string[]).join("\n") : String(value ?? "");
  const many = f.kind === "lines";
  const long = f.kind === "long" || many;
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className={LABEL}>
        {f.label}
        {f.optional ? <span className={HINT}> (optional)</span> : null}
      </label>
      {long ? (
        <Textarea
          id={id}
          rows={many ? 4 : 3}
          value={text}
          onChange={(e) => onChange(many ? e.target.value.split("\n") : e.target.value)}
        />
      ) : (
        <Input
          id={id}
          type={f.kind === "url" ? "url" : "text"}
          value={text}
          maxLength={f.max}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <span className={HINT}>
        {[
          f.hint,
          many && !f.hint?.includes("per line") ? "One per line." : null,
          !many ? `${text.length} of ${f.max}` : null,
        ]
          .filter(Boolean)
          .join(" ")}
      </span>
    </div>
  );
}

/**
 * The copy as it's typed, per page, shared by the editor and its preview beside it (two parts of
 * the record's detail that don't share a parent of ours).
 */
const typing = new Map<string, Content>();
const listeners = new Set<() => void>();
const setTyping = (id: string, c: Content | null) => {
  if (c) typing.set(id, c);
  else typing.delete(id);
  for (const l of listeners) l();
};
function useTyping(id: string): Content | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => typing.get(id),
  );
}

/** The fields in the template's groups: a group starts at a field that names one. */
function groupsOf(fields: readonly CopyField[]): [string, CopyField[]][] {
  const out: [string, CopyField[]][] = [];
  for (const f of fields) {
    const last = out[out.length - 1];
    if (f.group || !last) out.push([f.group ?? "Copy", [f]]);
    else last[1].push(f);
  }
  return out;
}

/** Why the copy can't be saved as it is, or null: the template's own check. */
function problemOf(templateId: string, content: Content): string | null {
  try {
    checkContent(templateOf(templateId), content);
    return null;
  } catch (err) {
    return err instanceof ContentProblem ? err.message : errorOf(err);
  }
}

/**
 * The copy editor: the page's words as its template's fields, grouped, never free HTML. Save keeps
 * a new version; the ask sends it to a yes (To approve, or the client's, by its approver setting).
 * Wren's team also gets Claude's draft.
 */
function CopyEditor({
  id,
  d,
  act,
  client,
}: {
  id: string;
  d: PageDetail;
  act: RecordAct;
  client: boolean;
}) {
  const draft = d.draft;
  const [content, setContent] = useState<Content>(() => ({ ...(draft?.content ?? {}) }));
  const [why, setWhy] = useState("");
  const [angle, setAngle] = useState("");
  const [part, setPart] = useState("");
  const [ask, setAsk] = useState("");
  const { said, busy, run } = useRun(act);
  useEffect(() => () => setTyping(id, null), [id]);
  if (!d.template || !draft) return null;
  const template = d.template;
  const parts = partsOf(templateOf(template.id), draft.content ?? {});
  const partKey = parts.some((p) => p.key === part) ? part : (parts[0]?.key ?? "");
  const edit = (next: Content) => {
    setContent(next);
    setTyping(id, JSON.stringify(next) === JSON.stringify(draft.content) ? null : next);
  };
  const changed = JSON.stringify(content) !== JSON.stringify(draft.content);
  const problem = changed ? problemOf(template.id, content) : null;
  const asked = d.waiting === draft.number;
  const live = d.live === draft.number;
  const closed = d.retiring;
  const state = closed
    ? "Waiting to be retired. Copy can't change until then."
    : live
      ? "This is what's live."
      : asked
        ? client
          ? "Waiting for a yes."
          : "Waiting in To approve."
        : "Saved, not asked yet.";
  return (
    <form
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          "save",
          "sites.save",
          { id, content, why: why.trim() || null, expect: draft.number },
          "Saved as a new version. Ask to publish when it's right.",
        );
      }}
    >
      <p className="text-[13.5px]">
        <span className="font-medium">
          {template.name}, version {draft.number}.
        </span>{" "}
        <span className={QUIET}>{state}</span>
      </p>
      {groupsOf(template.fields).map(([legend, fields]) => (
        <Fieldset key={legend} legend={legend}>
          {fields.map((f) => (
            <FieldBox
              key={f.key}
              id={`copy-${f.key}`}
              f={f}
              value={content[f.key]}
              onChange={(v) => edit({ ...content, [f.key]: v })}
            />
          ))}
        </Fieldset>
      ))}
      <Fieldset
        legend="Save and publish"
        note={
          client
            ? "Save keeps a new version. Publish waits for a yes: yours or Wren's, as your approver setting says."
            : "Save keeps a new version. Publish waits for a yes in To approve, or the client's when it approves its own."
        }
      >
        <div className="grid gap-1.5">
          <label htmlFor="copy-why" className={LABEL}>
            What changed <span className={HINT}>(optional)</span>
          </label>
          <Input
            id="copy-why"
            value={why}
            maxLength={500}
            onChange={(e) => setWhy(e.target.value)}
          />
        </div>
        {problem ? <p className="text-[13px] text-(--ui-bad)">{problem}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            tone="primary"
            disabled={!changed || !!problem || closed}
            busy={busy === "save"}
          >
            Save
          </Button>
          <Button
            disabled={changed || live || asked || closed}
            busy={busy === "ask"}
            onClick={() =>
              void run(
                "ask",
                "sites.ask",
                { id },
                client ? "Asked. It goes live on a yes." : "Asked. It waits in To approve.",
              )
            }
          >
            Ask to publish
          </Button>
          {changed ? (
            <Button
              tone="quiet"
              onClick={() => edit({ ...(draft.content ?? {}) })}
              disabled={busy !== null}
            >
              Undo changes
            </Button>
          ) : null}
          <Said said={said} />
        </div>
      </Fieldset>
      {client ? null : (
        <Fieldset
          legend="Claude's draft"
          note="Checked against the offer's facts. Links stay as they are. It lands as a new version."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="copy-angle"
              aria-label="Angle"
              className="max-w-[320px]"
              placeholder="Angle, or leave empty"
              value={angle}
              maxLength={120}
              onChange={(e) => setAngle(e.target.value)}
            />
            <Button
              disabled={changed || closed}
              busy={busy === "draft"}
              onClick={() =>
                void run(
                  "draft",
                  "sites.draft",
                  { id, angle: angle.trim() || null },
                  "Claude saved a new version. Read it before you ask.",
                )
              }
            >
              Ask Claude
            </Button>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="copy-part" className={LABEL}>
              Or rewrite one part
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="copy-part"
                className={SELECT}
                value={partKey}
                onChange={(e) => setPart(e.target.value)}
              >
                {parts.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <Input
                id="copy-ask"
                aria-label="What to change"
                className="max-w-[420px]"
                placeholder="What to change: shorter, warmer, lead with speed"
                value={ask}
                maxLength={500}
                onChange={(e) => setAsk(e.target.value)}
              />
              <Button
                disabled={changed || closed || !ask.trim() || !partKey}
                busy={busy === "rewrite"}
                onClick={() =>
                  void run(
                    "rewrite",
                    "sites.rewrite",
                    { id, part: partKey, ask: ask.trim() },
                    "Claude saved a new version with that part rewritten. Read it before you ask.",
                  )
                }
              >
                Rewrite
              </Button>
            </div>
            <span className={HINT}>
              Only that part changes. Links stay. Checked against the facts.
            </span>
          </div>
        </Fieldset>
      )}
    </form>
  );
}

/**
 * The page as it will look, beside the editor: drawn here from the copy as it's typed, with no
 * script and nothing counted. The saved draft opens on our host by its link.
 */
function Preview({ id, d, slug }: { id: string; d: PageDetail; slug: string | null }) {
  const [phone, setPhone] = useState(false);
  const typed = useTyping(id);
  const content = typed ?? d.draft?.content ?? null;
  const html = useMemo(() => {
    if (!d.template || !content) return null;
    try {
      return renderPage(templateOf(d.template.id), content, {
        page: id,
        base: "",
        track: false,
        banner: typed ? "Preview of your changes. Not saved." : "Preview. Not live until approved.",
      });
    } catch {
      return null;
    }
  }, [d.template, content, id, typed]);
  return (
    <div className={FRAME}>
      <div className={FRAME_HEAD}>
        <span className={GROUP_LABEL}>Preview</span>
        <div className="flex gap-1">
          <Button size="sm" tone={phone ? "quiet" : undefined} onClick={() => setPhone(false)}>
            Laptop
          </Button>
          <Button size="sm" tone={phone ? undefined : "quiet"} onClick={() => setPhone(true)}>
            Phone
          </Button>
        </div>
      </div>
      <div className="grid gap-2 p-3">
        <div className="overflow-hidden border border-(--ui-hair) bg-(--ui-paper)">
          {html ? (
            <iframe
              srcDoc={html}
              title="Page preview"
              sandbox=""
              className={
                phone ? "mx-auto block h-[640px] w-[390px] max-w-full" : "block h-[640px] w-full"
              }
            />
          ) : (
            <p className={`p-4 text-[13.5px] ${QUIET}`}>Nothing to show yet.</p>
          )}
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {d.preview ? (
            <a className="text-[13px] underline" href={d.preview} target="_blank" rel="noopener">
              Open the saved draft
            </a>
          ) : null}
          {slug ? <span className={HINT}>Live at /o/{slug} once approved.</span> : null}
        </div>
      </div>
    </div>
  );
}

/** A code page: where it lives and the tag that counts it. */
function InCode({ d, url }: { d: PageDetail; url: string }) {
  return (
    <div className="grid gap-3 text-[14px]">
      <p>
        Built in code. Edit it in the repo, then deploy it there. Claude Code's lander skill does
        both.
      </p>
      <dl className="grid gap-2">
        <div className="grid gap-0.5">
          <dt className={LABEL}>Edit in code</dt>
          <dd className="font-mono text-[13px] break-all">{d.repoPath ?? "No repo path yet."}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className={LABEL}>Live URL</dt>
          <dd>
            <a className="break-all underline" href={url} target="_blank" rel="noopener">
              {url}
            </a>
          </dd>
        </div>
        {d.kit ? (
          <div className="grid gap-0.5">
            <dt className={LABEL}>Kit tag, in its head</dt>
            <dd>
              <code className="block bg-(--ui-fill) p-2 text-[12.5px] break-all whitespace-pre-wrap">
                {d.kit}
              </code>
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/**
 * Numbers as a table. With `stack`, a phone gets each row as a card instead (its first cell on
 * top, the rest as label and value), so the name column isn't crushed.
 */
export function Table({
  head,
  rows,
  stack = false,
}: {
  head: (string | [string, "r"])[];
  rows: ReactNode[][];
  stack?: boolean;
}) {
  const labels = head.map((h) => (Array.isArray(h) ? h[0] : h));
  return (
    <>
      <div className={stack ? "hidden overflow-x-auto sm:block" : "overflow-x-auto"}>
        <table className="w-full text-left text-[13.5px]">
          <thead className={QUIET}>
            <tr className="border-b border-(--ui-hair)">
              {head.map((h) => {
                const [label, right] = Array.isArray(h) ? h : [h, null];
                return (
                  <th key={label} className={right ? `${TH} text-right` : TH}>
                    {label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are drawn once, in order.
              <tr key={i} className="border-b border-(--ui-hair) align-top">
                {r.map((c, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional.
                  <td key={j} className={j === 0 ? "py-1.5 pr-3" : `${TD} text-right`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {stack ? (
        <ul className="grid gap-3 sm:hidden">
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are drawn once, in order.
            <li key={i} className="grid gap-2 border-b border-(--ui-hair) pb-3 text-[14px]">
              <div>{r[0]}</div>
              <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5">
                {r.slice(1).map((c, j) =>
                  c === "" || c === null ? null : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional.
                    <div key={j} className="grid gap-0.5">
                      <dt className={HINT}>{labels[j + 1]}</dt>
                      <dd className="tabular-nums">{c}</dd>
                    </div>
                  ),
                )}
              </dl>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function Numbers({ d }: { d: PageDetail }) {
  if (!d.days.length) return <p className={QUIET}>No visits in the last 30 days.</p>;
  return (
    <TrendChart
      label="Visits"
      series={d.days.map((x) => ({ at: x.day, value: x.views }))}
      height={180}
    />
  );
}

function Sources({ d }: { d: PageDetail }) {
  if (!d.sources.length) return <p className={QUIET}>No visits counted.</p>;
  return (
    <Table
      head={["Source", ["Visits", "r"], ["Forms", "r"], ["Bookings", "r"]]}
      rows={d.sources.map((s) => [
        [s.channel, s.source, s.campaign].filter(Boolean).join(" · "),
        num(s.views),
        num(s.forms),
        num(s.books),
      ])}
    />
  );
}

/**
 * Each ad that links here: what it cost per form and per booking first, Meta's clicks and the
 * page's visits under its name. Spend and clicks are Meta's; the rest is the page's own count.
 */
function Ads({ ads }: { ads: AdIn[] }) {
  const currency = ads.find((a) => a.currency)?.currency ?? "USD";
  const cash = (n: number | null) => (n === null ? "" : money(n, currency));
  const per = (spend: number, n: number) =>
    spend > 0 && n > 0 ? Math.round((spend / n) * 100) / 100 : null;
  type Sums = Pick<AdIn, "spend" | "clicks" | "views" | "forms" | "books" | "hops">;
  const total: Sums = { spend: 0, clicks: 0, views: 0, forms: 0, books: 0, hops: 0 };
  for (const a of ads) for (const k of Object.keys(total) as (keyof Sums)[]) total[k] += a[k];
  const under = (a: Sums) =>
    [
      `${num(a.clicks)} clicks`,
      a.hops ? `${num(a.hops)} link clicks` : null,
      `${num(a.views)} visits`,
      per(a.spend, a.views) === null ? null : `${cash(per(a.spend, a.views))} a visit`,
    ]
      .filter(Boolean)
      .join(" · ");
  const row = (name: ReactNode, a: Sums) => [
    <span key="n" className="grid gap-0.5">
      {name}
      <span className={HINT}>{under(a)}</span>
    </span>,
    cash(a.spend || null),
    num(a.forms),
    num(a.books),
    cash(per(a.spend, a.forms)),
    cash(per(a.spend, a.books)),
  ];
  return (
    <div className="grid gap-2">
      <Table
        stack
        head={[
          "Ad",
          ["Spend", "r"],
          ["Forms", "r"],
          ["Bookings", "r"],
          ["Per form", "r"],
          ["Per booking", "r"],
        ]}
        rows={[
          ...ads.map((a) =>
            row(
              <span>
                {a.name} <Tag tone={a.status === "active" ? "green" : "neutral"}>{a.status}</Tag>
              </span>,
              a,
            ),
          ),
          ...(ads.length > 1 ? [row(<span className="font-medium">All ads</span>, total)] : []),
        ]}
      />
      <span className={HINT}>
        Spend and clicks are Meta's. Visits, forms and bookings are this page's, matched by the ad's
        id in its link.
      </span>
    </div>
  );
}

function Variants({ vs, here }: { vs: Variant[]; here: string }) {
  return (
    <Table
      head={[
        "Variant",
        ["Visits", "r"],
        ["Forms", "r"],
        ["Form rate", "r"],
        ["Bookings", "r"],
        ["Spend", "r"],
      ]}
      rows={vs.map((v) => [
        <a
          key="t"
          href={`/sites/pages/${v.id}`}
          className={v.id === here ? "font-medium" : "underline"}
        >
          {[v.title, v.angle].filter(Boolean).join(" · ")}
          {v.id === here ? " (this one)" : ""}
        </a>,
        num(v.views),
        num(v.forms),
        rate(v.formRate),
        num(v.books),
        usd(v.spend),
      ])}
    />
  );
}

function Versions({ d }: { d: PageDetail }) {
  return (
    <ul className="grid gap-1.5 text-[13.5px]">
      {d.versions.map((v) => (
        <li key={v.number} className="flex flex-wrap items-baseline gap-x-2">
          <span className="tabular-nums">v{v.number}</span>
          {d.live === v.number ? <Tag tone="green">Live</Tag> : null}
          {d.waiting === v.number ? <Tag tone="accent">Waiting</Tag> : null}
          <span className={QUIET}>
            {[day(v.at), v.by, v.origin === "claude" ? "Claude" : null, v.why]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Notes({ id, d, act }: { id: string; d: PageDetail; act: RecordAct }) {
  const [text, setText] = useState(d.notes ?? "");
  const { said, busy, run } = useRun(act);
  return (
    <div className="grid gap-2">
      <Textarea
        aria-label="Notes"
        rows={3}
        value={text}
        maxLength={4000}
        placeholder="What it's testing, what we learned."
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={text === (d.notes ?? "")}
          busy={busy === "notes"}
          onClick={() => void run("notes", "sites.notes", { id, notes: text }, "Saved")}
        >
          Save notes
        </Button>
        <Said said={said} />
      </div>
    </div>
  );
}

/** Wren's list: the copy editor and its preview for a data page, the repo for a code page. */
export const pageExtras: NonNullable<ListPage["extras"]> = (detail, { row, act }) =>
  extrasOf(detail as PageDetail | null, row, act, false);

/** A client's list: the same copy editor (no Claude), numbers, ads, the split and versions. */
export const clientPageExtras: NonNullable<ListPage["extras"]> = (detail, { row, act }) =>
  extrasOf(detail as PageDetail | null, row, act, true);

/** A section's body in a frame, under its label. */
const framed = (body: ReactNode) => (
  <div className={`${FRAME} ${FRAME_BODY} min-w-0 overflow-x-auto`}>{body}</div>
);

function extrasOf(d: PageDetail | null, row: Row, act: RecordAct, client: boolean): RecordExtras {
  if (!d) return {};
  const id = String(row.id);
  const url = String(row.url ?? "");
  const slug = /\/o\/([a-z0-9-]+)/.exec(url)?.[1] ?? null;
  const sections: [string, ReactNode][] = [
    ["Visits, last 30 days", framed(<Numbers key="n" d={d} />)],
    ["Where visits came from", framed(<Sources key="s" d={d} />)],
  ];
  if (d.ads.length) sections.push(["Ads to this page", framed(<Ads key="a" ads={d.ads} />)]);
  if (d.source === "data")
    sections.push(["A/B split", framed(<Split key="ab" id={id} d={d} row={row} act={act} />)]);
  if (d.variants.length)
    sections.push(["Variants", framed(<Variants key="v" vs={d.variants} here={id} />)]);
  if (d.versions.length) sections.push(["Versions", framed(<Versions key="h" d={d} />)]);
  if (!client)
    sections.push([
      "Notes",
      framed(<Notes key={`notes-${d.notes ?? ""}`} id={id} d={d} act={act} />),
    ]);
  if (d.source === "code")
    return client ? { sections } : { top: <InCode d={d} url={url} />, sections };
  const retired = row.status === "retired";
  return {
    // Keyed by version: a new one (a save, Claude's) opens fresh.
    ...(retired
      ? {}
      : {
          form: (
            <CopyEditor
              key={`${id}:${d.draft?.number ?? 0}`}
              id={id}
              d={d}
              act={act}
              client={client}
            />
          ),
        }),
    ...(d.draft
      ? { aside: <Preview key={`${id}:${d.draft.number}`} id={id} d={d} slug={slug} /> }
      : {}),
    sections,
  };
}
