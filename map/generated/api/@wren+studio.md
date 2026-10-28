# @wren/studio: interface

Exports: 358. Files: 34.

## packages/studio/src/bar.ts

- **BAR** (const) `readonly BarRule[]`
- **BAR_IDS** (const) `string[]`
- **BarFormat** (type) `type BarFormat = "long" | "short";`
- **BarRule** (interface) `interface BarRule { id: string; says: string; only?: BarFormat; }`
- **barLines** (function) `(format?: BarFormat): string`
- **VIDEO_CHECK** (const) `"video check"`

## packages/studio/src/cap.ts

- **CAP_RECORDINGS** (const) `string`
- **capEvents** (function) `(project: string, ffmpeg: string): Promise<RecordingEvents>`
- **capNotReady** (function) `(m: CapMeta | null): string | null`
- **capProjectOf** (function) `(path: string): string | null`
- **capTracks** (function) `(project: string, ffmpeg: string): Promise<{ main: string; cam?: string; offsetS?: number }>`
- **findCapProjects** (function) `(dir = CAP_RECORDINGS): Promise<string[]>`
- **isCap** (function) `(path: string): boolean`
- **parseKeyboard** (function) `(bytes: Uint8Array): { key: string; timeMs: number; down: boolean }[]`

## packages/studio/src/caption-styles.ts

- **bigWordState** (function) `(t: number, s: number, end: number): { opacity: number; scale: number }`
- **CAPTION_SHOWS** (const) `readonly ["screen", "track"]`
- **CAPTION_STYLES** (const) `readonly ["word", "pill", "sweep", "pop", "wipe", "stress"]`
- **CaptionShow** (type) `type CaptionShow = (typeof CAPTION_SHOWS)[number];`
- **CaptionStyle** (type) `type CaptionStyle = (typeof CAPTION_STYLES)[number];`
- **Captions** (interface) `interface Captions { style: string; long?: CaptionShow | undefined; short?: CaptionShow | undefined; behind?: boolean | undefined; on?: boolean | undefined; place?: { long?: number | undefined; short?: number | undefined } | undefined; }`
- **isCaptionStyle** (function) `(s: string): s is CaptionStyle`
- **onScreen** (function) `(c: Captions, format: "long" | "short"): boolean`
- **wordState** (function) `(style: string, w: { s: number; e: number }, t: number, until: number, o: { first?: boolean } = {}): WordState`

## packages/studio/src/captions.ts

- **Line** (interface) `interface Line { words: Word[]; s: number; e: number; }`
- **LineRules** (interface) `interface LineRules { minWords: number; maxWords: number; maxChars: number; overCost: number; pauseS: number; softPauseS: number; holdS: number; }`
- **lineAt** (function) `(lines: readonly Line[], t: number): { line: Line; word: number } | null`
- **pages** (function) `(words: readonly W[]): W[][]`
- **phrases** (function) `(words: readonly Word[], pauseS: number): Word[][]`
- **REEL** (const) `LineRules`
- **reelLines** (function) `(words: readonly Word[], o: LineRules = REEL): Line[]`
- **SUBS** (const) `LineRules`
- **srt** (function) `(words: readonly Word[], o: LineRules = SUBS): string`

## packages/studio/src/change.ts

- **withCutChanges** (function) `(cuts: readonly Cut[], changes: unknown): Cut[]`
- **changeSystem** (function) `(): string`
- **changePrompt** (function) `(e: VideoEdit, sentence: string, o: { board?: Storyboard; beat?: Beat | null; refused?: string[] } = {}): string`
- **changeAnswerOf** (function) `(text: string): { changes: string[]; patch: Record<string, unknown> | null } | null`
- **checkChange** (function) `(e: VideoEdit, raw: Record<string, unknown> | null): Checked`
- **proposeChange** (function) `(db: Queryable, id: number, sentence: string, model: ChangeModel, o: { by: string; beat?: string | null }): Promise<Proposal>`
- **applyChange** (function) `(db: Queryable, id: number, p: Pick<Proposal, "patch" | "expect" | "run">, by: string): Promise<{ run: string; edit: VideoEdit; snapped: Moved[]; }>`
- **CHANGE** (const) `{ readonly maxChars: 1000; readonly asks: 2; readonly beatChars: 900; readonly descriptionChars: 1500; readonly maxTokens: 4000; }`
- **Checked** (interface) `interface Checked { patch: EditPatch | null; expect: Record<string, unknown>; issues: string[]; snapped: Moved[]; }`
- **Proposal** (interface) `interface Proposal { run: string; id: number; sentence: string; beat: string | null; changes: string[]; patch: EditPatch | null; expect: Record<string, unknown>; issues: string[]; snapped: Moved[]; after: Storyboard; changed: BoardChange; model: string; }`
- **ChangeModel** (type) `type ChangeModel = StressModel & { answered?: string[]; name?: string };`

## packages/studio/src/cuts.ts

