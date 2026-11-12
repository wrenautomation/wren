/**
 * Canon › References (designs/2026-11-12-canon-references.md): every reel and video in Canon as a
 * card, his note whole. A card opens the reference (`?r=<id>`): a panel on a wide screen, a sheet
 * on a phone. List state lives in the address: `platform`, `provider`, `tag`, `q`, `noted`.
 */
import type {
  Facet,
  ReferencesPage as Page,
  Reference,
  ReferenceWhole,
} from "@wren/research/canon-console";
import {
  BottomSheet,
  Button,
  cx,
  Empty,
  Icon,
  Img,
  LoadFailed,
  Loading,
  num,
  Tag,
  usePhone,
  useSeen,
  Video,
  type VideoMark,
} from "@wren/ui";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@wren/ui/components/ui/sheet";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { dayLabel, SELECT } from "../work/bits.js";

const HERE = "/canon/references";
const FILTERS = ["platform", "provider", "tag", "q", "noted"] as const;
const PLATFORMS: Record<string, string> = { instagram: "Instagram", youtube: "YouTube" };
const PROVIDERS: Record<string, string> = { human: "His", agent: "An agent's", weaver: "Weaver's" };

/** m:ss */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const platformName = (p: string) => PLATFORMS[p] ?? p;

export function ReferencesPage({ params }: PageProps) {
  const open = params.get("r");
  return (
    <>
      <List params={params} />
      {open && <Opened key={open} id={open} params={params} />}
    </>
  );
}

