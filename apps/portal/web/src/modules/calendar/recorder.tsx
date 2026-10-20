/**
 * Calls recorded on William's Mac (designs/2026-10-16-call-recording.md). `RecorderBar` heads
 * Calendar > Calls and Pipelines > Calls: Record now, or Stop and since when, read from the Mac.
 * `recordingExtras` is a recording's page: the video (the shell's player), the notes, then the transcript.
 */
import type { RecorderState } from "@wren/calendar/recorder";
import type { RecordingDetail } from "@wren/calendar/records";
import type { CallNotes } from "@wren/channel-email/calls";
import { modelLabel } from "@wren/core/models/labels";
import { Button, type RecordExtras, tipProps } from "@wren/ui";
import { type ReactNode, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { ListPage } from "../../module.js";
import { PlayerSlot } from "../../player/index.js";
import { pipelinesAt } from "../deals/id.js";

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Record now or Stop, with what the Mac says; one press at a time. */
export function RecorderBar() {
  const got = useCall("calendar-recorder", () => call<RecorderState>("calendar/recorder", {}), {
    kept: false,
  });
  const [state, setState] = useState<RecorderState | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const now = state ?? got.data;
  const press = (what: "record" | "stopRecording") => {
    setBusy(true);
    setSaid(null);
    call<RecorderState>(`calendar/${what}`, {})
      .then((s) => {
        setState(s);
        if (what === "stopRecording") setSaid("Recording stopped. Notes in a few minutes.");
      })
      .catch((e: unknown) => setSaid(why(e)))
      .finally(() => setBusy(false));
  };
  const line = said ?? (got.error && !state ? "The Mac didn't answer. Is it on?" : null);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
      {now?.recording ? (
        <>
          <span className="flex items-center gap-1.5 text-(--ui-ink-2)">
            <span aria-hidden className="size-2 rounded-full bg-(--ui-bad)" />
            {now.since ? `Recording since ${timeOf(now.since)}` : "Recording"}
            {now.who ? ` · ${now.who}` : ""}
          </span>
          <Button
            tone="secondary"
            size="dense"
            busy={busy}
            disabled={busy}
            onClick={() => press("stopRecording")}
          >
            Stop recording
          </Button>
        </>
      ) : (
        <Button
          tone="secondary"
          size="dense"
          busy={busy}
          disabled={busy || got.pending}
          onClick={() => press("record")}
        >
          Record now
        </Button>
      )}
      {line ? <span className="text-(--ui-ink-3)">{line}</span> : null}
    </div>
  );
}

/** The Calls list's head: the recorder (Wren's own calls only). */
export const recorderHead: NonNullable<ListPage["head"]> = () => <RecorderBar />;

function Items({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="grid content-start gap-2">
      <h3 className="text-[13px] font-medium text-(--ui-ink-2)">{title}</h3>
      <ul className="grid gap-1.5">
        {items.map((i) => (
          <li key={i} className="text-[14px] leading-[1.6] text-pretty">
            {i}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A call's notes: the summary set big, then what they need, their worries, and next steps. */
export function CallNotesView({ notes, model }: { notes: CallNotes; model?: string | null }) {
  return (
    <div className="grid gap-4">
      <p className="text-[16px] leading-[1.5] text-pretty">{notes.summary}</p>
      <div className="grid gap-6 lg:grid-cols-3">
        <Items title="What they need" items={notes.needs} />
        <Items title="Worries" items={notes.objections} />
        <Items title="Next" items={notes.next} />
      </div>
      {model ? (
        <p className="text-[12px] text-(--ui-ink-3)">
          Notes by <span {...tipProps(model)}>{modelLabel(model)}</span>, from the transcript.
        </p>
      ) : null}
    </div>
  );
}

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** A recording's page: the video on top, the notes leading the details, the transcript after. */
export const recordingExtras: NonNullable<ListPage["extras"]> = (detail, { row }): RecordExtras => {
  const d = detail as RecordingDetail | null;
  if (!d) return {};
  const transcript: ReactNode = d.segments.length ? (
    <ol className="grid gap-1.5">
      {d.segments.map((s) => (
        <li key={`${s.start}:${s.text}`} className="flex gap-3 text-[14px] leading-[1.6]">
          <span className="w-12 shrink-0 text-right text-[12px] text-(--ui-ink-3) tabular-nums">
            {clock(s.start)}
          </span>
          <span className="text-pretty">{s.text}</span>
        </li>
      ))}
    </ol>
  ) : (
    <p className="text-[14px] text-(--ui-ink-3)">No words were heard.</p>
  );
  return {
    ...(d.url
      ? {
          top: (
            // Played by the shell's player (../../player): the call goes on in the corner.
            <PlayerSlot
              eager
              className="aspect-video w-full max-w-3xl rounded-(--ui-radius)"
              item={{
                id: `recording:${String(row.id)}`,
                kind: "media",
                media: "video",
                src: d.url,
                title: "Recorded call",
              }}
            />
          ),
        }
      : {}),
    lead: d.notes ? (
      <CallNotesView notes={d.notes} model={d.model} />
    ) : (
      <p className="text-[14px] text-(--ui-ink-3)">No notes: the model gave none.</p>
    ),
    sections: [
      ...(d.booking
        ? ([
            [
              "Booked call",
              <a key="call" href={`${pipelinesAt("calls")}/${d.booking}`}>
                Its brief and outcome
              </a>,
            ],
          ] as [string, ReactNode][])
        : []),
      ["Transcript", transcript],
    ],
  };
};
