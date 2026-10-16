/**
 * `wren calls`: recorded calls (designs/2026-10-16-call-recording.md). The Mac's desk asks
 * `upcoming` what to arm for, and runs `add` on each finished OBS file: a 720p mp4 and its words
 * by whisper.cpp here, the mp4 to the files bucket, notes by the worker's model, then the row and
 * the person's timeline line. Both local files go once it's saved.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import {
  matchBooking,
  type Segment,
  saveRecording,
  transcriptOf,
  upcomingCalls,
  writeNotes,
} from "@wren/channel-email/calls";
import { callBookings, callRecordings } from "@wren/channel-email/schema";
import type { Settings } from "@wren/config";
import type { Db } from "@wren/db";
import { putLocalFile } from "@wren/delivery/files";
import { loadLlmEnv, makeLlm } from "@wren/llm";
import { probe, sentenceEdges, transcribe, type Word, wav16k } from "@wren/studio";
import type { Command } from "commander";
import { eq } from "drizzle-orm";

const run = promisify(execFile);
type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/** A line ends at a sentence's end, a long pause, or 40 words. */
const PAUSE_S = 2;
const MAX_WORDS = 40;

/** Whisper's words as timed lines. */
export function segmentsOf(words: readonly Word[]): Segment[] {
  const { ends } = sentenceEdges(words);
  const out: Segment[] = [];
  let open: Word[] = [];
  const close = () => {
    const [first] = open;
    const last = open.at(-1);
    if (first && last)
      out.push({ start: first.s, end: last.e, text: open.map((w) => w.w.trim()).join(" ") });
    open = [];
  };
  words.forEach((w, i) => {
    const prev = open.at(-1);
    if (prev && w.s - prev.e > PAUSE_S) close();
    open.push(w);
    if (ends.has(i) || open.length >= MAX_WORDS) close();
  });
  close();
  return out;
}

/** Where a recording goes in the bucket: its day and its OBS name, so a retry lands on the same key. */
export function recordingKey(file: string, startedAt: Date): string {
  const name =
    basename(file)
      .replace(/\.[^.]+$/, "")
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^[-.]+|-+$/g, "")
      .slice(-80) || "call";
  return `calls/${startedAt.toISOString().slice(0, 10)}/${name}.mp4`;
}

export function registerCalls(
  program: Command,
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
): void {
  const calls = program.command("calls").description("Calls recorded on the Mac");

  calls
    .command("upcoming")
    .description("Booked calls ending after now and starting within --hours, as JSON")
    .option("--hours <n>", "how far ahead", "24")
    .action((o: { hours: string }) =>
      withDb(async (db) => {
        console.log(JSON.stringify(await upcomingCalls(db, new Date(), Number(o.hours))));
      }),
    );

  calls
    .command("add <file>")
    .description("Transcribe a recording, upload it, write its notes and keep it on the call")
    .option("--booking <id>", "the booked call it was (call_bookings id)")
    .option("--by <who>", "desk (a booked call) or manual (Record now)", "manual")
    .option("--started <iso>", "when it started (default: the file's birth time)")
    .option("--keep", "keep the local file")
    .action((file: string, o: { booking?: string; by: string; started?: string; keep?: boolean }) =>
      withDb(async (db) => {
        if (o.by !== "desk" && o.by !== "manual") throw new Error("--by is desk or manual");
        const bucket = settings.filesBucket;
        if (!bucket) throw new Error("WREN_FILES_BUCKET is not set");
        const info = await stat(file);
        const startedAt = o.started ? new Date(o.started) : info.birthtime;
        if (Number.isNaN(startedAt.getTime())) throw new Error("--started is not a time");
        const key = recordingKey(file, startedAt);
        // A retry after the save: nothing left to do but the local file.
        const [had] = await db
          .select({ id: callRecordings.id })
          .from(callRecordings)
          .where(eq(callRecordings.fileKey, key));
        if (had) {
          if (!o.keep) await rm(file, { force: true });
          console.log(JSON.stringify({ id: had.id, key, again: true }));
          return;
        }
        const ffmpeg = settings.ffmpeg;
        const { durationS } = await probe(file, ffmpeg);
        const dir = await mkdtemp(join(tmpdir(), "wren-call-"));
        try {
          const mp4 = join(dir, "call.mp4");
          const wav = join(dir, "call.wav");
          // 720p on the GPU, about 300 MB an hour; the words read from a 16 kHz wav.
          await run(ffmpeg, [
            ...["-v", "error", "-y", "-i", file, "-vf", "scale=-2:'min(720,ih)'"],
            ...["-c:v", "h264_videotoolbox", "-b:v", "560k", "-c:a", "aac", "-b:a", "96k"],
            ...["-movflags", "+faststart", mp4],
          ]);
          await wav16k(file, wav, ffmpeg);
          const segments = segmentsOf(await transcribe(wav, { align: false }));
          const booking =
            o.booking !== undefined ? Number(o.booking) : await matchBooking(db, startedAt);
          if (booking !== null && !Number.isSafeInteger(booking))
            throw new Error("--booking is a call_bookings id");
          const [who] =
            booking === null
              ? []
              : await db
                  .select({ name: callBookings.name, email: callBookings.email })
                  .from(callBookings)
                  .where(eq(callBookings.id, booking));
          let written: Awaited<ReturnType<typeof writeNotes>> = null;
          if (settings.llm !== "fake") {
            // Provider keys load from the model keys file (or the host's env); never logged.
            loadLlmEnv(settings.llmEnvPath, rootDir);
            const llm = makeLlm(settings.llm, process.env, { anthropicModel: settings.llmModel });
            written = await writeNotes(
              llm,
              transcriptOf(segments),
              who ? (who.name ?? who.email) : null,
            );
          }
          const bytes = await putLocalFile({ bucket }, key, mp4, "video/mp4");
          const id = await saveRecording(db, {
            callBookingId: booking,
            fileKey: key,
            bytes,
            durationS: Math.round(durationS),
            startedAt,
            endedAt: new Date(startedAt.getTime() + durationS * 1000),
            segments,
            notes: written?.notes ?? null,
            model: written?.model ?? null,
            by: o.by,
          });
          if (!o.keep) await rm(file, { force: true });
          console.log(
            JSON.stringify({
              id,
              booking,
              key,
              minutes: Math.round(durationS / 60),
              lines: segments.length,
              notes: Boolean(written),
            }),
          );
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }),
    );
}
