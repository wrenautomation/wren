/**
 * A test call: the real call loop (`runCall`) in this browser, on fakes. Typed, through the text
 * transport, or spoken, through the browser's own speech. The brain is the rule-based one and the
 * calendar, leads and messages are samples, so nothing is dialed, booked or spent. When it ends
 * the call is saved with its timed turns (`voice/saveTest`), so Calls and Latency show it.
 */
import { Alert, Button, Facts, Input, PageHeader, Section, Tag } from "@wren/ui";
import {
  type AgentSettings,
  agentOf,
  BrowserTransport,
  type CallResult,
  fakePorts,
  type Line,
  runCall,
  SAMPLE_LEADS,
  ScriptedBrain,
  type SpeechApi,
  TextTransport,
  type Turn,
} from "@wren/voice";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { call } from "../../api.js";
import type { PageProps } from "../../module.js";
import { SELECT } from "../work/bits.js";
import { useAgent } from "./agent.js";
import { Bubble, InDevelopment, Lines, QUIET, SMALL, TOOL_LABEL, TurnTimes } from "./bits.js";
import { browserSpeech, speechSupport } from "./speech.js";

type Mode = "typed" | "spoken";

const UNKNOWN = "+15555550199";
const CALLERS: [number: string, label: string][] = [
  ...Object.entries(SAMPLE_LEADS).map(([n, l]): [string, string] => [n, `${l.name}, ${l.company}`]),
  [UNKNOWN, "A number we don't know"],
];

const TRY = [
  "I'd like to book a call",
  "The first one works",
  "Can I talk to a person?",
  "Can you take a message?",
  "That's all, bye",
];

const OUTCOME: Record<CallResult["outcome"], string> = {
  booked: "Booked a call",
  transferred: "Put through",
  message: "Took a message",
  ended: "The agent ended it",
  hung_up: "The caller hung up",
  timed_out: "Ran past the limit",
  failed: "Failed",
};

/** The live call: what the page draws while it runs. */
interface Live {
  mode: Mode;
  transport: TextTransport | BrowserTransport;
  lines: Line[];
  /** The agent's sentences out but not yet in the transcript. */
  speaking: string[];
  /** The caller's words not final yet (spoken). */
  partial: string;
  turns: Turn[];
  started: number;
}

type Saved =
  | { state: "saving" }
  | { state: "saved"; id: number }
  | { state: "failed"; why: string };

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const ms = (n: number | null) =>
  n === null ? null : Math.min(600_000, Math.max(0, Math.round(n)));

