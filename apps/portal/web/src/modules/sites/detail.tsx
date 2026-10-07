/**
 * A page's detail in Sites (designs/2026-10-07-sites.md, "Portal"): the draft in a frame beside
 * the details, its copy as a form from the template's fields, then its numbers, where visits came
 * from, the ads that link to it, its variants side by side and its versions. A code page shows
 * where its code lives and the tag that counts it; it's edited in the repo, never here.
 */
import type { AdIn, PageDetail, Variant } from "@wren/sites/detail";
import type { Content, CopyField, ItemValue } from "@wren/sites/templates";
import {
  Button,
  Input,
  money,
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

const LABEL = "text-[13px] font-medium text-(--ui-ink-2)";
const HINT = "text-[12px] text-(--ui-ink-3)";
const TH = "py-1.5 pr-3 font-normal";
const TD = "py-1.5 pr-3 tabular-nums";

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

/** The draft's copy: save keeps a new version, Claude rewrites it, the ask sends it to To approve. */
function CopyForm({ id, d, act }: { id: string; d: PageDetail; act: RecordAct }) {
  const draft = d.draft;
  const [content, setContent] = useState<Content>(() => ({ ...(draft?.content ?? {}) }));
  const [why, setWhy] = useState("");
  const [angle, setAngle] = useState("");
  const { said, busy, run } = useRun(act);
  if (!d.template || !draft) return null;
  const changed = JSON.stringify(content) !== JSON.stringify(draft.content);
  const asked = d.waiting === draft.number;
  const live = d.live === draft.number;
  return (
    <form
      className="grid min-w-0 gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          "save",
          "sites.save",
          { id, content, why: why.trim() || null, expect: draft.number },
          "Saved as a new version.",
        );
      }}
    >
      <p className={`text-[13.5px] ${QUIET}`}>
        {d.template.name}, version {draft.number}.{" "}
        {live ? "This is what's live." : asked ? "Waiting in To approve." : "Not asked yet."}
      </p>
      {d.template.fields.map((f) => (
        <FieldBox
          key={f.key}
          id={`copy-${f.key}`}
          f={f}
          value={content[f.key]}
          onChange={(v) => setContent((c) => ({ ...c, [f.key]: v }))}
        />
      ))}
      <div className="grid gap-1.5">
        <label htmlFor="copy-why" className={LABEL}>
          Why this change <span className={HINT}>(optional)</span>
        </label>
        <Input id="copy-why" value={why} maxLength={500} onChange={(e) => setWhy(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" tone="primary" disabled={!changed} busy={busy === "save"}>
          Save
        </Button>
        <Button
          disabled={changed || live || asked}
          busy={busy === "ask"}
          onClick={() =>
            void run("ask", "sites.ask", { id }, "Asked. It waits in Marketing, To approve.")
          }
        >
          Ask to publish
        </Button>
        <Said said={said} />
      </div>
      <div className="grid gap-1.5 border-t border-(--ui-hair) pt-4">
        <label htmlFor="copy-angle" className={LABEL}>
          Claude's draft
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="copy-angle"
            className="max-w-[320px]"
            placeholder="Angle, or leave empty"
            value={angle}
            maxLength={120}
            onChange={(e) => setAngle(e.target.value)}
          />
          <Button
            disabled={changed}
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
        <span className={HINT}>
          Checked against the offer's facts. Links stay as they are. It lands as a new version.
        </span>
      </div>
    </form>
  );
}

/** The draft as it will look, beside the details: a laptop or a phone. */
function Preview({ src, slug }: { src: string; slug: string | null }) {
  const [phone, setPhone] = useState(false);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={LABEL}>Draft preview</span>
        <div className="flex gap-1">
          <Button size="sm" tone={phone ? "quiet" : undefined} onClick={() => setPhone(false)}>
            Laptop
          </Button>
          <Button size="sm" tone={phone ? undefined : "quiet"} onClick={() => setPhone(true)}>
            Phone
          </Button>
        </div>
      </div>
      <div className="overflow-hidden border border-(--ui-hair) bg-(--ui-paper)">
        <iframe
          key={src}
          src={src}
          title="Draft preview"
          sandbox=""
          className={
            phone ? "mx-auto block h-[640px] w-[390px] max-w-full" : "block h-[640px] w-full"
          }
        />
      </div>
      <a className="text-[13px] underline" href={src} target="_blank" rel="noopener">
        Open the preview
      </a>
      {slug ? <span className={HINT}>Live at /o/{slug} once approved.</span> : null}
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
              <code className="block overflow-x-auto bg-(--ui-fill) p-2 text-[12.5px] whitespace-pre">
                {d.kit}
              </code>
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

export function Table({ head, rows }: { head: (string | [string, "r"])[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
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

function Ads({ ads }: { ads: AdIn[] }) {
  return (
    <Table
      head={["Ad", ["Spend", "r"], ["Clicks", "r"], ["Visits", "r"], ["Forms", "r"]]}
      rows={ads.map((a) => [
        <span key="n">
          {a.name} <Tag tone={a.status === "active" ? "green" : "neutral"}>{a.status}</Tag>
        </span>,
        usd(a.spend),
        num(a.clicks),
        num(a.views),
        num(a.forms),
      ])}
    />
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

const EDITOR = (
  <p className={`text-[13.5px] ${QUIET}`}>
    In development. Edit the copy above, or build the page in code with the lander skill.
  </p>
);

export const pageExtras: NonNullable<ListPage["extras"]> = (detail, { row, act }) => {
  const d = detail as PageDetail | null;
  if (!d) return {};
  const id = String(row.id);
  const url = String(row.url ?? "");
  const slug = /\/o\/([a-z0-9-]+)/.exec(url)?.[1] ?? null;
  const sections: [string, ReactNode][] = [
    ["Visits, last 30 days", <Numbers key="n" d={d} />],
    ["Where visits came from", <Sources key="s" d={d} />],
  ];
  if (d.ads.length) sections.push(["Ads that link here", <Ads key="a" ads={d.ads} />]);
  if (d.variants.length)
    sections.push(["Variants", <Variants key="v" vs={d.variants} here={id} />]);
  if (d.versions.length) sections.push(["Versions", <Versions key="h" d={d} />]);
  sections.push(["Notes", <Notes key={`notes-${d.notes ?? ""}`} id={id} d={d} act={act} />]);
  if (d.source === "code") return { top: <InCode d={d} url={url} />, sections };
  sections.push(["Visual editor", EDITOR]);
  return {
    // Keyed by version: a new one (a save, Claude's) opens fresh.
    form: <CopyForm key={`${id}:${d.draft?.number ?? 0}`} id={id} d={d} act={act} />,
    ...(d.preview ? { aside: <Preview key={d.preview} src={d.preview} slug={slug} /> } : {}),
    sections,
  } satisfies RecordExtras;
};
