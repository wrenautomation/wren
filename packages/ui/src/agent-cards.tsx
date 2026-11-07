/**
 * The agent's cards in a turn (designs/2026-11-04-multi-user-runtime.md, Decision 9): its options
 * as buttons (AskUserQuestion) and the web addresses a person sent.
 */
import type { DataMessagePartProps } from "@assistant-ui/react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { tokens } from "./agent-steps.js";
import type { AgentQuestion, AgentThreadProps, ChoicesData, CompactData } from "./agent-thread.js";
import { Button, Tag } from "./controls.js";
import { useLoad } from "./data/query.js";
import { cx } from "./format.js";
import { Icon } from "./icons.js";
import { Video } from "./video.js";

export const Answer = createContext<AgentThreadProps["onAnswer"]>(() => {});

/** A card sends a turn: the words go out as the person's own. */
export const Say = createContext<(text: string) => void>(() => {});

/** A page's head as the portal reads it (`/api/unfurl`); images are `data:` URLs. */
export interface LinkPreview {
  title?: string | undefined;
  line?: string | undefined;
  image?: string | undefined;
  icon?: string | undefined;
}

/** The host app's preview read; none = bare cards. */
export const Preview = createContext<((href: string) => Promise<LinkPreview>) | undefined>(
  undefined,
);
const PREVIEWS = {};
const HOUR = 3_600_000;

/** The CLI's result line: `"<question>"="<answer>"` per question. */
const PICKED = /"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g;

export function answersOf(result: string | undefined): Record<string, string> | null {
  if (!result) return null;
  const out: Record<string, string> = {};
  const plain = (x: string) => x.replace(/\\(.)/g, "$1");
  for (const [, q, a] of result.matchAll(PICKED))
    if (q && a !== undefined) out[plain(q)] = plain(a);
  return Object.keys(out).length ? out : null;
}

// trailing punctuation is the sentence's, not the address's; a ")" only when unmatched
const URL_IN = /https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?\]]/g;

/** The web addresses in a turn, once each, as cards (a guard cap only). */
export function linksIn(text: string): URL[] {
  const out = new Map<string, URL>();
  for (let [m] of text.matchAll(URL_IN)) {
    while (m.endsWith(")") && m.split(")").length > m.split("(").length) m = m.slice(0, -1);
    try {
      const u = new URL(m);
      if (!out.has(u.href)) out.set(u.href, u);
    } catch {}
    if (out.size >= 12) break;
  }
  return [...out.values()];
}

/** A web address in a turn: its page's image, title and line when read, else its site and path;
 * opens in a new tab. */
