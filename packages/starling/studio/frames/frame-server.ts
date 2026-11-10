/**
 * Serves one render: the page, its bundle, the edit's folder (`/media/`) and single frames of the
 * video files in it (`/frame`). A frame is exact: ffmpeg decodes from the keyframe before it and
 * resamples to the output's rate from the packet times, so a variable-rate recording lands on the
 * same frames every run. Run by plain `node` (types only; no syntax node cannot strip).
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve, sep } from "node:path";

/** Frames one ffmpeg run extracts. */
const CHUNK = 120;
/** Chunks kept on disk per render (120 frames of 1080p jpeg is about 25 MB). */
const KEEP = 48;

export const run = (cmd: string, args: string[], out = false): Promise<string> =>
  new Promise((done, fail) => {
    const p = spawn(cmd, args, { stdio: ["ignore", out ? "pipe" : "ignore", "pipe"] });
    let text = "";
    let err = "";
    p.stdout?.on("data", (d) => {
      text += d;
    });
    p.stderr?.on("data", (d) => {
      err += d;
    });
    p.on("error", fail);
    p.on("close", (code) =>
      code === 0 ? done(text) : fail(new Error(`${cmd} exit ${code}: ${err.slice(-800)}`)),
    );
  });

type Packet = { t: number; key: boolean };

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
};

