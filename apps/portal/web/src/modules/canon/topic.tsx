/**
 * Canon › one topic (`/canon/topic?t=<name>`), in layer order: the skill (the door an agent loads),
 * the procedure (guide), the rule sets line by line with what backs each line, and the references
 * behind them. Evidence, checks, his notes, conflicts and files sit beside the layers. Any link opens
 * the record or file beside the page.
 */
import type { RuleLine, RuleSet, TopicWhole } from "@wren/research/canon-library";
import { Empty, Icon, LoadFailed, Loading, num, Tag, type TagTone, useSeen } from "@wren/ui";
import { Fragment, type ReactNode } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href } from "../../route.js";
import {
  Markdown,
  Section,
  sizeLabel,
  splitFrontmatter,
  VIDEO_KINDS,
  withoutTitle,
} from "./parts.js";
import { Code, fileHref, OpenedHere, recordHref } from "./record.js";
import { Poster } from "./references.js";

const HERE = "/canon/topic";

type Ref = TopicWhole["references"][number];
type Conflict = TopicWhole["conflicts"][number];

export function TopicPage({ params }: PageProps) {
  const name = params.get("t");
  if (!name)
    return (
      <Empty title="No topic picked" action={<a href="/canon/overview">Every topic</a>}>
        Pick a topic on the overview.
      </Empty>
    );
  return <Topic key={name} name={name} params={params} />;
}

function Topic({ name, params }: { name: string; params: URLSearchParams }) {
  const got = useCall(`canon-topic:${name}`, () => call<TopicWhole>("canon/topic", { name }));
  useSeen(
    "record",
    got.data
      ? {
          label: got.data.title,
          icon: "book",
          text: `Canon topic ${got.data.name}${got.data.guide ? `\n\nGuide:\n${got.data.guide.body}` : ""}`,
        }
      : null,
  );
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading shape="rows" lines={8} />;
  return <Whole t={got.data} params={params} />;
}

