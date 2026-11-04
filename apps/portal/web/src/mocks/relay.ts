/**
 * A fake `wren agent serve` for page stories. msw answers the relay's address and replays a tape
 * from the real relay (`wren agent serve --tape <dir>`, then packages/agent/scripts/scrub-tape.mjs).
 * The page, the SDK and the thread code are the real ones: only the frames are recorded.
 * Control requests answer from the tapes by subtype; a turn plays at its recorded pace (each gap
 * capped), waits on each permission ask, and jumps to the recorded stop on an interrupt.
 */
import { HttpResponse, http, ws } from "msw";
import { HTTP, RELAY, type SetupInfo } from "../modules/agent/connect.js";

type Frame = Record<string, unknown> & { type?: string };
export interface TapeLine {
  /** ms from the tape's first frame */
  t: number;
  from: "page" | "cli" | "relay";
  frame: Frame;
}
type Tape = readonly TapeLine[];

const sub = (f: Frame) => (f.request as { subtype?: string } | undefined)?.subtype;
const asks = (f: Frame) => (f.response as { request_id?: string } | undefined)?.request_id;

interface Reply {
  sub: string;
  /** when the page asked, and in which of its turns */
  t: number;
  turn: number;
  response: Frame;
}

/** Replies to the page's control requests, with when it asked: answers depend on the chat's state. */
function repliesOf(tape: Tape): Reply[] {
  const out: Reply[] = [];
  const asked = new Map<string, { sub: string; t: number; turn: number }>();
  let turn = -1;
  for (const { t, from, frame } of tape) {
    if (from === "page" && frame.type === "user") turn++;
    if (from === "page" && frame.type === "control_request")
      asked.set(String(frame.request_id), { sub: sub(frame) ?? "", t, turn: Math.max(turn, 0) });
    const a = frame.type === "control_response" && from !== "page" && asked.get(asks(frame) ?? "");
    if (a) out.push({ ...a, response: frame.response as Frame });
  }
  return out;
}

interface Turn {
  lines: TapeLine[];
  /** index after the recorded interrupt: where a stop jumps to */
  cut?: number;
}

/** What the CLI and the relay sent after each of the page's turns. */
function turnsOf(tape: Tape): Turn[] {
  const asked = new Set<string>();
  const turns: Turn[] = [];
  const pre: TapeLine[] = [];
  for (const line of tape) {
    const { from, frame } = line;
    const now = turns.at(-1);
    if (from === "page") {
      if (frame.type === "user") turns.push({ lines: turns.length ? [] : pre });
      if (frame.type !== "control_request") continue;
      asked.add(String(frame.request_id));
      if (sub(frame) === "interrupt" && now) now.cut = now.lines.length;
      continue;
    }
    if (frame.type === "control_response" && asked.has(asks(frame) ?? "")) continue;
    (now?.lines ?? pre).push(line);
  }
  return turns;
}