- **CUT_DEFAULTS** (const) `CutKnobs`
- **CUT_FORMATS** (const) `readonly ["long", "short"]`
- **CutFormat** (type) `type CutFormat = (typeof CUT_FORMATS)[number];`
- **CutKnobs** (type) `type CutKnobs = z.infer<typeof cutKnobsSchema>;`
- **CutKnobsByFormat** (type) `type CutKnobsByFormat = z.infer<typeof cutKnobsByFormat>;`
- **CutRow** (interface) `interface CutRow { n: number; cut: Cut; lengthS: number; before: string; after: string; flags: string[]; }`
- **cutKnobsByFormat** (const) `z.ZodObject<{ long: z.ZodDefault<z.ZodObject<{ minGapS: z.ZodDefault<z.ZodNumber>; airS: z.ZodDefault<z.ZodNumber>; noiseMarginDb: z.ZodDefault<z.ZodNumber>; snapS: z.ZodDefault<z.ZodNumber>; }, z.core.$strip>>; short: z.ZodDefault<z.ZodObject<{ minGapS: z.ZodDefault<z.ZodNumber>; airS: z.ZodDefault…`
- **cutKnobsSchema** (const) `z.ZodObject<{ minGapS: z.ZodDefault<z.ZodNumber>; airS: z.ZodDefault<z.ZodNumber>; noiseMarginDb: z.ZodDefault<z.ZodNumber>; snapS: z.ZodDefault<z.ZodNumber>; }, z.core.$strip>`
- **fitWords** (function) `(words: readonly Word[], silences: readonly Span[]): Word[]`
- **fromCutTime** (function) `(t: number, keep: readonly Span[]): number`
- **keepSegments** (function) `(cuts: readonly Cut[], durationS: number, fps = 30): Span[]`
- **onCut** (function) `(t: number, keep: readonly Span[]): number`
- **readCutKnobs** (function) `(raw: unknown): CutKnobsByFormat`
- **reviewCuts** (function) `(cuts: readonly Cut[], words: readonly Word[]): CutRow[]`
- **SHORT_CUT_DEFAULTS** (const) `CutKnobs`
- **shortCutsOver** (function) `(cuts: readonly Cut[], shortCuts: readonly Cut[]): Cut[]`
- **toCutTime** (function) `(t: number, keep: readonly Span[]): number | null`
- **noiseThresholdDb** (function) `(pcm: Pcm, marginDb: number): number`
- **silenceCuts** (function) `(words: readonly Word[], silences: readonly Span[], pcm: Pcm, durationS: number, knobs: CutKnobs = CUT_DEFAULTS): Cut[]`
- **fillerProposals** (function) `(words: readonly Word[]): Cut[]`
- **withSilence** (function) `(existing: readonly Cut[], silence: readonly Cut[]): Cut[]`
- **Span** (interface) `interface Span { s: number; e: number; }`
- **Pcm** (interface) `interface Pcm { samples: Float32Array; rate: number; }`

## packages/studio/src/duck.ts

- **bedVolume** (function) `(m: { volume: number; duck: readonly (readonly [number, number])[]; duckDb: number }, t: number): number`
- **DUCK** (const) `{ readonly db: 8; readonly joinS: 0.6; readonly attackS: 0.15; readonly releaseS: 0.5; }`
- **duckAt** (function) `(t: number, duck: readonly (readonly [number, number])[]): number`

## packages/studio/src/edit.ts

- **addVideo** (function) `(db: Queryable, input: string, o: AddOptions): Promise<VideoEdit>`
- **cutKnobs** (function) `(db: Queryable, format: CutFormat = "long"): Promise<CutKnobs>`
- **editPatchSchema** (const) `z.ZodObject<{ title: z.ZodOptional<z.ZodString>; description: z.ZodOptional<z.ZodString>; tags: z.ZodOptional<z.ZodArray<z.ZodString>>; chapters: z.ZodOptional<z.ZodArray<z.ZodObject<{ at: z.ZodNumber; title: z.ZodString; }, z.core.$strict>>>; cuts: z.ZodOptional<z.ZodArray<z.ZodObject<{ why: z.ZodE…`
- **formatsFor** (function) `(main: Pick<Track, "width" | "height">): Format[]`
- **getEdit** (function) `(db: Queryable, id: number): Promise<VideoEdit>`
- **keepCut** (function) `(db: Queryable, id: number, n: number, by: string): Promise<{ run: string; edit: VideoEdit; snapped: Moved[]; }>`
- **linesOf** (function) `(e: Pick<VideoEdit, "words" | "cuts" | "tracks">): import("./finish.js").CaptionLine[]`
- **redoSilence** (function) `(db: Queryable, id: number, ffmpeg: string, by: string): Promise<{ run: string; edit: VideoEdit; snapped: Moved[]; }>`
- **sameJson** (function) `(a: unknown, b: unknown): boolean`
- **setCut** (function) `(db: Queryable, id: number, span: { from: number; to: number }, state: "cut" | "kept", by: string): Promise<{ run: string; edit: VideoEdit; snapped: Moved[]; }>`
- **setCutKnobs** (function) `(db: Queryable, patch: Partial<CutKnobs>, by: string, format: CutFormat = "long"): Promise<CutKnobs>`
- **setEdit** (function) `(db: Queryable, id: number, input: unknown, o: { by: string; command?: string; run?: string; stats?: object; expect?: Record<string, unknown>; agent?: boolean; lock?: boolean; }): Promise<{ run: string; edit: VideoEdit; snapped: Moved[] }>`
- **setFiles** (function) `(db: Queryable, id: number, files: Record<string, string>): Promise<void>`
- **setKeys** (function) `(db: Queryable, id: number, keys: Record<string, string>): Promise<void>`
- **setLine** (function) `(db: Queryable, id: number, line: { at: number[]; text: string; was: string }, by: string): Promise<{ run: string; edit: VideoEdit }>`
- **setLocks** (function) `(db: Queryable, id: number, o: { lock?: readonly string[]; unlock?: readonly string[] }): Promise<string[]>`
- **setLook** (function) `(db: Queryable, id: number, provider: string, look: Look): Promise<void>`
- **setRender** (function) `(db: Queryable, id: number, render: RenderState | null): Promise<void>`
- **setRendered** (function) `(db: Queryable, id: number, files: Record<string, string>, keys: Record<string, string>): Promise<void>`
- **setStress** (function) `(db: Queryable, id: number, stress: number[], o: { by: string; stats?: object }): Promise<{ run: string; edit: VideoEdit; snapped: Moved[]; }>`
- **setStudioWords** (function) `(db: Queryable, words: string[], by: string): Promise<string[]>`
- **setWords** (function) `(db: Queryable, id: number, change: WordsFix | { words: unknown; stress?: unknown }, o: { by: string; command?: string }): Promise<{ run: string; n: number; edit: VideoEdit }>`
- **stressOnCut** (function) `(words: readonly Word[], stress: readonly number[], keep: ReturnType<typeof keepSegments>): string[]`
- **studioWords** (function) `(db: Queryable): Promise<string[]>`
- **twelvelabsMinutes** (function) `(db: Queryable): Promise<number>`
- **WordsFix** (type) `type WordsFix = { wrong: string; right: string } | { at: number; text: string };`
- **checkPatch** (function) `(patch: EditPatch, durationS: number, cuts: readonly Cut[] = [], words: readonly Word[] = [], frame?: { width: number; height: number }, held: readonly { from: number; to: number }[] = []): string[]`
- **readyPatch** (function) `(now: VideoEdit, input: unknown): { patch: EditPatch | null; snapped: Moved[]; issues: string[] }`
- **withPatch** (function) `(now: VideoEdit, patch: EditPatch): VideoEdit`
- **VIDEO** (const) `RegExp`
- **CAM** (const) `RegExp`
- **EditPatch** (type) `type EditPatch = z.infer<typeof editPatchSchema>;`
- **editField** (const) `(edit: VideoEdit, k: string) => unknown`

