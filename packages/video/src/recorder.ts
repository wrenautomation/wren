/**
 * Records a walk through a web page as a screen video would show it. The
 * browser streams a frame each time the page changes (CDP screencast) at twice
 * the viewport's size; the mouse really moves and clicks, and the page draws a
 * cursor where it is. Zooms and captions are only noted here, with the second
 * they start, and the encoder applies them. Playwright loads on `openRecorder`,
 * so importing this package costs nothing.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, CDPSession, Locator, Page } from "playwright";
import { type Card, DEFAULT_LOOK, type Look, OVERLAY_SCRIPT } from "./overlay.js";
import type { Caption, Frame, Recording, Zoom } from "./timeline.js";

export interface RecorderOptions {
  /** Work directory: frames and caption pictures land here. */
  dir: string;
  /** Viewport in CSS pixels; frames are `scale` times this. */
  width?: number;
  height?: number;
  scale?: number;
  /** JPEG quality of each frame, 0 to 100. */
  quality?: number;
  look?: Partial<Look>;
  /** The video's size: captions are drawn at it. */
  outWidth?: number;
  outHeight?: number;
}

export interface ZoomOptions {
  /** Seconds held at full zoom. */
  hold?: number;
  /** Seconds to ease in, and again to ease out. */
  ramp?: number;
  /** At most this much; less when the target is big. */
  max?: number;
}

