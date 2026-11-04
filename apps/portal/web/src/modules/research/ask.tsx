/**
 * Ask birdwatch (designs/2026-11-04-multi-user-runtime.md, WA-1053): a Claude agent with the
 * birdwatch skill, on this Mac's relay. The page fills the window: past chats on the left (only
 * the asker's own), the chat on the right with the setup at its head and the model in the box.
 */
import { AgentThread, Alert, Button, cx, Empty, Loading, relative, Seg } from "@wren/ui";
import { useEffect, useRef, useState } from "react";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate, useRoute } from "../../route.js";
import { relaySessions, relaySetups, type SessionRow, type SetupInfo } from "../agent/connect.js";
import { closeText } from "../agent/thread.js";
import { pageToken, useAgent } from "../agent/use-agent.js";

const MODEL: Record<string, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" };

/** Prompts per setup: the read-only one reads past runs, the full one starts new research. */
const SUGGEST: Record<string, readonly string[]> = {
  "birdwatch-read": [
    "What did the last birdwatch run find?",
    "List the open research runs and where each stopped.",
    "Which sources did the newest run read?",
    "Summarize the findings with their quotes.",
  ],
  birdwatch: [
    "What do dental clinics pay for patient reactivation?",
    "Find benchmarks for cold email reply rates in 2026.",
    "Which CRMs do small law firms use most?",
    "What do sources say about AI receptionists for clinics?",
  ],
};

export function AskPage({ params }: PageProps) {
  const here = `/${useRoute().path.join("/")}`;
  const setups = useCall("agent:setups", () => relaySetups(), { kept: false });
  const mine = (setups.data ?? []).filter((s) => s.app === "research");
  const setup = mine.find((s) => s.name === params.get("setup")) ?? mine[0];
  const chat = params.get("chat");
  // kept on the device: the list paints at once, and reads again behind itself
  const sessions = useCall(setup ? `agent:sessions:${setup.name}` : null, async () =>
    relaySessions(setup?.name ?? "", await pageToken()),
  );
  const go = (p: Record<string, string | null>, replace = false) =>
    navigate(href(here, p, params), replace);
  // narrow windows: the list folds so the chat keeps the screen
  const [list, setList] = useState(false);

  if (setups.error && !setups.data) {
    const c = closeText(setups.error);
    return (
      <Alert onRetry={c.retry ? setups.retry : undefined} className="max-w-xl">
        {c.text}
      </Alert>
    );
  }
  if (!setup)
    return setups.data ? (
      <Empty>No research setup on this Mac's agent.</Empty>
    ) : (
      <Loading shape="rows" lines={4} />
    );

  const rows = sessions.data ?? [];
  const model = params.get("model") ?? setup.model;
  const stored = chat ? rows.find((r) => r.session === chat)?.title : undefined;
  return (
    <div className="grid min-h-0 flex-1 gap-5 min-[1000px]:grid-cols-[248px_minmax(0,1fr)]">
      <nav aria-label="Chats" className="flex min-h-0 flex-col gap-3 max-[999px]:max-h-[40dvh]">
        <div className="flex gap-2">
          <Button tone="secondary" icon="plus" onClick={() => go({ chat: null })}>
            New chat
          </Button>
          <Button
            tone="quiet"
            icon="list"
            aria-expanded={list}
            className="min-[1000px]:hidden"
            onClick={() => setList(!list)}
          >
            {list ? "Hide chats" : `Chats${rows.length ? ` (${rows.length})` : ""}`}
          </Button>
        </div>
        <div className={cx("flex min-h-0 flex-col", !list && "max-[999px]:hidden")}>
          {sessions.error && !sessions.data ? (
            <Alert onRetry={sessions.retry}>{closeText(sessions.error).text}</Alert>
          ) : sessions.pending ? (
            <Loading shape="rows" lines={4} />
          ) : rows.length ? (
            <ChatList
              rows={rows}
              open={chat}
              hrefOf={(r) => href(here, { chat: r.session }, params)}
            />
          ) : (
            <p className="m-0 px-2 text-[13px] text-(--ui-ink-3)">No chats yet.</p>
          )}
        </div>
      </nav>
      <section className="flex min-h-0 min-w-0 flex-col max-[999px]:h-[calc(100dvh-220px)] max-[999px]:min-h-[420px]">
        <Chat
          key={setup.name}
          setup={setup}
          chat={chat}
          model={model}
          head={(first) => (
            <header className="flex min-h-9 flex-wrap items-center gap-3 border-(--ui-hair) border-b pb-3">
              <h1 className="m-0 min-w-0 flex-1 text-[15px] font-semibold text-(--ui-ink) wrap-anywhere">
                {stored ?? first ?? (chat ? "Chat" : "New chat")}
              </h1>
              {mine.length > 1 ? (
                <Seg
                  label="Setup"
                  dense
                  items={mine.map((s) => ({ value: s.name, label: s.title }))}
                  value={setup.name}
                  onChange={(v) => go({ setup: v, chat: null, model: null })}
                />
              ) : null}
            </header>
          )}
          tools={
            <Seg
              label="Model"
              dense
              items={setup.models.map((m) => ({ value: m, label: MODEL[m] ?? m }))}
              value={model}
              onChange={(v) => go({ model: v === setup.model ? null : v }, true)}
            />
          }
          onSession={(id) => {
            if (id !== chat) go({ chat: id }, true);
            sessions.retry();
          }}
          onIdle={sessions.retry}
        />
      </section>
    </div>
  );
}

