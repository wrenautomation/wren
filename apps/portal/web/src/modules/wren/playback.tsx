/**
 * Play on the canvas: a made-up lead (`LEAD`) walks the workflow, a dot along each wire, the
 * step lit, and beside the graph what the lead got at each step: the step's own template, live
 * now, rendered for the lead. A level with no copy of its own (the top) opens into the first
 * workflow it walks through and plays there. Reads; writes nothing.
 */
import type { RecordAnswer, RecordsPage } from "@wren/core/records/serve";
import { Button, type GraphDot, Section } from "@wren/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { call } from "../../api.js";
import type { Drawn } from "../marketplace/boxes.js";
import { QUIET } from "../work/bits.js";
import {
  BOOKING,
  beatOf,
  dayOf,
  fill,
  LEAD,
  type PlayStep,
  REPLY,
  sideOf,
  walkOf,
} from "./play.js";

type Row = Record<string, unknown>;
type Sample = { subject: string | null; body: string };
const scope = (client: string | null) => (client ? { client } : {});

const steps = new Map<string, Promise<Row[]>>();
/** Every sequence step and its template (`templates.step`), read once a session. */
function stepRows(client: string | null): Promise<Row[]> {
  const key = client ?? "";
  let got = steps.get(key);
  if (!got) {
    got = call<RecordsPage>("console/recordsList", {
      record: "templates.step",
      view: "all",
      limit: 500,
      ...scope(client),
    })
      .then((p) => p.rows as Row[])
      .catch(() => [] as Row[]);
    steps.set(key, got);
  }
  return got;
}

const samples = new Map<string, Promise<Sample | null>>();
/** A template's live words rendered for the made-up lead (`templates.template` detail). */
function sampleOf(id: string, client: string | null): Promise<Sample | null> {
  const key = `${client ?? ""}:${id}`;
  let got = samples.get(key);
  if (!got) {
    got = call<RecordAnswer>("console/recordsGet", {
      record: "templates.template",
      id,
      ...scope(client),
    })
      .then((a) => (a.detail as { live?: { sample?: Sample | null } | null } | null)?.live?.sample)
      .then((s) => s ?? null)
      .catch(() => null);
    samples.set(key, got);
  }
  return got;
}

/** A node's template: its own cadence step's, or the first step's of the sequence it opens. */
function templateOf(rows: readonly Row[], w: Drawn, node: string): string | null {
  const own = rows.find((r) => r.id === `${w.id}/${node}`);
  const opens = w.nodes.find((n) => n.id === node)?.opens;
  const r =
    own ??
    (opens
      ? rows
          .filter((x) => x.sequence_id === opens)
          .sort((a, b) => Number(a.step) - Number(b.step))[0]
      : undefined);
  return r?.template_id ? String(r.template_id) : null;
}

/** A node's copy for the node panel: its template and the words the made-up lead gets. */
export async function copyOf(
  w: Drawn,
  node: string,
  client: string | null,
): Promise<{ template: string; words: string | null } | null> {
  const id = templateOf(await stepRows(client), w, node);
  if (!id) return null;
  const t = await sampleOf(id, client);
  return {
    template: id,
    words: t ? fill(t.subject ? `Subject: ${t.subject}\n\n${t.body}` : t.body) : null,
  };
}

/**
 * What the lead got at each step, from the step's own template: a cadence step's, or for a
 * node that opens a sequence, its first step's. A reply or a booking is the lead's own line.
 */
async function wordsOf(
  w: Drawn,
  walk: readonly PlayStep[],
  client: string | null,
): Promise<(string | null)[]> {
  const rows = await stepRows(client);
  return Promise.all(
    walk.map(async (s) => {
      const id = templateOf(rows, w, s.box);
      if (id) {
        const t = await sampleOf(id, client);
        return t ? fill(t.subject ? `Subject: ${t.subject}\n\n${t.body}` : t.body) : null;
      }
      const ch = sideOf(s.uses, s.label);
      return ch === "reply" ? REPLY : ch === "booking" ? BOOKING : null;
    }),
  );
}

/**
 * `into` opens a card's inside on the canvas, playing there; `auto` starts it on arrival (the
 * level above opened into this one).
 */
export function usePlay(
  w: Drawn,
  client: string | null,
  { into, auto = false }: { into?: (opens: string) => void; auto?: boolean } = {},
) {
  const steps = useMemo(() => walkOf(w), [w]);
  const [run, setRun] = useState(0);
  const [at, setAt] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [words, setWords] = useState<(string | null)[]>([]);
  const playing = at >= 0 && at < steps.length;

  useEffect(() => {
    if (!playing) return;
    const next = steps[at + 1];
    const t = setTimeout(() => setAt(next ? at + 1 : steps.length), beatOf(next?.wait));
    return () => clearTimeout(t);
  }, [playing, at, steps]);

  const start = async () => {
    setLoading(true);
    const got = await wordsOf(w, steps, client);
    setLoading(false);
    // Nothing to read at this level: play inside a card it walks through, a sequence first.
    const inside = steps
      .map((s) => w.nodes.find((n) => n.id === s.box)?.opens)
      .filter((o): o is string => !!o && o !== w.id);
    const sequences = new Set((await stepRows(client)).map((r) => String(r.sequence_id)));
    const opens = inside.find((o) => sequences.has(o)) ?? inside[0];
    if (got.every((x) => !x) && opens && into) return into(opens);
    setWords(got);
    setRun((r) => r + 1);
    setAt(0);
  };
  const stop = () => setAt(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per arrival at this workflow.
  useEffect(() => {
    if (auto) void start();
  }, [auto, w.id]);

  const step = playing ? steps[at] : undefined;
  const dots: GraphDot[] = step
    ? [
        ...(step.edge
          ? [{ id: `play:${run}:${at}:wire`, edge: step.edge, tone: "accent" as const }]
          : []),
        { id: `play:${run}:${at}:card`, node: step.box, tone: "accent" },
      ]
    : [];
  const shown = at < 0 ? [] : steps.slice(0, Math.min(at + 1, steps.length));
  // The newest step stays in view inside the panel; the page doesn't move.
  const list = useRef<HTMLOListElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new step scrolls.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [shown.length]);

  const button =
    steps.length > 1 ? (
      <Button
        tone="secondary"
        size="dense"
        disabled={loading}
        onClick={playing ? stop : () => void start()}
      >
        {playing ? "Stop" : loading ? "Reading copy" : at >= 0 ? "Play again" : "Play"}
      </Button>
    ) : null;

  const panel =
    at >= 0 ? (
      <Section
        title="Play"
        className="min-[1100px]:sticky min-[1100px]:top-4"
        note={`${LEAD.name} of ${LEAD.company} is made up. Waits are cut to a second or two; nothing is sent.`}
      >
        <ol ref={list} className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1">
          {/* A walk never visits a card twice, so its card names the step. */}
          {shown.map((s, i) => (
            <li
              key={s.box}
              className={`grid gap-1 border-l-2 pl-4 text-[14px] ${
                s.box === step?.box ? "border-(--ui-accent)" : "border-(--ui-hair)"
              }`}
            >
              <span className={`text-[12.5px] ${QUIET}`}>
                {dayOf(steps.slice(0, i + 1).map((x) => x.wait))}
                {s.wait ? ` · after ${s.wait}` : ""}
              </span>
              <span className="font-medium">{s.label}</span>
              {words[i] ? (
                <p className="max-w-[68ch] whitespace-pre-line text-(--ui-ink-2)">{words[i]}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </Section>
    ) : null;

  return { dots, focus: step ? [step.box] : undefined, button, panel, playing };
}
