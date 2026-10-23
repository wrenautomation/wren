/**
 * Ask: questions to Claude Code about the system, newest first, each with its answer. Claude
 * Code runs on William's Mac, read only: code, designs and prod through read-only SQL. ⌘K asks
 * from any page and lands here; while one is thinking the list checks again every few seconds.
 */
import type { RecordsPage, Row } from "@wren/core/records/serve";
import {
  Button,
  DictateField,
  dateTip,
  EditConflict,
  Empty,
  LoadFailed,
  Loading,
  PageHeader,
  Pill,
  relative,
  Textarea,
  UnsavedMark,
  useEdit,
} from "@wren/ui";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { navigate } from "../../route.js";
import { RowsPanel } from "../work/rows-panel.js";
import { sourceOf } from "./cite.js";

const POLL_MS = 4000;
const STATES = {
  thinking: { label: "Thinking", color: "var(--ui-ink-3)" },
  answered: { label: "Answered", color: "var(--ui-good)" },
  failed: { label: "Failed", color: "var(--ui-bad)" },
} as const;

/** The answer as plain text: `code` in mono, a cited file linked, ** dropped. */
function Answer({ text }: { text: string }): ReactNode {
  return text.split(/(`[^`\n]+`)/).map((part, i) => {
    if (!part.startsWith("`")) return part.replaceAll("**", "");
    const code = part.slice(1, -1);
    const href = sourceOf(code);
    return href ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string.
      <a key={i} href={href} target="_blank" rel="noreferrer" className="font-mono text-[12.5px]">
        {code}
      </a>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string.
      <code key={i} className="font-mono text-[12.5px]">
        {code}
      </code>
    );
  });
}

/** Where a question was asked, as a person says it: "/content/drafts" is "Content, drafts". */
function placeOf(page: string): string | null {
  const [app, sub] = page.split(/[?#]/)[0]?.split("/").filter(Boolean) ?? [];
  if (app === "ask") return null;
  if (!app) return "Home";
  const name = (s: string) => decodeURIComponent(s).replaceAll("-", " ");
  const head = name(app);
  return `${head.charAt(0).toUpperCase()}${head.slice(1)}${sub ? `, ${name(sub)}` : ""}`;
}

/** Ask Claude Code `question`, as asked from `page`, then show the thread. */
export async function askClaude(question: string, page: string) {
  await call("console/question", { question, page });
  navigate("/ask/questions");
}

export function Ask() {
  const list = useCall("console.ask", () =>
    call<RecordsPage>("console/recordsList", { record: "console.ask", view: "all", limit: 50 }),
  );
  const ask = useEdit("ask:new:question", "");
  const q = ask.value;
  const box = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thinking = list.data?.rows.some((r) => r.state === "thinking") ?? false;
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new answer sets the next check.
  useEffect(() => {
    if (!thinking) return;
    const t = setTimeout(list.retry, POLL_MS);
    return () => clearTimeout(t);
  }, [list.data]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sent = q;
      await call("console/question", { question: sent.trim(), page: "/ask/questions" });
      // Cleared only if he hasn't typed on meanwhile.
      ask.saved(sent);
      list.retry();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Ask"
        lede="Answers from the code, the designs and prod. Read only. ⌘K asks from any page."
      />
      <form onSubmit={submit} className="mb-6 flex flex-col gap-2">
        <DictateField target={box} label="Dictate your question">
          <Textarea
            ref={box}
            {...ask.field}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e);
            }}
            placeholder="How many replies came in this week, and from which campaign?"
            rows={3}
            aria-label="Your question"
          />
        </DictateField>
        <EditConflict
          conflict={ask.conflict}
          onKeepMine={ask.keepMine}
          onTakeTheirs={ask.takeTheirs}
          what="The question"
        />
        <div className="flex items-center gap-3">
          <Button tone="primary" size="dense" type="submit" busy={busy} disabled={!q.trim()}>
            Ask
          </Button>
          <UnsavedMark edit={ask} />
          {error ? <span className="text-[13px] text-(--ui-bad)">{error}</span> : null}
        </div>
      </form>
      {list.error && !list.data ? (
        <LoadFailed error={list.error} onRetry={list.retry} />
      ) : !list.data ? (
        <Loading shape="rows" lines={4} />
      ) : !list.data.rows.length ? (
        <Empty>Your questions and their answers show here.</Empty>
      ) : (
        <RowsPanel<Row>
          rows={list.data.rows}
          rowKey={(r) => String(r.id)}
          label="questions"
          noun="question"
          // The answer is prose: a box under its question, as a thread's reply sits under a row.
          box={(r) =>
            r.answer ? (
              <p className="m-0 whitespace-pre-wrap text-[14px] text-(--ui-ink-2) wrap-anywhere">
                <Answer text={String(r.answer)} />
              </p>
            ) : null
          }
          name={{ label: "Question", icon: "text", min: 260, title: (r) => String(r.question) }}
          columns={[
            {
              key: "state",
              label: "State",
              icon: "selected",
              width: 120,
              phone: true,
              cell: (r) => {
                const s = STATES[r.state as keyof typeof STATES] ?? STATES.failed;
                return <Pill color={s.color}>{s.label}</Pill>;
              },
            },
            { key: "by", label: "By", icon: "user", width: 130, cell: (r) => String(r.by) },
            {
              key: "from",
              label: "From",
              icon: "link",
              width: 170,
              cell: (r) =>
                r.page && placeOf(String(r.page)) ? (
                  <a href={String(r.page)} className="wrap-anywhere whitespace-normal">
                    {placeOf(String(r.page))}
                  </a>
                ) : null,
            },
            {
              key: "asked",
              label: "Asked",
              icon: "clock",
              width: 130,
              quiet: true,
              cell: (r) =>
                typeof r.asked === "string" ? (
                  <time dateTime={r.asked} {...dateTip(new Date(r.asked))}>
                    {relative(new Date(r.asked))}
                  </time>
                ) : null,
            },
            {
              key: "took",
              label: "Took",
              icon: "hash",
              width: 80,
              quiet: true,
              cell: (r) => (r.took !== null ? `${String(r.took)}s` : ""),
            },
          ]}
        />
      )}
    </>
  );
}
