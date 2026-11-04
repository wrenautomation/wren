/**
 * A chat with a Claude agent (designs/2026-11-04-multi-user-runtime.md, Decision 4): assistant-ui's
 * store runtime holds the thread state (running, parts, approvals, scroll, copy), Streamdown draws
 * the reply's markdown, safe while it streams. This part knows no SDK: the page folds its frames
 * into `AgentMessage`s and answers the callbacks. Looks: design language 14 (stream, busy, error)
 * and 15 F3 (the message and the reply box); one reading column, the box at its foot.
 */
import {
  ActionBarPrimitive,
  type AppendMessage,
  AssistantRuntimeProvider,
  type Attachment,
  type AttachmentAdapter,
  AttachmentPrimitive,
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
import {
  type PropsWithChildren,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Streamdown } from "streamdown";
import { Answer, answersOf, Choices, LinkCard, linksIn } from "./agent-cards.js";
import { Ring } from "./busy.js";
import { Button, Tag } from "./controls.js";
import { Alert } from "./feedback.js";
import { cx } from "./format.js";
import { tipProps } from "./hint.js";
import { Icon, type IconName } from "./icons.js";

/** A file in a turn. `src` (a data URL) draws an image. */
export interface AgentFile {
  name: string;
  kind: "image" | "pdf" | "video" | "audio" | "file";
  src?: string | undefined;
  size?: number | undefined;
}

/** One step of a reply: words, thinking, or a tool call with its result and the ask, if any. */
export type AgentPart =
  | { type: "text"; text: string }
  | { type: "file"; file: AgentFile }
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
      /** AskUserQuestion: the picks, by question. */
      answers?: Record<string, string> | undefined;
    };

/** One of AskUserQuestion's questions: 2-4 options; "Something else" is always offered. */
export interface AgentQuestion {
  question: string;
  header?: string | undefined;
  options: { label: string; description?: string | undefined }[];
  multiSelect?: boolean | undefined;
}

/** The agent's choices as a card (AskUserQuestion): open, answered, or skipped. */
export interface ChoicesData {
  id: string;
  questions: AgentQuestion[];
  answers: Record<string, string> | null;
  open: boolean;
  skipped: boolean;
}

/** What a turn cost, from the CLI's result line. */
export interface AgentFoot {
  ms?: number | undefined;
  input?: number | undefined;
  output?: number | undefined;
  cacheRead?: number | undefined;
  cacheWrite?: number | undefined;
  /** API list price, USD; on the plan nothing is billed. */
  cost?: number | undefined;
  model?: string | undefined;
  /** Ran on the Claude plan (init `apiKeySource: none`), not an API key. */
  plan?: boolean | undefined;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  parts: AgentPart[];
  at?: string | undefined;
  /** live: still coming; stopped: Stop pressed; failed: the turn ended in an error. */
  state?: "live" | "done" | "stopped" | "failed" | undefined;
  foot?: AgentFoot | undefined;
  /** The page a turn was sent from. */
  page?: string | undefined;
}

/** A picked file, made ready by the page: `data` is the page's own (inline blocks, a stored path). */
export interface AgentSent {
  file: AgentFile;
  data: unknown;
}

/** Files in the box: the page turns each into what its turn carries, while its chip shows. */
export interface AgentFiles {
  accept: string;
  /** Throws a sentence the chip shows (too large, the upload failed). */
  ready: (file: File) => Promise<unknown>;
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
  onSend: (text: string, files: readonly AgentSent[]) => void;
  /** Files may be added: the clip button, drop and paste. */
  files?: AgentFiles | undefined;
  /** The page the next turn names: a chip in the box; Close drops it. */
  context?: { label: string; onDrop: () => void } | null | undefined;
  onStop: () => void;
  /** An ask answered; `answers` for AskUserQuestion, by question. */
  onAnswer: (toolId: string, allow: boolean, answers?: Record<string, string>) => void;
  /** Before the first turn: a heading, a line, and prompts that send on a click. */
  welcome?:
    | { title: string; text?: string | undefined; suggestions?: readonly string[] | undefined }
    | undefined;
  placeholder?: string | undefined;
  /** In the box's foot, left: the model pick. */
  tools?: ReactNode;
  /** Under the box: what it runs on. */
  note?: ReactNode;
  className?: string | undefined;
}