## packages/studio/src/film.ts

- **Film** (type) `type Film = Record<string, string>;`
- **FilmChange** (interface) `interface FilmChange { run: string; command: string; by: string | null; at: string; fields: string[]; diff: string; }`
- **FilmOptions** (interface) `interface FilmOptions { bedS?: number | undefined; }`
- **filmAssets** (function) `(e: Pick<VideoEdit, "tracks"> & Partial<Pick<VideoEdit, "sounds" | "music">>): { main: string; cam: string | null; sounds: string[]; }`
- **filmHistory** (function) `(now: VideoEdit, runs: readonly { run: string; command: string; by: string | null; at: string; before: object }[]): FilmChange[]`
- **longFilm** (function) `(e: VideoEdit, o: FilmOptions = {}): Film`
- **shortFilm** (function) `(e: VideoEdit, n: number, o: FilmOptions = {}): Film`
- **wordsVtt** (function) `(e: Pick<VideoEdit, "words" | "cuts" | "tracks">): string`

## packages/studio/src/finish-look.ts

- **TextOverlay** (interface) `interface TextOverlay { text: string; from: number; to: number; x: number; y: number; size: OverlaySize; }`
- **CAPTION_LOOK** (const) `{ readonly foreground: "#0e0e0e"; readonly accent: "#7969a3"; readonly font: "\"General Sans\", ui-sans-serif, system-ui, sans-serif"; }`
- **CAPTION_Y** (const) `{ readonly long: 0.885; readonly short: 0.66; }`
- **captionWordLook** (function) `(style: string, st: WordState, o: { stressed: boolean; size: number; accent: string }): { word: CSSProperties; fill?: CSSProperties }`
- **cornerCam** (function) `(w: number, h: number): CSSProperties`
- **longCaption** (function) `(w: number, h: number, place: number | undefined, font: string): { box: CSSProperties; text: CSSProperties; size: number }`
- **OVERLAY** (const) `{ readonly maxChars: 120; readonly max: 30; readonly minS: 0.3; readonly scale: { s: number; m: number; l: number; }; readonly margin: 0.04; readonly fadeS: 0.18; readonly maxWidth: 0.86; }`
- **OVERLAY_SIZES** (const) `readonly ["s", "m", "l"]`
- **OverlaySize** (type) `type OverlaySize = (typeof OVERLAY_SIZES)[number];`
- **overlayAt** (function) `(o: TextOverlay, t: number, w: number, h: number): { x: number; y: number; size: number; width: number; opacity: number } | null`
- **pillLook** (function) `(size: number, foreground: string): CSSProperties`
- **reelCaption** (function) `(w: number, y: number, chars: number, maxChars: number, font: string): { box: CSSProperties; size: number }`
- **reelY** (function) `(h: number, place: { short?: number | undefined } | undefined): number`

## packages/studio/src/finish.ts