/** The finished call as `saveTest` takes it. */
function testCallOf(r: CallResult) {
  return {
    pipeline: clip(r.pipeline, 200),
    outcome: r.outcome,
    transcript: r.transcript.slice(0, 400).map((l) => ({
      who: l.who,
      text: clip(l.text, 4000),
      ...(l.tool ? { tool: clip(l.tool, 40) } : {}),
    })),
    turns: r.turns.slice(0, 400).map((t) => ({
      n: t.n,
      caller: clip(t.caller, 4000),
      agent: clip(t.agent, 4000),
      tools: t.tools.slice(0, 20).map((x) => clip(x, 40)),
      speculative: t.speculative,
      barged: t.barged,
      ms: {
        final: ms(t.ms.final),
        end: ms(t.ms.end),
        token: ms(t.ms.token),
        audio: ms(t.ms.audio),
        heard: ms(t.ms.heard),
      },
    })),
    message: r.message === null ? null : clip(r.message, 4000),
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt.toISOString(),
  };
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function TestCall({ demo }: PageProps) {
  const agent = useAgent();
  const [mode, setMode] = useState<Mode>("typed");
  const [from, setFrom] = useState(CALLERS[0]?.[0] ?? UNKNOWN);
  const [, setTick] = useState(0);
  const live = useRef<Live | null>(null);
  const [result, setResult] = useState<CallResult | null>(null);
  const [broke, setBroke] = useState<string | null>(null);
  const [mic, setMic] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [now, setNow] = useState(Date.now());
  const spoken = speechSupport();
  const bump = () => setTick((t) => t + 1);
  const on = live.current !== null && result === null && broke === null;

  // The clock while the call runs.
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);

  // Leaving the page hangs up.
  useEffect(() => () => live.current?.transport.leave(), []);

  const save = async (r: CallResult) => {
    if (demo) return;
    setSaved({ state: "saving" });
    try {
      const out = await call<{ id: number }>("voice/saveTest", { call: testCallOf(r) });
      setSaved({ state: "saved", id: out.id });
    } catch (err) {
      setSaved({ state: "failed", why: err instanceof Error ? err.message : String(err) });
    }
  };

  const start = (settings: AgentSettings) => {
    setResult(null);
    setBroke(null);
    setMic(null);
    setSaved(null);
    const callStart = { id: crypto.randomUUID(), from, to: "", direction: "test" as const };
    const callee = {
      said: (text: string) => {
        live.current?.speaking.push(text);
        bump();
      },
      ended: () => bump(),
    };
    let transport: TextTransport | BrowserTransport;
    if (mode === "spoken") {
      const speech = browserSpeech();
      // The caller's words as they come, for the page; the transport gets them too.
      const heard: SpeechApi = {
        ...speech,
        listen: (o) =>
          speech.listen({
            ...o,
            partial: (text) => {
              if (live.current) live.current.partial = text;
              bump();
              o.partial(text);
            },
            final: (text) => {
              if (live.current) live.current.partial = "";
              bump();
              o.final(text);
            },
          }),
      };
      transport = new BrowserTransport(callStart, heard, { ...callee, error: setMic });
    } else transport = new TextTransport(callStart, callee);
    const here: Live = {
      mode,
      transport,
      lines: [],
      speaking: [],
      partial: "",
      turns: [],
      started: Date.now(),
    };
    live.current = here;
    setNow(Date.now());
    runCall({
      pipeline: { transport, brain: new ScriptedBrain({ tokenMs: mode === "typed" ? 30 : 0 }) },
      agent: settings,
      ports: fakePorts(),
      onLine: (l) => {
        here.lines.push(l);
        if (l.who === "agent") here.speaking = [];
        bump();
      },
      onTurn: (t) => {
        here.turns.push(t);
        bump();
      },
    }).then(
      (r) => {
        if (live.current !== here) return;
        here.speaking = [];
        setResult(r);
        void save(r);
      },
      (err: unknown) => {
        if (live.current === here) setBroke(err instanceof Error ? err.message : String(err));
      },
    );
  };

  const settings = agent.data?.agent ?? (agent.error ? agentOf({}) : null);
  const l = live.current;
  return (
    <>
      <PageHeader
        title="Test call"
        lede="Call the agent the way a caller would. It runs in this browser on sample data, so nothing is dialed or booked."
      />
      <InDevelopment>
        A rule-based brain stands in for the model until setup. A spoken call uses your browser's
        own speech, so it sounds robotic and timings run slower than on the phone line.
      </InDevelopment>
      {agent.error && !agent.data ? (
        <Alert onRetry={agent.retry}>
          Couldn't read the agent's settings, so a call uses the defaults. {agent.error.message}
        </Alert>
      ) : null}
      <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <section
          aria-label="The call"
          className="grid min-w-0 overflow-hidden rounded-(--ui-radius) bg-(--ui-tile) shadow-[inset_0_0_0_1px_var(--ui-hair)]"
        >
          <CallHead live={l} on={on} now={now} result={result} broke={broke} />
          <Transcript live={l} result={result} />
          <div className="border-t border-(--ui-hair) bg-(--ui-paper) p-4">
            {on && l ? (
              l.mode === "typed" ? (
                <Composer
                  transport={l.transport as TextTransport}
                  onHangUp={() => l.transport.leave()}
                />
              ) : (
                <Listening partial={l.partial} mic={mic} onHangUp={() => l.transport.leave()} />
              )
            ) : (
              <Setup
                mode={mode}
                setMode={setMode}
                from={from}
                setFrom={setFrom}
                spoken={spoken}
                again={l !== null}
                ready={settings !== null}
                onStart={() => settings && start(settings)}
              />
            )}
          </div>
        </section>
        <aside className="grid min-w-0 gap-8">
          <Section
            title="Turn timing"
            note="From the moment the caller stops, until they hear the agent."
          >
            <TurnTimes turns={result?.turns ?? l?.turns ?? []} />
          </Section>
          {result ? <Summary result={result} saved={saved} demo={demo} /> : null}
        </aside>
      </div>
    </>
  );
}