/** `AgentMessage` → assistant-ui's message: approvals ride the tool part, the foot rides metadata. */
export function threadMessage(m: AgentMessage): ThreadMessageLike {
  const files = m.parts.flatMap((p) => (p.type === "file" ? [p.file] : []));
  return {
    id: m.id,
    role: m.role,
    ...(m.at ? { createdAt: new Date(m.at) } : {}),
    ...(files.length
      ? {
          attachments: files.map((f, i) => ({
            id: `${m.id}-f${i}`,
            type: f.kind,
            name: f.name,
            status: { type: "complete" as const },
            content: f.src ? [{ type: "image" as const, image: f.src }] : [],
          })),
        }
      : {}),
    ...(m.role === "user" && m.page ? { metadata: { custom: { page: m.page } } } : {}),
    content: m.parts.flatMap((p) =>
      p.type === "file"
        ? []
        : p.type === "tool" && p.name === ASK_TOOL
          ? { type: "data" as const, name: "choices", id: p.id, data: choicesOf(p) }
          : p.type === "text"
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

const ASK_TOOL = "AskUserQuestion";

function choicesOf(p: Extract<AgentPart, { type: "tool" }>): ChoicesData {
  const qs = Array.isArray(p.input.questions) ? (p.input.questions as AgentQuestion[]) : [];
  const answers = p.answers ?? answersOf(p.result);
  return {
    id: p.id,
    questions: qs.filter((q) => q && typeof q.question === "string" && Array.isArray(q.options)),
    answers,
    open: !answers && !p.failed && !!p.ask && p.ask.allowed === undefined,
    skipped: !answers && (p.ask?.allowed === false || !!p.failed),
  };
}

const textOf = (m: AppendMessage) =>
  m.content.map((c) => (c.type === "text" ? c.text : "")).join("");

/** A file's kind from its type, else its name. */
export function fileKind(type: string, name: string): AgentFile["kind"] {
  const t = type || "";
  if (t.startsWith("image/")) return "image";
  if (t === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (t.startsWith("video/") || /\.(mp4|mov|webm|mkv|m4v)$/i.test(name)) return "video";
  if (t.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|flac)$/i.test(name)) return "audio";
  return "file";
}

/** A small JPEG of a picked image for its chip and turn; none when the browser can't draw it. */
async function thumb(file: File, edge = 160): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, edge / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return c.toDataURL("image/jpeg", 0.82);
  } catch {
    return undefined;
  }
}

let picked = 0;

/** assistant-ui's attachment adapter over the page's `ready`: the chip runs while it works. */
function useFiles(files: AgentFiles | undefined) {
  const ready = useRef(files?.ready);
  ready.current = files?.ready;
  const sent = useRef(new Map<string, AgentSent>());
  const accept = files?.accept;
  const adapter = useMemo<AttachmentAdapter | undefined>(
    () =>
      accept === undefined
        ? undefined
        : {
            accept,
            async *add({ file }) {
              const kind = fileKind(file.type, file.name);
              const base = {
                id: `file-${(picked++).toString(36)}`,
                type: kind,
                name: file.name,
                contentType: file.type,
                file,
              };
              yield { ...base, status: { type: "running", reason: "uploading", progress: 0 } };
              try {
                const [data, src] = await Promise.all([
                  (ready.current ?? (async () => null))(file),
                  kind === "image" ? thumb(file) : undefined,
                ]);
                sent.current.set(base.id, {
                  file: { name: file.name, kind, size: file.size, ...(src ? { src } : {}) },
                  data,
                });
                yield {
                  ...base,
                  ...(src ? { content: [{ type: "image" as const, image: src }] } : {}),
                  status: { type: "requires-action", reason: "composer-send" },
                };
              } catch (e) {
                yield {
                  ...base,
                  status: {
                    type: "incomplete",
                    reason: "error",
                    message: e instanceof Error ? e.message : String(e),
                  },
                };
              }
            },
            async remove(a) {
              sent.current.delete(a.id);
            },
            async send(a) {
              if (!sent.current.has(a.id)) throw new Error(`${a.name} isn't ready`);
              return { ...a, status: { type: "complete" }, content: a.content ?? [] };
            },
          },
    [accept],
  );
  /** The turn's files, in the order they were added; each leaves the map once sent. */
  const take = (m: AppendMessage): AgentSent[] =>
    (m.attachments ?? []).flatMap((a) => {
      const f = sent.current.get(a.id);
      sent.current.delete(a.id);
      return f ? [f] : [];
    });
  return { adapter, take };
}

/** The reading column: replies, the box and the welcome share it. */

const COLUMN = "mx-auto w-full max-w-[46rem] px-[clamp(12px,3vw,28px)]";

export function AgentThread(p: AgentThreadProps) {
  const files = useFiles(p.files);
  const runtime = useExternalStoreRuntime<AgentMessage>({
    messages: p.messages,
    convertMessage: threadMessage,
    isRunning: p.running,
    isDisabled: !!p.closed || !!p.stale,
    onNew: async (m) => {
      const text = textOf(m).trim();
      const sent = files.take(m);
      if (text || sent.length) p.onSend(text, sent);
    },
    onCancel: async () => p.onStop(),
    onRespondToToolApproval: ({ approvalId, approved }) => p.onAnswer(approvalId, approved),
    ...(files.adapter ? { adapters: { attachments: files.adapter } } : {}),
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Answer.Provider value={p.onAnswer}>
        <ThreadPrimitive.Root className={cx("flex h-full min-h-0 flex-col", p.className)}>
          <ThreadPrimitive.Viewport
            aria-busy={p.stale || undefined}
            className="relative flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]"
          >
            <div
              className={cx(
                COLUMN,
                "grid gap-8 pt-6 pb-6 transition-opacity duration-200",
                p.stale && "opacity-50",
              )}
            >
              <ThreadPrimitive.Messages>
                {({ message }) => (message.role === "user" ? <UserTurn /> : <ReplyTurn />)}
              </ThreadPrimitive.Messages>
              {p.starting ? <Starting /> : null}
              {p.error ? (
                <Alert onRetry={p.error.retry} className="ui-rise mb-0">
                  {p.error.text}
                </Alert>
              ) : null}
            </div>
            <ThreadPrimitive.Empty>
              {p.welcome ? <Welcome {...p.welcome} /> : null}
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto bg-[linear-gradient(transparent,var(--ui-paper)_28px)] pt-7 pb-1">
              <div className={cx(COLUMN, "relative")}>
                <ThreadPrimitive.ScrollToBottom
                  className="absolute -top-11 left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-full bg-(--ui-paper) text-(--ui-ink-2) shadow-[inset_0_0_0_1px_var(--ui-hair),var(--ui-raise)] transition-opacity duration-200 hover:text-(--ui-ink) disabled:pointer-events-none disabled:opacity-0"
                  aria-label="Scroll to the newest"
                >
                  <Icon name="down" size={15} />
                </ThreadPrimitive.ScrollToBottom>
                <Composer
                  closed={p.closed}
                  placeholder={p.placeholder}
                  tools={p.tools}
                  files={!!p.files}
                  context={p.context}
                />
                {p.note ? (
                  <p className="mx-0 mt-2 mb-0 text-center text-[12px] text-(--ui-ink-3)">
                    {p.note}
                  </p>
                ) : null}
              </div>
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </Answer.Provider>
    </AssistantRuntimeProvider>
  );
}

/** Before the first turn: centred over the box, the prompts as quiet cards. */
function Welcome({
  title,
  text,
  suggestions,
}: {
  title: string;
  text?: string | undefined;
  suggestions?: readonly string[] | undefined;
}) {
  return (
    <div
      className={cx(COLUMN, "grid flex-1 content-center gap-5 py-10 [animation:ui-fade_.25s_both]")}
    >
      <div className="grid gap-1.5">
        <h2 className="m-0 text-[22px]/tight font-semibold tracking-[-0.01em] text-(--ui-ink)">
          {title}
        </h2>
        {text ? <p className="m-0 max-w-prose text-[14px] text-(--ui-ink-2)">{text}</p> : null}
      </div>
      {suggestions?.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {suggestions.map((s) => (
            <ThreadPrimitive.Suggestion
              key={s}
              prompt={s}
              send
              className="rounded-(--ui-leaf-box) bg-(--ui-paper) px-3.5 py-3 text-left text-[13.5px] text-(--ui-ink-2) shadow-[inset_0_0_0_1px_var(--ui-hair)] transition-[color,box-shadow] duration-150 hover:text-(--ui-ink) hover:shadow-[inset_0_0_0_1px_var(--ui-ink-3)]"
            >
              {s}
            </ThreadPrimitive.Suggestion>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Artifact 15 F3 `.msg`, mirrored to the right: the person's own turn. */
function UserTurn() {
  const words = useAuiState((s) => s.message.content.some((c) => c.type === "text" && !!c.text));
  const page = useAuiState(
    (s) => (s.message.metadata.custom as { page?: string } | undefined)?.page,
  );
  const said = useAuiState((s) =>
    s.message.content.map((c) => (c.type === "text" ? c.text : "")).join("\n"),
  );
  const urls = useMemo(() => linksIn(said), [said]);
  return (
    <MessagePrimitive.Root className="ui-rise grid min-w-0 justify-items-end gap-1.5">
      <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5 empty:hidden">
        <MessagePrimitive.Attachments>{() => <FileChip />}</MessagePrimitive.Attachments>
      </div>
      {words ? (
        <div className="max-w-[85%] whitespace-pre-wrap wrap-anywhere rounded-[14px_4px_14px_14px] bg-(--ui-wash) px-3.5 py-2.5 text-[14.5px]/[1.5] text-(--ui-ink)">
          <MessagePrimitive.Parts />
        </div>
      ) : null}
      {urls.map((u) => (
        <LinkCard key={u.href} url={u} />
      ))}
      {page ? (
        <span className="inline-flex max-w-[85%] items-center gap-1 text-[12px] text-(--ui-ink-3)">
          <Icon name="page" size={12} className="flex-none" />
          <span className="wrap-anywhere">{page}</span>
        </span>
      ) : null}
    </MessagePrimitive.Root>
  );
}

const FILE_ICON: Record<AgentFile["kind"], IconName> = {
  image: "image",
  pdf: "doc",
  video: "video",
  audio: "mic",
  file: "doc",
};

const bytes = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** One file, in the box or in a sent turn: the picture for an image, else its icon and name. */
function FileChip({ remove }: { remove?: boolean }) {
  const a = useAuiState((s) => s.attachment) as Attachment;
  const kind = (FILE_ICON[a.type as AgentFile["kind"]] ? a.type : "file") as AgentFile["kind"];
  const src = a.content?.find((c) => c.type === "image")?.image;
  const busy = a.status.type === "running";
  const failed =
    a.status.type === "incomplete" ? (a.status.message ?? "Couldn't add this file") : null;
  const size = a.file?.size;
  return (
    <AttachmentPrimitive.Root
      {...(failed ? tipProps(failed) : src ? tipProps(a.name) : {})}
      className={cx(
        "group/file relative flex max-w-60 items-center gap-2 rounded-[10px] bg-(--ui-paper) text-[12.5px] shadow-[inset_0_0_0_1px_var(--ui-hair)]",
        src ? "size-11 overflow-hidden p-0" : "min-h-11 py-1.5 pr-3 pl-1.5",
        failed && "shadow-[inset_0_0_0_1px_var(--ui-bad)]",
      )}
    >
      {src ? (
        <img src={src} alt={a.name} className="size-full object-cover" />
      ) : (
        <>
          <span
            className={cx(
              "grid size-8 flex-none place-items-center rounded-[7px] bg-(--ui-fill)",
              failed ? "text-(--ui-bad)" : "text-(--ui-ink-2)",
            )}
          >
            {busy ? <Ring /> : <Icon name={FILE_ICON[kind]} size={15} />}
          </span>
          <span className="grid min-w-0 leading-tight">
            <span className="text-(--ui-ink) wrap-anywhere">
              <AttachmentPrimitive.Name />
            </span>
            <span className={cx(failed ? "text-(--ui-bad)" : "text-(--ui-ink-3)")}>
              {failed ?? (busy ? "Adding" : size ? bytes(size) : kind === "pdf" ? "PDF" : kind)}
            </span>
          </span>
        </>
      )}
      {src && busy ? (
        <span className="absolute inset-0 grid place-items-center bg-(--ui-paper)/60">
          <Ring />
        </span>
      ) : null}
      {remove ? (
        <AttachmentPrimitive.Remove
          aria-label={`Remove ${a.name}`}
          className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-(--ui-ink) text-(--ui-canvas) opacity-0 shadow-(--ui-raise) transition-opacity duration-150 group-hover/file:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <Icon name="close" size={11} />
        </AttachmentPrimitive.Remove>
      ) : null}
    </AttachmentPrimitive.Root>
  );
}

function ReplyTurn() {
  return (
    <MessagePrimitive.Root className="ui-rise group/reply grid min-w-0 gap-3">
      <MessagePrimitive.Parts
        components={{
          Text: Reply,
          Reasoning: Thinking,
          tools: { Fallback: ToolRow },
          data: { by_name: { choices: Choices } },
          ToolGroup: Steps,
        }}
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
    className="ui-agent-text min-w-0 text-[14.5px]/[1.6] text-(--ui-ink) [overflow-wrap:anywhere]"
  >
    <Streamdown
      mode={status.type === "running" ? "streaming" : "static"}
      isAnimating={status.type === "running"}
      controls={{ code: true, table: false, mermaid: false }}
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
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-semibold hover:text-(--ui-ink-2) [&::-webkit-details-marker]:hidden">
        {status.type === "running" ? "Thinking" : "Thought"}
        <Icon name="down" size={12} className="transition-transform group-open:rotate-180" />
      </summary>
      <p className="mt-1.5 mb-0 whitespace-pre-wrap border-(--ui-hair) border-l-2 pl-3 text-[13.5px] text-(--ui-ink-2)">
        {text}
      </p>
    </details>
  );
};

const TOOL_ICON: Record<string, IconName> = { Bash: "code", Read: "read", Skill: "book" };

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

/** A call's name for a person: its description, else what it does in a few words. */
function toolTitle(name: string, input: Record<string, unknown>): string {
  if (typeof input.description === "string" && input.description) return input.description;
  const line = toolLine(name, input);
  if (name === "Read") return `Read ${line.split("/").pop() || "a file"}`;
  if (name === "Skill") return `Load the ${line || "a"} skill`;
  if (name === "Bash") return "Run a command";
  return name;
}

/** Seconds since `from` (else since it began), ticking while `on`. */
function useElapsed(on: boolean, from: number): string {
  const start = useRef(from || Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  const s = Math.max(0, Math.round((now - (from || start.current)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Runs of tool calls, one line: folded, it names the live step and the time; opens on a click or an ask. */
function Steps({
  startIndex,
  endIndex,
  children,
}: PropsWithChildren<{ startIndex: number; endIndex: number }>) {
  // one string, so the selector's answer is stable between renders
  const sum = useAuiState((s) => {
    const ps = s.message.parts.slice(startIndex, endIndex + 1);
    let live = 0;
    let asks = 0;
    let bad = 0;
    for (const x of ps) {
      if (x.type !== "tool-call") continue;
      const a = x.approval;
      if (a && a.approved === undefined && !a.resolution) asks++;
      else if (x.result === undefined && a?.approved !== false) live++;
      if (x.isError) bad++;
    }
    return `${ps.length}|${live}|${asks}|${bad}|${s.message.status?.type === "running" ? 1 : 0}`;
  });
  const [n, live, asks, bad, running] = sum.split("|").map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  // the live step's own name: the one line shown while the steps work, folded
  const now = useAuiState((s) => {
    for (const x of s.message.parts.slice(startIndex, endIndex + 1))
      if (x.type === "tool-call" && x.result === undefined && x.approval?.approved !== false)
        return toolTitle(x.toolName, (x.args ?? {}) as Record<string, unknown>);
    return "";
  });
  const from = useAuiState((s) => s.message.createdAt?.getTime() ?? 0);
  const [mine, setMine] = useState<boolean | null>(null);
  const busy = asks > 0 || (live > 0 && running > 0);
  const took = useElapsed(busy && !asks, from);
  if (n < 2) return <>{children}</>;
  const open = asks > 0 || (mine ?? false);
  const label =
    asks > 0
      ? "Waiting on you"
      : busy
        ? `${now || "Working"} · ${took}`
        : `Ran ${n} steps${bad ? `, ${bad} failed` : ""}`;
  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setMine(!open)}
        className="inline-flex items-center gap-2 justify-self-start text-[13px] font-semibold text-(--ui-ink-3) hover:text-(--ui-ink-2)"
      >
        {busy && !asks ? <Ring /> : <Icon name="list" size={14} />}
        <span key={busy ? now : label} className="[animation:ui-fade_.2s_both] tabular-nums">
          {label}
        </span>
        <Icon
          name="down"
          size={12}
          className={cx("transition-transform duration-200", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="ui-rise ml-[6px] grid gap-0.5 border-(--ui-hair) border-l pl-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** A tool call: one line that opens to its command and output; the ask in place when it asks. */
const ToolRow: ToolCallMessagePartComponent = (t) => {
  const input = (t.args ?? {}) as Record<string, unknown>;
  const line = toolLine(t.toolName, input) || t.argsText;
  const ask = t.approval;
  const asking = !!ask && ask.approved === undefined && !ask.resolution;
  const done = t.result !== undefined;
  const out = done && typeof t.result === "string" ? t.result.trim() : "";
  const [mine, setMine] = useState(false);
  const open = asking || mine;
  return (
    <div
      className={cx(
        "grid rounded-(--ui-leaf-box) transition-colors duration-200",
        asking && "bg-(--ui-wash) px-3 py-2.5",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        disabled={asking}
        onClick={() => setMine(!mine)}
        className="group/row flex min-w-0 items-center gap-2 py-1 text-left text-[13.5px] text-(--ui-ink-2) hover:text-(--ui-ink) disabled:cursor-default"
      >
        <Icon
          name={TOOL_ICON[t.toolName] ?? "bolt"}
          size={14}
          className="flex-none text-(--ui-ink-3)"
        />
        <span className="min-w-0 wrap-anywhere">{toolTitle(t.toolName, input)}</span>
        <span key={statusOf(t, asking, done)} className="flex-none [animation:ui-fade_.2s_both]">
          {asking ? (
            <Tag tone="warn">Waiting on you</Tag>
          ) : ask?.approved === false ? (
            <Tag>Denied</Tag>
          ) : t.isError ? (
            <Tag tone="bad">Failed</Tag>
          ) : done ? (
            <Icon name="check" size={14} className="text-(--ui-good)" />
          ) : t.status.type === "running" || t.status.type === "requires-action" ? (
            <Ring />
          ) : null}
        </span>
        {asking ? null : (
          <Icon
            name="down"
            size={12}
            className={cx(
              "flex-none text-(--ui-ink-3) opacity-0 transition-[opacity,rotate] duration-200 group-hover/row:opacity-100",
              open && "rotate-180 opacity-100",
            )}
          />
        )}
      </button>
      {open ? (
        <div className="ui-rise grid gap-2 pt-1 pb-2">
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap rounded-[4px_10px_4px_10px] bg-(--ui-canvas) px-3 py-2 font-mono text-[12.5px] text-(--ui-ink) shadow-[inset_0_0_0_1px_var(--ui-hair)] [overflow-wrap:anywhere]">
            {t.toolName === "Bash" ? `$ ${line}` : line}
          </pre>
          {asking ? (
            <div className="grid gap-2">
              <span className="text-[13.5px] text-(--ui-ink-2)">
                Claude agent asks to run this{ask?.prompt ? `: ${ask.prompt.toLowerCase()}` : "."}
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
          {out ? (
            <pre className="m-0 max-h-72 overflow-auto whitespace-pre-wrap px-3 font-mono text-[12px] text-(--ui-ink-2) [overflow-wrap:anywhere]">
              {out}
            </pre>
          ) : done ? (
            <span className="px-3 text-[12.5px] text-(--ui-ink-3)">No output.</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

/** The row's state, for the cross-fade when it changes. */
const statusOf = (
  t: {
    isError?: boolean | undefined;
    approval?: { approved?: boolean } | undefined;
    status: { type: string };
  },
  asking: boolean,
  done: boolean,
) =>
  asking
    ? "ask"
    : t.approval?.approved === false
      ? "denied"
      : t.isError
        ? "failed"
        : done
          ? "done"
          : t.status.type;

const MODEL_NAME: Record<string, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" };
const modelName = (m: string) =>
  MODEL_NAME[m] ?? MODEL_NAME[/claude-(\w+)/.exec(m)?.[1] ?? ""] ?? m;

const count = (n: number) =>
  n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);

/** Every token the turn moved: input, cache and output. */
const totalOf = (f: AgentFoot) =>
  (f.input ?? 0) + (f.output ?? 0) + (f.cacheRead ?? 0) + (f.cacheWrite ?? 0);

/** The turn's foot: model, time, tokens; the price only where a key pays it. */
export function footLine(foot: AgentFoot | null, state: string): string | null {
  const total = foot ? totalOf(foot) : 0;
  const bits = [
    state === "stopped" ? "Stopped" : state === "failed" ? "Failed" : null,
    foot?.model ? modelName(foot.model) : null,
    foot?.ms ? `${(foot.ms / 1000).toFixed(1)} s` : null,
    total ? `${count(total)} tokens` : null,
    foot?.cost && foot.plan === false ? usd(foot.cost) : null,
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : null;
}

/** The foot's detail, on hover: where the tokens went, and who pays. */
function footDetail(foot: AgentFoot | null): string | null {
  if (!foot || !totalOf(foot)) return null;
  const parts = [
    `${count(foot.input ?? 0)} in`,
    `${count(foot.output ?? 0)} out`,
    `${count(foot.cacheRead ?? 0)} cache read`,
    `${count(foot.cacheWrite ?? 0)} cache write`,
  ].join(", ");
  const pay =
    foot.plan === false
      ? foot.cost
        ? `Billed ${usd(foot.cost)} to the API key.`
        : "Billed to the API key."
      : foot.plan
        ? `On your Claude plan${foot.cost ? `: ${usd(foot.cost)} at API prices, not billed` : ""}.`
        : "";
  return `${parts}. ${pay}`.trim();
}

/** Nothing new on screen while the turn runs: no parts yet, or the last step just ended. */
function Pending() {
  const wait = useAuiState((s) => {
    if (s.message.status?.type !== "running") return false;
    const last = s.message.parts.at(-1);
    return !last || (last.type === "tool-call" && last.result !== undefined);
  });
  return wait ? (
    <span className="[animation:ui-fade_.2s_.3s_both]">
      <Tag tone="accent" busy>
        Thinking
      </Tag>
    </span>
  ) : null;
}

const ICON_BUTTON =
  "grid size-7 place-items-center rounded-(--ui-radius) text-(--ui-ink-3) transition-colors duration-150 hover:bg-(--ui-fill) hover:text-(--ui-ink)";

/** Copy, then the usage line; on older replies both wait for the pointer. */
function Foot() {
  const custom = useAuiState((s) => s.message.metadata.custom) as
    | { foot: AgentFoot | null; state: string }
    | undefined;
  const live = useAuiState((s) => s.message.status?.type === "running");
  if (live || !custom) return null;
  const line = footLine(custom.foot, custom.state);
  const detail = footDetail(custom.foot);
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="-ml-1.5 flex min-h-7 items-center gap-1 text-[12.5px] text-(--ui-ink-3) transition-opacity duration-200 data-floating:opacity-0 data-floating:group-hover/reply:opacity-100 [animation:ui-fade_.25s_both]"
    >
      <ActionBarPrimitive.Copy className={cx(ICON_BUTTON, "group/copy")} aria-label="Copy">
        <Icon name="copy" size={14} className="group-data-copied/copy:hidden" />
        <Icon
          name="check"
          size={14}
          className="hidden text-(--ui-good) group-data-copied/copy:block"
        />
      </ActionBarPrimitive.Copy>
      {line ? (
        <span
          className="cursor-default px-1 [font-variant-numeric:tabular-nums]"
          tabIndex={detail ? 0 : undefined}
          {...tipProps(detail, { side: "bottom" })}
        >
          {line}
        </span>
      ) : null}
    </ActionBarPrimitive.Root>
  );
}

/** Artifact 14: nothing under a second, then the ring and words. */
function Starting() {
  return (
    <div
      role="status"
      className="flex items-center gap-2 text-[13.5px] text-(--ui-ink-2) [animation:ui-fade_.2s_1s_both]"
    >
      <Ring />
      Starting Claude agent
    </div>
  );
}

/** One box: the words, then the model pick left and Send (Stop while a turn is out) right. */
function Composer({
  closed,
  placeholder,
  tools,
  files,
  context,
}: {
  closed?: string | null | undefined;
  placeholder?: string | undefined;
  tools?: ReactNode;
  files: boolean;
  context?: AgentThreadProps["context"];
}) {
  const running = useAuiState((s) => s.thread.isRunning);
  const box = (
    <ComposerPrimitive.Root className="grid rounded-[16px] bg-(--ui-paper) shadow-[inset_0_0_0_1px_var(--ui-hair),var(--ui-raise)] transition-shadow duration-150 focus-within:shadow-[inset_0_0_0_1px_var(--ui-focus),var(--ui-raise)] in-data-dragging:shadow-[inset_0_0_0_2px_var(--ui-active),var(--ui-raise)]">
      {context || files ? (
        <div className="flex flex-wrap items-center gap-2 px-3 pt-3 empty:hidden">
          {context ? (
            <span className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-[14px] py-1 bg-(--ui-fill) pr-1 pl-2.5 text-[12.5px] text-(--ui-ink-2) [animation:ui-fade_.15s_both]">
              <Icon name="page" size={13} className="flex-none" />
              <span className="min-w-0 wrap-anywhere">{context.label}</span>
              <button
                type="button"
                aria-label="Don't send this page"
                {...tipProps("Don't send this page")}
                onClick={context.onDrop}
                className="grid size-5 flex-none place-items-center rounded-full text-(--ui-ink-3) hover:bg-(--ui-wash) hover:text-(--ui-ink)"
              >
                <Icon name="close" size={11} />
              </button>
            </span>
          ) : null}
          {files ? (
            <ComposerPrimitive.Attachments>
              {() => <FileChip remove />}
            </ComposerPrimitive.Attachments>
          ) : null}
        </div>
      ) : null}
      <ComposerPrimitive.Input
        rows={1}
        maxRows={12}
        disabled={!!closed}
        placeholder={closed ?? placeholder ?? "Ask the agent"}
        aria-label="Message"
        className="w-full resize-none border-0 bg-transparent px-4 pt-3.5 pb-1.5 text-[14.5px]/[1.5] text-(--ui-ink) outline-none placeholder:text-(--ui-ink-3) disabled:cursor-not-allowed"
      />
      <div className="flex min-h-11 items-center gap-2 px-2.5 pb-2.5">
        {files ? (
          <ComposerPrimitive.AddAttachment
            multiple
            aria-label="Add files"
            {...tipProps("Add files: or drop or paste them")}
            className="grid size-8 flex-none place-items-center rounded-full text-(--ui-ink-2) transition-colors duration-150 hover:bg-(--ui-fill) hover:text-(--ui-ink) disabled:opacity-50"
          >
            <Icon name="attach" size={16} />
          </ComposerPrimitive.AddAttachment>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">{tools}</div>
        {running ? (
          <ComposerPrimitive.Cancel
            aria-label="Stop"
            {...tipProps("Stop", { keys: "Esc" })}
            className="grid size-8 flex-none place-items-center rounded-full bg-(--ui-ink) text-(--ui-canvas) [animation:ui-fade_.15s_both] hover:opacity-85"
          >
            <span className="size-2.5 rounded-[2px] bg-current" />
          </ComposerPrimitive.Cancel>
        ) : (
          <ComposerPrimitive.Send
            aria-label="Send"
            className="grid size-8 flex-none place-items-center rounded-full bg-(--ui-primary) text-(--ui-on-accent) [animation:ui-fade_.15s_both] hover:opacity-90 disabled:bg-(--ui-fill) disabled:text-(--ui-ink-3)"
          >
            <Icon name="arrowUp" size={16} />
          </ComposerPrimitive.Send>
        )}
      </div>
    </ComposerPrimitive.Root>
  );
  return files ? (
    <ComposerPrimitive.AttachmentDropzone>{box}</ComposerPrimitive.AttachmentDropzone>
  ) : (
    box
  );
}
