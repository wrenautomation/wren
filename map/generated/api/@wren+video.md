# @wren/video: interface

Exports: 24. Files: 6.

## packages/video/src/capture.ts

- **CaptureOptions** (interface) `interface CaptureOptions { width?: number; height?: number; waitMs?: number; }`
- **capturePage** (function) `(url: string, file: string, o: CaptureOptions = {}): Promise<void>`

## packages/video/src/encode.ts

- **Encoded** (interface) `interface Encoded { mp4: string; poster: string; seconds: number; }`
- **EncodeOptions** (interface) `interface EncodeOptions { ffmpeg?: string; width?: number; height?: number; fps?: number; crf?: number; }`
- **encode** (function) `(rec: Recording, out: string, options: EncodeOptions & { posterAt?: number; keepFrames?: boolean } = {}): Promise<Encoded>`
- **encodeArgs** (function) `(rec: Recording, listFile: string, mp4: string, o: Required<Omit<EncodeOptions, "ffmpeg">>): string[]`

## packages/video/src/overlay.ts

- **Card** (interface) `interface Card { eyebrow?: string; title: string; sub?: string; }`
- **DEFAULT_LOOK** (const) `Look`
- **Look** (interface) `interface Look { background: string; foreground: string; muted: string; accent: string; font: string; }`

## packages/video/src/publish.ts

- **publish** (function) `(encoded: Encoded, id: string, meta: Record<string, unknown>, o: PublishOptions): Promise<Published>`
- **PublishOptions** (interface) `interface PublishOptions { bucket: string; origin: string; region?: string; client?: S3Client; }`
- **Published** (interface) `interface Published { id: string; mp4: string; poster: string; meta: string; }`
- **newVideoId** (function) `(): string`

## packages/video/src/recorder.ts

- **openRecorder** (function) `(options: RecorderOptions): Promise<Recorder>`
- **Recorder** (class) `readonly page: Page;; constructor(browser: Browser, page: Page, o: Recorder["o"]); now(): number; goto(url: string): Promise<void>; start(): Promise<void>; pause(ms: number): Promise<void>; card(card: Card, instant = false): Promise<void>; uncard(): Promise<void>; move(target: Locator | Point, ms?: number): Promise<Point>; click(target: Locator): Promise<void>; scrollTo(target: Locator): Promise<void>; zoom(target: Locator | Locator[], o: ZoomOptions = {}): Promise<void>; caption(text: string | null): void; stop(): Promise<Recording>; close(): Promise<void>`
- **RecorderOptions** (interface) `interface RecorderOptions { dir: string; width?: number; height?: number; scale?: number; quality?: number; look?: Partial<Look>; outWidth?: number; outHeight?: number; }`
- **ZoomOptions** (interface) `interface ZoomOptions { hold?: number; ramp?: number; max?: number; }`

## packages/video/src/timeline.ts

- **Caption** (interface) `interface Caption { text: string; start: number; end: number; png?: string; }`
- **checkZooms** (function) `(zooms: readonly Zoom[]): void`
- **concatList** (function) `(frames: readonly Frame[], end: number): string`
- **Frame** (interface) `interface Frame { file: string; t: number; }`
- **Recording** (interface) `interface Recording { dir: string; width: number; height: number; frames: Frame[]; end: number; zooms: Zoom[]; captions: Caption[]; }`
- **Zoom** (interface) `interface Zoom { start: number; end: number; ramp: number; cx: number; cy: number; z: number; }`
- **zoomExpressions** (function) `(zooms: readonly Zoom[], width: number, height: number): { z: string; x: string; y: string }`
