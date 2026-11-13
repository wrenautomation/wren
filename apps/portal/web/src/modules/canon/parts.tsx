/**
 * Canon's shared parts: the search box, a filter select, a titled section, and Markdown with Canon's cites: `[n]` links to the record it names.
 */
import type { Link } from "@wren/research/canon-library";
import { cx, GROUP_LABEL } from "@wren/ui";
import { type ReactNode, useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { SELECT } from "../work/bits.js";

export function Search({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    // edit-ok: search box, applied on Enter and on blur
    <input
      type="search"
      aria-label={label}
      placeholder={placeholder}
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

export function Pick({
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

export function Section({
  title,
  id,
  about,
  children,
}: {
  title: string;
  id?: string;
  /** one line under the label: what this part is */
  about?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-4 flex-col gap-1.5">
      <h3 className={cx("m-0", GROUP_LABEL)}>{title}</h3>
      {about && <p className="m-0 -mt-1 text-[13px] text-pretty text-(--ui-ink-3)">{about}</p>}
      {children}
    </section>
  );
}

// `[3]`, `[3 at 2:10]`: a cite by its place in the record's list; not a link already
const CITE = /\[(\d+)((?: [^\]\n]*)?)\](?![(:])/g;
const NOTES = /\[notes\](?![(:])/g;

/** Canon's markdown with each `[n]` as a link to the record it names. */
function citeLinks(text: string): string {
  return text
    .replace(CITE, (_, n: string, rest: string) => `[\\[${n}${rest}\\]](#cite-${n})`)
    .replace(NOTES, "[\\[notes\\]](#notes)");
}

const MD: Components = {
  h1: ({ children }) => (
    <h2 className="mt-2 mb-1 text-[20px] leading-snug font-semibold text-pretty">{children}</h2>
  ),
  h2: ({ children }) => (
    <h3 className="mt-4 mb-1 text-[16.5px] leading-snug font-semibold text-pretty">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-3 mb-0.5 text-[14.5px] leading-snug font-semibold">{children}</h4>
  ),
  h4: ({ children }) => <h5 className="mt-2 mb-0 text-[14px] font-semibold">{children}</h5>,
  p: ({ children }) => <p className="my-1.5 text-pretty">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 flex list-disc flex-col gap-1 pl-5">{children}</ul>,
  ol: ({ children }) => (
    <ol className="my-1.5 flex list-decimal flex-col gap-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 bg-(--ui-band) px-3 py-1 [border-radius:4px_10px_4px_10px]">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => (
    <code className={cx("text-[0.92em] wrap-anywhere", className)}>{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto bg-(--ui-band) p-3 text-[12.5px] leading-normal [border-radius:4px_10px_4px_10px]">
      {children}
    </pre>
  ),
  // table-ok: a markdown file's own table, drawn as written
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-(--ui-hair) px-2 py-1 text-left align-bottom font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-(--ui-hair) px-2 py-1 align-top">{children}</td>
  ),
  hr: () => <hr className="my-3 border-0 border-t border-(--ui-hair)" />,
};

/**
 * Markdown, whole. `cites`: the record's list, so `[n]` opens the record it names (`open` makes the
 * link). `notes`: where `[notes]` goes (the topic's notes), when there is one.
 */
export function Markdown({
  text,
  cites,
  open,
  notes,
  className,
}: {
  text: string;
  cites?: readonly Link[];
  open?: (id: string) => string;
  notes?: string;
  className?: string;
}) {
  const a: Components["a"] = ({ href: to, children }) => {
    const n = /^#cite-(\d+)$/.exec(to ?? "")?.[1];
    if (n) {
      const c = cites?.[Number(n) - 1];
      if (!c || !open)
        return <span className="whitespace-nowrap text-(--ui-ink-3)">{children}</span>;
      return (
        <a
          href={open(c.id)}
          title={c.title ?? c.id}
          className="text-[0.88em] whitespace-nowrap no-underline"
        >
          {children}
        </a>
      );
    }
    if (to === "#notes")
      return notes ? (
        <a href={notes} className="text-[0.88em] no-underline">
          {children}
        </a>
      ) : (
        <span className="text-(--ui-ink-3)">{children}</span>
      );
    const outside = /^https?:/.test(to ?? "");
    return (
      <a
        href={to}
        {...(outside ? { target: "_blank", rel: "noreferrer" } : {})}
        className="wrap-anywhere"
      >
        {children}
      </a>
    );
  };
  return (
    <div className={cx("text-[14px] leading-normal wrap-anywhere", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ ...MD, a }}>
        {citeLinks(text)}
      </ReactMarkdown>
    </div>
  );
}

export const VIDEO_KINDS = new Set(["reel", "video", "short"]);

/** A body without its leading `# title` line: the page or panel already shows the title. */
export const withoutTitle = (text: string) => text.replace(/^#\s[^\n]*\n+/, "");

/** A markdown file's frontmatter (null when none) and the rest. */
export function splitFrontmatter(text: string): { head: string | null; body: string } {
  if (!text.startsWith("---\n")) return { head: null, body: text };
  const end = text.indexOf("\n---", 4);
  if (end < 0) return { head: null, body: text };
  return { head: text.slice(4, end), body: text.slice(end + 4).replace(/^\n+/, "") };
}

const TYPE_NAMES: Record<string, [string, string]> = {
  source: ["Source", "Sources"],
  finding: ["Finding", "Findings"],
  pattern: ["Pattern", "Patterns"],
  verdict: ["Verdict", "Verdicts"],
  rule: ["Rule set", "Rule sets"],
  guide: ["Guide", "Guides"],
  conflict: ["Conflict", "Conflicts"],
};
export const typeName = (t: string | null, many = false) =>
  t ? (TYPE_NAMES[t]?.[many ? 1 : 0] ?? t) : "Missing";