/** The asker's chats, newest first; the open one marked. */
function ChatList({
  rows,
  open,
  hrefOf,
}: {
  rows: readonly SessionRow[];
  open: string | null;
  hrefOf: (r: SessionRow) => string;
}) {
  return (
    <ul className="m-0 grid min-h-0 list-none content-start gap-px overflow-y-auto p-0 [scrollbar-width:thin]">
      {rows.map((r) => (
        <li key={r.session}>
          <a
            href={hrefOf(r)}
            aria-current={r.session === open ? "page" : undefined}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navigate(hrefOf(r));
            }}
            className={cx(
              "grid gap-0.5 rounded-(--ui-radius) px-2.5 py-2 no-underline transition-colors duration-150",
              r.session === open
                ? "bg-(--ui-wash) text-(--ui-ink)"
                : "text-(--ui-ink-2) hover:bg-(--ui-fill) hover:text-(--ui-ink)",
            )}
          >
            <span className="text-[13.5px]/[1.35] wrap-anywhere">{r.title || "Untitled chat"}</span>
            <span className="text-[12px] text-(--ui-ink-3)">{relative(new Date(r.at))}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Chat({
  setup,
  chat,
  model,
  head,
  tools,
  onSession,
  onIdle,
}: {
  setup: SetupInfo;
  chat: string | null;
  model: string;
  /** The chat's head; `first` is the opening question, the title until the list has one. */
  head: (first: string | undefined) => React.ReactNode;
  tools: React.ReactNode;
  onSession: (id: string) => void;
  /** A turn ended: the chat's title and time change in the list. */
  onIdle: () => void;
}) {
  const a = useAgent({ setup: setup.name, session: chat, model, onSession });
  const was = useRef(a.running);
  const idle = useRef(onIdle);
  idle.current = onIdle;
  useEffect(() => {
    if (was.current && !a.running) idle.current();
    was.current = a.running;
  }, [a.running]);
  const one = a.messages.find((m) => m.role === "user")?.parts[0];
  const first = one?.type === "text" ? one.text : undefined;
  if (a.loading)
    return (
      <>
        {head(undefined)}
        <div className="mx-auto w-full max-w-[46rem] pt-6">
          <Loading shape="rows" lines={3} />
        </div>
      </>
    );
  const read = setup.name.endsWith("-read");
  return (
    <>
      {head(first)}
      <AgentThread
        className="min-h-0 flex-1 [animation:ui-fade_.2s_both]"
        stale={a.stale}
        messages={a.messages}
        running={a.running}
        starting={a.starting}
        error={a.error}
        onSend={a.send}
        onStop={a.stop}
        onAnswer={a.answer}
        placeholder="Ask a research question"
        tools={tools}
        welcome={{
          title: read ? "Ask about past research" : "What should I research?",
          text: read
            ? "The agent reads birdwatch's runs and answers from them. It changes nothing."
            : "The agent plans the research with birdwatch, runs it, and answers with sources. Each step shows as it runs.",
          suggestions: SUGGEST[setup.name],
        }}
        note={`Claude agent${a.plan === false ? " on an API key" : a.plan ? " on your Claude plan" : ""} · ${setup.tools.join(", ")}`}
      />
    </>
  );
}