- **ASPECT** (const) `Record<Format, string>`
- **CaptionLine** (interface) `interface CaptionLine { at: number[]; text: string; s: number; e: number; }`
- **CROPPED** (const) `readonly ["vertical", "square", "portrait"]`
- **CroppedFormat** (type) `type CroppedFormat = (typeof CROPPED)[number];`
- **Crops** (type) `type Crops = { [F in CroppedFormat]?: Point | undefined } & { shorts?: Record<string, Point> | undefined; };`
- **coverMs** (function) `(at: number, keep: readonly Span[]): number`
- **cropWindow** (function) `(w: number, h: number, frame: readonly [number, number], centre: Point = { x: 0.5, y: 0.5 }): [number, number, number, number]`
- **FRAME** (const) `Record<Format, [number, number]>`
- **formatFor** (function) `(platform: string, rendered: ReadonlySet<string>): CroppedFormat | null`
- **isCropped** (function) `(f: Format): f is CroppedFormat`
- **overlaysOnCut** (function) `(overlays: readonly TextOverlay[], keep: readonly Span[]): { from: number; to: number; text: string; x: number; y: number; size: import("./finish-look.js").OverlaySize; }[]`
- **Point** (type) `type Point = { x: number; y: number };`
- **FPS** (const) `30`
- **snapTime** (function) `(t: number, words: readonly Pick<Word, "s" | "e">[], durationS: number, magnetS = 4 / FPS): number`
- **cropCentre** (function) `(w: number, h: number, frame: readonly [number, number], centre: Point): Point`
- **pictureOf** (function) `(tracks: Pick<Tracks, "main" | "cam" | "camBox">): { source: "main" | "cam"; centre: Point; }`
- **inOut** (function) `(cuts: readonly Cut[], durationS: number, fps = FPS): { in: number; out: number; }`
- **trimCuts** (function) `(cuts: readonly Cut[], durationS: number, to: { in?: number; out?: number }): Cut[]`
- **moveCutEdge** (function) `(cuts: readonly Cut[], i: number, side: "from" | "to", t: number, durationS: number): Cut[]`
- **addCut** (function) `(cuts: readonly Cut[], from: number, to: number, durationS: number): Cut[]`
- **playFrom** (function) `(t: number, keep: readonly Span[]): number | null`
- **newOverlay** (function) `(at: number, durationS: number, text = "Your text"): TextOverlay`
- **captionLines** (function) `(words: readonly Word[], cuts: readonly Cut[], durationS: number): CaptionLine[]`
- **captionTrack** (function) `(words: readonly (Word & { stress?: boolean })[], cuts: readonly Cut[], durationS: number, which: "long" | "short"): { keep: Span[]; lines: (Line & { words: ShownWord[] })[]; which: "long" | "short" }`
- **captionShown** (function) `(track: ReturnType<typeof captionTrack>, t: number): ShownLine | null`
- **rewriteLine** (function) `(words: readonly Word[], at: readonly number[], text: string): Word[]`
- **overlaySchema** (const) `z.ZodObject<{ text: z.ZodString; from: z.ZodNumber; to: z.ZodNumber; x: z.ZodNumber; y: z.ZodNumber; size: z.ZodEnum<{ m: "m"; s: "s"; l: "l"; }>; }, z.core.$strict>`
- **overlaysSchema** (const) `z.ZodArray<z.ZodObject<{ text: z.ZodString; from: z.ZodNumber; to: z.ZodNumber; x: z.ZodNumber; y: z.ZodNumber; size: z.ZodEnum<{ m: "m"; s: "s"; l: "l"; }>; }, z.core.$strict>>`
- **cropsSchema** (const) `z.ZodObject<{ vertical: z.ZodOptional<z.ZodObject<{ x: z.ZodNumber; y: z.ZodNumber; }, z.core.$strict>>; square: z.ZodOptional<z.ZodObject<{ x: z.ZodNumber; y: z.ZodNumber; }, z.core.$strict>>; portrait: z.ZodOptional<z.ZodObject<{ x: z.ZodNumber; y: z.ZodNumber; }, z.core.$strict>>; shorts: z.ZodOp…`
- **shortCrop** (function) `(crops: Crops | undefined, n: number): Point | null`
- **captionPlaceSchema** (const) `z.ZodObject<{ long: z.ZodOptional<z.ZodNumber>; short: z.ZodOptional<z.ZodNumber>; }, z.core.$strict>`
- **captionY** (function) `(place: CaptionPlace | undefined, which: "long" | "short"): number`
- **snapFrame** (function) `(t: number, fps = FPS): number`
- **ShownLine** (interface) `interface ShownLine { words: ShownWord[]; end: number; t: number; }`

## packages/studio/src/fx.ts

- **FX** (const) `Record<Role, FxRole>`
- **Role** (type) `type Role = keyof typeof fx;`

## packages/studio/src/kit.ts

- **audioFiles** (function) `(audio: AudioProps | undefined): string[]`
- **Bed** (type) `type Bed = z.infer<typeof bedSchema>;`
- **bedPath** (function) `(e: Bed, cache = KIT_CACHE): string`
- **KIT_CACHE** (const) `string`
- **loadBeds** (function) `(pkgDir: string): Promise<Bed[]>`
- **stageSounds** (function) `(dir: string, files: Iterable<string>, o: { pkgDir: string; cache?: string }): Promise<number>`
- **unknownSounds** (function) `(beds: readonly Bed[], ids: Iterable<string>): string[]`

## packages/studio/src/locks.ts

- **brokenLocks** (function) `(locked: readonly string[], before: object, after: object): string[]`
- **changedPaths** (function) `(before: object, after: object, fields: readonly string[]): string[]`
- **isLockPath** (function) `(p: string): boolean`
- **valueAt** (function) `(edit: object, path: string): unknown`
- **withLocks** (function) `(locked: readonly string[], paths: readonly string[]): string[]`

## packages/studio/src/look.ts

- **cohereLooker** (function) `(keys: readonly string[], o: { ffmpeg?: string; fetchFn?: typeof fetch } = {}): Looker`
- **cutTranscript** (function) `(words: readonly Word[], keep: readonly Span[]): string`
- **geminiLooker** (function) `(keys: readonly string[], fetchFn: typeof fetch = fetch): Looker`
- **LOOK_PROVIDERS** (const) `readonly ["gemini", "twelvelabs", "cohere"]`
- **Looker** (type) `type Looker = ( file: string, transcript: string, prior?: Look["media"], ) => Promise<Omit<Look, "at">>;`
- **LookProvider** (type) `type LookProvider = (typeof LOOK_PROVIDERS)[number];`
- **TL_FREE_MINUTES** (const) `600`
- **toRaw** (function) `(look: Omit<Look, "at">, keep: readonly Span[]): Look`
- **twelvelabsFind** (function) `(key: string | undefined, media: NonNullable<Look["media"]>, words: string, fetchFn: typeof fetch = fetch): Promise<{ start: number; end: number; rank?: number }[]>`
- **twelvelabsLooker** (function) `(key: string | undefined, o: { usedMinutes: number; durationS: number; cut: string; fetchFn?: typeof fetch }): Looker`

## packages/studio/src/loudness.ts