function List({ params }: { params: URLSearchParams }) {
  const q = {
    platform: params.get("platform") || null,
    provider: params.get("provider") || null,
    tag: params.get("tag") || null,
    q: params.get("q") || null,
    noted: params.get("noted") === "1" || null,
  };
  const key = JSON.stringify(q);
  const got = useCall(`canon-references:${key}`, () => call<Page>("canon/references", q));
  const [extra, setExtra] = useState<{ key: string; pages: Page[] }>({ key, pages: [] });
  const more = extra.key === key ? extra.pages : [];
  const [loading, setLoading] = useState(false);
  useSeen("list", {
    label: "References",
    icon: "book",
    text: `Canon references${q.platform ? `, ${platformName(q.platform)}` : ""}${
      q.provider ? `, ${q.provider}'s` : ""
    }${q.tag ? `, tagged ${q.tag}` : ""}${q.q ? `, matching "${q.q}"` : ""}${q.noted ? ", with his note" : ""}`,
  });
  const set = (k: string, v: string | null) => navigate(href(HERE, { [k]: v || null }, params));

  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading shape="rows" lines={4} />;
  const data = got.data;
  if (!data.indexed)
    return (
      <Empty title="No index here yet" waits>
        Canon reaches this page after the first sync: `wren canon sync`.
      </Empty>
    );
  const pages = [data, ...more];
  const rows = pages.flatMap((p) => p.rows);
  const next = pages.at(-1)?.next ?? null;
  const filtered = FILTERS.some((k) => params.has(k));
  const options = (
    facets: Facet[],
    name: (v: string) => string,
    all: string,
    at: string | null,
  ) => ({
    "": all,
    // the picked value stays listed when no row has it any more
    ...(at && !facets.some((f) => f.value === at) ? { [at]: name(at) } : {}),
    ...Object.fromEntries(facets.map((f) => [f.value, `${name(f.value)} (${num(f.n)})`])),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 @min-[720px]/main:flex @min-[720px]/main:flex-wrap @min-[720px]/main:items-center">
        <Search value={q.q ?? ""} onChange={(v) => set("q", v)} />
        <Pick
          label="Platform"
          value={q.platform ?? ""}
          options={options(data.facets.platform, platformName, "Every platform", q.platform)}
          onChange={(v) => set("platform", v)}
        />
        <Pick
          label="Saved by"
          value={q.provider ?? ""}
          options={options(data.facets.provider, (v) => PROVIDERS[v] ?? v, "Anyone's", q.provider)}
          onChange={(v) => set("provider", v)}
        />
        <Pick
          label="Tag"
          value={q.tag ?? ""}
          options={options(data.facets.tag, (v) => v, "Every tag", q.tag)}
          onChange={(v) => set("tag", v)}
        />
        <label className="flex min-h-[38px] items-center gap-2 text-[14px] text-(--ui-ink-2)">
          <input
            type="checkbox"
            className="size-4 accent-(--ui-accent)"
            checked={!!q.noted}
            onChange={(e) => set("noted", e.target.checked ? "1" : null)}
          />
          Only with his note
        </label>
        <span className="col-span-2 text-[13px] text-(--ui-ink-3) @min-[720px]/main:ml-auto">
          {num(data.total)} {data.total === 1 ? "reference" : "references"}
        </span>
      </div>
      {!rows.length ? (
        filtered ? (
          <Empty
            action={
              <a href={href(HERE, Object.fromEntries(FILTERS.map((k) => [k, null])), params)}>
                Clear filters
              </a>
            }
          >
            No reference matches these filters.
          </Empty>
        ) : (
          <Empty title="No references yet">
            A reel or video comes in with `wren source add &lt;link&gt;`.
          </Empty>
        )
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-x-3 gap-y-5 p-0 @min-[720px]/main:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
          {rows.map((r) => (
            <li key={r.id} className="min-w-0">
              <Card r={r} params={params} />
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
                const page = await call<Page>("canon/references", { ...q, after: next });
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
      {data.head && (
        <p className="m-0 text-[12px] text-(--ui-ink-3)">
          Indexed at Canon commit <code>{data.head.slice(0, 8)}</code>
        </p>
      )}
    </div>
  );
}

function Search({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    // edit-ok: search box, applied on Enter and on blur
    <input
      type="search"
      aria-label="Search references"
      placeholder="Search title, note, creator"
      className={cx(SELECT, "col-span-2 w-full min-w-0 @min-[720px]/main:w-64")}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onChange(text.trim());
      }}
      onBlur={() => text.trim() !== value && onChange(text.trim())}
    />
  );
}

function Pick({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Readonly<Record<string, string>>;
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label={label}
      className={cx(SELECT, "w-full min-w-0 @min-[720px]/main:w-auto @min-[720px]/main:max-w-64")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {Object.entries(options).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}

/** Who saved it: his own, or an agent's. */
function Saver({ r }: { r: Reference }) {
  if (!r.provider) return null;
  return r.provider.kind === "human" ? (
    <Tag tone="accent">{r.provider.who === "william" ? "William" : r.provider.who}</Tag>
  ) : (
    <Tag>{PROVIDERS[r.provider.kind] ? r.provider.kind : r.provider.kind}</Tag>
  );
}

function Poster({ r, className }: { r: Reference; className?: string }) {
  return (
    <span
      className={cx(
        "relative block aspect-[4/5] overflow-hidden bg-(--ui-band) [border-radius:4px_10px_4px_10px]",
        className,
      )}
    >
      {r.poster ? (
        <Img src={r.poster} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <span className="grid size-full place-items-center text-(--ui-ink-3)">
          <Icon name="video" className="size-6" />
        </span>
      )}
      {r.length != null && (
        <span className="absolute right-1.5 bottom-1.5 bg-black/70 px-1.5 py-0.5 text-[11.5px] font-medium text-white tabular-nums [border-radius:3px]">
          {clock(r.length)}
        </span>
      )}
    </span>
  );
}

function Card({ r, params }: { r: Reference; params: URLSearchParams }) {
  const to = href(HERE, { r: r.id }, params);
  // a phone: a row, poster left, note across; wide: a card, poster on top
  return (
    <article className="grid grid-cols-[96px_minmax(0,1fr)] content-start gap-x-3 gap-y-2 @min-[720px]/main:flex @min-[720px]/main:flex-col">
      <a href={to} tabIndex={-1} aria-hidden="true" className="group row-span-2 self-start">
        <Poster r={r} className="transition-[opacity] duration-150 group-hover:opacity-90" />
      </a>
      <a
        href={to}
        className="self-start text-[14px] leading-snug font-medium text-(--ui-ink) no-underline wrap-anywhere hover:underline"
      >
        {r.title}
      </a>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 self-start text-[12.5px] text-(--ui-ink-3)">
        <span>{platformName(r.platform)}</span>
        {r.handle && <span className="wrap-anywhere">@{r.handle}</span>}
        <span>{dayLabel(r.saved)}</span>
        <Saver r={r} />
      </span>
      {r.note && (
        <div className="col-span-2">
          <NoteText note={r.note} />
        </div>
      )}
    </article>
  );
}

/** His note: whole, never clamped. */
function NoteText({ note }: { note: NonNullable<Reference["note"]> }) {
  return (
    <p className="m-0 bg-(--ui-accent-tint) px-2.5 py-2 text-[13.5px] leading-normal whitespace-pre-line text-(--ui-ink) wrap-anywhere [border-radius:4px_10px_4px_10px]">
      {note.text}
    </p>
  );
}

function Opened({ id, params }: { id: string; params: URLSearchParams }) {
  const phone = usePhone();
  const got = useCall(`canon-reference:${id}`, () =>
    call<ReferenceWhole>("canon/reference", { id }),
  );
  const shut = () => navigate(href(HERE, { r: null }, params), true);
  useSeen(
    "record",
    got.data ? { label: got.data.title, icon: "video", text: seenText(got.data) } : null,
  );
  const title = got.data?.title ?? "Reference";
  const body = got.error ? (
    <LoadFailed error={got.error} onRetry={got.retry} />
  ) : !got.data ? (
    <Loading shape="rows" lines={6} />
  ) : (
    <Whole r={got.data} />
  );
  if (phone)
    return (
      <BottomSheet
        label={title}
        start="large"
        onClose={shut}
        bodyClassName="px-4 pt-2 pb-[calc(96px+env(safe-area-inset-bottom))]"
        head={
          <div className="flex h-11 items-center border-b border-(--ui-hair) px-2">
            <CloseButton onClick={shut} />
          </div>
        }
      >
        {body}
      </BottomSheet>
    );
  return (
    <Sheet open onOpenChange={(o) => !o && shut()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto data-[side=right]:sm:max-w-[560px]"
      >
        {/* the body's h2 shows the title; the close button sits top right */}
        <SheetHeader className="sr-only">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>The reference, his note and the rule lines it backs.</SheetDescription>
        </SheetHeader>
        <div className="px-5 pt-12 pb-10">{body}</div>
      </SheetContent>
    </Sheet>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClick}
      className="inline-grid size-8 cursor-pointer place-items-center border-0 bg-transparent text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink) pointer-coarse:size-11"
    >
      <Icon name="close" className="size-4" />
    </button>
  );
}

const seenText = (r: ReferenceWhole) =>
  [
    `${r.title} (${platformName(r.platform)}${r.handle ? `, @${r.handle}` : ""}), ${r.url}`,
    r.note ? `His note: ${r.note.text}` : null,
    r.hook ? `Hook: ${r.hook}` : null,
    r.backs.length ? `Backs: ${r.backs.map((b) => `${b.line} ${b.text}`).join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

/** The player: the stored file with the beats as marks; the embed when the file is missing. */
function Player({ r }: { r: ReferenceWhole }) {
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const bad = () => setFailed(true);
    el.addEventListener("error", bad);
    return () => el.removeEventListener("error", bad);
  }, []);
  const tall = r.platform !== "youtube";
  if (r.video && !failed) {
    const marks: VideoMark[] = r.beats.map((b, i) => ({ id: i, start: b.t }));
    return (
      <Video
        ref={video}
        src={r.video}
        poster={r.poster}
        marks={marks}
        className={cx("w-full", tall && "mx-auto max-h-[70vh] max-w-[400px]")}
      />
    );
  }
  if (r.embed)
    return (
      <iframe
        src={r.embed}
        title={r.title}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        className={cx(
          "block w-full border-0 bg-(--ui-band)",
          tall ? "mx-auto aspect-[9/16] max-h-[70vh] max-w-[400px]" : "aspect-video",
        )}
      />
    );
  // nothing to play here: a strip, not a tall empty frame
  return (
    <a
      href={r.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 bg-(--ui-band) px-3 py-4 text-[13.5px] text-(--ui-ink-2) [border-radius:4px_10px_4px_10px]"
    >
      <Icon name="video" className="size-4 flex-none" />
      No file saved. Watch it on {platformName(r.platform)}.
      <Icon name="external" className="size-3.5 flex-none" />
    </a>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="m-0 text-[12px] font-semibold tracking-wide text-(--ui-ink-3) uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Whole({ r }: { r: ReferenceWhole }) {
  const stats = [
    r.stats?.views != null ? `${num(r.stats.views)} views` : null,
    r.stats?.likes != null ? `${num(r.stats.likes)} likes` : null,
    r.stats?.comments != null ? `${num(r.stats.comments)} comments` : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-5">
      <Player r={r} />
      <div className="flex flex-col gap-1.5">
        <h2 className="m-0 text-[18px] leading-snug font-semibold text-pretty wrap-anywhere">
          {r.title}
        </h2>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-(--ui-ink-3)">
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1"
          >
            {platformName(r.platform)}
            {r.handle ? ` @${r.handle}` : ""}
            <Icon name="external" className="size-3.5" />
          </a>
          {r.posted && <span>Posted {dayLabel(r.posted)}</span>}
          <span>Saved {dayLabel(r.saved)}</span>
          <Saver r={r} />
        </span>
        {stats.length > 0 && (
          <span className="text-[13px] text-(--ui-ink-3) tabular-nums">{stats.join(" · ")}</span>
        )}
      </div>
      {r.note && (
        <Section title="His note">
          <NoteText note={r.note} />
        </Section>
      )}
      {r.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.tags.map((t) => (
            <a
              key={t}
              href={href(HERE, { tag: t }, new URLSearchParams())}
              className="no-underline"
            >
              <Tag>{t}</Tag>
            </a>
          ))}
        </div>
      )}
      <Section title="Backs">
        {r.backs.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {r.backs.map((b) => (
              <li key={`${b.set}:${b.line}`} className="flex flex-col gap-0.5">
                <span className="text-[12.5px] text-(--ui-ink-3)">
                  <code>{b.line}</code> in {b.setTitle}
                </span>
                <span className="text-[14px] leading-normal text-pretty">{b.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[13.5px] text-(--ui-ink-3)">No rule line cites it yet.</p>
        )}
      </Section>
      {(r.hook || r.cta) && (
        <Section title="Breakdown">
          {r.hook && (
            <p className="m-0 text-[14px] leading-normal">
              <span className="text-(--ui-ink-3)">
                Hook{r.hookStyle ? ` (${r.hookStyle})` : ""}:{" "}
              </span>
              {r.hook}
            </p>
          )}
          {r.cta && (
            <p className="m-0 text-[14px] leading-normal">
              <span className="text-(--ui-ink-3)">Call to action: </span>
              {r.cta}
            </p>
          )}
          {r.beats.length > 0 && (
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {r.beats.map((b) => (
                <li key={`${b.t}:${b.beat}`} className="flex gap-2 text-[13.5px] leading-normal">
                  <span className="flex-none text-(--ui-ink-3) tabular-nums">{clock(b.t)}</span>
                  <span>{b.beat}</span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      )}
      {(r.caption || r.transcript) && (
        <details className="group">
          <summary className="cursor-pointer text-[13.5px] text-(--ui-ink-2)">
            Caption and transcript
          </summary>
          <div className="mt-2 flex flex-col gap-3 text-[13.5px] leading-normal whitespace-pre-line wrap-anywhere">
            {r.caption && <p className="m-0">{r.caption}</p>}
            {r.transcript && <p className="m-0 text-(--ui-ink-2)">{r.transcript}</p>}
          </div>
        </details>
      )}
    </div>
  );
}
