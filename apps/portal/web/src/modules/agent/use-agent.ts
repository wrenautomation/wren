/**
 * One chat with a setup, for a page: the thread state, and send, stop, answer, model. The socket
 * opens on the first send (a past chat opens with `resume`), so reading an old chat starts no
 * `claude`. Leaving the chat or the page closes the socket; the relay ends the child.
 */
import {
  type AgentCommand,
  type AgentMessage,
  type AgentSent,
  type AgentStatusInfo,
  type AgentTask,
  type AgentTaskOutput,
  useLoad,
} from "@wren/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { socketToken } from "../../api.js";
import { openSetup, type Query, relayHistory, turns } from "./connect.js";
import { readyFile, turnContent, type Wire } from "./files.js";
import {
  answered,
  asked,
  closeText,
  cut,
  EMPTY,
  fold,
  history,
  said,
  type ThreadState,
} from "./thread.js";

/** The page's sign-in token; a local run has none and the dev Worker answers for "dev". */
export const pageToken = async () => (await socketToken()) ?? "dev";

/** Chats read this tab: a return to one shows it at once while it reads again; never on the device. */
const CHATS = {};

/** A setup's commands, as its last session listed them: a new chat has the `/` menu before it opens. */
const COMMANDS = new Map<string, readonly AgentCommand[]>();
const commandsOf = (
  list: readonly { name: string; description: string; argumentHint: string }[],
): AgentCommand[] =>
  list.map((c) => ({
    name: c.name,
    description: c.description,
    hint: c.argumentHint || undefined,
  }));

interface Live {
  q: Query;
  end: () => void;
  say: (content: Wire[] | string) => void;
  asks: Map<string, (allow: boolean, answers?: Record<string, string>) => void>;
  closing: boolean;
}

export interface AgentChat {
  messages: readonly AgentMessage[];
  running: boolean;
  starting: boolean;
  /** Nothing to show yet: the first read of a chat. Draw the skeleton. */
  loading: boolean;
  /** The last chat still shows while the picked one reads: dim it. */
  stale: boolean;
  error: { text: string; retry?: (() => void) | undefined } | null;
  session: string | undefined;
  /** From init: true on the Claude plan, false on an API key; unknown before the first turn. */
  plan: boolean | undefined;
  /** The terminal's status line: from init, then context and plan limits after each turn. */
  status: AgentStatusInfo;
  /** The model's default effort, as the CLI applies it with no pick. */
  baseEffort: string | undefined;
  /** Live background shells, Monitors and subagents; empty once the socket closes. */
  tasks: readonly AgentTask[];
  stopTask: (id: string) => void;
  /** A shell's or Monitor's last 8 KB; rejects when the socket is closed. */
  taskOutput: (id: string) => Promise<AgentTaskOutput>;
  /** What `/` lists: the session's commands and skills. */
  commands: readonly AgentCommand[];
  /** `page` names the page the turn is sent from; the thread shows it under the turn. */
  send: (text: string, files?: readonly AgentSent[], page?: string) => void;
  /** A picked file → what its turn carries (AgentThread `files.ready`). */
  ready: (file: File) => Promise<Wire[]>;
  stop: () => void;
  answer: (toolId: string, allow: boolean, answers?: Record<string, string>) => void;
}