function CallHead({
  live,
  on,
  now,
  result,
  broke,
}: {
  live: Live | null;
  on: boolean;
  now: number;
  result: CallResult | null;
  broke: string | null;
}) {
  const state = broke ? "Broke" : result ? OUTCOME[result.outcome] : on ? "On the call" : "Ready";
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-(--ui-hair) bg-(--ui-paper) px-4 py-2.5">
      <span className="flex items-center gap-2.5 text-[14px] font-medium" aria-live="polite">
        <span
          aria-hidden
          className={[
            "size-2 rounded-full",
            on ? "animate-pulse bg-(--ui-accent) motion-reduce:animate-none" : "bg-(--ui-hair)",
          ].join(" ")}
        />
        {state}
      </span>
      <span className={`${SMALL} tabular-nums`}>
        {live
          ? clock(
              Math.max(0, Math.floor(((result?.endedAt.getTime() ?? now) - live.started) / 1000)),
            )
          : ""}
      </span>
    </div>
  );
}

function Transcript({ live, result }: { live: Live | null; result: CallResult | null }) {
  const box = useRef<HTMLOListElement>(null);
  const lines = result?.transcript ?? live?.lines ?? [];
  const speaking = live?.speaking.join(" ") ?? "";
  const partial = live?.partial ?? "";
  // Follow the newest line, as a chat does.
  useEffect(() => {
    const b = box.current;
    if (b) b.scrollTop = b.scrollHeight;
  });
  return (
    <ol
      ref={box}
      aria-label="Transcript"
      aria-live="polite"
      className="grid h-[min(56vh,480px)] min-h-72 content-start gap-2.5 overflow-y-auto overscroll-contain px-4 py-5"
    >
      {!live ? (
        <li className={`m-auto max-w-[36ch] text-center ${QUIET}`}>
          Start a call. The agent speaks first, as it would on the phone.
        </li>
      ) : null}
      <Lines lines={lines} />
      {!result && speaking ? (
        <Bubble who="agent" live>
          {speaking}
        </Bubble>
      ) : null}
      {!result && partial ? (
        <Bubble who="caller" live>
          {partial}
        </Bubble>
      ) : null}
    </ol>
  );
}