- **applyFilter** (function) `(m: Loudness, i: number = LOUDNESS.i): string`
- **LOUDNESS** (const) `{ readonly i: -14; readonly tp: -1.5; readonly lra: 11; }`
- **Loudness** (interface) `interface Loudness { i: number; tp: number; lra: number; thresh: number; }`
- **measureFilter** (function) `(): string`
- **measureLoudness** (function) `(file: string, ffmpeg: string): Promise<Loudness | null>`
- **normalizeLoudness** (function) `(file: string, ffmpeg: string, o: { wav?: boolean; i?: number } = {}): Promise<Loudness | null>`
- **parseLoudnorm** (function) `(stderr: string): Loudness | null`

## packages/studio/src/matte.ts

- **editMattes** (function) `(pkgDir: string, edit: VideoEdit, o: { ffmpeg: string; at?: number; log?: (l: string) => void }): Promise<{ mattes: Matte[]; skipped: MattePlan["skipped"] }>`
- **ensureModel** (function) `(log: (l: string) => void = () => {}): Promise<string>`
- **MATTE** (const) `{ readonly size: 320; readonly maxS: 3; readonly mergeS: 0.5; readonly max: 40; readonly dir: "matte"; }`
- **MattePlan** (interface) `interface MattePlan { windows: MatteWindow[]; skipped: { i: number; why: string }[]; }`
- **MatteWindow** (interface) `interface MatteWindow { n: number; source: "main" | "cam"; fromFrame: number; frames: number; picks: number[]; }`
- **MODEL** (const) `{ readonly name: "u2net_human_seg"; readonly url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx"; readonly sha256: "01eb6a29a5c4d8edb30b56adad9bb3a2a0535338e480724a213e0acfd2d1c73c"; readonly bytes: 175997641; }`
- **makeMattes** (function) `(pkgDir: string, dir: string, plan: MattePlan, sources: { main: MatteSource; cam?: MatteSource }, o: { fps: number; ffmpeg: string; log?: (l: string) => void }): Promise<Matte[]>`
- **matteFile** (function) `(w: MatteWindow): string`
- **Pick** (interface) `interface Pick { i: number; w: string; s: number; e: number; }`
- **planMattes** (function) `(o: { picks: readonly Pick[]; layout: readonly LayoutRange[]; cam: boolean; camBox: boolean; durationS: number; fps: number; }): MattePlan`

## packages/studio/src/media.ts

- **cutSize** (function) `(s: { width: number; height: number }): [number, number]`
- **cutTracks** (function) `(tracks: Tracks, keep: readonly Span[], dir: string, ffmpeg: string): Promise<Record<string, string>>`
- **filmstrip** (function) `(input: string, out: string, durationS: number, ffmpeg: string): Promise<string>`
- **frameAt** (function) `(input: string, atS: number, out: string, ffmpeg: string): Promise<string>`
- **portrait** (function) `(s: { width: number; height: number }): boolean`
- **preview** (function) `(input: string, out: string, ffmpeg: string): Promise<string>`
- **probe** (function) `(path: string, ffmpeg: string): Promise<Track & { audio: boolean }>`
- **proxy360** (function) `(main: string, cam: string | undefined, out: string, ffmpeg: string): Promise<string>`
- **STRIP** (const) `{ readonly n: 60; readonly across: 10; readonly width: 160; }`
- **scaleFilter** (function) `(s: { width: number; height: number }): "scale=1080:-2:flags=lanczos" | "scale=-2:1080:flags=lanczos"`
- **sourceProxy** (function) `(input: string, out: string, ffmpeg: string, o: { shiftS?: number; audio?: boolean } = {}): Promise<string>`
- **wav16k** (function) `(path: string, out: string, ffmpeg: string): Promise<void>`

## packages/studio/src/obs.ts

- **findRecordings** (function) `(dir: string, quietS = 60, now = Date.now()): Promise<string[]>`
- **isOpen** (function) `(file: string): Promise<boolean>`
- **obsRecordingDir** (function) `(home = homedir()): Promise<string | null>`

## packages/studio/src/promo.ts

- **PromoProps** (type) `type PromoProps = { fps: number; durationInFrames: number; width: number; height: number; look: Look; audio: AudioProps; lufs: number; finish: { glow: boolean; dither: boolean }; scenes: TimedScene[]; };`
- **PromoScene** (type) `type PromoScene = z.infer<typeof promoScene>;`
- **PromoScript** (type) `type PromoScript = z.infer<typeof promoScript>;`
- **promoProps** (function) `(script: PromoScript, sizes: Record<string, [number, number]> = {}, o: { musicLufs?: number; takes?: Record<string, Take> } = {}): PromoProps`
- **promoScript** (const) `z.ZodObject<{ format: z.ZodDefault<z.ZodEnum<{ wide: "wide"; tall: "tall"; }>>; theme: z.ZodDefault<z.ZodEnum<{ light: "light"; dark: "dark"; }>>; fps: z.ZodOptional<z.ZodUnion<z.ZodLiteral<60 | 30>[]>>; look: z.ZodDefault<z.ZodObject<{ background: z.ZodOptional<z.ZodString>; foreground: z.ZodOption…`
- **secondsOf** (function) `(s: PromoScene): number`

## packages/studio/src/props.ts

