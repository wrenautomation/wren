/**
 * Play on the canvas: a made-up lead (`LEAD`) walks the workflow, a dot along each wire, the
 * step lit, and under the graph what the lead got at each step in the copy that's live now.
 * Reads copy; writes nothing.
 */
import type { RecordAnswer, RecordsPage } from "@wren/core/records/serve";
import { Button, type GraphDot, Section } from "@wren/ui";
import { useEffect, useMemo, useState } from "react";
import { call } from "../../api.js";
import type { Drawn } from "../marketplace/boxes.js";
import { QUIET } from "../work/bits.js";
import {
  BOOKING,
  beatOf,
  type Channel,
  channelOf,
  dayOf,
  fill,
  LEAD,
  type PlayStep,
  REPLY,
  walkOf,
} from "./play.js";

/** The copy live now, by channel, in send order. */
interface Copy {
  email: { subject: string; body: string }[];
  text: string[];
  dm: string[];
}

type Row = Record<string, unknown>;
const list = (record: string, client: string | null) =>
  call<RecordsPage>("console/recordsList", {
    record,
    view: "all",
    limit: 100,
    ...(client ? { client } : {}),
  })
    .then((p) => p.rows as Row[])
    .catch(() => [] as Row[]);

const copies = new Map<string, Promise<Copy>>();
/** Read once a session: the opener and follow-ups that sent most, and the written texts and DMs. */
function copyOf(client: string | null): Promise<Copy> {
  const key = client ?? "";
  let got = copies.get(key);
  if (!got) {
    got = (async () => {
      const [variants, texts, dms] = await Promise.all([
        list("email.variant", client),
        list("marketing.text_copy", client),
        list("marketing.dm_copy", client),
      ]);
      const steps = ["Opener", "Follow-up 1", "Follow-up 2", "Follow-up 3"];
      const ids = steps.flatMap((s) => {
        const r = variants.find((v) => v.step === s);
        return r ? [String(r.id)] : [];
      });
      const email = (
        await Promise.all(
          ids.map((id) =>
            call<RecordAnswer>("console/recordsGet", {
              record: "email.variant",
              id,
              ...(client ? { client } : {}),
            })
              .then((a) => (a.detail as { email?: { subject: string; body: string } | null }).email)
              .catch(() => null),
          ),
        )
      ).flatMap((e) => (e ? [e] : []));
      const bodies = (rows: Row[]) =>
        rows
          .filter((r) => typeof r.body === "string" && r.body && !String(r.id).endsWith(".subject"))
          .map((r) => String(r.body));
      return { email, text: bodies(texts), dm: bodies(dms) };
    })();
    copies.set(key, got);
  }
  return got;
}

/** What the lead got at each step: the k-th email step the k-th email, and so on. */
function wordsOf(steps: readonly PlayStep[], copy: Copy | null): (string | null)[] {
  const seen: Record<string, number> = {};
  return steps.map((s) => {
    const ch: Channel = channelOf(s.uses, s.label);
    if (ch === "reply") return REPLY;
    if (ch === "booking") return BOOKING;
    if (!ch || !copy) return null;
    const k = seen[ch] ?? 0;
    seen[ch] = k + 1;
    if (ch === "email") {
      const e = copy.email[k] ?? copy.email.at(-1);
      return e ? `Subject: ${fill(e.subject)}\n\n${fill(e.body)}` : null;
    }
    const t = copy[ch][k] ?? copy[ch].at(-1);
    return t ? fill(t) : null;
  });
}

export function usePlay(w: Drawn, client: string | null) {
  const steps = useMemo(() => walkOf(w), [w]);
  const [run, setRun] = useState(0);
  const [at, setAt] = useState(-1);
  const [copy, setCopy] = useState<Copy | null>(null);
  const playing = at >= 0 && at < steps.length;

  useEffect(() => {
    if (!playing) return;
    const next = steps[at + 1];
    const t = setTimeout(() => setAt(next ? at + 1 : steps.length), beatOf(next?.wait));
    return () => clearTimeout(t);
  }, [playing, at, steps]);

  const start = () => {
    setRun((r) => r + 1);
    setAt(0);
    void copyOf(client).then(setCopy);
  };
  const stop = () => setAt(-1);

  const step = playing ? steps[at] : undefined;
  const dots: GraphDot[] = step
    ? [
        ...(step.edge
          ? [{ id: `play:${run}:${at}:wire`, edge: step.edge, tone: "accent" as const }]
          : []),
        { id: `play:${run}:${at}:card`, node: step.box, tone: "accent" },
      ]
    : [];
  const words = useMemo(() => wordsOf(steps, copy), [steps, copy]);
  const shown = at < 0 ? [] : steps.slice(0, Math.min(at + 1, steps.length));

  const button =
    steps.length > 1 ? (
      <Button tone="secondary" size="dense" onClick={playing ? stop : start}>
        {playing ? "Stop" : at >= 0 ? "Play again" : "Play"}
      </Button>
    ) : null;

  const panel =
    at >= 0 ? (
      <Section
        title="Play"
        className="mt-8"
        note={`${LEAD.name} of ${LEAD.company} is made up. Waits are cut to a second or two; nothing is sent.`}
      >
        <ol className="grid gap-4">
          {/* A walk never visits a card twice, so its card names the step. */}
          {shown.map((s, i) => (
            <li key={s.box} className="grid gap-1 border-l-2 border-(--ui-accent) pl-4 text-[14px]">
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
