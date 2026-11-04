/**
 * The agent's cards in a turn (designs/2026-11-04-multi-user-runtime.md, Decision 9): its options
 * as buttons (AskUserQuestion) and the web addresses a person sent.
 */
import type { DataMessagePartProps } from "@assistant-ui/react";
import { createContext, useContext, useState } from "react";
import type { AgentQuestion, AgentThreadProps, ChoicesData } from "./agent-thread.js";
import { Button, Tag } from "./controls.js";
import { cx } from "./format.js";
import { Icon } from "./icons.js";

export const Answer = createContext<AgentThreadProps["onAnswer"]>(() => {});

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

/** A web address in a turn: its site, then its path; opens in a new tab. */
export function LinkCard({ url }: { url: URL }) {
  const path = `${url.pathname === "/" ? "" : url.pathname}${url.search}`;
  return (
    <a
      href={url.href}
      target="_blank"
      rel="noreferrer noopener"
      className="flex max-w-[85%] items-center gap-3 rounded-[12px] bg-(--ui-paper) py-2 pr-3.5 pl-2 no-underline shadow-[inset_0_0_0_1px_var(--ui-hair)] transition-colors duration-150 hover:bg-(--ui-hover)"
    >
      <span className="grid size-9 flex-none place-items-center rounded-[8px] bg-(--ui-fill) text-(--ui-ink-2)">
        <Icon name="globe" size={16} />
      </span>
      <span className="grid min-w-0 leading-tight">
        <span className="text-[13.5px] font-medium text-(--ui-ink) wrap-anywhere">
          {url.host.replace(/^www\./, "")}
        </span>
        {path ? (
          <span className="text-[12.5px] text-(--ui-ink-3) wrap-anywhere">{path}</span>
        ) : null}
      </span>
      <Icon name="external" size={13} className="flex-none text-(--ui-ink-3)" />
      <span className="sr-only">, opens in a new tab</span>
    </a>
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
    if (one) send(next, o);
  };
  return (
    <div className="ui-rise grid gap-5 rounded-(--ui-leaf-box) bg-(--ui-paper) p-4 shadow-[inset_0_0_0_1px_var(--ui-hair)]">
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
          <fieldset key={q.question} disabled={!data.open} className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-2 grid gap-0.5 p-0">
              {q.header ? (
                <span className="text-[12px] font-semibold text-(--ui-ink-3)">{q.header}</span>
              ) : null}
              <span className="text-[14.5px]/[1.45] font-semibold text-(--ui-ink)">
                {q.question}
              </span>
            </legend>
            {q.options.map((o) => (
              <button
                key={o.label}
                type="button"
                aria-pressed={chosen(o.label)}
                onClick={() => pick(q, o.label)}
                className={cx(
                  "grid gap-0.5 rounded-[10px] px-3 py-2.5 text-left shadow-[inset_0_0_0_1px_var(--ui-hair)] transition-[background-color,box-shadow] duration-150 enabled:hover:bg-(--ui-hover) aria-pressed:bg-(--ui-wash) aria-pressed:shadow-[inset_0_0_0_1.5px_var(--ui-active)]",
                )}
              >
                <span
                  className={cx(
                    "flex items-center gap-2 text-[14px] font-medium",
                    // answered: the pick in ink, the rest a step back
                    !data.open && !chosen(o.label) ? "text-(--ui-ink-2)" : "text-(--ui-ink)",
                  )}
                >
                  <span className="min-w-0 flex-1 wrap-anywhere">{o.label}</span>
                  {chosen(o.label) ? (
                    <Icon name="check" size={15} className="flex-none text-(--ui-active)" />
                  ) : null}
                </span>
                {o.description ? (
                  <span className="text-[13px]/[1.45] text-(--ui-ink-3)">{o.description}</span>
                ) : null}
              </button>
            ))}
            {own !== undefined ? (
              <p className="m-0 flex items-start gap-2 rounded-[10px] bg-(--ui-wash) px-3 py-2.5 text-[14px] text-(--ui-ink) shadow-[inset_0_0_0_1.5px_var(--ui-active)]">
                <span className="min-w-0 flex-1 wrap-anywhere">{own}</span>
                <Icon name="check" size={15} className="mt-0.5 flex-none text-(--ui-active)" />
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
          <Button tone="quiet" size="sm" onClick={() => answer(data.id, false)}>
            Skip
          </Button>
          {one && !Object.values(other).some((v) => v !== undefined) ? null : (
            <Button size="sm" disabled={!ready} onClick={() => send()}>
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
