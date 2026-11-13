/**
 * Canon › Library: every record of every type, newest change first. Filters live in the address:
 * `type`, `status`, `topic`, `tag`, `q`. A search also lists the files whose path or text matches.
 * The Add box on top files a link, a picture or a PDF; a filed one opens here (`?r=`).
 */
import { sizeLabel } from "@wren/core/paths";
import type { Counted, RecordsPage } from "@wren/research/canon-library";
import { Button, Empty, LoadFailed, Loading, num, Tag, useSeen } from "@wren/ui";
import { useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { dayLabel } from "../work/bits.js";
import { AddBox } from "./add-box.js";
import { Pick, Search, Section, typeName } from "./parts.js";
import { fileHref, OpenedHere, recordHref } from "./record.js";

const HERE = "/canon/library";
const FILTERS = ["type", "status", "topic", "tag", "q"] as const;

export function LibraryPage({ params }: PageProps) {
  return (
    <div className="flex flex-col gap-6">
      <AddBox here={HERE} params={params} />
      <Records params={params} />
    </div>
  );
}

function Records({ params }: { params: URLSearchParams }) {
  const q = {
    type: params.get("type") || null,
    status: params.get("status") || null,
    topic: params.get("topic") || null,
    tag: params.get("tag") || null,
    q: params.get("q") || null,
  };
  const key = JSON.stringify(q);
  const got = useCall(`canon-records:${key}`, () => call<RecordsPage>("canon/records", q));
  const [extra, setExtra] = useState<{ key: string; pages: RecordsPage[] }>({ key, pages: [] });
  const more = extra.key === key ? extra.pages : [];
  const [loading, setLoading] = useState(false);
  useSeen("list", {
    label: "Library",
    icon: "book",
    text: `Canon records${q.type ? `, ${typeName(q.type, true)}` : ""}${q.topic ? `, topic ${q.topic}` : ""}${q.q ? `, matching "${q.q}"` : ""}`,
  });
  const set = (k: string, v: string | null) => navigate(href(HERE, { [k]: v || null }, params));

  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading shape="rows" lines={6} />;
  const data = got.data;
  if (!data.indexed)
    return (
      <Empty title="No index here yet" waits>
        Canon reaches this page after the first sync: `wren canon sync`.
      </Empty>
    );
  const rows = [data, ...more].flatMap((p) => p.rows);
  const next = [data, ...more].at(-1)?.next ?? null;
  const filtered = FILTERS.some((k) => params.has(k));
  const options = (
    facets: Counted[],
    name: (v: string) => string,
    all: string,
    at: string | null,
  ) => ({
    "": all,
    ...(at && !facets.some((f) => f.value === at) ? { [at]: name(at) } : {}),
    ...Object.fromEntries(facets.map((f) => [f.value, `${name(f.value)} (${num(f.n)})`])),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 @min-[720px]/main:flex @min-[720px]/main:flex-wrap @min-[720px]/main:items-center">
        <Search
          value={q.q ?? ""}
          label="Search Canon"
          placeholder="Search title, id, text"
          onChange={(v) => set("q", v)}
        />
        <Pick
          label="Type"
          value={q.type ?? ""}
          options={options(data.facets.type, (v) => typeName(v, true), "Every type", q.type)}
          onChange={(v) => set("type", v)}
        />
        <Pick
          label="Topic"
          value={q.topic ?? ""}
          options={options(data.facets.topic, (v) => v, "Every topic", q.topic)}
          onChange={(v) => set("topic", v)}
        />
        <Pick
          label="Status"
          value={q.status ?? ""}
          options={options(data.facets.status, (v) => v, "Any status", q.status)}
          onChange={(v) => set("status", v)}
        />
        {q.tag && (
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0"
            onClick={() => set("tag", null)}
            aria-label={`Clear tag ${q.tag}`}
          >
            <Tag tone="accent">Tag {q.tag} ×</Tag>
          </button>
        )}
        <span className="col-span-2 text-[13px] text-(--ui-ink-3) @min-[720px]/main:ml-auto">
          {num(data.total)} {data.total === 1 ? "record" : "records"}
        </span>
      </div>

      {data.files.length > 0 && (
        <Section title={`Files (${data.files.length})`}>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {data.files.map((f) => (
              <li key={f.path} className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
                <a href={fileHref(HERE, f.path, params)} className="wrap-anywhere">
                  {f.path}
                </a>
                <span className="text-[12px] text-(--ui-ink-3)">{sizeLabel(f.size)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!rows.length ? (
        filtered ? (
          <Empty
            action={
              <a href={href(HERE, Object.fromEntries(FILTERS.map((k) => [k, null])), params)}>
                Clear filters
              </a>
            }
          >
            No record matches these filters.
          </Empty>
        ) : (
          <Empty title="No records yet">Canon is empty.</Empty>
        )
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((r) => (
            <li key={r.id} className="border-b border-(--ui-hair) py-2.5 first:pt-0">
              <article className="flex min-w-0 flex-col gap-1">
                <a
                  href={recordHref(HERE, r.id, params)}
                  className="text-[14.5px] leading-snug font-medium text-(--ui-ink) no-underline wrap-anywhere hover:underline"
                >
                  {r.title}
                </a>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-(--ui-ink-3)">
                  <span>{typeName(r.type)}</span>
                  {r.topic && <span>{r.topic}</span>}
                  {r.status !== "live" && <Tag tone="warn">{r.status}</Tag>}
                  <span>Changed {dayLabel(r.updated)}</span>
                </span>
                {r.summary && (
                  <p className="m-0 max-w-[90ch] text-[13.5px] leading-normal text-pretty text-(--ui-ink-2) wrap-anywhere">
                    {r.summary}
                  </p>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}
      {next != null && (
        <span>
          <Button
            size="dense"
            tone="quiet"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              try {
                const page = await call<RecordsPage>("canon/records", { ...q, after: next });
                setExtra((x) => ({ key, pages: x.key === key ? [...x.pages, page] : [page] }));
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? "Loading…" : "Show more"}
          </Button>
        </span>
      )}
      <OpenedHere here={HERE} params={params} />
    </div>
  );
}