type Point = { x: number; y: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const MOVE_TICK_MS = 16;
const SCROLL_SETTLE_MS = 900;
const CARD_FADE_MS = 650;
/** The bottom share of the frame a one-line caption covers (see `captionHtml`). */
const CAPTION_BAND = 0.15;

export class Recorder {
  readonly page: Page;
  private readonly browser: Browser;
  private readonly o: Required<Omit<RecorderOptions, "look">> & { look: Look };
  private cdp: CDPSession | null = null;
  private t0 = 0;
  private readonly frames: Frame[] = [];
  private readonly writes: Promise<void>[] = [];
  private readonly zooms: Zoom[] = [];
  private readonly captions: Caption[] = [];
  private captionOpen: Caption | null = null;
  private mouse: Point;

  constructor(browser: Browser, page: Page, o: Recorder["o"]) {
    this.browser = browser;
    this.page = page;
    this.o = o;
    this.mouse = { x: o.width / 2, y: o.height / 2 };
  }

  /** Seconds since `start`. */
  now(): number {
    return Date.now() / 1000 - this.t0;
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "networkidle" });
  }

  /** Start keeping frames. Everything before this is not in the video. */
  async start(): Promise<void> {
    if (this.cdp) throw new Error("already recording");
    await mkdir(join(this.o.dir, "frames"), { recursive: true });
    const cdp = await this.page.context().newCDPSession(this.page);
    this.cdp = cdp;
    cdp.on("Page.screencastFrame", (f) => {
      const file = `frames/${String(this.frames.length + 1).padStart(6, "0")}.jpg`;
      const at = f.metadata.timestamp ?? Date.now() / 1000;
      this.frames.push({ file, t: Math.max(0, at - this.t0) });
      this.writes.push(writeFile(join(this.o.dir, file), Buffer.from(f.data, "base64")));
      cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    this.t0 = Date.now() / 1000;
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: this.o.quality,
      maxWidth: this.o.width * this.o.scale,
      maxHeight: this.o.height * this.o.scale,
      everyNthFrame: 1,
    });
  }

  async pause(ms: number): Promise<void> {
    await sleep(ms);
  }

  /** A full-screen card over the page; `instant` skips the fade (the video's first frame). */
  async card(card: Card, instant = false): Promise<void> {
    await this.page.evaluate(
      ([c, i]) => (globalThis as unknown as { __wrenOverlay: OverlayApi }).__wrenOverlay.card(c, i),
      [card, instant] as const,
    );
    if (!instant) await sleep(CARD_FADE_MS);
  }

  async uncard(): Promise<void> {
    await this.page.evaluate(() =>
      (globalThis as unknown as { __wrenOverlay: OverlayApi }).__wrenOverlay.uncard(),
    );
    await sleep(CARD_FADE_MS);
  }

  /** Glide the mouse to the target's center (or a point), eased, as a hand would. */
  async move(target: Locator | Point, ms?: number): Promise<Point> {
    const to = "x" in target ? target : await this.center(target);
    const from = this.mouse;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const total = ms ?? Math.min(1100, 380 + dist * 0.6);
    const steps = Math.max(1, Math.round(total / MOVE_TICK_MS));
    const began = Date.now();
    for (let i = 1; i <= steps; i++) {
      const p = ease(i / steps);
      await this.page.mouse.move(from.x + (to.x - from.x) * p, from.y + (to.y - from.y) * p);
      const due = began + i * MOVE_TICK_MS - Date.now();
      if (due > 0) await sleep(due);
    }
    this.mouse = to;
    return to;
  }

  /** Move to the target and press it. */
  async click(target: Locator): Promise<void> {
    await this.scrollTo(target);
    await this.move(target);
    await sleep(140);
    await this.page.mouse.down();
    await sleep(90);
    await this.page.mouse.up();
  }

  /** Scroll the target to the middle of its scroller, smoothly, when it is not in view. */
  async scrollTo(target: Locator): Promise<void> {
    await target.waitFor({ state: "visible" });
    const moved = await target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.top >= 0 && r.bottom <= (globalThis as unknown as { innerHeight: number }).innerHeight)
        return false;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    });
    if (moved) await sleep(SCROLL_SETTLE_MS);
  }

  /**
   * Push in on the target (or the box around several) and hold there; the page
   * keeps running underneath. With a caption showing, the target is fit and
   * centered in the space above it.
   */
  async zoom(target: Locator | Locator[], o: ZoomOptions = {}): Promise<void> {
    const targets = Array.isArray(target) ? target : [target];
    const first = targets[0];
    if (!first) throw new Error("zoom needs a target");
    await this.scrollTo(first);
    const box = unionBox(await Promise.all(targets.map((t) => t.boundingBox())));
    const { width, height, scale } = this.o;
    const band = this.captionOpen ? height * CAPTION_BAND : 0;
    const fit = Math.min((width * 0.86) / box.width, ((height - band) * 0.86) / box.height);
    const z = Math.max(1.1, Math.min(o.max ?? 1.8, fit));
    const ramp = o.ramp ?? 0.8;
    const hold = o.hold ?? 2.5;
    const start = this.now();
    this.zooms.push({
      start,
      end: start + 2 * ramp + hold,
      ramp,
      cx: (box.x + box.width / 2) * scale,
      cy: (box.y + box.height / 2 + band / (2 * z)) * scale,
      z,
    });
    await sleep((2 * ramp + hold) * 1000);
  }

  /** A line at the bottom of the video from now until the next caption, or `null` to clear it. */
  caption(text: string | null): void {
    const at = this.now();
    if (this.captionOpen) this.captionOpen.end = at;
    this.captionOpen = text ? { text, start: at, end: at } : null;
    if (this.captionOpen) this.captions.push(this.captionOpen);
  }

  /** Stop the stream and hand back what was recorded. */
  async stop(): Promise<Recording> {
    if (!this.cdp) throw new Error("not recording");
    const end = this.now();
    if (this.captionOpen) this.captionOpen.end = end;
    this.captionOpen = null;
    await this.cdp.send("Page.stopScreencast");
    await this.cdp.detach();
    this.cdp = null;
    await Promise.all(this.writes);
    const captions = this.captions.filter((c) => c.end - c.start > 0.4);
    await this.drawCaptions(captions);
    return {
      dir: this.o.dir,
      width: this.o.width * this.o.scale,
      height: this.o.height * this.o.scale,
      frames: [...this.frames],
      end,
      zooms: [...this.zooms],
      captions,
    };
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  private async center(target: Locator): Promise<Point> {
    await target.waitFor({ state: "visible" });
    const box = await target.boundingBox();
    if (!box) throw new Error("target is not on screen");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /** Each caption as a transparent picture the size of the video, text at the bottom. */
  private async drawCaptions(captions: Caption[]): Promise<void> {
    if (!captions.length) return;
    await mkdir(join(this.o.dir, "captions"), { recursive: true });
    const { outWidth, outHeight, look } = this.o;
    const page = await this.browser.newPage({
      viewport: { width: outWidth, height: outHeight },
      deviceScaleFactor: 1,
    });
    try {
      for (const [i, c] of captions.entries()) {
        await page.setContent(captionHtml(c.text, look, outHeight));
        c.png = join(this.o.dir, "captions", `${i + 1}.png`);
        await page.screenshot({ path: c.png, omitBackground: true, scale: "css" });
      }
    } finally {
      await page.close();
    }
  }
}

interface OverlayApi {
  card(c: Card, instant: boolean): void;
  uncard(): void;
}

type Box = { x: number; y: number; width: number; height: number };

function unionBox(boxes: (Box | null)[]): Box {
  if (boxes.some((b) => !b)) throw new Error("zoom target is not on screen");
  const bs = boxes as Box[];
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  const right = Math.max(...bs.map((b) => b.x + b.width));
  const bottom = Math.max(...bs.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function captionHtml(text: string, look: Look, outHeight: number): string {
  const u = outHeight / 1080;
  return `<!doctype html><html><body style="margin:0;background:transparent">
<div style="position:fixed;left:0;right:0;bottom:${Math.round(70 * u)}px;display:flex;justify-content:center">
<div style="max-width:72%;padding:${Math.round(18 * u)}px ${Math.round(32 * u)}px;border-radius:${Math.round(16 * u)}px;
background:rgba(14,14,14,.86);color:#fff;font-family:${escapeHtml(look.font)};font-size:${Math.round(36 * u)}px;
line-height:1.3;font-weight:500;letter-spacing:-.005em;text-align:center">${escapeHtml(text)}</div></div></body></html>`;
}

/** A browser at the right size, the overlay on every page it opens. */
export async function openRecorder(options: RecorderOptions): Promise<Recorder> {
  const o = {
    dir: options.dir,
    width: options.width ?? 1280,
    height: options.height ?? 720,
    scale: options.scale ?? 2,
    quality: options.quality ?? 88,
    outWidth: options.outWidth ?? 1920,
    outHeight: options.outHeight ?? 1080,
    look: { ...DEFAULT_LOOK, ...options.look },
  };
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch (err) {
    throw new Error("recording needs Playwright: `pnpm exec playwright install chromium`", {
      cause: err,
    });
  }
  // Emulated scale alone streams at 1x; the flag makes the real surface 2x. The full
  // browser's new headless mode streams faster than the shell (about 48 frames a second).
  const browser = await playwright.chromium.launch({
    channel: "chromium",
    args: [`--force-device-scale-factor=${o.scale}`],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: o.width, height: o.height },
      deviceScaleFactor: o.scale,
      // The overlay's inline <style> would be refused by a strict style-src (the portal's is).
      bypassCSP: true,
    });
    await context.addInitScript(`${OVERLAY_SCRIPT}(${JSON.stringify(o.look)})`);
    return new Recorder(browser, await context.newPage(), o);
  } catch (err) {
    await browser.close();
    throw err;
  }
}