function Whole({ t, params }: { t: TopicWhole; params: URLSearchParams }) {
  const open = (id: string) => recordHref(HERE, id, params);
  const checksAt = `topics/${t.name}/checks/`;
  const checks = t.files.filter((f) => f.path.startsWith(checksAt));
  const files = t.files.filter((f) => !f.path.startsWith(checksAt));
  const refs = new Map(t.references.map((r) => [r.id, r]));
  const allSets = [...t.sets, ...t.borrowed];
  const lineCount = allSets.reduce((n, s) => n + s.rules.length, 0);
  const loads = t.skill ? skillLoads(t.skill) : null;
  const layers: [string, string, boolean][] = [
    ["skill", "Skill", t.skill != null],
    ["guide", "Procedure", true],
    ["sets", `Rule sets (${allSets.length})`, allSets.length > 0],
    ["references", `References (${t.references.length})`, t.references.length > 0],
  ];
  const beside: [string, string, boolean][] = [
    ["evidence", `Evidence (${t.evidence.length})`, t.evidence.length > 0],
    ["checks", `Checks (${checks.length})`, checks.length > 0],
    ["notes", "His notes", t.notes != null],
    ["conflicts", `Conflicts (${t.conflicts.length})`, t.conflicts.length > 0],
    ["files", `Files (${files.length})`, files.length > 0],
  ];
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <a href="/canon/overview" className="inline-flex items-center gap-1 text-[13px]">
          <Icon name="left" className="size-3.5" /> Every topic
        </a>
        <h2 className="m-0 text-[22px] leading-tight font-semibold text-pretty wrap-anywhere">
          {t.title}
        </h2>
        {t.description && (
          <p className="m-0 max-w-[70ch] text-[14.5px] leading-normal text-pretty text-(--ui-ink-2)">
            {t.description}
          </p>
        )}
        {/* the four layers in order; the parts beside them under it */}
        <nav
          aria-label="On this page"
          className="flex flex-wrap items-center gap-x-1 gap-y-1 pt-1 text-[13px]"
        >
          {layers
            .filter(([, , has]) => has)
            .map(([id, label], i) => (
              <span key={id} className="inline-flex items-center gap-1">
                {i > 0 && <Icon name="right" className="size-3 text-(--ui-ink-3)" />}
                <a href={`#${id}`}>{label}</a>
              </span>
            ))}
        </nav>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
          {beside
            .filter(([, , has]) => has)
            .map(([id, label]) => (
              <a key={id} href={`#${id}`} className="text-(--ui-ink-2)">
                {label}
              </a>
            ))}
        </span>
      </div>

      {t.skill != null && loads && (
        <Section
          title="Skill"
          id="skill"
          about="The door an agent loads: the procedure, his notes, then these rule sets."
        >
          <dl className="m-0 grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13.5px]">
            {loads.renders.map((r) => {
              const isGuide = (id: string) => id === t.guide?.id || id === t.name;
              const sets = r.ids.filter((id) => !isGuide(id));
              return (
                <Fragment key={r.ids.join(" ")}>
                  {r.ids.some(isGuide) && (
                    <>
                      <dt className="text-(--ui-ink-3)">Procedure</dt>
                      <dd className="m-0">
                        <a href="#guide">{t.guide?.title ?? t.name}</a>
                      </dd>
                      {loads.notes && (
                        <>
                          <dt className="text-(--ui-ink-3)">His notes</dt>
                          <dd className="m-0">
                            <a href="#notes">notes.md</a>
                          </dd>
                        </>
                      )}
                    </>
                  )}
                  {sets.length > 0 && (
                    <>
                      <dt className="text-(--ui-ink-3)">Rule sets</dt>
                      <dd className="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        {sets.map((id) => (
                          <a key={id} href={`#set-${id}`} className="wrap-anywhere">
                            {allSets.find((x) => x.id === id)?.title ?? id}
                          </a>
                        ))}
                        {r.only.length > 0 && (
                          <span className="text-(--ui-ink-3)">only {r.only.join(", ")}</span>
                        )}
                        {r.except.length > 0 && (
                          <span className="text-(--ui-ink-3)">all but {r.except.join(", ")}</span>
                        )}
                      </dd>
                    </>
                  )}
                </Fragment>
              );
            })}
          </dl>
          <Fold summary={<span>SKILL.md as written</span>}>
            <SkillText text={t.skill} />
          </Fold>
        </Section>
      )}

      <Section title="Procedure" id="guide" about="The guide: the steps, in order.">
        {t.guide ? (
          <>
            <div className="flex items-center gap-3 text-[12.5px] text-(--ui-ink-3)">
              <a href={open(t.guide.id)}>The guide's record</a>
              <span>{t.guide.cites.length} cites</span>
            </div>
            <Markdown
              text={withoutTitle(t.guide.body)}
              cites={t.guide.cites}
              open={open}
              notes="#notes"
              className="max-w-[78ch]"
            />
          </>
        ) : (
          <p className="m-0 text-[13.5px] text-(--ui-ink-3)">This topic has no guide yet.</p>
        )}
      </Section>

      {allSets.length > 0 && (
        <Section
          title="Rule sets"
          id="sets"
          about={`${num(lineCount)} lines, each with a fixed id. A line says what backs it: his source, an agent's, or nothing yet.`}
        >
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {t.sets.map((s) => (
              <li key={s.id}>
                <SetBlock
                  s={s}
                  open={open}
                  refs={refs}
                  conflicts={t.conflicts}
                  only={filterOf(loads, s)}
                  own
                />
              </li>
            ))}
          </ul>
          {t.borrowed.length > 0 && (
            <div className="flex flex-col gap-2 pt-3">
              <span className="text-[13px] text-(--ui-ink-3)">
                Borrowed: sets another topic owns that this topic loads.
              </span>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {t.borrowed.map((s) => (
                  <li key={s.id}>
                    <SetBlock
                      s={s}
                      open={open}
                      refs={refs}
                      conflicts={t.conflicts}
                      only={filterOf(loads, s)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {t.references.length > 0 && (
        <Section
          title="References"
          id="references"
          about="The examples under the lines. Each says which lines it backs."
        >
          <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-5 p-0 @min-[560px]/main:grid-cols-[repeat(auto-fill,minmax(148px,1fr))]">
            {t.references.map((r) => (
              <li key={r.id}>
                <RefCard r={r} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {t.evidence.length > 0 && (
        <Section
          title={`Evidence (${t.evidence.length})`}
          id="evidence"
          about="Every other source under the procedure and its sets, at any depth."
        >
          <Fold summary={<span>Show every source</span>}>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {t.evidence.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
                  <a
                    href={
                      s.kind && VIDEO_KINDS.has(s.kind)
                        ? href("/canon/references", { r: s.id })
                        : open(s.id)
                    }
                    className="wrap-anywhere"
                  >
                    {s.title}
                  </a>
                  <span className="text-[12px] text-(--ui-ink-3)">{s.kind ?? "source"}</span>
                  <Backs lines={s.backs} />
                </li>
              ))}
            </ul>
          </Fold>
        </Section>
      )}

      {checks.length > 0 && (
        <Section title="Checks" id="checks" about="Scripts that test work against the rules.">
          <FileList files={checks} drop={checksAt} params={params} />
        </Section>
      )}

      {t.notes != null && (
        <Section title="His notes" id="notes">
          <div className="bg-(--ui-accent-tint) px-3 py-2 [border-radius:4px_10px_4px_10px]">
            <Markdown text={withoutTitle(t.notes)} />
          </div>
        </Section>
      )}

      {t.conflicts.length > 0 && (
        <Section title="Open conflicts" id="conflicts">
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {t.conflicts.map((c) => (
              <li key={c.id} className="flex flex-col gap-1">
                <a href={open(c.id)} className="text-[14px] font-medium wrap-anywhere">
                  {c.title}
                </a>
                <Backs lines={c.lines} label="Lines" />
                <Markdown text={c.body} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {files.length > 0 && (
        <Section title="Files" id="files">
          <FileList files={files} drop={`topics/${t.name}/`} params={params} />
        </Section>
      )}
      <OpenedHere here={HERE} params={params} />
    </div>
  );
}

/** One rule set: its head, then each line with its id, backing, conflicts and references. */
function SetBlock({
  s,
  open,
  refs,
  conflicts,
  only,
  own,
}: {
  s: RuleSet;
  open: (id: string) => string;
  refs: Map<string, Ref>;
  conflicts: readonly Conflict[];
  only: string | null;
  own?: boolean;
}) {
  return (
    <Fold
      id={`set-${s.id}`}
      open={own}
      summary={
        <>
          <span className="font-semibold wrap-anywhere">{s.title}</span>
          <span className="text-(--ui-ink-3)">
            {s.prefix ? `${s.prefix}, ` : ""}
            {num(s.rules.length)} {s.rules.length === 1 ? "line" : "lines"}
          </span>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-(--ui-ink-3)">
        <a href={open(s.id)}>The set whole</a>
        {!own && s.topic && (
          <span>
            Owned by <a href={href(HERE, { t: s.topic })}>{s.topic}</a>
          </span>
        )}
        {s.usedBy.length > 0 && (
          <span>
            Also loaded by{" "}
            {s.usedBy.map((u, i) => (
              <span key={u.topic}>
                {i > 0 && ", "}
                <a href={href(HERE, { t: u.topic })}>{u.title}</a>
              </span>
            ))}
          </span>
        )}
        {only && <span>This topic loads {only}</span>}
      </div>
      <ol className="m-0 flex list-none flex-col p-0">
        {s.rules.map((l) => (
          <Line
            key={l.id}
            l={l}
            s={s}
            open={open}
            refs={refs}
            conflicts={conflicts.filter((c) => c.lines.includes(l.id))}
          />
        ))}
      </ol>
    </Fold>
  );
}

// what `knowledge audit` says stands behind a line
const BACKING: Record<RuleLine["backing"], [string, TagTone]> = {
  human: ["His", "accent"],
  agent: ["Agent", "neutral"],
  unknown: ["Source has no provider", "neutral"],
  none: ["No source", "warn"],
};

function Line({
  l,
  s,
  open,
  refs,
  conflicts,
}: {
  l: RuleLine;
  s: RuleSet;
  open: (id: string) => string;
  refs: Map<string, Ref>;
  conflicts: readonly Conflict[];
}) {
  const [label, tone] = BACKING[l.backing];
  const shown = l.sources.map((id) => refs.get(id)).filter((r): r is Ref => !!r);
  return (
    <li
      id={`line-${l.id}`}
      className="grid scroll-mt-4 grid-cols-1 gap-x-2 gap-y-0.5 border-t @min-[560px]/main:grid-cols-[4.25rem_minmax(0,1fr)] border-(--ui-hair) py-2 first:border-t-0 target:bg-(--ui-accent-tint)"
    >
      {/* id above the text on a phone, in its own column when wide */}
      <code className="pt-0.5 text-[12px] text-(--ui-ink-3)">{l.id}</code>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Markdown text={l.text} cites={s.cites} open={open} notes="#notes" className="[&_p]:my-0" />
        <span className="flex flex-wrap items-center gap-1.5">
          <Tag tone={tone}>{label}</Tag>
          {conflicts.map((c) => (
            <a key={c.id} href={open(c.id)} className="no-underline">
              <Tag tone="bad">Conflict</Tag>
            </a>
          ))}
          {shown.map((r) => (
            <a
              key={r.id}
              href={href("/canon/references", { r: r.id })}
              title={r.title}
              aria-label={`Reference: ${r.title}`}
              className="block w-7"
            >
              <Poster r={r} small />
            </a>
          ))}
        </span>
      </div>
    </li>
  );
}

function RefCard({ r }: { r: Ref }) {
  const to = href("/canon/references", { r: r.id });
  return (
    <article className="flex flex-col gap-1.5">
      <a href={to} tabIndex={-1} aria-label={r.title} className="group block">
        <Poster r={r} className="transition-[opacity] duration-150 group-hover:opacity-90" />
      </a>
      <a
        href={to}
        className="text-[13.5px] leading-snug font-medium text-(--ui-ink) no-underline wrap-anywhere hover:underline"
      >
        {r.title}
      </a>
      {r.backs.length > 0 ? (
        <Backs lines={r.backs} label="Backs" />
      ) : (
        <span className="text-[12px] text-(--ui-ink-3)">Backs no line yet</span>
      )}
    </article>
  );
}

/** Line ids as links to their row on this page. */
function Backs({ lines, label }: { lines: readonly string[]; label?: string }) {
  if (!lines.length) return null;
  const unique = [...new Set(lines)];
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-(--ui-ink-3)">
      {label && <span>{label}</span>}
      {unique.map((id) => (
        <a key={id} href={`#line-${id}`} className="whitespace-nowrap">
          {id}
        </a>
      ))}
    </span>
  );
}

function FileList({
  files,
  drop,
  params,
}: {
  files: TopicWhole["files"];
  drop: string;
  params: URLSearchParams;
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {files.map((f) => (
        <li key={f.path} className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
          <a href={fileHref(HERE, f.path, params)} className="wrap-anywhere">
            {f.path.slice(drop.length)}
          </a>
          <span className="text-[12px] text-(--ui-ink-3)">{sizeLabel(f.size)}</span>
        </li>
      ))}
    </ul>
  );
}

function Fold({
  summary,
  children,
  id,
  open,
}: {
  summary: ReactNode;
  children: ReactNode;
  id?: string;
  open?: boolean | undefined;
}) {
  return (
    <details
      id={id}
      open={open}
      className="group scroll-mt-4 bg-(--ui-band) px-3 py-2 [border-radius:4px_10px_4px_10px]"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 text-[14px] [&::-webkit-details-marker]:hidden">
        <Icon
          name="right"
          className="size-3.5 flex-none self-center transition-transform group-open:rotate-90"
        />
        {summary}
      </summary>
      <div className="flex flex-col gap-2 pt-2">{children}</div>
    </details>
  );
}

/** The skill's door: frontmatter, then its template text as written. */
function SkillText({ text }: { text: string }) {
  const { head, body } = splitFrontmatter(text);
  return (
    <>
      {head && <Code text={head} />}
      <Code text={body} />
    </>
  );
}

type Render = { ids: string[]; only: string[]; except: string[] };

/** What SKILL.md loads: each `knowledge … render <ids> [--only|--except <lines>]`, and notes.md. */
function skillLoads(text: string): { renders: Render[]; notes: boolean } {
  const renders: Render[] = [];
  for (const m of text.matchAll(/\bknowledge\b[^\n`]*?\srender\s+([^\n`|]+)/g)) {
    const r: Render = { ids: [], only: [], except: [] };
    let into: string[] = r.ids;
    for (const w of (m[1] ?? "").trim().split(/\s+/)) {
      if (w === "--only") into = r.only;
      else if (w === "--except") into = r.except;
      else if (w.startsWith("--")) into = [];
      else into.push(...w.split(",").filter(Boolean));
    }
    if (r.ids.length) renders.push(r);
  }
  return { renders, notes: /\bnotes\.md\b/.test(text) };
}

/** The `--only`/`--except` a skill puts on set `s`'s lines, by its prefix. */
function filterOf(loads: ReturnType<typeof skillLoads> | null, s: RuleSet): string | null {
  const r = loads?.renders.find((x) => x.ids.includes(s.id));
  if (!r || !s.prefix) return null;
  const mine = (ids: string[]) => ids.filter((id) => id.startsWith(`${s.prefix}-`));
  const only = mine(r.only);
  const except = mine(r.except);
  if (only.length) return `only ${only.join(", ")}`;
  if (except.length) return `all but ${except.join(", ")}`;
  return null;
}
