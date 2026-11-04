/**
 * One chat with a setup, as a page or the shell's panel draws it: the head, the thread, files,
 * and the page the turn is sent from (designs/2026-11-04-multi-user-runtime.md, Decisions 6, 7).
 */
import { AgentThread, Loading, Seg } from "@wren/ui";
import { useEffect, useRef, useState } from "react";
import type { SetupInfo } from "./connect.js";
import { ACCEPT } from "./files.js";
import { useAgent } from "./use-agent.js";

const MODEL: Record<string, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" };

const WELCOME: Record<string, { title: string; text: string; suggestions: readonly string[] }> = {
  birdwatch: {
    title: "What should I research?",
    text: "The agent plans the research with birdwatch, runs it, and answers with sources. Each step shows as it runs. Add a file, a picture or a video and it reads that too.",
    suggestions: [
      "What did the last birdwatch run find?",
      "What do dental clinics pay for patient reactivation?",
      "Find benchmarks for cold email reply rates in 2026.",
      "Which CRMs do small law firms use most?",
    ],
  },
};

/** The model pick, in the box's foot. */
export function ModelPick({
  setup,
  value,
  onChange,
}: {
  setup: SetupInfo;
  value: string;
  onChange: (m: string) => void;
}) {
  return (
    <Seg
      label="Model"
      dense
      items={setup.models.map((m) => ({ value: m, label: MODEL[m] ?? m }))}
      value={value}
      onChange={onChange}
    />
  );
}

export function AgentChat({
  setup,
  chat,
  model,
  head,
  tools,
  page,
  onSession,
  onIdle,
  onRunning,
  className,
}: {
  setup: SetupInfo;
  chat: string | null;
  model: string;
  /** The chat's head; `first` is the opening question, the title until the list has one. */
  head?: (first: string | undefined) => React.ReactNode;
  tools?: React.ReactNode;
  /** The page open beside the chat: a chip in the box, and a line in the turn. */
  page?: string | undefined;
  onSession: (id: string) => void;
  /** A turn ended: the chat's title and time change in the list. */
  onIdle?: () => void;
  onRunning?: (running: boolean) => void;
  className?: string;
}) {
  const a = useAgent({ setup: setup.name, session: chat, model, onSession });
  const was = useRef(a.running);
  const idle = useRef(onIdle);
  idle.current = onIdle;
  const busy = useRef(onRunning);
  busy.current = onRunning;
  useEffect(() => {
    if (was.current && !a.running) idle.current?.();
    was.current = a.running;
    busy.current?.(a.running);
  }, [a.running]);
  // a page dropped from the box stays dropped until another page opens
  const [dropped, setDropped] = useState<string | null>(null);
  const sendPage = page && page !== dropped ? page : undefined;
  const one = a.messages.find((m) => m.role === "user")?.parts[0];
  const first = one?.type === "text" ? one.text : undefined;
  if (a.loading)
    return (
      <>
        {head?.(undefined)}
        <div className="mx-auto w-full max-w-[46rem] px-4 pt-6">
          <Loading shape="rows" lines={3} />
        </div>
      </>
    );
  const w = WELCOME[setup.name];
  return (
    <>
      {head?.(first)}
      <AgentThread
        className={className ?? "min-h-0 flex-1 [animation:ui-fade_.2s_both]"}
        stale={a.stale}
        messages={a.messages}
        running={a.running}
        starting={a.starting}
        error={a.error}
        onSend={(text, files) => a.send(text, files, sendPage)}
        files={{ accept: ACCEPT, ready: a.ready }}
        context={sendPage ? { label: sendPage, onDrop: () => setDropped(sendPage) } : null}
        onStop={a.stop}
        onAnswer={a.answer}
        placeholder={setup.name === "birdwatch" ? "Ask a research question" : "Ask the agent"}
        tools={tools}
        welcome={w ?? { title: `Ask ${setup.title}` }}
        note={`Claude agent${a.plan === false ? " on an API key" : a.plan ? " on your Claude plan" : ""} · ${setup.tools.filter((t) => t !== "AskUserQuestion").join(", ")}`}
      />
    </>
  );
}
