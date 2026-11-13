/**
 * Any Canon record or file, opened beside the page that links it: `?r=<id>` a record, `?f=<path>` a
 * file. A record shows its fields whole, its body with cites as links, what it cites and what cites it.
 */
import { sizeLabel } from "@wren/core/paths";
import type { FileWhole, Link, RecordWhole } from "@wren/research/canon-library";
import { DetailSheet, Empty, Icon, LoadFailed, Loading, Tag, useSeen } from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { href, navigate } from "../../route.js";
import { explorerHref } from "../explorer/href.js";
import { dayLabel } from "../work/bits.js";
import {
  Markdown,
  Section,
  splitFrontmatter,
  typeName,
  VIDEO_KINDS,
  withoutTitle,
} from "./parts.js";

// fields the head already shows, or that only the index needs
const SHOWN = new Set(["cites", "note", "provider", "description", "version", "by", "why"]);

/** The record or file the address names, if any. */
export function OpenedHere({ here, params }: { here: string; params: URLSearchParams }) {
  const r = params.get("r");
  const f = params.get("f");
  if (r) return <OpenedRecord key={r} id={r} here={here} params={params} />;
  if (f) return <OpenedFile key={f} path={f} here={here} params={params} />;
  return null;
}

/** A link that opens record `id` beside page `here`, keeping the page's filters. */
export const recordHref = (here: string, id: string, params: URLSearchParams) =>
  href(here, { r: id, f: null }, params);
export const fileHref = (here: string, path: string, params: URLSearchParams) =>
  href(here, { f: path, r: null }, params);

function OpenedRecord({ id, here, params }: { id: string; here: string; params: URLSearchParams }) {
  const got = useCall(`canon-record:${id}`, () => call<RecordWhole>("canon/record", { id }));
  const shut = () => navigate(href(here, { r: null }, params), true);
  useSeen(
    "record",
    got.data
      ? {
          label: got.data.title,
          icon: "book",
          text: `${typeName(got.data.type)} ${got.data.id}: ${got.data.title}\n\n${got.data.body}`,
        }
      : null,
  );
  return (
    <DetailSheet
      title={got.data?.title ?? "Record"}
      about="The record whole, what it cites and what cites it."
      onClose={shut}
    >
      {got.error ? (
        <LoadFailed error={got.error} onRetry={got.retry} />
      ) : !got.data ? (
        <Loading shape="rows" lines={6} />
      ) : (
        <RecordBody r={got.data} open={(id) => recordHref(here, id, params)} />
      )}
    </DetailSheet>
  );
}

/**
 * A record's fields, note, body and links. `bare`: inside a frame that already shows its title and
 * its cites both ways (Explorer's preview).
 */
export function RecordBody({
  r,
  open,
  bare,
}: {
  r: RecordWhole;
  open: (id: string) => string;
  bare?: boolean;
}) {
  const note = r.data.note as { text?: string; by?: string; at?: string } | undefined;
  const provider = r.data.provider as { kind?: string; who?: string } | undefined;
  const url = typeof r.data.url === "string" ? r.data.url : null;
  const kind = typeof r.data.kind === "string" ? r.data.kind : null;
  const facts = Object.entries(r.data).filter(([k, v]) => !SHOWN.has(k) && v != null && v !== "");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <Tag>{typeName(r.type)}</Tag>
          {r.status !== "live" && <Tag tone="warn">{r.status}</Tag>}
          {provider?.kind === "human" && <Tag tone="accent">His</Tag>}
          {r.topic && (
            <a href={href("/canon/topic", { t: r.topic })} className="no-underline">
              <Tag tone="green">{r.topic}</Tag>
            </a>
          )}
        </span>
        {!bare && (
          <h2 className="m-0 text-[18px] leading-snug font-semibold text-pretty wrap-anywhere">
            {r.title}
          </h2>
        )}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-(--ui-ink-3)">
          {/* bare: the frame's header names the id */}
          {!bare && <code className="wrap-anywhere">{r.id}</code>}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1"
            >
              Open the source <Icon name="external" className="size-3.5" />
            </a>
          )}
          {r.type === "source" && kind && VIDEO_KINDS.has(kind) && (
            <a href={explorerHref(`canon/references/${r.id}`)}>Play in Explorer</a>
          )}
          <a
            href={r.github}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1"
          >
            GitHub <Icon name="external" className="size-3.5" />
          </a>
        </span>
      </div>
      {typeof r.data.description === "string" && (
        <p className="m-0 text-[14px] leading-normal text-pretty">{r.data.description}</p>
      )}
      {note?.text && (
        <Section title="His note">
          <p className="m-0 bg-(--ui-accent-tint) px-2.5 py-2 text-[13.5px] leading-normal whitespace-pre-line wrap-anywhere [border-radius:4px_10px_4px_10px]">
            {note.text}
          </p>
        </Section>
      )}
      {r.body.trim() && (
        <Section title={r.type === "rule" ? "Lines" : "Text"}>
          <Markdown text={withoutTitle(r.body)} cites={r.cites} open={open} />
        </Section>
      )}
      {!bare && (
        <>
          <LinkList title="Cites" links={r.cites} open={open} numbered empty="It cites nothing." />
          <LinkList title="Cited by" links={r.citedBy} open={open} empty="Nothing cites it yet." />
        </>
      )}
      <Section title="Fields">
        <dl className="m-0 grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
          {provider?.kind && <Fact k="provider" v={`${provider.kind}: ${provider.who ?? ""}`} />}
          {facts.map(([k, v]) => (
            <Fact key={k} k={k} v={v} />
          ))}
          <Fact k="by" v={r.data.by} />
          <Fact k="why" v={r.data.why} />
          <Fact k="version" v={r.data.version} />
          <Fact k="file" v={r.path} />
        </dl>
      </Section>
    </div>
  );
}