/** A file, whole or the byte range a `<video>` asks for. */
function send(res: ServerResponse, file: string, range?: string): void {
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  const size = statSync(file).size;
  const head: Record<string, string | number> = {
    "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "max-age=3600",
  };
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
    if (start > end) {
      res.writeHead(416, { "content-range": `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, {
      ...head,
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-length": end - start + 1,
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...head, "content-length": size });
  createReadStream(file).pipe(res);
}

export type FrameServer = {
  /** `http://127.0.0.1:<port>`. Job `i`'s page: `<url>/job/<i>`. */
  url: string;
  /** A name in the edit's folder to its path; throws on a name that leaves the folder. */
  media: (name: string) => string;
  close: () => Promise<void>;
};

export async function frameServer(o: {
  /** The edit's folder. */
  dir: string;
  /** Where the bundle is (`bundle.js`, `bundle.css`, font files). */
  bundle: string;
  /** Scratch folder for extracted frames. */
  cache: string;
  /** The page's `job.json`, by job number. */
  jobs: unknown[];
  ffmpeg?: string;
  ffprobe?: string;
}): Promise<FrameServer> {
  const ffmpeg = o.ffmpeg ?? "ffmpeg";
  const ffprobe = o.ffprobe ?? "ffprobe";
  const root = resolve(o.dir);
  const media = (name: string): string => {
    const file = resolve(root, name);
    if (file !== root && !file.startsWith(root + sep))
      throw new Error(`outside the folder: ${name}`);
    return file;
  };

  // packet times per file: where each frame starts and which are keyframes
  const packets = new Map<string, Promise<Packet[]>>();
  const packetsOf = (file: string): Promise<Packet[]> => {
    let p = packets.get(file);
    if (!p) {
      p = run(
        ffprobe,
        [
          ...["-v", "error", "-select_streams", "v:0"],
          ...["-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", file],
        ],
        true,
      ).then((text) =>
        text
          .trim()
          .split("\n")
          .map((line) => line.split(","))
          .map(([t, flags]) => ({ t: Number(t), key: !!flags?.startsWith("K") }))
          .filter((r) => Number.isFinite(r.t))
          .sort((a, b) => a.t - b.t),
      );
      packets.set(file, p);
    }
    return p;
  };

  // chunk folder → its extraction; oldest first, so the first key is the one to drop
  const chunks = new Map<string, Promise<string>>();
  const busy = new Set<string>();
  /** Frames [chunk*CHUNK, +CHUNK) of `file` at `fps`: a frame holds until the next one starts. */
  const extract = (file: string, fps: number, alpha: boolean, chunk: number): Promise<string> => {
    const id = createHash("sha1").update(`${file}|${fps}|${alpha}`).digest("hex").slice(0, 16);
    const dir = join(o.cache, id, String(chunk));
    const had = chunks.get(dir);
    if (had) {
      chunks.delete(dir);
      chunks.set(dir, had);
      return had;
    }
    busy.add(dir);
    const made = packetsOf(file)
      .then(async (rows) => {
        const first = rows[0];
        if (!first) throw new Error(`no video frames: ${file}`);
        mkdirSync(dir, { recursive: true });
        const start = chunk * CHUNK;
        const at = start / fps;
        // the keyframe at or before the frame on screen at the chunk's start
        const shown = rows.filter((r) => r.t <= at + 1e-6).at(-1) ?? first;
        const key = rows.filter((r) => r.key && r.t <= shown.t + 1e-6).at(-1) ?? first;
        const grid = Math.floor(key.t * fps + 1e-6);
        const args = ["-v", "error", "-y", "-ss", String(Math.max(0, key.t - 0.001)), "-copyts"];
        // ffmpeg's own VP9 decoder drops the alpha plane
        if (alpha && file.endsWith(".webm")) args.push("-c:v", "libvpx-vp9");
        const pick = `trim=start_frame=${start - grid}:end_frame=${start - grid + CHUNK}`;
        args.push(
          ...["-i", file, "-vf", `fps=${fps}:start_time=${grid / fps},${pick},setpts=PTS-STARTPTS`],
          ...["-fps_mode", "passthrough", "-start_number", String(start)],
        );
        if (alpha) args.push("-pix_fmt", "rgba", join(dir, "%07d.png"));
        else args.push("-q:v", "2", join(dir, "%07d.jpg"));
        await run(ffmpeg, args);
        return dir;
      })
      .finally(() => busy.delete(dir));
    chunks.set(dir, made);
    made.catch(() => chunks.delete(dir));
    for (const old of chunks.keys()) {
      if (chunks.size <= KEEP) break;
      if (busy.has(old)) continue;
      chunks.delete(old);
      rmSync(old, { recursive: true, force: true });
    }
    return made;
  };

  const frame = async (
    file: string,
    f: number,
    fps: number,
    alpha: boolean,
  ): Promise<string | null> => {
    const ext = alpha ? "png" : "jpg";
    const chunk = Math.floor(f / CHUNK);
    const dir = await extract(file, fps, alpha, chunk);
    const hit = join(dir, `${String(f).padStart(7, "0")}.${ext}`);
    if (existsSync(hit)) {
      // read ahead: the next chunk is ready when the capture gets there
      if (f % CHUNK > CHUNK / 2) extract(file, fps, alpha, chunk + 1).catch(() => undefined);
      return hit;
    }
    // past the end: hold the file's last frame
    const last = (await packetsOf(file)).at(-1)?.t ?? 0;
    const tail = await extract(file, fps, alpha, Math.floor((last * fps) / CHUNK));
    const name = readdirSync(tail)
      .filter((n) => n.endsWith(ext))
      .sort()
      .pop();
    return name ? join(tail, name) : null;
  };

  const page = (title: string) =>
    `<!doctype html><meta charset=utf-8><title>${title}</title><link rel=stylesheet href=/bundle.css><style>html,body{margin:0;background:#000;overflow:hidden}.frame-stage,.frame-stage *{box-sizing:border-box}</style><div id=stage></div><script src=/bundle.js></script>`;

  const server: Server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? "/", "http://x");
      const path = decodeURIComponent(u.pathname);
      const job = path.match(/^\/job\/(\d+)(?:\/(index\.html|job\.json)?)?$/);
      if (job) {
        const body = o.jobs[Number(job[1])];
        if (body === undefined) res.writeHead(404).end();
        else if (job[2] === "job.json")
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
        // the page asks for `job.json` beside it, so a bare `/job/0` moves to `/job/0/`
        else if (job[2] === undefined && !path.endsWith("/"))
          res.writeHead(302, { location: `${path}/${u.search}` }).end();
        else res.writeHead(200, { "content-type": "text/html" }).end(page(`job ${job[1]}`));
        return;
      }
      if (path.startsWith("/media/")) return send(res, media(path.slice(7)), req.headers.range);
      if (path === "/frame") {
        const hit = await frame(
          media(u.searchParams.get("file") ?? ""),
          Math.max(0, Math.round(Number(u.searchParams.get("frame")))),
          Number(u.searchParams.get("fps")),
          u.searchParams.get("alpha") === "1",
        );
        if (hit) send(res, hit);
        else res.writeHead(404).end();
        return;
      }
      // the bundle and the font files beside it
      send(res, join(o.bundle, path.replace(/^\/+/, "").replace(/\.\.+/g, ".")));
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      process.stderr.write(`frame server: ${req.url}: ${text}\n`);
      if (!res.headersSent) res.writeHead(500);
      res.end(text);
    }
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    media,
    close: () =>
      new Promise((closed) => {
        server.closeAllConnections();
        server.close(() => closed());
      }),
  };
}