- **BehindWord** (type) `type BehindWord = { w: string; s: number; e: number; to: number; matte: { file: string; src: string; fromFrame: number; frames: number }; place: { text: string; x: number; y: number; size: number }; };`
- **BIG** (const) `{ readonly long: { readonly frame: [1920, 1080]; readonly size: 260; readonly y: 430; }; readonly vertical: { readonly frame: [1080, 1920]; readonly size: 220; readonly y: 620; }; readonly square: { readonly frame: [1080, 1080]; readonly size: 200; readonly y: 400; }; readonly portrait: { readonly f…`
- **bigText** (function) `(w: string): string`
- **FramedProps** (type) `type FramedProps = Omit<LongProps, "cam" | "layout"> & { format: CroppedFormat; frame: [number, number]; picture: { file: string; size: [number, number]; window: [number, number, number, number] }; };`
- **faceRect** (function) `(face: Face, w: number, h: number, crop: Point | null = null): Rect`
- **framedPicture** (function) `(edit: VideoEdit): { source: "main" | "cam"; size: [number, number]; centre: Point; }`
- **framedProps** (function) `(edit: VideoEdit, format: CroppedFormat, mattes: readonly Matte[] = [], o: { skip?: OnSkip } = {}): FramedProps`
- **LongProps** (type) `type LongProps = { main: string; cam: string | null; fps: number; durationInFrames: number; words: Word[]; layout: LayoutRange[]; captions: Captions; stress: number[]; behind: BehindWord[]; overlays: TextOverlay[]; audio: AudioProps; look: Look; };`
- **longProps** (function) `(edit: VideoEdit, mattes: readonly Matte[] = [], o: { skip?: OnSkip } = {}): LongProps`
- **longSrt** (function) `(edit: VideoEdit): string`
- **Matte** (type) `type Matte = MatteWindow & { file: string; zone?: Zone };`
- **OnSkip** (type) `type OnSkip = (w: { w: string; s: number }, format: string) => void;`
- **SHORT_COUNT** (const) `{ readonly min: 2; readonly max: 12; }`
- **SHORT_S** (const) `{ readonly min: 20; readonly max: 60; }`
- **ShortProps** (type) `type ShortProps = Omit<LongProps, "cam"> & { face: Face; crop: Point | null; startFrame: number; segments: { from: number; frames: number }[]; title: string; card: TitleCard | null; };`
- **shortProps** (function) `(edit: VideoEdit, n: number, mattes: readonly Matte[] = [], o: { skip?: OnSkip } = {}): ShortProps`
- **ThumbnailProps** (type) `type ThumbnailProps = { main: string; face: Face; frame: number; text: string; variant: 1 | 2 | 3; look: Look; };`
- **thumbnailProps** (function) `(edit: VideoEdit): ThumbnailProps[] | null`
- **VerticalProps** (type) `type VerticalProps = FramedProps;`
- **verticalProps** (function) `(edit: VideoEdit, mattes: readonly Matte[] = [], o: { skip?: OnSkip } = {}): FramedProps`
- **verticalWindow** (function) `(w: number, h: number, cx = w / 2): [number, number, number, number]`

## packages/studio/src/punctuate.ts

- **alignPunctuation** (function) `(words: readonly Word[], text: string): { words: Word[]; changed: number }`
- **PUNCTUATE_CHUNK** (const) `250`
- **punctuate** (function) `(model: StressModel, words: readonly Word[]): Promise<{ words: Word[]; changed: number; asked: number }>`
- **punctuatePrompt** (function) `(words: readonly Word[]): string`
- **unpunctuated** (function) `(words: readonly Word[]): boolean`

## packages/studio/src/remotion.ts

- **openStudio** (function) `(pkgDir: string, dir: string, props: LongProps): Promise<void>`
- **RenderJob** (interface) `interface RenderJob { long?: LongProps; framed?: { [F in CroppedFormat]?: FramedProps | undefined }; shorts?: Map<number, ShortProps>; thumbnails?: ThumbnailProps[]; }`
- **renderAll** (function) `(pkgDir: string, dir: string, job: RenderJob, log: (line: string) => void = () => {}, ffmpeg = "ffmpeg"): Promise<{ files: Record<string, string>; seconds: Record<string, number> }>`
- **renderPromo** (function) `(pkgDir: string, dir: string, props: PromoProps, stillS?: number, ffmpeg = "ffmpeg"): Promise<string>`
- **renderStill** (function) `(pkgDir: string, dir: string, props: LongProps, atS: number): Promise<string>`
- **renderStills** (function) `(pkgDir: string, dir: string, job: Omit<RenderJob, "thumbnails">, atS: number, label = String(Math.round(atS * 10) / 10)): Promise<Record<string, string>>`

## packages/studio/src/render-hash.ts

- **CUT_HASH** (const) `string`
- **changedSince** (function) `(e: VideoEdit): string[] | null`
- **coverHash** (function) `(output: string | undefined, at: number): string`
- **cutHash** (function) `(e: VideoEdit): string`
- **hasHashes** (function) `(files: Record<string, string>): boolean`
- **hashFiles** (function) `(hashes: Record<string, string>, names: Iterable<string>): { [k: string]: string; }`
- **hashKey** (function) `(output: string): string`
- **isWanted** (function) `(e: Pick<VideoEdit, "formats">, output: string): boolean`
- **outputHashes** (function) `(e: VideoEdit): Record<string, string>`
- **RENDER_PARTS** (const) `readonly ["long", "vertical", "square", "portrait", "shorts", "thumbs"]`
- **RENDER_VERSION** (const) `1`
- **RenderPart** (type) `type RenderPart = (typeof RENDER_PARTS)[number];`
- **digest** (function) `(v: unknown): string`

## packages/studio/src/safe-zones.ts

- **addMask** (function) `(acc: Float32Array, mask: Uint8Array, size: number): void`
- **covered** (function) `(zone: Zone, rect: Rect, box: Rect): number`
- **fitRect** (function) `(src: [number, number], box: [number, number], fit: "contain" | "cover"): Rect`
- **placeWord** (function) `(zone: Zone, rect: Rect, o: { frame: [number, number]; text: string; size: number; y: number }): Spot | null`
- **Rect** (type) `type Rect = [number, number, number, number];`
- **Spot** (interface) `interface Spot { x: number; y: number; size: number; where: Where; clear: number; }`
- **verticalRect** (function) `(picture: { size: [number, number]; window: [number, number, number, number] }, frame: readonly [number, number] = [1080, 1920]): Rect`
- **Where** (type) `type Where = "middle" | "above" | "left" | "right";`
- **wordBox** (function) `(text: string, size: number, x: number, y: number): Rect`
- **ZONE** (const) `{ readonly grid: 48; readonly thresh: number; readonly clear: 0.7; readonly margin: 0.04; readonly shrink: 0.8; readonly minScale: 0.5; readonly charW: 0.62; readonly glyphH: 0.72; }`
- **Zone** (interface) `interface Zone { grid: number; occ: string; }`
- **zoneAcc** (function) `(grid: number = ZONE.grid): Float32Array<ArrayBuffer>`
- **zoneOf** (function) `(acc: Float32Array): Zone`

