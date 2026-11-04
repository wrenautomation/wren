/**
 * A chat with a Claude agent (designs/2026-11-04-multi-user-runtime.md, Decision 4): assistant-ui's
 * store runtime holds the thread state (running, parts, approvals, scroll), Streamdown draws the
 * reply's markdown, safe while it streams. This part knows no SDK: the page folds its frames into
 * `AgentMessage`s and answers the callbacks. Looks: design language 14 (stream, busy, error) and
 * 15 F3 (the message and the reply box).
 */
import {
  type AppendMessage,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  type ReasoningMessagePartComponent,
  type TextMessagePartComponent,
  type ThreadMessageLike,
  ThreadPrimitive,
  type ToolCallMessagePartComponent,
  useAuiState,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { type ReactNode, useState } from "react";
import { Streamdown } from "streamdown";
import { Ring } from "./busy.js";
import { Button, Tag } from "./controls.js";
import { Alert } from "./feedback.js";
import { cx } from "./format.js";
import { Icon, type IconName } from "./icons.js";

/** One step of a reply: words, thinking, or a tool call with its result and the ask, if any. */
export type AgentPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      input: Record<string, unknown>;
      /** The input as it streams, before it parses. */
      inputText?: string | undefined;
      result?: string | undefined;
      failed?: boolean | undefined;
      /** The agent asks before it runs this: open until `allowed` is set. */
      ask?: { why?: string | undefined; allowed?: boolean | undefined } | undefined;
    };

/** What a turn cost, from the CLI's result line. */
export interface AgentFoot {
  ms?: number | undefined;
  tokens?: number | undefined;
  cost?: number | undefined;
  model?: string | undefined;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  parts: AgentPart[];
  at?: string | undefined;
  /** live: still coming; stopped: Stop pressed; failed: the turn ended in an error. */
  state?: "live" | "done" | "stopped" | "failed" | undefined;
  foot?: AgentFoot | undefined;
}

export interface AgentThreadProps {
  messages: readonly AgentMessage[];
  /** A turn is out: Stop shows, Send waits. */
  running: boolean;
  /** The session opens: words after one second. */
  starting?: boolean | undefined;
  /** One sentence, and Retry where trying again can help. */
  error?: { text: string; retry?: (() => void) | undefined } | null | undefined;
  /** Why nothing can be sent (no relay, no grant); the box reads only. */
  closed?: string | null | undefined;
  /** Another chat still shows while this one reads: dimmed, the box held. */
  stale?: boolean | undefined;
  onSend: (text: string) => void;
  onStop: () => void;
  onAnswer: (toolId: string, allow: boolean) => void;
  /** Shown before the first turn. */
  empty?: ReactNode;
  placeholder?: string | undefined;
  className?: string | undefined;
}

/** `AgentMessage` → assistant-ui's message: approvals ride the tool part, the foot rides metadata. */
export function threadMessage(m: AgentMessage): ThreadMessageLike {
  return {
    id: m.id,
    role: m.role,
    ...(m.at ? { createdAt: new Date(m.at) } : {}),
    content: m.parts.map((p) =>
      p.type === "text"
        ? { type: "text" as const, text: p.text }
        : p.type === "thinking"
          ? { type: "reasoning" as const, text: p.text }
          : {
              type: "tool-call" as const,
              toolCallId: p.id,
              toolName: p.name,
              args: p.input as never,
              argsText: p.inputText ?? JSON.stringify(p.input),
              ...(p.result !== undefined ? { result: p.result, isError: !!p.failed } : {}),
              ...(p.ask
                ? {
                    approval: {
                      id: p.id,
                      ...(p.ask.why ? { prompt: p.ask.why } : {}),
                      ...(p.ask.allowed !== undefined ? { approved: p.ask.allowed } : {}),
                    },
                  }
                : {}),
            },
    ),
    ...(m.role === "assistant"
      ? {
          status:
            m.state === "live"
              ? { type: "running" as const }
              : m.state === "stopped"
                ? { type: "incomplete" as const, reason: "cancelled" as const }
                : m.state === "failed"
                  ? { type: "incomplete" as const, reason: "error" as const }
                  : { type: "complete" as const, reason: "stop" as const },
          metadata: { custom: { foot: m.foot ?? null, state: m.state ?? "done" } },
        }
      : {}),
  };
}

const textOf = (m: AppendMessage) =>
  m.content.map((c) => (c.type === "text" ? c.text : "")).join("");