export function useAgent(o: {
  setup: string;
  /** A past chat to show and resume; null = a new one. */
  session: string | null;
  /** The model picked, when not the setup's own. */
  model?: string | undefined;
  /** The effort picked; unset = the CLI's own for the model. */
  effort?: string | undefined;
  /** The permission mode picked; unset = the setup's. */
  mode?: string | undefined;
  /** The CLI named the session: a new chat gets its id. */
  onSession?: (id: string) => void;
}): AgentChat {
  const [s, setS] = useState<ThreadState>(EMPTY);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<AgentChat["error"]>(null);
  const live = useRef<Live | null>(null);
  const [status, setStatus] = useState<AgentStatusInfo>({});
  // the model's own effort, seen while no effort is picked
  const [baseEffort, setBaseEffort] = useState<string | undefined>();
  const [tasks, setTasks] = useState<readonly AgentTask[]>([]);
  const [commands, setCommands] = useState(() => COMMANDS.get(o.setup) ?? []);
  const learned = useCallback(
    (list: readonly AgentCommand[]) => {
      COMMANDS.set(o.setup, list);
      setCommands(list);
    },
    [o.setup],
  );
  const model = useRef(o.model);
  model.current = o.model;
  const picks = useRef({ effort: o.effort, mode: o.mode });
  picks.current = { effort: o.effort, mode: o.mode };
  const onSession = useRef(o.onSession);
  onSession.current = o.onSession;
  // the id this hook is showing: a new chat's id arriving must not reload it
  const shown = useRef<string | null>(null);
  // Retry after a dropped socket sends the last turn again, on a new one
  type Turn = [text: string, files: readonly AgentSent[], page: string | undefined];
  const last = useRef<Turn>(["", [], undefined]);
  const again = useRef<(...t: Turn) => void>(() => {});
  const failed = useCallback((e: unknown) => {
    const c = closeText(e);
    // the page shows one sentence; the console keeps the cause
    console.error("agent:", e);
    setError({ text: c.text, retry: c.retry ? () => again.current(...last.current) : undefined });
  }, []);

  // bumped on each close: a socket that finishes opening after its chat was left shuts at once
  const gen = useRef(0);

  const close = useCallback(() => {
    gen.current++;
    const l = live.current;
    live.current = null;
    if (!l) return;
    l.closing = true;
    // the level is per CLI process: a new socket starts with none
    setTasks([]);
    for (const a of l.asks.values()) a(false);
    l.end();
    l.q.close();
  }, []);

  // a stored chat: TanStack Query in this tab's scope, so a return to it paints at once
  const stored = useLoad<Awaited<ReturnType<typeof relayHistory>>>(
    o.session ? `history:${o.setup}:${o.session}` : null,
    async () => relayHistory(o.setup, o.session ?? "", await pageToken()),
    CHATS,
  );

  // a chat switch: drop the socket; a new chat starts empty, a stored one keeps the last on
  // screen (dimmed) until its turns land
  useEffect(() => {
    if (o.session && o.session === shown.current && live.current) return;
    close();
    shown.current = o.session;
    setError(null);
    setStarting(false);
    if (!o.session) setS(EMPTY);
  }, [o.session, close]);

  // the stored turns land, or read again behind the chat: shown unless a turn is live
  useEffect(() => {
    if (!o.session || !stored.data || stored.placeholder || live.current) return;
    if (shown.current !== o.session) return;
    setS({ ...history(stored.data), session: o.session });
  }, [o.session, stored.data, stored.placeholder]);

  useEffect(() => close, [close]);

  // the model picked mid-chat goes to the live session at once
  useEffect(() => {
    const q = live.current?.q;
    if (o.model && q)
      void q
        .setModel(o.model)
        .then(() => applied(q, setStatus, picks.current.effort ? undefined : setBaseEffort))
        .catch(() => {});
  }, [o.model]);
  useEffect(() => {
    // read-ok: a control call to the open session, not a data read
    const q = live.current?.q;
    if (!q) return;
    // unset: back to the model's own level
    void q
      .applyFlagSettings({ effortLevel: (o.effort ?? null) as "high" | null })
      .then(() => applied(q, setStatus, picks.current.effort ? undefined : setBaseEffort))
      .catch(() => {});
  }, [o.effort]);
  useEffect(() => {
    if (o.mode) void live.current?.q.setPermissionMode(o.mode as "default").catch(() => {});
  }, [o.mode]);

  const open = useCallback(
    async (resume: string | undefined): Promise<Live> => {
      const t = turns();
      const asks = new Map<string, (allow: boolean, answers?: Record<string, string>) => void>();
      const token = await pageToken();
      const q = await openSetup({
        setup: o.setup,
        token,
        prompt: t.stream,
        ...(resume ? { resume } : {}),
        ...(model.current ? { model: model.current } : {}),
        ...(picks.current.effort ? { effort: picks.current.effort } : {}),
        ...(picks.current.mode ? { mode: picks.current.mode } : {}),
        canUseTool: (name, input, { toolUseID, decisionReason, signal }) =>
          new Promise((res) => {
            const done = (allow: boolean, answers?: Record<string, string>) => {
              asks.delete(toolUseID);
              res(
                allow
                  ? // AskUserQuestion takes the picks back on its input
                    { behavior: "allow", updatedInput: answers ? { ...input, answers } : input }
                  : { behavior: "deny", message: "The person said no." },
              );
            };
            asks.set(toolUseID, done);
            signal.addEventListener(
              "abort",
              () => {
                done(false);
                setS((p) => answered(p, toolUseID, false));
              },
              { once: true },
            );
            setS((p) => asked(p, { id: toolUseID, name, input, why: decisionReason }));
          }),
      });
      const l: Live = { q, end: t.end, say: t.say, asks, closing: false };
      void (async () => {
        try {
          for await (const m of q) {
            if (l.closing) break;
            if (m.type === "system" && m.subtype === "init") {
              const effort = (m as { effort?: string | null }).effort;
              setStatus((s) => ({ ...s, model: m.model, effort: effort ?? s.effort }));
              void applied(q, setStatus, picks.current.effort ? undefined : setBaseEffort);
              void q
                .supportedCommands()
                .then((c) => learned(commandsOf(c)))
                .catch(() => {});
              setStarting(false);
              shown.current = m.session_id;
              onSession.current?.(m.session_id);
            }
            setS((p) => fold(p, m as never));
            if (m.type === "result") void measure(q, setStatus);
            if (m.type === "system") setTasks((t) => taskFold(t, m));
            if (m.type === "system" && m.subtype === "commands_changed")
              learned(commandsOf(m.commands));
          }
          if (!l.closing) setS(cut);
        } catch (e) {
          if (l.closing) return;
          failed(e);
          setS(cut);
        } finally {
          setStarting(false);
          if (live.current === l) live.current = null;
        }
      })();
      return l;
    },
    [o.setup, failed, learned],
  );

  const send = useCallback(
    (text: string, files: readonly AgentSent[] = [], page?: string) => {
      last.current = [text, files, page];
      setError(null);
      setS((p) => said(p, text, { files: files.map((f) => f.file), page }));
      const content = files.length || page ? turnContent(text, files, page) : text;
      const l = live.current;
      if (l) return l.say(content);
      setStarting(true);
      const at = gen.current;
      open(shown.current ?? undefined)
        .then((n) => {
          if (at !== gen.current) {
            n.closing = true;
            n.end();
            n.q.close();
            return;
          }
          live.current = n;
          n.say(content);
        })
        .catch((e) => {
          setStarting(false);
          failed(e);
          setS(cut);
        });
    },
    [open, failed],
  );

  again.current = send;

  const ready = useCallback(
    async (file: File) => readyFile(o.setup, await pageToken(), file),
    [o.setup],
  );

  const stop = useCallback(() => {
    const l = live.current;
    if (!l) return setS(cut);
    setS((p) => ({ ...p, stopping: true }));
    for (const [id, a] of l.asks) {
      a(false);
      setS((p) => answered(p, id, false));
    }
    void l.q.interrupt().catch(() => {});
  }, []);

  const answer = useCallback((id: string, allow: boolean, answers?: Record<string, string>) => {
    // an ask already closed (Stop, abort) took its deny: a late click changes nothing
    const ask = live.current?.asks.get(id);
    if (!ask) return;
    ask(allow, answers);
    setS((p) => answered(p, id, allow, answers));
  }, []);

  return {
    messages: s.messages,
    running: s.running,
    starting,
    loading: !!o.session && s.session !== o.session && !s.messages.length && !stored.error,
    stale: !!o.session && s.session !== o.session && !!s.messages.length,
    error:
      error ??
      (stored.error && s.session !== o.session ? storedError(stored.error, stored.retry) : null),
    session: s.session ?? o.session ?? undefined,
    plan: s.plan,
    status,
    baseEffort,
    tasks,
    stopTask: (id: string) => void live.current?.q.stopTask(id).catch(() => {}),
    taskOutput: async (id: string) => {
      // SDK 0.3.318: on Query at runtime, not yet in its types
      const q = live.current?.q as unknown as { getTaskOutput?: (id: string) => Promise<TaskOut> };
      if (!q?.getTaskOutput) throw new Error("not connected");
      const o = await q.getTaskOutput(id);
      return { output: o.output, bytes: o.total_bytes, truncated: o.truncated };
    },
    commands,
    send,
    ready,
    stop,
    answer,
  };
}