const DATE = /^\d{4}-\d{2}-\d{2}T/;

/** A finding's quote: `{ text, at }`. */
const quoteOf = (v: unknown) =>
  v && typeof v === "object" && typeof (v as { text?: unknown }).text === "string"
    ? (v as { text: string; at?: unknown })
    : null;

function Fact({ k, v }: { k: string; v: unknown }) {
  if (v == null || v === "") return null;
  const q = quoteOf(v);
  if (q)
    return (
      <>
        <dt className="text-(--ui-ink-3) wrap-anywhere">{k}</dt>
        <dd className="m-0 min-w-0 wrap-anywhere">
          “{q.text}”{q.at != null && <span className="text-(--ui-ink-3)"> at {String(q.at)}</span>}
        </dd>
      </>
    );
  const flat =
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : Array.isArray(v) && v.every((x) => typeof x !== "object")
        ? v.join(", ")
        : null;
  return (
    <>
      <dt className="text-(--ui-ink-3) wrap-anywhere">{k}</dt>
      <dd className="m-0 min-w-0 whitespace-pre-line wrap-anywhere">
        {flat == null ? (
          <pre className="m-0 overflow-x-auto text-[12px] leading-snug whitespace-pre-wrap">
            {JSON.stringify(v, null, 2)}
          </pre>
        ) : DATE.test(flat) ? (
          <span title={flat}>{dayLabel(flat)}</span>
        ) : (
          flat
        )}
      </dd>
    </>
  );
}

function LinkList({
  title,
  links,
  open,
  numbered,
  empty,
}: {
  title: string;
  links: readonly Link[];
  open: (id: string) => string;
  numbered?: boolean;
  empty: string;
}) {
  return (
    <Section title={`${title}${links.length ? ` (${links.length})` : ""}`}>
      {links.length ? (
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {links.map((l, i) => (
            <li key={l.id} className="flex min-w-0 gap-2 text-[13.5px] leading-snug">
              {numbered && (
                <span className="w-6 flex-none text-right text-(--ui-ink-3) tabular-nums">
                  {i + 1}.
                </span>
              )}
              <span className="flex min-w-0 flex-col">
                {l.status === "missing" ? (
                  <span className="text-(--ui-ink-3) wrap-anywhere">
                    {l.id} <Tag tone="bad">not in Canon</Tag>
                  </span>
                ) : (
                  <a href={open(l.id)} className="wrap-anywhere">
                    {l.title}
                  </a>
                )}
                {l.status !== "missing" && (
                  <span className="text-[12px] text-(--ui-ink-3)">
                    {typeName(l.type)}
                    {l.status !== "live" ? `, ${l.status}` : ""}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="m-0 text-[13.5px] text-(--ui-ink-3)">{empty}</p>
      )}
    </Section>
  );
}

function OpenedFile({
  path,
  here,
  params,
}: {
  path: string;
  here: string;
  params: URLSearchParams;
}) {
  const got = useCall(`canon-file:${path}`, () => call<FileWhole>("canon/file", { path }));
  const shut = () => navigate(href(here, { f: null }, params), true);
  const name = path.split("/").pop() ?? path;
  useSeen(
    "record",
    got.data?.body != null
      ? { label: name, icon: "doc", text: `${path}\n\n${got.data.body}` }
      : null,
  );
  return (
    <DetailSheet title={name} about="A file in Canon, whole." onClose={shut}>
      {got.error ? (
        <LoadFailed error={got.error} onRetry={got.retry} />
      ) : !got.data ? (
        <Loading shape="rows" lines={6} />
      ) : (
        <FileBody f={got.data} />
      )}
    </DetailSheet>
  );
}

/** A file whole: Markdown, else code. `bare`: its frame shows the name. */
export function FileBody({ f, bare }: { f: FileWhole; bare?: boolean }) {
  const md = f.path.endsWith(".md");
  const { head, body } =
    md && f.body != null ? splitFrontmatter(f.body) : { head: null, body: f.body };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        {!bare && (
          <h2 className="m-0 text-[18px] leading-snug font-semibold wrap-anywhere">
            {f.path.split("/").pop()}
          </h2>
        )}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-(--ui-ink-3)">
          <code className="wrap-anywhere">{f.path}</code>
          <span>{sizeLabel(f.size)}</span>
          <a
            href={f.github}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1"
          >
            GitHub <Icon name="external" className="size-3.5" />
          </a>
        </span>
      </div>
      {f.body == null ? (
        <Empty title="Not text">The index keeps this file's size only. Open it on GitHub.</Empty>
      ) : md ? (
        <>
          {head && <Code text={head} />}
          <Markdown text={body ?? ""} />
        </>
      ) : (
        <Code text={f.body} />
      )}
    </div>
  );
}

export function Code({ text }: { text: string }) {
  return (
    <pre className="m-0 overflow-x-auto bg-(--ui-band) p-3 text-[12.5px] leading-normal [border-radius:4px_10px_4px_10px]">
      {text}
    </pre>
  );
}