export function LinkCard({ url, preview }: { url: URL; preview?: LinkPreview | undefined }) {
  const read = useContext(Preview);
  const load = useLoad<LinkPreview>(
    read && !preview ? url.href : null,
    () => (read ? read(url.href) : Promise.resolve({})),
    PREVIEWS,
    { freshMs: HOUR },
  );
  const p: LinkPreview = preview ?? load.data ?? {};
  const host = url.host.replace(/^www\./, "");
  const path = `${url.pathname === "/" ? "" : url.pathname}${url.search}`;
  const mark = p.icon ? (
    <img src={p.icon} alt="" className="size-4 flex-none rounded-[3px] object-contain" />
  ) : (
    <Icon name="globe" size={p.title ? 14 : 16} />
  );
  const out = (
    <>
      <Icon name="external" size={13} className="flex-none text-(--ui-ink-3)" />
      <span className="sr-only">, opens in a new tab</span>
    </>
  );
  const link =
    "group max-w-[85%] rounded-[12px] bg-(--ui-paper) no-underline shadow-[inset_0_0_0_1px_var(--ui-hair)] transition-colors duration-150 hover:bg-(--ui-hover)";
  if (p.image)
    return (
      <a
        href={url.href}
        target="_blank"
        rel="noreferrer noopener"
        className={cx(link, "grid w-[min(22rem,85%)] overflow-hidden")}
      >
        <img
          src={p.image}
          alt=""
          className="aspect-[1.91] w-full bg-(--ui-fill) object-cover [animation:ui-fade_.3s_both]"
        />
        <span className="grid gap-1 px-3.5 pt-2.5 pb-3 leading-tight">
          <span className="flex items-center gap-1.5 text-[12px] text-(--ui-ink-3)">
            {mark}
            <span className="min-w-0 flex-1 wrap-anywhere">{host}</span>
            {out}
          </span>
          {p.title ? (
            <span className="text-[14px]/[1.35] font-medium text-(--ui-ink) wrap-anywhere">
              {p.title}
            </span>
          ) : null}
          {p.line ? (
            <span className="text-[12.5px]/[1.45] text-(--ui-ink-2) wrap-anywhere">{p.line}</span>
          ) : null}
        </span>
      </a>
    );
  return (
    <a
      href={url.href}
      target="_blank"
      rel="noreferrer noopener"
      className={cx(link, "flex items-center gap-3 py-2 pr-3.5 pl-2")}
    >
      <span className="grid size-9 flex-none place-items-center rounded-[8px] bg-(--ui-fill) text-(--ui-ink-2)">
        {mark}
      </span>
      <span className="grid min-w-0 leading-tight">
        <span className="text-[13.5px] font-medium text-(--ui-ink) wrap-anywhere">
          {p.title ?? host}
        </span>
        {p.title || path ? (
          <span className="text-[12.5px] text-(--ui-ink-3) wrap-anywhere">
            {p.title ? `${host}${path}` : path}
          </span>
        ) : null}
      </span>
      {out}
    </a>
  );
}

// an absolute or ~/ path to an image or video, as a turn names it (bare, quoted or in backticks)
const MEDIA_PATH =
  /(?:^|[\s`'"([])((?:~\/|\/)[^\s`'"()<>[\]]*\.(?:png|jpe?g|gif|webp|avif|svg|mp4|m4v|mov|webm))(?=$|[\s`'"),.;:!?\]])/gi;

/** The image and video paths in a turn, once each (a guard cap only). */
function pathsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(MEDIA_PATH)) {
    if (m[1]) out.add(m[1]);
    if (out.size >= 8) break;
  }
  return [...out];
}

/** The host app's file read by path (the relay's Mac); none = no file previews. */
export const FileRead = createContext<((path: string) => Promise<Blob>) | undefined>(undefined);
const FILES = {};

/** The images and videos a turn names by path, each under its path; one the host refuses shows
 * nothing. */
export function FilePreviews({ text, end }: { text: string; end?: boolean | undefined }) {
  const read = useContext(FileRead);
  const paths = useMemo(() => (read ? pathsIn(text) : []), [read, text]);
  if (!read || !paths.length) return null;
  return (
    <div className={cx("flex max-w-full flex-wrap gap-2 empty:hidden", end && "justify-end")}>
      {paths.map((p) => (
        <FilePreview key={p} path={p} read={read} />
      ))}
    </div>
  );
}

function FilePreview({ path, read }: { path: string; read: (path: string) => Promise<Blob> }) {
  const load = useLoad<Blob>(path, () => read(path), FILES, { freshMs: 60_000 });
  const blob = load.data;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setSrc(u);
    return () => {
      URL.revokeObjectURL(u);
      setSrc(null);
    };
  }, [blob]);
  if (!src || !blob) return null;
  const name = path.split("/").pop() ?? path;
  const media = "block max-h-80 max-w-full rounded-[10px] bg-(--ui-fill)";
  return (
    <figure className="ui-rise m-0 grid max-w-[min(100%,28rem)] justify-items-start gap-1.5">
      {blob.type.startsWith("video/") ? (
        <Video src={src} className="w-full" />
      ) : (
        <a href={src} target="_blank" rel="noreferrer noopener" className="block">
          <img
            src={src}
            alt={name}
            className={cx(media, "shadow-[inset_0_0_0_1px_var(--ui-hair)]")}
          />
        </a>
      )}
      <figcaption className="font-mono text-[11.5px] text-(--ui-ink-3) wrap-anywhere">
        {path}
      </figcaption>
    </figure>
  );
}