## packages/studio/src/schema.ts

- **EDIT_STATES** (const) `readonly ["added", "edited", "rendered", "approved", "uploaded", "rejected"]`
- **EditState** (type) `type EditState = (typeof EDIT_STATES)[number];`
- **CUT_WHYS** (const) `readonly ["silence", "filler", "retake", "manual"]`
- **CUT_STATES** (const) `readonly ["cut", "proposed", "kept"]`
- **LAYOUTS** (const) `readonly ["corner", "cam", "screen"]`
- **FORMATS** (const) `readonly ["long", "vertical", "square", "portrait"]`
- **Format** (type) `type Format = (typeof FORMATS)[number];`
- **Word** (interface) `interface Word { w: string; s: number; e: number; }`
- **Cut** (interface) `interface Cut { from: number; to: number; why: (typeof CUT_WHYS)[number]; state: (typeof CUT_STATES)[number]; }`
- **Track** (interface) `interface Track { path: string; durationS: number; width: number; height: number; fps: number; }`
- **Tracks** (interface) `interface Tracks { main: Track; cam?: Track & { offsetS: number }; camBox?: [number, number, number, number]; }`
- **LayoutRange** (interface) `interface LayoutRange { from: number; to: number; show: (typeof LAYOUTS)[number]; }`
- **Short** (interface) `interface Short { from: number; to: number; title: string; card?: boolean | undefined; cardText?: string | undefined; }`
- **Chapter** (interface) `interface Chapter { at: number; title: string; }`
- **Look** (interface) `interface Look { at: string; summary: string; moments: { at: number; why: string }[]; shorts: Short[]; chapters: Chapter[]; thumbnails: { at: number; why: string }[]; media?: { id: string; asset: string; cut: string; minutes: number }; }`
- **RenderState** (interface) `interface RenderState { state: "waiting" | "rendering" | "failed"; at: string; by?: string; why?: string; }`
- **videoEdits** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "video_edits"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "video_edits"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **VideoEdit** (type) `type VideoEdit = typeof videoEdits.$inferSelect;`

## packages/studio/src/sentences.ts

- **EditWords** (interface) `interface EditWords { words: readonly Word[]; cuts: readonly Cut[]; durationS: number; }`
- **keptWords** (function) `(words: readonly Word[], keep: readonly Span[]): Word[]`
- **Moved** (interface) `interface Moved { n: number; from: number; to: number; }`
- **SENTENCE** (const) `{ readonly pauseS: 0.6; readonly reachS: 20; readonly padS: 0.15; readonly slackS: 0.05; }`
- **sentenceEdges** (function) `(words: readonly Word[]): { starts: Set<number>; ends: Set<number> }`
- **shortIssues** (function) `(e: EditWords, shorts: readonly Pick<Short, "from" | "to">[], only: (s: Pick<Short, "from" | "to">, i: number) => boolean = () => true): string[]`
- **snapShorts** (function) `(e: EditWords, shorts: readonly Short[]): { shorts: Short[]; moved: Moved[] }`

## packages/studio/src/sounds.ts

- **AudioProps** (type) `type AudioProps = { sounds: PlacedSound[]; music: { file: string; volume: number; duck: [number, number][]; duckDb: number } | null; };`
- **autoSounds** (function) `(edit: { tracks: { main: { durationS: number } }; layout: readonly LayoutRange[]; overlays?: readonly { from: number }[] | undefined; shorts: readonly Short[]; }, events: RecordingEvents = { clicks: [], keys: [] }): Sound[]`
- **BED_DB** (const) `-16`
- **BED_ID** (const) `RegExp`
- **BED_LUFS** (const) `-14`
- **FX_BED_LUFS** (const) `{ readonly voice: number; readonly music: -24; }`
- **isEffect** (function) `(id: string): id is Role`
- **kitFiles** (function) `(ids: Iterable<string>): string[]`
- **Music** (interface) `interface Music { id: string; gainDb?: number | undefined; duck?: boolean | undefined; }`
- **musicSchema** (const) `z.ZodNullable<z.ZodObject<{ id: z.ZodString; gainDb: z.ZodOptional<z.ZodNumber>; duck: z.ZodOptional<z.ZodBoolean>; }, z.core.$strict>>`
- **PlacedSound** (type) `type PlacedSound = { file: string; from: number; volume: number; trim?: number };`
- **placeEffects** (function) `(cues: readonly (readonly [t: number, id: string, gainDb?: number | undefined])[], o: { fps: number; bed: number }): PlacedSound[]`
- **RecordingEvents** (interface) `interface RecordingEvents { clicks: number[]; keys: number[]; }`
- **ROLE_SAYS** (const) `{ readonly tick: "an airy tick, in quick runs"; readonly "tick.crisp": "a brighter tick"; readonly tock: "a wooden knock, just before the cut"; readonly hit: "a short punchy hit on a cut"; readonly land: "a round low thump just after the cut, for a card or a panel landing"; readonly "land.light": "a…`
- **ROLES** (const) `("text" | "key" | "pop" | "drop" | "click" | "tick" | "land" | "hit" | "tick.crisp" | "tock" | "land.light" | "whoosh.short" | "whoosh.long" | "riser" | "swell" | "key.space" | "key.return" | "click.confirm" | "snap" | "bell")[]`
- **SOUND_RULES** (const) `readonly [{ readonly on: "click"; readonly id: "click"; readonly says: "a small plastic click on each mouse click"; }, { readonly on: "key"; readonly id: "key"; readonly says: "a key tap on each key press, a new take each"; }, { readonly on: "overlay"; readonly id: "pop"; readonly says: "a soft pop …`
- **Sound** (interface) `interface Sound { at: number; id: string; gainDb?: number | undefined; only?: "long" | "short" | undefined; }`
- **soundFile** (function) `(id: string): string`
- **soundsSchema** (const) `z.ZodArray<z.ZodObject<{ at: z.ZodNumber; id: z.ZodString & z.ZodType<"text" | "key" | "pop" | "drop" | "click" | "tick" | "land" | "hit" | "tick.crisp" | "tock" | "land.light" | "whoosh.short" | "whoosh.long" | "riser" | "swell" | "key.space" | "key.return" | "click.confirm" | "snap" | "bell", stri…`
- **speech** (function) `(words: readonly Pick<Word, "s" | "e">[]): [number, number][]`
- **takeVolume** (function) `(role: Role, take: Take, bed: number, gainDb = 0): number`