export interface FakeRelay {
  /** The chat to replay. */
  tape: Tape;
  /** Tapes whose control replies the page may also ask for (get_settings, get_task_output …). */
  library?: readonly Tape[];
  /** `GET /setups` */
  setups: SetupInfo[];
  /** Stored chats: id → frames (`GET /s/<setup>/sessions/<id>`), listed newest first. */
  stored?: readonly {
    session: string;
    at: string;
    title?: string;
    frames: Record<string, unknown>[];
  }[];
  /** A gap between frames never runs longer than this (ms). */
  gap?: number;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function fakeRelay({ tape, library = [], setups, stored = [], gap = 400 }: FakeRelay) {
  const own = repliesOf(tape);
  const lib = library.flatMap(repliesOf);
  // the reply recorded nearest this point: the next one in this turn, else the last before it
  const reply = (s: string, turn: number, now: number): Frame => {
    const mine = own.filter((r) => r.sub === s);
    const r =
      mine.find((x) => x.turn === turn && x.t >= now) ??
      mine.findLast((x) => x.t <= now) ??
      mine[0] ??
      lib.find((x) => x.sub === s);
    return r?.response ?? { subtype: "success", response: {} };
  };
  const link = ws.link(`${RELAY}/*`);
  return [
    http.get(`${HTTP}/setups`, () => HttpResponse.json(setups)),
    http.get(`${HTTP}/s/:setup/sessions`, () =>
      HttpResponse.json(stored.map(({ frames: _, ...row }) => row)),
    ),
    http.get(`${HTTP}/s/:setup/sessions/:id`, ({ params }) => {
      const s = stored.find((x) => x.session === params.id);
      return s
        ? HttpResponse.json(s.frames)
        : HttpResponse.json({ error: "no such chat" }, { status: 404 });
    }),
    http.patch(`${HTTP}/s/:setup/sessions/:id`, () => HttpResponse.json({ ok: true })),
    http.get(`${HTTP}/s/:setup/file`, () => new HttpResponse(null, { status: 404 })),
    link.addEventListener("connection", ({ client }) => {
      const turns = turnsOf(tape);
      let now = 0;
      const send = (f: Frame, t?: number) => {
        if (t !== undefined) now = t;
        // the CLI stamps some frames; a replay's clock is now
        const g =
          typeof f.timestamp === "string" ? { ...f, timestamp: new Date().toISOString() } : f;
        client.send(`${JSON.stringify(g)}\n`);
      };
      const allowed = new Map<string, () => void>();
      let authed = false;
      let next = 0;
      let queued = 0;
      let playing = false;
      let stop: (() => void) | null = null;
      let closed = false;
      client.addEventListener("close", () => {
        closed = true;
        stop?.();
      });

      const play = async (turn: Turn | undefined) => {
        playing = true;
        let i = 0;
        let jumped = false;
        stop = () => {
          jumped = true;
          if (turn?.cut != null) i = turn.cut;
          for (const go of allowed.values()) go();
        };
        const lines = turn?.lines ?? [];
        while (i < lines.length && !closed) {
          const line = lines[i];
          const before = lines[i - 1];
          i++;
          if (!line) break;
          if (!jumped && before) await wait(Math.min(line.t - before.t, gap));
          if (closed) break;
          send(line.frame, line.t);
          if (line.frame.type === "control_request" && !jumped)
            await new Promise<void>((r) => allowed.set(String(line.frame.request_id), r));
          // a stop with no recorded one: the turn ends where it is
          if (jumped && turn?.cut == null) break;
        }
        stop = null;
        playing = false;
        if (queued > 0 && !closed) {
          queued--;
          void play(turns[next++]);
        }
      };

      client.addEventListener("message", (e) => {
        for (const raw of String(e.data).split("\n")) {
          if (!raw.trim()) continue;
          const f = JSON.parse(raw) as Frame;
          if (!authed) {
            authed = f.type === "auth";
            continue;
          }
          if (f.type === "control_request") {
            const s = sub(f) ?? "";
            const r = reply(s, Math.max(next - 1, 0), now);
            send({ type: "control_response", response: { ...r, request_id: f.request_id } });
            if (s === "interrupt") stop?.();
          } else if (f.type === "control_response") {
            const id = asks(f) ?? "";
            allowed.get(id)?.();
            allowed.delete(id);
          } else if (f.type === "user") {
            if (playing) queued++;
            else void play(turns[next++]);
          }
        }
      });
    }),
  ];
}

/** The text of each turn the page sent on the tape, in order: what a story types. */
export const typedOn = (tape: Tape): string[] =>
  tape
    .filter((x) => x.from === "page" && x.frame.type === "user")
    .map((x) => {
      const c = (x.frame.message as { content: unknown }).content;
      return typeof c === "string"
        ? c
        : ((c as { type: string; text?: string }[]).find((b) => b.type === "text")?.text ?? "");
    });
