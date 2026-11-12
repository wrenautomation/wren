/**
 * One chat's changes and asks (designs/2026-11-11-agent-panel.md, D1 and D2), read from the
 * console: Changes lines grouped per turn, Undo, the asks with a person's Yes or No. Read again
 * when a tool call ends and when a turn ends.
 */
import type {
  AgentChange,
  AgentChangeTurn,
  AgentConfirm,
  AgentMessage,
  RiskyAct,
  UndoChange,
} from "@wren/ui";
import { useEffect, useMemo, useRef } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { markChanged } from "./drive.js";

/** `agent-changes.ts` AgentChangeLine, as the route sends it. */
export interface ChangeLine {
  id: string;
  at: string;
  turn: string | null;
  table: string;
  area: string;
  op: "insert" | "update" | "delete" | "truncate";
  row: string | null;
  change: string | null;
  undone: boolean;
  keyed: boolean;
  /** Record types its table feeds: the places to mark. */
  records?: string[];
}

/** `agent_confirms` row, as the route sends it. */
export interface AskRow {
  id: string;
  act: RiskyAct;
  client: string;
  what: string;
  args: { command: string; argv: string[] };
  state: "pending" | "yes" | "no" | "used";
  decidedBy: string | null;
  decidedAt: string | null;
  at: string;
}

const NO_KEY = "This table has no key: the row can't be found again.";

/** `delivery.wise_credits` → "Wise credit". */
export function tableWord(table: string): string {
  const base = (table.split(".").at(-1) ?? table).replace(/_/g, " ");
  const one = base.endsWith("ies")
    ? `${base.slice(0, -3)}y`
    : base.endsWith("ses") || base.endsWith("xes")
      ? base.slice(0, -2)
      : base.endsWith("s") && !base.endsWith("ss")
        ? base.slice(0, -1)
        : base;
  return one.charAt(0).toUpperCase() + one.slice(1);
}

const AREAS = new Set(["money", "client", "team", "data"]);

export function changeOf(l: ChangeLine): AgentChange {
  return {
    id: l.id,
    at: l.at,
    op: l.op === "truncate" ? "delete" : l.op,
    what: l.row ? `${tableWord(l.table)} · ${l.row}` : tableWord(l.table),
    change: l.change ?? undefined,
    area: AREAS.has(l.area) ? (l.area as AgentChange["area"]) : undefined,
    undone: l.undone,
    fixed: l.keyed ? undefined : NO_KEY,
  };
}

const firstLine = (m: AgentMessage): string => {
  const t = m.parts.find((p) => p.type === "text");
  return t?.type === "text" ? (t.text.split("\n")[0] ?? "") : "";
};

/**
 * Lines → turns, newest first. A turn's words and reply come by time: the last message you sent
 * at or before its first line (the relay's turn id is not the page's message id).
 */
export function turnsOf(
  lines: readonly ChangeLine[],
  messages: readonly AgentMessage[],
): (AgentChangeTurn & { reply: string | null })[] {
  const groups = new Map<string, ChangeLine[]>();
  for (const l of lines) {
    const k = l.turn ?? "";
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const sent = messages
    .map((m, i) => ({ m, i, at: m.at ? Date.parse(m.at) : Number.NaN }))
    .filter((x) => x.m.role === "user" && !Number.isNaN(x.at));
  return [...groups.entries()]
    .map(([turn, ls]) => {
      const first = Math.min(...ls.map((l) => Date.parse(l.at)));
      const by = sent.filter((x) => x.at <= first).at(-1);
      const reply = by ? messages.slice(by.i + 1).find((m) => m.role === "assistant") : undefined;
      return {
        id: turn,
        said: (by && firstLine(by.m)) || "An earlier message",
        at: new Date(first).toISOString(),
        lines: ls.map(changeOf),
        reply: reply?.id ?? null,
      };
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function askOf(a: AskRow): AgentConfirm {
  return {
    id: a.id,
    act: a.act,
    title: a.what,
    facts: [
      ["Runs", [a.args.command, ...a.args.argv].join(" ")],
      ["Where", a.client === "wren" ? "Wren" : a.client],
    ],
    state: a.state === "pending" ? "asks" : a.state === "no" ? "no" : "yes",
    by: a.decidedBy ?? undefined,
    at: a.decidedAt ?? undefined,
  };
}

/** What the agent is told after a Yes or No: it re-runs the same command, or not. */
export const decidedTurn = (a: AgentConfirm, yes: boolean, why?: string): string =>
  yes
    ? `Yes to "${a.title}" (ask ${a.id}). Run the same command again; it goes through once.`
    : `No to "${a.title}" (ask ${a.id}). Don't run it.${why ? ` Why: ${why}` : ""}`;

export function useChatChanges(o: {
  chat: string | null;
  running: boolean;
  /** Tool calls with a result: a write may have landed. */
  toolsDone: number;
  messages: readonly AgentMessage[];
}) {
  const changes = useCall(o.chat ? `agentChanges:${o.chat}` : null, () =>
    call<{ lines: ChangeLine[] }>("console/agentChanges", { chat: o.chat }),
  );
  const asks = useCall(o.chat ? `agentConfirms:${o.chat}` : null, () =>
    call<{ asks: AskRow[] }>("console/agentConfirms", { chat: o.chat }),
  );
  const again = useRef(() => {});
  again.current = () => {
    changes.retry();
    asks.retry();
  };
  const was = useRef({ running: o.running, toolsDone: o.toolsDone });
  useEffect(() => {
    const w = was.current;
    const ended = w.running && !o.running;
    if (ended || o.toolsDone > w.toolsDone) again.current();
    was.current = { running: o.running, toolsDone: o.toolsDone };
  }, [o.running, o.toolsDone]);
  // a line not seen before marks its places; the first read of a chat marks none
  const seen = useRef<{ chat: string | null; ids: Set<string> | null }>({ chat: null, ids: null });
  useEffect(() => {
    const lines = changes.data?.lines;
    if (!lines) return;
    const s = seen.current;
    if (s.chat !== o.chat || !s.ids) {
      seen.current = { chat: o.chat, ids: new Set(lines.map((l) => l.id)) };
      return;
    }
    const fresh = lines.filter((l) => !s.ids?.has(l.id));
    for (const l of fresh) s.ids.add(l.id);
    markChanged([...new Set(fresh.flatMap((l) => l.records ?? []))]);
  }, [changes.data, o.chat]);
  const turns = useMemo(
    () => turnsOf(changes.data?.lines ?? [], o.messages),
    [changes.data, o.messages],
  );
  const undo: UndoChange = async (t) => {
    const got = await call<{ undone: string[]; refused?: { why: string } }>("console/agentUndo", {
      chat: o.chat,
      ...("line" in t ? { event: t.line } : { turn: t.turn }),
    });
    changes.retry();
    return got.refused?.why ?? null;
  };
  const decide = async (id: string, yes: boolean) => {
    await call("console/agentDecide", { id, yes });
    asks.retry();
  };
  return {
    turns,
    asks: (asks.data?.asks ?? []).map(askOf),
    undo,
    decide,
  };
}