/** The agent's options as a card (AskUserQuestion). One question with one pick sends on the click;
 * else pick, then Send. Once answered it stays, the pick marked. */
export function Choices(props: DataMessagePartProps<ChoicesData>) {
  // the part state's own union widens data to any
  const data: ChoicesData = props.data;
  const answer = useContext(Answer);
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string | undefined>>({});
  const card = useRef<HTMLDivElement>(null);
  // input still streaming or malformed: nothing to pick yet
  if (!data.questions.length) return null;
  const one = data.questions.length === 1 && !data.questions[0]?.multiSelect;
  const pickOf = (q: AgentQuestion, p = picks, o = other) => {
    const typed = o[q.question]?.trim();
    if (typed !== undefined && !q.multiSelect) return typed;
    return [...(p[q.question] ?? []), ...(typed ? [typed] : [])].join(", ");
  };
  const ready = data.questions.every((q) => !!pickOf(q));
  const send = (p = picks, o = other) =>
    answer(
      data.id,
      true,
      Object.fromEntries(data.questions.map((q) => [q.question, pickOf(q, p, o)])),
    );
  const pick = (q: AgentQuestion, label: string) => {
    const was = picks[q.question] ?? [];
    const next = {
      ...picks,
      [q.question]: q.multiSelect
        ? was.includes(label)
          ? was.filter((x) => x !== label)
          : [...was, label]
        : [label],
    };
    const o = q.multiSelect ? other : { ...other, [q.question]: undefined };
    setPicks(next);
    setOther(o);
    if (one) {
      send(next, o);
      // the box takes the keys again, where the next words go
      card.current?.closest("[data-agent-thread]")?.querySelector("textarea")?.focus();
    }
  };
  return (
    <div ref={card} className="ui-rise grid gap-5">
      {data.questions.map((q) => {
        const final = data.answers?.[q.question];
        const chosen = (label: string) =>
          final !== undefined
            ? final === label || final.split(", ").includes(label)
            : (picks[q.question] ?? []).includes(label);
        // the person's own words: what the answer holds past the option labels
        const own =
          final === undefined
            ? undefined
            : (q.multiSelect
                ? final.split(", ").filter((x) => !q.options.some((o) => o.label === x))
                : q.options.some((o) => o.label === final)
                  ? []
                  : [final]
              ).join(", ") || undefined;
        const typing = other[q.question] !== undefined;
        return (
          <fieldset
            key={q.question}
            disabled={!data.open}
            className="m-0 grid gap-2 border-0 p-0"
            onKeyDown={(e) => {
              // 1-9 picks, as in the terminal
              const o = q.options[Number(e.key) - 1];
              if (!o || e.target instanceof HTMLInputElement) return;
              e.preventDefault();
              pick(q, o.label);
            }}
          >
            <legend className="mb-2 grid gap-0.5 p-0">
              {q.header ? (
                <span className="text-[12px] font-semibold text-(--ui-ink-3)">{q.header}</span>
              ) : null}
              <span className="text-[14.5px]/[1.45] font-semibold text-(--ui-ink)">
                {q.question}
              </span>
            </legend>
            {q.options.map((o, k) => {
              const on = chosen(o.label);
              return (
                <button
                  key={o.label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(q, o.label)}
                  className={cx(
                    "group/opt flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-[background-color,color,box-shadow,transform] duration-150 enabled:active:scale-[.99]",
                    on
                      ? "bg-(--ui-fill) text-(--ui-ink) shadow-[inset_0_0_0_1.5px_var(--ui-ink-2)]"
                      : "bg-(--ui-paper) text-(--ui-ink) shadow-[inset_0_0_0_1px_var(--ui-hair),0_1px_2px_rgb(0_0_0/.04)] enabled:hover:shadow-[inset_0_0_0_1px_var(--ui-ink-3),0_1px_2px_rgb(0_0_0/.06)]",
                    !data.open && !on && "text-(--ui-ink-2)",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      "grid size-5.5 flex-none place-items-center rounded-[6px] font-mono text-[11.5px] tabular-nums",
                      on ? "bg-(--ui-ink) text-(--ui-paper)" : "bg-(--ui-fill) text-(--ui-ink-2)",
                    )}
                  >
                    {on && !data.open ? <Icon name="check" size={12} /> : k + 1}
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="text-[14px] font-medium wrap-anywhere">{o.label}</span>
                    {o.description ? (
                      <span className={cx("text-[12.5px]/[1.45]", "text-(--ui-ink-3)")}>
                        {o.description}
                      </span>
                    ) : null}
                  </span>
                  {data.open ? (
                    <Icon
                      name="arrow"
                      size={15}
                      className="flex-none transition-transform duration-150 group-enabled/opt:group-hover/opt:translate-x-0.5"
                    />
                  ) : null}
                </button>
              );
            })}
            {own !== undefined ? (
              <p className="m-0 flex items-start gap-2 rounded-[10px] bg-(--ui-fill) px-3 py-2.5 text-[14px] text-(--ui-ink) shadow-[inset_0_0_0_1.5px_var(--ui-ink-2)]">
                <span className="min-w-0 flex-1 wrap-anywhere">{own}</span>
                <Icon name="check" size={15} className="mt-0.5 flex-none text-(--ui-ink)" />
              </p>
            ) : data.open ? (
              typing ? (
                <input
                  // edit-ok: one answer, sent at once to a live ask
                  // biome-ignore lint/a11y/noAutofocus: opened by its own click
                  autoFocus
                  aria-label={`Your own answer: ${q.question}`}
                  placeholder="Your own answer"
                  value={other[q.question] ?? ""}
                  onChange={(e) => {
                    setOther({ ...other, [q.question]: e.target.value });
                    if (!q.multiSelect) setPicks({ ...picks, [q.question]: [] });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && ready) send();
                    if (e.key === "Escape") setOther({ ...other, [q.question]: undefined });
                  }}
                  className="h-10 rounded-[10px] border-0 bg-(--ui-paper) px-3 text-[14px] text-(--ui-ink) shadow-[inset_0_0_0_1.5px_var(--ui-focus)] outline-none placeholder:text-(--ui-ink-3)"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setOther({ ...other, [q.question]: "" })}
                  className="justify-self-start rounded-(--ui-radius) px-1 py-1 text-[13.5px] text-(--ui-ink-3) hover:text-(--ui-ink)"
                >
                  Something else…
                </button>
              )
            ) : null}
          </fieldset>
        );
      })}
      {data.open ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button tone="quiet" size="dense" onClick={() => answer(data.id, false)}>
            Skip
          </Button>
          {one && !Object.values(other).some((v) => v !== undefined) ? null : (
            <Button size="dense" disabled={!ready} onClick={() => send()}>
              Send
            </Button>
          )}
        </div>
      ) : data.skipped ? (
        <Tag className="justify-self-start">Skipped</Tag>
      ) : null}
    </div>
  );
}

/** A rule across the thread where the context compacted; the turn's Working line covers it live. */
export function Compacted(props: DataMessagePartProps<CompactData>) {
  const d: CompactData = props.data;
  if (d.state === "live") return null;
  const failed = d.state === "failed";
  const what = failed
    ? `Compaction failed${d.error ? `: ${d.error}` : ""}`
    : `${d.trigger === "auto" ? "Auto-compacted" : "Compacted"}${
        d.before ? `: ${tokens(d.before)} to ${tokens(d.after ?? 0)} tokens` : ""
      }`;
  return (
    <p className="m-0 flex items-center gap-3 py-1 text-[12px] [animation:ui-fade_.2s_both]">
      <span aria-hidden className="h-px flex-1 bg-(--ui-hair)" />
      <span
        className={cx("max-w-[80%] text-center", failed ? "text-(--ui-bad)" : "text-(--ui-ink-3)")}
      >
        {what}
      </span>
      <span aria-hidden className="h-px flex-1 bg-(--ui-hair)" />
    </p>
  );
}