export function AgentThread(p: AgentThreadProps) {
  const runtime = useExternalStoreRuntime<AgentMessage>({
    messages: p.messages,
    convertMessage: threadMessage,
    isRunning: p.running,
    isDisabled: !!p.closed || !!p.stale,
    onNew: async (m) => {
      const text = textOf(m).trim();
      if (text) p.onSend(text);
    },
    onCancel: async () => p.onStop(),
    onRespondToToolApproval: ({ approvalId, approved }) => p.onAnswer(approvalId, approved),
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root
        className={cx("grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]", p.className)}
      >
        <ThreadPrimitive.Viewport
          aria-busy={p.stale || undefined}
          className={cx(
            "min-h-0 overflow-y-auto px-1 pb-4 transition-opacity duration-200",
            p.stale && "opacity-50",
          )}
        >
          <ThreadPrimitive.Empty>{p.empty}</ThreadPrimitive.Empty>
          <div className="grid gap-5">
            <ThreadPrimitive.Messages>
              {({ message }) => (message.role === "user" ? <UserTurn /> : <ReplyTurn />)}
            </ThreadPrimitive.Messages>
          </div>
          {p.starting ? <Starting /> : null}
          {p.error ? (
            <Alert onRetry={p.error.retry} className="ui-rise mt-4 mb-0">
              {p.error.text}
            </Alert>
          ) : null}
        </ThreadPrimitive.Viewport>
        <Composer closed={p.closed} placeholder={p.placeholder} />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

/** Artifact 15 F3 `.msg`, mirrored to the right: the person's own turn. */
function UserTurn() {
  return (
    <MessagePrimitive.Root className="ui-rise flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-[14px_4px_14px_14px] bg-(--ui-wash) px-3 py-2.5 text-[14px] text-(--ui-ink)">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function ReplyTurn() {
  return (
    <MessagePrimitive.Root className="ui-rise grid min-w-0 gap-2.5">
      <MessagePrimitive.Parts
        components={{ Text: Reply, Reasoning: Thinking, tools: { Fallback: ToolCard } }}
      />
      <Pending />
      <Foot />
    </MessagePrimitive.Root>
  );
}

/** Artifact 14 "Stream": words as they come, a lavender caret while live. */
const Reply: TextMessagePartComponent = ({ text, status }) => (
  <div
    data-live={status.type === "running" ? "" : undefined}
    className="ui-agent-text min-w-0 text-[14.5px]/[1.55] text-(--ui-ink) [overflow-wrap:anywhere]"
  >
    <Streamdown
      mode={status.type === "running" ? "streaming" : "static"}
      isAnimating={status.type === "running"}
      controls={false}
    >
      {text}
    </Streamdown>
  </div>
);

/** Thinking folds away; a signed-only block (no words) shows only while it runs. */
const Thinking: ReasoningMessagePartComponent = ({ text, status }) => {
  if (!text.trim())
    return status.type === "running" ? (
      <span>
        <Tag tone="accent" busy>
          Thinking
        </Tag>
      </span>
    ) : null;
  return (
    <details className="group text-[13px] text-(--ui-ink-3)">
      <summary className="cursor-pointer list-none font-semibold [&::-webkit-details-marker]:hidden">
        {status.type === "running" ? "Thinking" : "Thought"}
        <Icon name="down" size={12} className="ml-1 inline align-[-1px] group-open:rotate-180" />
      </summary>
      <p className="mt-1.5 mb-0 whitespace-pre-wrap border-(--ui-hair) border-l-2 pl-3 text-[13.5px] text-(--ui-ink-2)">
        {text}
      </p>
    </details>
  );
};

const TOOL_ICON: Record<string, IconName> = { Bash: "code", Read: "read", Skill: "sparkle" };

/** The one line that says what a call does: Bash's command, Read's file, Skill's name. */
export function toolLine(name: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  if (name === "Bash") return s("command");
  if (name === "Read") return s("file_path");
  if (name === "Skill") return s("skill");
  return Object.values(input)
    .filter((v) => typeof v === "string")
    .join(" · ");
}

/** A tool call: what it runs, how it went, its output folded; the ask in place when it asks. */
const ToolCard: ToolCallMessagePartComponent = (t) => {
  const input = (t.args ?? {}) as Record<string, unknown>;
  const line = toolLine(t.toolName, input) || t.argsText;
  const ask = t.approval;
  const open = ask && ask.approved === undefined && !ask.resolution;
  const done = t.result !== undefined;
  const why = typeof input.description === "string" ? input.description : null;
  return (
    <div
      className={cx(
        "grid gap-2 rounded-(--ui-leaf-box) px-3 py-2.5 text-[13.5px] shadow-[inset_0_0_0_1px_var(--ui-hair)]",
        open && "bg-(--ui-wash)",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon
          name={TOOL_ICON[t.toolName] ?? "bolt"}
          size={15}
          className="mt-0.5 flex-none text-(--ui-ink-3)"
        />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="font-semibold text-(--ui-ink)">{why ?? t.toolName}</span>
          <code className="font-mono text-[12.5px] text-(--ui-ink-2) [overflow-wrap:anywhere]">
            {line}
          </code>
        </div>
        <span key={statusOf(t, !!open, done)} className="flex-none [animation:ui-fade_.2s_both]">
          {open ? (
            <Tag tone="warn">Waiting on you</Tag>
          ) : ask?.approved === false ? (
            <Tag>Denied</Tag>
          ) : t.isError ? (
            <Tag tone="bad">Failed</Tag>
          ) : done ? (
            <Icon name="check" size={15} className="text-(--ui-good)" />
          ) : t.status.type === "running" || t.status.type === "requires-action" ? (
            <Ring />
          ) : null}
        </span>
      </div>
      {open ? (
        <div className="ui-rise grid gap-2">
          <span className="text-(--ui-ink-2)">
            Claude agent asks to run this{ask.prompt ? `: ${ask.prompt.toLowerCase()}` : "."}
          </span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void t.respondToApproval?.({ approved: true })}>
              Allow once
            </Button>
            <Button
              size="sm"
              tone="secondary"
              onClick={() => void t.respondToApproval?.({ approved: false })}
            >
              Deny
            </Button>
          </div>
        </div>
      ) : null}
      {done && typeof t.result === "string" && t.result.trim() ? <Output text={t.result} /> : null}
    </div>
  );
};

/** The card's state, for the cross-fade when it changes. */
const statusOf = (
  t: {
    isError?: boolean | undefined;
    approval?: { approved?: boolean } | undefined;
    status: { type: string };
  },
  open: boolean,
  done: boolean,
) =>
  open
    ? "ask"
    : t.approval?.approved === false
      ? "denied"
      : t.isError
        ? "failed"
        : done
          ? "done"
          : t.status.type;

function Output({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="justify-self-start text-[12.5px] font-semibold text-(--ui-ink-3) hover:text-(--ui-accent)"
      >
        {open ? "Hide output" : "Show output"}
      </button>
      {open ? (
        <pre className="ui-rise m-0 max-h-60 overflow-auto whitespace-pre-wrap rounded-[4px_12px_4px_12px] bg-(--ui-canvas) px-3 py-2 font-mono text-[12px] text-(--ui-ink-2) [overflow-wrap:anywhere]">
          {text}
        </pre>
      ) : null}
    </div>
  );
}

const MODEL_NAME: Record<string, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" };
const modelName = (m: string) =>
  MODEL_NAME[m] ?? MODEL_NAME[/claude-(\w+)/.exec(m)?.[1] ?? ""] ?? m;

/** The turn's foot: model, time, tokens, cost. "Stopped" when Stop ended it. */
export function footLine(foot: AgentFoot | null, state: string): string | null {
  const bits = [
    state === "stopped" ? "Stopped" : null,
    foot?.model ? modelName(foot.model) : null,
    foot?.ms ? `${(foot.ms / 1000).toFixed(1)} s` : null,
    foot?.tokens
      ? `${foot.tokens >= 1000 ? `${(foot.tokens / 1000).toFixed(1)}k` : foot.tokens} tokens`
      : null,
    foot?.cost ? `$${foot.cost.toFixed(2)}` : null,
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : null;
}

/** A reply with nothing in it yet. */
function Pending() {
  const empty = useAuiState((s) => s.message.status?.type === "running" && !s.message.parts.length);
  return empty ? (
    <span>
      <Tag tone="accent" busy>
        Thinking
      </Tag>
    </span>
  ) : null;
}

function Foot() {
  const custom = useAuiState((s) => s.message.metadata.custom) as
    | { foot: AgentFoot | null; state: string }
    | undefined;
  const live = useAuiState((s) => s.message.status?.type === "running");
  const line = !live && custom ? footLine(custom.foot, custom.state) : null;
  return line ? (
    <span className="text-[12.5px] text-(--ui-ink-3) [animation:ui-fade_.25s_both]">{line}</span>
  ) : null;
}

/** Artifact 14: nothing under a second, then the ring and words. */
function Starting() {
  return (
    <div
      role="status"
      className="mt-4 flex items-center gap-2 text-[13.5px] text-(--ui-ink-2) [animation:ui-fade_.2s_1s_both]"
    >
      <Ring />
      Starting Claude agent
    </div>
  );
}

/** Artifact 15 F3 `.rp`: the box, then Send, or Stop while a turn is out. */
function Composer({
  closed,
  placeholder,
}: {
  closed?: string | null | undefined;
  placeholder?: string | undefined;
}) {
  const running = useAuiState((s) => s.thread.isRunning);
  return (
    <ComposerPrimitive.Root className="grid gap-2 border-(--ui-hair) border-t pt-3">
      <ComposerPrimitive.Input
        rows={2}
        maxRows={10}
        disabled={!!closed}
        placeholder={closed ?? placeholder ?? "Ask the agent"}
        aria-label="Message"
        className="w-full resize-none rounded-[4px_12px_4px_12px] border-0 bg-(--ui-canvas) px-[11px] py-[9px] text-[14px] text-(--ui-ink) shadow-[inset_0_0_0_1px_var(--ui-hair)] outline-none placeholder:text-(--ui-ink-3) focus-visible:shadow-[inset_0_0_0_1px_var(--ui-accent)]"
      />
      <div className="flex justify-end gap-2">
        {running ? (
          <ComposerPrimitive.Cancel asChild>
            <Button size="sm" tone="secondary" icon="stop">
              Stop
            </Button>
          </ComposerPrimitive.Cancel>
        ) : (
          <ComposerPrimitive.Send asChild>
            <Button size="sm" icon="send">
              Send
            </Button>
          </ComposerPrimitive.Send>
        )}
      </div>
    </ComposerPrimitive.Root>
  );
}
