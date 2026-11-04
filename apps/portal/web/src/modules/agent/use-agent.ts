/**
 * One chat with a setup, for a page: the thread state, and send, stop, answer, model. The socket
 * opens on the first send (a past chat opens with `resume`), so reading an old chat starts no
 * `claude`. Leaving the chat or the page closes the socket; the relay ends the child.
 */
import { type AgentMessage, useLoad } from "@wren/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { socketToken } from "../../api.js";
import { openSetup, type Query, relayHistory, turns } from "./connect.js";
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

interface Live {
  q: Query;
  end: () => void;
  say: (text: string) => void;
  asks: Map<string, (allow: boolean) => void>;
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
  send: (text: string) => void;
  stop: () => void;
  answer: (toolId: string, allow: boolean) => void;
}

export function useAgent(o: {
  setup: string;
  /** A past chat to show and resume; null = a new one. */
  session: string | null;
  /** The model picked, when not the setup's own. */
  model?: string | undefined;
  /** The CLI named the session: a new chat gets its id. */
  onSession?: (id: string) => void;
}): AgentChat {
  const [s, setS] = useState<ThreadState>(EMPTY);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<AgentChat["error"]>(null);
  const live = useRef<Live | null>(null);
  const model = useRef(o.model);
  model.current = o.model;
  const onSession = useRef(o.onSession);
  onSession.current = o.onSession;
  // the id this hook is showing: a new chat's id arriving must not reload it
  const shown = useRef<string | null>(null);
  // Retry after a dropped socket sends the last turn again, on a new one
  const last = useRef("");
  const again = useRef<(text: string) => void>(() => {});
  const failed = useCallback((e: unknown) => {
    const c = closeText(e);
    // the page shows one sentence; the console keeps the cause
    console.error("agent:", e);
    setError({ text: c.text, retry: c.retry ? () => again.current(last.current) : undefined });
  }, []);

  // bumped on each close: a socket that finishes opening after its chat was left shuts at once
  const gen = useRef(0);

  const close = useCallback(() => {
    gen.current++;
    const l = live.current;
    live.current = null;
    if (!l) return;
    l.closing = true;
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
    if (o.model) void live.current?.q.setModel(o.model).catch(() => {});
  }, [o.model]);

  const open = useCallback(
    async (resume: string | undefined): Promise<Live> => {
      const t = turns();
      const asks = new Map<string, (allow: boolean) => void>();
      const token = await pageToken();
      const q = await openSetup({
        setup: o.setup,
        token,
        prompt: t.stream,
        ...(resume ? { resume } : {}),
        ...(model.current ? { model: model.current } : {}),
        canUseTool: (name, input, { toolUseID, decisionReason, signal }) =>
          new Promise((res) => {
            const done = (allow: boolean) => {
              asks.delete(toolUseID);
              res(
                allow
                  ? { behavior: "allow", updatedInput: input }
                  : { behavior: "deny", message: "The person said no." },
              );
            };
            asks.set(toolUseID, done);
            signal.addEventListener("abort", () => done(false), { once: true });
            setS((p) => asked(p, { id: toolUseID, name, input, why: decisionReason }));
          }),
      });
      const l: Live = { q, end: t.end, say: t.say, asks, closing: false };
      void (async () => {
        try {
          for await (const m of q) {
            if (l.closing) break;
            if (m.type === "system" && m.subtype === "init") {
              setStarting(false);
              shown.current = m.session_id;
              onSession.current?.(m.session_id);
            }
            setS((p) => fold(p, m as never));
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
    [o.setup, failed],
  );

  const send = useCallback(
    (text: string) => {
      last.current = text;
      setError(null);
      setS((p) => said(p, text));
      const l = live.current;
      if (l) return l.say(text);
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
          n.say(text);
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

  const stop = useCallback(() => {
    const l = live.current;
    if (!l) return setS(cut);
    setS((p) => ({ ...p, stopping: true }));
    for (const a of l.asks.values()) a(false);
    void l.q.interrupt().catch(() => {});
  }, []);

  const answer = useCallback((id: string, allow: boolean) => {
    live.current?.asks.get(id)?.(allow);
    setS((p) => answered(p, id, allow));
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
    send,
    stop,
    answer,
  };
}

const storedError = (e: unknown, retry: () => void) => {
  const c = closeText(e);
  return { text: c.text, retry: c.retry ? retry : undefined };
};
