/**
 * Ask: questions to Claude Code about the system, newest first, each with its answer. Claude
 * Code runs on William's Mac, read only: code, designs and prod through read-only SQL. ⌘K asks
 * from any page and lands here; while one is thinking the list checks again every few seconds.
 */
import type { RecordsPage } from "@wren/core/records/serve";
import { Alert, Button, Empty, Loading, PageHeader, Tag, Textarea } from "@wren/ui";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { navigate } from "../../route.js";
import { sourceOf } from "./cite.js";

const POLL_MS = 4000;
const STATES = {
  thinking: { label: "Thinking", tone: "neutral" },
  answered: { label: "Answered", tone: "green" },
  failed: { label: "Failed", tone: "rust" },
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

/** Ask Claude Code `question`, as asked from `page`, then show the thread. */
export async function askClaude(question: string, page: string) {
  await call("console/question", { question, page });
  navigate("/ask/questions");
}

export function Ask() {
  const list = useCall("console.ask", () =>
    call<RecordsPage>("console/recordsList", { record: "console.ask", view: "all", limit: 50 }),
  );
  const [q, setQ] = useState("");
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
      await call("console/question", { question: q.trim(), page: "/ask/questions" });
      setQ("");
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
        lede="Claude Code on William's Mac answers from the code, the designs and prod, read only. ⌘K asks from any page."
      />
      <form onSubmit={submit} className="mb-6 flex flex-col gap-2">
        <Textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e);
          }}
          placeholder="How many replies came in this week, and from which campaign?"
          rows={3}
          aria-label="Your question"
        />
        <div className="flex items-center gap-3">
          <Button type="submit" busy={busy} disabled={!q.trim()}>
            Ask
          </Button>
          {error ? <span className="text-[13px] text-(--ui-bad)">{error}</span> : null}
        </div>
      </form>
      {list.error && !list.data ? (
        <Alert onRetry={list.retry}>{list.error.message}</Alert>
      ) : !list.data ? (
        <Loading lines={4} />
      ) : !list.data.rows.length ? (
        <Empty>Nothing asked yet.</Empty>
      ) : (
        <ol className="flex list-none flex-col gap-4 p-0">
          {list.data.rows.map((r) => {
            const s = STATES[r.state as keyof typeof STATES] ?? STATES.failed;
            return (
              <li key={r.id} className="border-(--ui-hair) border-t pt-4">
                <p className="font-medium text-(--ui-ink)">{String(r.question)}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-(--ui-ink-3)">
                  <Tag tone={s.tone} dot>
                    {s.label}
                  </Tag>
                  <span>{String(r.by)}</span>
                  {r.page ? (
                    <a href={String(r.page)} className="hover:text-(--ui-ink)">
                      from {String(r.page)}
                    </a>
                  ) : null}
                  {typeof r.asked === "string" ? (
                    <time dateTime={r.asked}>{new Date(r.asked).toLocaleString()}</time>
                  ) : null}
                  {r.took !== null ? <span>{String(r.took)}s</span> : null}
                </p>
                {r.answer ? (
                  <p className="mt-2 whitespace-pre-wrap text-[14px] text-(--ui-ink-2) wrap-anywhere">
                    <Answer text={String(r.answer)} />
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
