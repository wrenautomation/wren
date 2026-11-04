/**
 * One chat with a setup, as a page or the shell's panel draws it: the head, the thread, files,
 * and the page the turn is sent from (designs/2026-11-04-multi-user-runtime.md, Decisions 6, 7).
 */
import type { Who } from "@wren/core/access";
import {
  AgentPick,
  AgentStatus,
  AgentTasks,
  AgentThread,
  cx,
  Icon,
  Input,
  Loading,
  modelName,
  type PickOption,
} from "@wren/ui";
import { useEffect, useRef, useState } from "react";
import { linkPreview } from "../../api.js";
import { keep, recall } from "../../local.js";
import { relayFile, relayRename, type SetupInfo } from "./connect.js";
import { ACCEPT } from "./files.js";
import { pageToken, useAgent } from "./use-agent.js";

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

/** The Mac's owner: a Wren admin. The relay decides the same from `delivery/me` (Decision 11). */
export const ownerOf = (who: Who | undefined): boolean =>
  !!who && "team" in who && who.team === "admin";

const EFFORT: readonly PickOption[] = [
  { value: "", label: "Auto effort", hint: "The model's own level" },
  { value: "low", label: "Low", hint: "Fastest, fewest tokens" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max", hint: "Slowest, most thorough" },
];

const MODES: readonly (PickOption & { owner?: boolean })[] = [
  { value: "default", label: "Ask first", hint: "Asks before a tool the setup does not allow" },
  { value: "acceptEdits", label: "Accept edits", hint: "Edits files without asking" },
  { value: "plan", label: "Plan", hint: "Reads and plans; changes nothing" },
  { value: "dontAsk", label: "Don't ask", hint: "Refuses what the setup does not allow" },
  {
    value: "bypassPermissions",
    label: "Bypass",
    hint: "Runs every tool without asking. Owner only",
    warn: true,
    owner: true,
  },
];

const PICKS = "wren.agent.picks";
interface Picks {
  effort: string;
  mode?: string;
}

/** Effort and mode, kept on this device: the owner's mode starts on bypass, as asked 11-04. */
function usePicks(owner: boolean) {
  const [p, setP] = useState<Picks>(() => {
    try {
      return { effort: "", ...(JSON.parse(recall(PICKS) ?? "{}") as Partial<Picks>) };
    } catch {
      return { effort: "" };
    }
  });
  const set = (n: Partial<Picks>) =>
    setP((o) => {
      const v = { ...o, ...n };
      keep(PICKS, JSON.stringify(v));
      return v;
    });
  const modes = MODES.filter((m) => owner || !m.owner);
  const mode =
    modes.find((m) => m.value === p.mode)?.value ?? (owner ? "bypassPermissions" : "default");
  return { effort: p.effort, mode, modes, set };
}

/** The chat's name: a click edits it, Enter saves, Esc leaves it. A new chat has none to edit. */
export function ChatTitle({
  setup,
  chat,
  title,
  onRenamed,
  className,
}: {
  setup: string;
  chat: string | null;
  title: string;
  onRenamed: () => void;
  className?: string;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // a saved name shows at once, before the list reads it back
  const [mine, setMine] = useState<{ chat: string; title: string } | null>(null);
  const shown = mine?.chat === chat ? mine.title : title;
  const text = cx("m-0 min-w-0 text-[15px] font-semibold text-(--ui-ink) wrap-anywhere", className);
  if (!chat) return <h1 className={text}>{title}</h1>;
  const save = async () => {
    const t = (typed ?? "").trim();
    if (!t || t === shown) return setTyped(null);
    setBusy(true);
    try {
      await relayRename(setup, chat, await pageToken(), t);
      setMine({ chat, title: t });
      setTyped(null);
      setError(null);
      onRenamed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (typed !== null)
    return (
      <div className="grid min-w-0 flex-1 gap-1">
        {/* edit-ok: a chat name, saved on Enter and on blur */}
        <Input
          autoFocus
          aria-label="Chat name"
          value={typed}
          disabled={busy}
          maxLength={200}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void save();
            if (e.key === "Escape") {
              e.stopPropagation();
              setTyped(null);
              setError(null);
            }
          }}
          className="h-8 text-[15px] font-semibold"
        />
        {error ? <span className="text-[12.5px] text-(--ui-bad)">{error}</span> : null}
      </div>
    );
  return (
    <h1 className={cx(text, "flex-1")}>
      <button
        type="button"
        title="Rename"
        onClick={() => setTyped(shown)}
        className="group/name -mx-1.5 inline-flex max-w-full items-center gap-1.5 rounded-(--ui-radius) px-1.5 py-0.5 text-left font-[inherit] text-[inherit] transition-colors duration-150 hover:bg-(--ui-fill) focus-visible:outline-2 focus-visible:outline-(--ui-focus)"
      >
        <span className="min-w-0 wrap-anywhere">{shown}</span>
        <Icon
          name="edit"
          size={13}
          className="flex-none text-(--ui-ink-3) opacity-0 transition-opacity duration-150 group-hover/name:opacity-100 group-focus-visible/name:opacity-100 max-sm:opacity-100"
        />
        <span className="sr-only">, rename</span>
      </button>
    </h1>
  );
}

export function AgentChat({
  setup,
  chat,
  model,
  onModel,
  owner,
  head,
  page,
  onSession,
  onIdle,
  onRunning,
  className,
}: {
  setup: SetupInfo;
  chat: string | null;
  model: string;
  onModel: (m: string) => void;
  /** The Mac's owner (`ownerOf`): may pick bypass. */
  owner: boolean;
  /** The chat's head; `first` is the opening question, the title until the list has one. */
  head?: (first: string | undefined) => React.ReactNode;
  /** The page open beside the chat: a chip in the box, and a line in the turn. */
  page?: string | undefined;
  onSession: (id: string) => void;
  /** A turn ended: the chat's title and time change in the list. */
  onIdle?: () => void;
  onRunning?: (running: boolean) => void;
  className?: string;
}) {
  const picks = usePicks(owner);
  // a setup with its own mode keeps it: the relay refuses any other
  const mode = setup.mode ?? picks.mode;
  const a = useAgent({
    setup: setup.name,
    session: chat,
    model,
    effort: picks.effort || undefined,
    mode,
    onSession,
  });
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
        preview={linkPreview}
        readFile={async (path) => relayFile(setup.name, await pageToken(), path)}
        placeholder={setup.name === "birdwatch" ? "Ask a research question" : "Ask the agent"}
        tools={
          <>
            <AgentPick
              label="Model"
              value={model}
              options={setup.models.map((m) => ({ value: m, label: modelName(m) }))}
              onChange={onModel}
            />
            <AgentPick
              label="Effort"
              value={picks.effort}
              options={EFFORT}
              onChange={(effort) => picks.set({ effort })}
            />
            {setup.mode ? null : (
              <AgentPick
                label="Permissions"
                value={mode}
                options={picks.modes}
                onChange={(m) => picks.set({ mode: m })}
              />
            )}
          </>
        }
        welcome={w ?? { title: `Ask ${setup.title}` }}
        above={<AgentTasks tasks={a.tasks} onStop={a.stopTask} />}
        commands={a.commands}
        note={
          a.status.model ? (
            <AgentStatus info={{ ...a.status, model: modelName(a.status.model) }} />
          ) : (
            `Claude agent · ${setup.tools.filter((t) => t !== "AskUserQuestion").join(", ")}`
          )
        }
      />
    </>
  );
}