function Setup(o: {
  mode: Mode;
  setMode(m: Mode): void;
  from: string;
  setFrom(n: string): void;
  spoken: ReturnType<typeof speechSupport>;
  again: boolean;
  ready: boolean;
  onStart(): void;
}) {
  const modes: [Mode, string][] = [
    ["typed", "Type"],
    ["spoken", "Talk"],
  ];
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-[13px] text-(--ui-ink-2)">How</legend>
        <div className="flex">
          {modes.map(([m, label]) => {
            const off = m === "spoken" && !o.spoken.ok;
            return (
              <Button
                key={m}
                size="dense"
                tone={o.mode === m ? "primary" : "secondary"}
                aria-pressed={o.mode === m}
                disabled={off}
                title={off && !o.spoken.ok ? o.spoken.why : undefined}
                onClick={() => o.setMode(m)}
                className="rounded-none first:rounded-l-(--ui-radius) last:rounded-r-(--ui-radius)"
              >
                {label}
              </Button>
            );
          })}
        </div>
      </fieldset>
      <label className="grid min-w-0 grow basis-[220px] gap-1.5 text-[13px] text-(--ui-ink-2)">
        <span>Calling from</span>
        <select className={SELECT} value={o.from} onChange={(e) => o.setFrom(e.target.value)}>
          {CALLERS.map(([n, label]) => (
            <option key={n} value={n}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <Button size="dense" icon="phone" disabled={!o.ready} onClick={o.onStart}>
        {o.again ? "Call again" : "Start call"}
      </Button>
      {o.mode === "spoken" ? (
        <p className={`basis-full ${SMALL}`}>
          Your browser asks for the microphone. Headphones keep the agent from hearing itself.
        </p>
      ) : !o.spoken.ok ? (
        <p className={`basis-full ${SMALL}`}>{o.spoken.why}</p>
      ) : null}
    </div>
  );
}

function Composer({ transport, onHangUp }: { transport: TextTransport; onHangUp(): void }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const send = (line: string) => {
    if (!line.trim()) return;
    transport.type(line.trim());
    setText("");
    input.current?.focus();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };
  return (
    <div className="grid gap-3">
      <form onSubmit={submit} className="flex items-center gap-2">
        <Input
          ref={input}
          value={text}
          maxLength={500}
          placeholder="Say something as the caller"
          aria-label="What the caller says"
          onChange={(e) => setText(e.target.value)}
          className="h-9 min-w-0 flex-1 text-[14.5px]"
        />
        <Button size="dense" type="submit" disabled={!text.trim()}>
          Send
        </Button>
        <Button size="dense" tone="secondary" onClick={onHangUp}>
          Hang up
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={SMALL}>Try</span>
        {TRY.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => send(t)}
            className="cursor-pointer rounded-(--ui-radius) px-2 py-1 text-[13px] text-(--ui-ink-2) shadow-[inset_0_0_0_1px_var(--ui-hair)] transition-colors hover:bg-(--ui-hover) hover:text-(--ui-ink)"
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

function Listening({
  partial,
  mic,
  onHangUp,
}: {
  partial: string;
  mic: string | null;
  onHangUp(): void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {mic ? (
        <p className="text-[13.5px] text-(--ui-bad)">{mic}</p>
      ) : (
        <p className="flex items-center gap-2.5 text-[14px]">
          <span aria-hidden className="flex h-4 items-end gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1 animate-pulse rounded-full bg-(--ui-accent) motion-reduce:animate-none"
                style={{
                  height: `${partial ? 100 : 40 + i * 20}%`,
                  animationDelay: `${i * 150}ms`,
                }}
              />
            ))}
          </span>
          {partial ? "Hearing you" : "Listening"}
        </p>
      )}
      <Button size="dense" tone="secondary" onClick={onHangUp}>
        Hang up
      </Button>
    </div>
  );
}

function Summary({
  result,
  saved,
  demo,
}: {
  result: CallResult;
  saved: Saved | null;
  demo: boolean;
}) {
  const tools = result.transcript.filter((l) => l.who === "tool").map((l) => l.tool ?? "tool");
  const heard = result.turns
    .filter((t) => t.n > 0 && t.ms.heard !== null)
    .map((t) => t.ms.heard as number)
    .sort((a, b) => a - b);
  const p50 = heard.length ? heard[Math.floor((heard.length - 1) / 2)] : undefined;
  return (
    <Section title="How it went">
      <div className="grid gap-4">
        <Facts
          items={[
            [
              "Outcome",
              <Tag key="o" tone={result.outcome === "failed" ? "neutral" : "green"}>
                {OUTCOME[result.outcome]}
              </Tag>,
            ],
            [
              "Caller",
              result.lead
                ? `${result.lead.name}, ${result.lead.company ?? ""}`.replace(/, $/, "")
                : "Unknown",
            ],
            ["Booked", result.booking ? result.booking.start.toLocaleString() : "No"],
            ...(result.message ? [["Message", result.message] as [string, string]] : []),
            ["Tools", tools.length ? tools.map((t) => TOOL_LABEL[t] ?? t).join(", ") : "None"],
            ["Heard after, p50", p50 === undefined ? "No turns" : `${Math.round(p50)} ms`],
            ["Pipeline", result.pipeline],
          ]}
        />
        {demo ? null : saved?.state === "saved" ? (
          <p className={SMALL}>
            Saved. <a href={`/voice/calls/${saved.id}`}>Open it in Calls</a>
          </p>
        ) : saved?.state === "failed" ? (
          <Alert>Couldn't save it. {saved.why}</Alert>
        ) : saved?.state === "saving" ? (
          <p className={SMALL}>Saving…</p>
        ) : null}
      </div>
    </Section>
  );
}