type TaskOut = { output: string; total_bytes: number; truncated: boolean };

/**
 * `background_tasks_changed` is the live set (replace it); `task_started` gives a start time and
 * `task_progress` a line. Ambient tasks are housekeeping: hidden, as the CLI asks.
 */
function taskFold(t: readonly AgentTask[], m: { subtype: string } & Record<string, unknown>) {
  if (m.subtype === "background_tasks_changed") {
    const live = m.tasks as {
      task_id: string;
      task_type: string;
      description: string;
      ambient?: boolean;
    }[];
    return live
      .filter((x) => !x.ambient)
      .map((x) => {
        const had = t.find((o) => o.id === x.task_id);
        return {
          id: x.task_id,
          type: x.task_type,
          description: x.description,
          started: had?.started ?? Date.now(),
          summary: had?.summary,
          tokens: had?.tokens,
          uses: had?.uses,
        };
      });
  }
  if (m.subtype === "task_progress") {
    const u = m.usage as { total_tokens?: number; tool_uses?: number } | undefined;
    return t.map((o) =>
      o.id === m.task_id
        ? {
            ...o,
            ...(typeof m.summary === "string" ? { summary: m.summary } : {}),
            ...(u?.total_tokens ? { tokens: u.total_tokens } : {}),
            ...(u?.tool_uses ? { uses: u.tool_uses } : {}),
          }
        : o,
    );
  }
  return t;
}