## packages/studio/src/storyboard.ts

- **beatSpans** (function) `(e: Pick<Edit, "words" | "chapters">, durationS: number): { kind: "chapter" | "part"; title: string | null; from: number; to: number }[]`
- **storyboardOf** (function) `(e: Edit): Storyboard`
- **boardChange** (function) `(before: Storyboard, after: Storyboard): BoardChange`
- **beatText** (function) `(b: Beat, o: { max?: number } = {}): string[]`
- **storyboardText** (function) `(sb: Storyboard, o: { max?: number } = {}): string`
- **Show** (type) `type Show = (typeof LAYOUTS)[number];`
- **BEAT** (const) `{ readonly partS: 30; }`
- **Beat** (interface) `interface Beat { key: string; kind: "chapter" | "part" | "short"; n: number; title: string | null; from: number; to: number; at: number; onCut: { from: number; to: number } | null; playsS: number; cutS: number; cut: "none" | "some" | "all"; said: string; struck: string; onScreen: string[]; layout: Show[]; }`
- **Storyboard** (interface) `interface Storyboard { title: string; rawS: number; cutS: number; formats: Format[]; chapters: number; captions: string; beats: Beat[]; shorts: Beat[]; }`
- **BoardChange** (interface) `interface BoardChange { header: string[]; beats: string[]; gone: string[]; }`

## packages/studio/src/stress.ts

- **checkStress** (function) `(words: readonly Word[], stress: readonly number[]): string[]`
- **OUT_OF_FREE** (const) `RegExp`
- **parseStress** (function) `(text: string, words: readonly Word[], from = 0, to = words.length): number[]`
- **proposeStress** (function) `(model: StressModel, cut: readonly { i: number; w: Word }[]): Promise<{ stress: number[]; asked: number; offered: number }>`
- **remapStress** (function) `(before: readonly Word[], after: readonly Word[], stress: readonly number[]): number[]`
- **STRESS** (const) `{ readonly perMinute: 3; readonly gapS: 0.6; readonly holdS: 1.2; readonly repeatMax: 2; readonly repeatGapS: 180; readonly chunk: 300; }`
- **spaceStress** (function) `(words: readonly Word[], picks: readonly number[], o: { perMinute?: number } = {}): number[]`
- **stressCandidates** (function) `(e: { words: readonly Word[]; cuts: readonly Cut[]; tracks: { main: { durationS: number } } }, fps = 30): { i: number; w: Word }[]`
- **stressPrompt** (function) `(words: readonly Word[], from: number, to: number): string`
- **withFallback** (function) `(primary: StressModel & { name: string }, backup: (StressModel & { name: string }) | null, when: RegExp = OUT_OF_FREE): StressModel & { answered: string[] }`
- **wordAt** (function) `(words: readonly Word[], at: number): number`
- **beatsOf** (function) `(words: readonly Word[]): number[]`
- **clash** (function) `(words: readonly Word[], beats: readonly number[], i: number, j: number): string | null`
- **shownOf** (function) `(w: Word): { from: number; to: number; }`
- **StressModel** (interface) `interface StressModel { complete(prompt: string, o?: { system?: string; maxTokens?: number }): Promise<{ text: string }>; }`

## packages/studio/src/take.ts

- **readTake** (function) `(root: string, dir: string): Promise<Take>`

## packages/studio/src/video-check.ts

- **CheckIssue** (interface) `interface CheckIssue { at: number; rule: string; says: string; }`
- **CheckResult** (interface) `interface CheckResult { pass: boolean; issues: CheckIssue[]; }`
- **checkPrompt** (function) `(format: BarFormat, o: { durationS: number; every: number; cols: number; cuts: number[]; words: string }): string`
- **checkRender** (function) `(file: string, o: { format: BarFormat; durationS: number; words: readonly { w: string; s: number }[]; model: Model; ffmpeg: string; }): Promise<CheckResult>`
- **parseCheck** (function) `(text: string): CheckResult`
- **sheetGrid** (function) `(durationS: number): { every: number; n: number; cols: number; rows: number; }`

## packages/studio/src/whisper.ts

- **transcribe** (function) `(wav: string, opts: { model?: string; bin?: string; language?: string; prompt?: string; align?: boolean; } = {}): Promise<Word[]>`

## packages/studio/src/words.ts

- **fixWordAt** (function) `(words: readonly Word[], at: number, text: string): Fixed`
- **fixWords** (function) `(words: readonly Word[], wrong: string, right: string): Fixed`
