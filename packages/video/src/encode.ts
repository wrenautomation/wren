/**
 * A recording into an mp4 and a poster, with ffmpeg. Frames become a steady
 * 30 fps, zooms are applied here (not in the page, so nothing on the page
 * moves), captions are laid over as pictures. The source is twice the output's
 * size, so a zoomed view is still sharp.
 */
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkZooms, concatList, type Recording, zoomExpressions } from "./timeline.js";

export interface EncodeOptions {
  /** The ffmpeg binary; "ffmpeg" on the PATH by default. */
  ffmpeg?: string;
  width?: number;
  height?: number;
  fps?: number;
  /** x264 quality: lower is better and bigger. */
  crf?: number;
}

export interface Encoded {
  mp4: string;
  poster: string;
  seconds: number;
}

const FADE = 0.3;

/** The ffmpeg arguments that turn `rec` into `mp4`. Pure, so it is tested without ffmpeg. */
export function encodeArgs(
  rec: Recording,
  listFile: string,
  mp4: string,
  o: Required<Omit<EncodeOptions, "ffmpeg">>,
): string[] {
  checkZooms(rec.zooms);
  const { z, x, y } = zoomExpressions(rec.zooms, rec.width, rec.height);
  const size = `${o.width}x${o.height}`;
  const chains = [
    `[0:v]fps=${o.fps},zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${size}:fps=${o.fps},setsar=1[v0]`,
  ];
  const inputs = ["-f", "concat", "-safe", "0", "-i", listFile];
  const captions = rec.captions.filter((c) => c.png);
  captions.forEach((c, i) => {
    const n = i + 1;
    const out = Math.max(c.start, c.end - FADE);
    inputs.push("-loop", "1", "-framerate", String(o.fps), "-t", rec.end.toFixed(3));
    inputs.push("-i", c.png as string);
    chains.push(
      `[${n}:v]format=rgba,fade=in:st=${c.start.toFixed(3)}:d=${FADE}:alpha=1,` +
        `fade=out:st=${out.toFixed(3)}:d=${FADE}:alpha=1[c${n}]`,
      `[v${n - 1}][c${n}]overlay=0:0:format=auto[v${n}]`,
    );
  });
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputs,
    "-filter_complex",
    chains.join(";"),
    "-map",
    `[v${captions.length}]`,
    "-t",
    rec.end.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    String(o.crf),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    mp4,
  ];
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-4000);
    });
    child.on("error", (e) =>
      fail(new Error(`${bin} did not start (${e.message}); install ffmpeg or set its path`)),
    );
    child.on("close", (code) =>
      code === 0 ? done() : fail(new Error(`${bin} exited ${code}: ${err.trim()}`)),
    );
  });
}

/**
 * Encode `rec` to `<out>.mp4` and `<out>.jpg`. The poster is the frame at
 * `posterAt` seconds (the title card by default). The frames and caption
 * pictures are deleted after (a minute of frames is about 300 MB) unless
 * `keepFrames`.
 */
export async function encode(
  rec: Recording,
  out: string,
  options: EncodeOptions & { posterAt?: number; keepFrames?: boolean } = {},
): Promise<Encoded> {
  const bin = options.ffmpeg ?? "ffmpeg";
  const o = {
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    fps: options.fps ?? 30,
    crf: options.crf ?? 20,
  };
  const list = join(rec.dir, "frames.ffconcat");
  await writeFile(list, concatList(rec.frames, rec.end));
  const mp4 = `${out}.mp4`;
  const poster = `${out}.jpg`;
  await run(bin, encodeArgs(rec, list, mp4, o));
  const at = Math.min(Math.max(0, options.posterAt ?? 1), Math.max(0, rec.end - 0.1));
  await run(bin, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    at.toFixed(3),
    "-i",
    mp4,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    poster,
  ]);
  if (!options.keepFrames) {
    await Promise.all(
      ["frames", "captions", "frames.ffconcat"].map((f) =>
        rm(join(rec.dir, f), { recursive: true, force: true }),
      ),
    );
  }
  return { mp4, poster, seconds: rec.end };
}