/**
 * The effort the CLI sends for the model now: the pick, else the model's default (Sonnet and Opus
 * high, Haiku medium on 2.1.318). `getSettings` is on Query at runtime, not yet in its types.
 */
async function applied(
  q: Query,
  set: (f: (s: AgentStatusInfo) => AgentStatusInfo) => void,
  base?: (e: string | undefined) => void,
) {
  const g = q as unknown as { getSettings?: () => Promise<{ applied?: { effort?: string | null } }> };
  const a = await g.getSettings?.().catch(() => null);
  if (!a?.applied || !("effort" in a.applied)) return;
  const e = a.applied.effort ?? undefined;
  set((s) => ({ ...s, effort: e }));
  base?.(e);
}

/** After a turn: the context in use and the plan's 5h and 7d use, as `/context` and `/usage` give them. */
async function measure(q: Query, set: (f: (s: AgentStatusInfo) => AgentStatusInfo) => void) {
  const [ctx, use] = await Promise.all([
    q.getContextUsage({ detail: "summary" }).catch(() => null),
    // `/usage` is still experimental in the SDK: a rename shows as a type error on the bump
    q
      .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
      .catch(() => null),
  ]);
  const limits = use?.rate_limits_available ? use.rate_limits : null;
  set((s) => ({
    ...s,
    ...(ctx ? { context: { used: ctx.totalTokens, max: ctx.maxTokens } } : {}),
    fiveHour: limits?.five_hour?.utilization ?? undefined,
    sevenDay: limits?.seven_day?.utilization ?? undefined,
  }));
}

const storedError = (e: unknown, retry: () => void) => {
  const c = closeText(e);
  return { text: c.text, retry: c.retry ? retry : undefined };
};
