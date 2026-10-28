# @wren/ui: interface

Exports: 704. Files: 124.

## node_modules/.pnpm/@tanstack+query-core@5.104.0/node_modules/@tanstack/query-core/build/modern/focusManager.d.cts

- **focusManager** (const) `FocusManager`

## node_modules/.pnpm/@tanstack+query-core@5.104.0/node_modules/@tanstack/query-core/build/modern/onlineManager.d.cts

- **onlineManager** (const) `OnlineManager`

## node_modules/.pnpm/sonner@2.0.8_@types+react@19.3.0_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/sonner/dist/index.d.ts

- **toast** (const) `((message: titleT, data?: ExternalToast) => string | number) & { success: (message: titleT | React.ReactNode, data?: ExternalToast) => string | number; info: (message: titleT | React.ReactNode, data?: ExternalToast) => string | number; warning: (message: titleT | React.ReactNode, data?: ExternalToast) => string | number; error: (message: titleT | React.ReactNode, data?: ExternalToast) => string | number; custom: (jsx: (id: number | string) => React.ReactElement, data?: ExternalToast) => string | number; message: (message: titleT | React.ReactNode, data?: ExternalToast) => string | number; promise: <ToastData>(promise: PromiseT<ToastData>, data?: PromiseData<ToastData>) => (string & { unwrap: () => Promise<ToastData>; }) | (number & { unwrap: () => Promise<ToastData>; }) | { unwrap: () => Promise<ToastData>; }; dismiss: (id?: number | string) => string | number; loading: (message: titleT | React.ReactNode, data?: ExternalToast) => string | number; } & { getHistory: () => (ToastT | ToastToDismiss)[]; getToasts: () => (ToastT | ToastToDismiss)[]; }`

## packages/core/src/saved-views.ts

- **SavedViewLine** (interface) `interface SavedViewLine { id: number; name: string; params: string; shared: boolean; mine: boolean; }`

## packages/ui/.storybook/frame.tsx

- **preview** (const) `Preview`

## packages/ui/.storybook/story-tests.ts

- **storyTests** (function) `(configDir: string): import("vite").UserConfig`

## packages/ui/src/access.ts

- **Access** (interface) `interface Access { audience?: "team" | "client" | "demo"; role?: "owner"; feature?: string; needs?: Permission; flag?: string; at?: Target; }`
- **can** (function) `(viewer: Viewer, access: Access | undefined): boolean`
- **canAt** (function) `(viewer: Viewer, verb: Permission, at: Target = {}): boolean`
- **Viewer** (interface) `interface Viewer { team: boolean; demo: boolean; role?: "owner" | "member" | "viewer"; features?: readonly string[]; can?: readonly string[]; flags?: Readonly<Record<string, string>>; who?: Who; }`

## packages/ui/src/accounts.tsx

- **AccountBadge** (function) `({ field, value, warn, }: { field?: FieldMeta | null | undefined; value: string; warn?: string | null | undefined; }): import("react").JSX.Element`
- **AccountFilter** (function) `({ meta, place }: { meta: RecordMeta; place: Place }): import("react").JSX.Element | null`
- **AccountPicker** (function) `({ pick, onPick, busy, unsaved, }: { pick: AccountPick; onPick: (key: string | null) => void | Promise<void>; busy?: boolean | undefined; unsaved?: boolean | undefined; }): import("react").JSX.Element`
- **accountFieldOf** (function) `(meta: RecordMeta): FieldMeta | null`
- **accountState** (function) `(field: FieldMeta | null | undefined, key: string): State`

## packages/ui/src/action.tsx

- **Action** (interface) `interface Action { id: string; label: string; icon?: IconName; handler: string; input?: unknown; requires?: Access; confirm?: string; ask?: { field: string; label: string; from?: string; preview?: MessageKind | ((id: string | number) => Promise<MessageKind | null>); }; form?: readonly FormField[]; each?: true; done?: (answer: unknown) => string; optimistic?: string; key?: string; bulk?: true; undo?: string; when?: Readonly<Record<string, readonly string[]>>; blocked?: Readonly<Record<string, Readonly<Record<string, string>>>>; sets?: Readonly<Record<string, string>>; inline?: true; expect?: true; }`
- **Call** (type) `type Call = (handler: string, input: Record<string, unknown>) => Promise<unknown>;`
- **Copied** (interface) `interface Copied { text: string; url: string; }`
- **callOnce** (function) `(call: Call, handler: string, ids: readonly (string | number)[], input: Record<string, unknown>, press: Omit<PressOptions, "key"> = {}, writes: Writes = WRITES): Promise<unknown>`
- **copiedIn** (function) `(answer: unknown): Copied | null`
- **copyAndOpen** (function) `(c: Copied): void`
- **FormField** (interface) `interface FormField { field: string; label: string; type?: | "long" | "date" | "number" | "url" | "file" | "switch" | "select" | "lines" | "numbers" | "pick" | "combo" | "json"; optional?: true; options?: readonly string[]; choices?: { handler: string; list: (answer: unknown) => readonly string[] }; labels?: Readonly<Record<string, string>>; hint?: string; pattern?: string; from?: (values: Record<string, string>) => string; }`
- **holdWithUndo** (function) `(o: { press: PressOptions; commit: (requestId: string) => Promise<unknown>; line: string; writes?: Writes | undefined; toast?: ToastFns | undefined; }): boolean`
- **Runner** (class) `opened; constructor(private deps: RunnerDeps); update(deps: RunnerDeps): void; readonly subscribe; readonly snapshot; get busy(); run(action: Action, ids: Ids, start = ""): "asked" | "held" | "sent" | null; close(): void; submit(input: Record<string, unknown>): Promise<boolean>; refuse(why: string): void; send(action: Action, ids: Ids, input: Record<string, unknown>): Promise<boolean>; go(action: Action, ids: Ids, given: Record<string, unknown>): Promise<boolean>`
- **said** (function) `(line: string): () => string`
- **say** (const) `{ done: (line: string) => undefined; failed: (err: unknown) => undefined; stale: (line: string) => undefined; }`
- **Toasts** (function) `(): import("react").JSX.Element`
- **useHeld** (function) `(many: string, writes: Writes = WRITES): { ids: ReadonlySet<string>; going: ReadonlyMap<string, string | null>; landed: number; }`
- **useLastWrite** (function) `(record: string | null | undefined, what?: readonly string[], writes: Writes = WRITES): Write | null`

## packages/ui/src/browser.tsx

- **Browser** (function) `({ label, folders, folder, onFolder, rootLabel = "All", folderActions, onDrop, head, list, detail, placeholder, onClose, nameOf = (part) => part, }: { label: string; folders: readonly BrowserFolder[]; folder: string; onFolder: (path: string) => void; rootLabel?: string; folderActions?: ReactNode; onDrop?: ((folder: string, id: string) => void) | undefined; head?: ReactNode; list: ReactNode; detail: ReactNode | null; placeholder?: ReactNode; onClose: () => void; nameOf?: (part: string) => string; }): import("react").JSX.Element`
- **BrowserFolder** (interface) `interface BrowserFolder { path: string; count: number; }`
- **BrowserRow** (function) `({ id, open, onOpen, draggable = false, children, }: { id: string; open: boolean; onOpen: () => void; draggable?: boolean; children: ReactNode; }): import("react").JSX.Element`
- **folderTree** (function) `(folders: readonly BrowserFolder[], nameOf: (part: string) => string = (part) => part): Node[]`

## packages/ui/src/busy.tsx

- **Busy** (function) `({ on, size = "small" }: { on: boolean; size?: BusySize }): import("react").JSX.Element | null`
- **BusyBox** (function) `({ title, note }: { title: string; note?: string | undefined }): import("react").JSX.Element`
- **BusySize** (type) `type BusySize = "small" | "step" | "big";`
- **Ring** (function) `({ size = "small", on = true }: { size?: BusySize; on?: boolean }): import("react").JSX.Element`

## packages/ui/src/charts/heat.tsx

- **HeatChart** (function) `({ rows, cols, cells, label, color = "var(--ui-chart-1)", format = (n) => n.toLocaleString("en-US"), }: HeatProps): import("react").JSX.Element`

## packages/ui/src/charts/index.tsx

- **BarsChart** (function) `(props: BarsProps): import("react").JSX.Element`
- **BarsRow** (interface) `interface BarsRow { label: string; value: number; note?: string | undefined; tone?: string | undefined; }`
- **ColumnsChart** (function) `(props: ColumnsProps): import("react").JSX.Element`
- **LinesChart** (function) `(props: LinesProps): import("react").JSX.Element`
- **RingChart** (function) `(props: RingProps): import("react").JSX.Element`
- **RingSlice** (interface) `interface RingSlice { key: string; value: number; color: string; }`
- **Sparkline** (function) `({ fallback, ...props }: SparkProps & { fallback: ReactNode }): import("react").JSX.Element`
- **TrendChart** (function) `(props: TrendProps): import("react").JSX.Element`

## packages/ui/src/components/ui/input.tsx

- **Input** (function) `({ className, type, ...props }: React.ComponentProps<"input">): React.JSX.Element`

## packages/ui/src/components/ui/textarea.tsx

- **Textarea** (function) `({ className, ...props }: React.ComponentProps<"textarea">): React.JSX.Element`

## packages/ui/src/controls.tsx

- **Button** (function) `({ tone, size, icon, arrow, busy, done, doneLabel = "Done", disabled, children, className, type = "button", ...rest }: ButtonLook & { busy?: boolean | undefined; done?: boolean | undefined; doneLabel?: ReactNode; } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">): import("react").JSX.Element`
- **ButtonLink** (function) `({ tone, size, icon, arrow, children, className, ...rest }: ButtonLook & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "className">): import("react").JSX.Element`
- **ButtonTone** (type) `type ButtonTone = "primary" | "secondary" | "quiet";`
- **Check** (function) `({ checked, onChange, note, disabled, children, }: { checked: boolean; onChange: (checked: boolean) => void; note?: ReactNode; disabled?: boolean | undefined; children: ReactNode; }): import("react").JSX.Element`
- **Checks** (function) `({ children, className }: { children: ReactNode; className?: string }): import("react").JSX.Element`
- **Seg** (function) `({ label, items, value, onChange, dense = false, fill = false, className, }: { label: string; items: readonly { value: T; label: ReactNode; busy?: boolean | undefined }[]; value: T; onChange: (value: T) => void; dense?: boolean | undefined; fill?: boolean | undefined; className?: string | undefined; }): import("react").JSX.Element`
- **Tag** (function) `({ tone = "neutral", dot = false, busy, title, className, style, children, }: { tone?: TagTone; dot?: boolean; busy?: boolean | undefined; title?: string | undefined; className?: string | undefined; style?: CSSProperties | undefined; children: ReactNode; }): import("react").JSX.Element`
- **TagTone** (type) `type TagTone = "neutral" | "accent" | "warn" | "green" | "bad";`
- **Track** (function) `({ value, max = 1, label, name, className, }: { value: number; max?: number; label?: ReactNode; name?: string | undefined; className?: string | undefined; }): import("react").JSX.Element`

## packages/ui/src/copy.tsx

- **COPIED_MS** (const) `1500`
- **CodeBlock** (function) `({ label, code }: { label: string; code: string }): import("react").JSX.Element`
- **Copyable** (function) `({ text, className }: { text: string; className?: string }): import("react").JSX.Element`
- **CopyButton** (function) `({ text, label = "Copy", tone = "quiet", size = "sm", className, }: { text: string; label?: string; tone?: ButtonTone; size?: "sm" | "dense"; className?: string; }): import("react").JSX.Element`
- **useCopy** (function) `(): { copied: string | null; copy: (text: string, key?: string) => void }`

## packages/ui/src/customize.tsx

- **moved** (function) `(list: readonly T[], from: number, to: number): T[]`
- **PinLine** (interface) `interface PinLine { href: string; label: string; icon: IconName; }`
- **PinnedRow** (function) `({ pins }: { pins: PinLine[] }): import("react").JSX.Element | null`
- **Pref** (interface) `interface Pref<T> { value: T | undefined; ready: boolean; set: (value: T | null) => void; }`
- **RAIL_PREF** (const) `"rail"`
- **RailPref** (interface) `interface RailPref { pins: string[]; }`
- **togglePin** (function) `(pins: readonly string[], href: string): string[]`
- **usePref** (function) `(keep: KeepApi | undefined, key: string): Pref<T>`

## packages/ui/src/data.tsx

- **Facts** (function) `({ items, className, }: { items: [label: string, value: ReactNode][]; className?: string | undefined; }): import("react").JSX.Element`
- **Settings** (function) `({ values, fields, className, }: { values: Readonly<Record<string, unknown>> | null | undefined; fields?: readonly SettingField[] | null | undefined; className?: string | undefined; }): import("react").JSX.Element | null`

## packages/ui/src/data/delta.ts

- **listChanged** (function) `(list: (ask: ListAsk) => Promise<RecordsPage>, ask: ListAsk, before: RecordsPage | undefined): Promise<RecordsPage>`

## packages/ui/src/data/edits.ts

- **EDITS** (const) `Edits`
- **Edits** (class) `setClient(client: string | null): void; view(client = this.client): Store; get(client: string, key: string): string | null; set(client: string, key: string, value: string | null, fromTab = false): void; keys(client = this.client): string[]; start(owner: string | null, disk: KeyValue | null, legacy: Storage | null = null): Promise<void>; wipe(): void; readonly subscribe; readonly snapshot`

## packages/ui/src/data/local.ts

- **dropLocalCopy** (function) `(storage: KeyValue | null = store ?? indexedStore()): Promise<void>`
- **indexedStore** (function) `(idb: IDBFactory | undefined = globalThis.indexedDB, name = DB): KeyValue | null`
- **KeyValue** (interface) `interface KeyValue extends AsyncStore { clear(): Promise<void>; entries(prefix: string): Promise<[string, string][]>; }`
- **LocalCopy** (interface) `interface LocalCopy { owner: string | null; storage?: KeyValue | null; tabs?: boolean; }`
- **startLocalCopy** (function) `({ owner, storage = indexedStore(), tabs = true, }: LocalCopy): Promise<void>`
- **tellTabsLanded** (function) `(): void`

## packages/ui/src/data/query.ts

- **cachedOf** (function) `(scope: object, key: string): T | undefined`
- **dropCached** (function) `(scope: object, key: string): void`
- **FOCUS_STALE_MS** (const) `60000`
- **keyOf** (function) `(scope: object, key: string): QueryKey`
- **nameScope** (function) `(scope: S, name: string): S`
- **QUERIES** (const) `QueryClient`
- **readCached** (function) `(scope: object, key: string, fn: () => Promise<T>, freshMs = FOCUS_STALE_MS): Promise<T>`
- **readTogether** (function) `(fn: <T>(run: () => T) => T): void`
- **refreshAll** (function) `(): Promise<void>`
- **refreshing** (function) `(l: Pick<Load<unknown>, "loading" | "data" | "placeholder">): boolean`
- **stampOf** (function) `(data: unknown): number`
- **Load** (type) `type Load<T> = { data: T | null; error: Error | null; loading: boolean; pending: boolean; placeholder: boolean; retry: () => void; at: number; };`
- **useLoad** (function) `(key: string | null, fn: (before: T | undefined) => Promise<T>, scope?: object, o: { freshMs?: number } = {}): Load<T>`
- **Patch** (type) `type Patch = (key: string, data: unknown) => unknown;`
- **patchedSince** (function) `(scope: object, key: string, data: unknown, left: number): unknown`
- **writeThrough** (function) `(scope: object, patch: Patch, now = Date.now()): void`

## packages/ui/src/data/status.tsx

- **indicatorOf** (function) `(online: boolean, pending: number): string | null`
- **SendLine** (type) `type SendLine = { tone: "info" | "bad"; text: string } | null;`
- **SendStatus** (function) `({ write, done, className, }: { write: Write | null; done?: string | null; className?: string; }): import("react").JSX.Element | null`
- **sendLineOf** (function) `(w: Write | null, done: string | null = "Sent."): SendLine`
- **useWritesState** (function) `(writes: Writes = WRITES): { online: boolean; pending: number }`
- **WritesIndicator** (function) `({ className }: { className?: string }): import("react").JSX.Element | null`

## packages/ui/src/data/use-edit.tsx

- **Edit** (interface) `interface Edit { value: string; set: (value: string) => void; dirty: boolean; restored: boolean; conflict: EditConflictState | null; keepMine: () => void; takeTheirs: () => void; saved: (value?: string) => void; discard: () => void; field: { value: string; onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void; "data-edit": string; }; }`
- **EditConflict** (function) `({ conflict, onKeepMine, onTakeTheirs, what = "this", }: { conflict: EditConflictState | null; onKeepMine: () => void; onTakeTheirs: () => void; what?: string; }): import("react").JSX.Element | null`
- **EditConflictState** (interface) `interface EditConflictState { mine: string; theirs: string; }`
- **EditOptions** (interface) `interface EditOptions { version?: string | null | undefined; now?: () => number; }`
- **UnsavedMark** (function) `({ edit }: { edit: Pick<Edit, "dirty" | "conflict"> }): import("react").JSX.Element | null`
- **useEdit** (function) `(key: string | null, server: string, o: EditOptions = {}): Edit`

## packages/ui/src/day.tsx

- **DaySource** (interface) `interface DaySource { record: string; label: string; view?: string; at: string; carry?: true; action?: string; open: string; }`
- **RecordDay** (function) `(props: RecordDayProps): import("react").JSX.Element`

## packages/ui/src/dictate-text.ts

- **joinDictated** (function) `(before: string, said: string, after = ""): string`

## packages/ui/src/dictate.tsx

- **DICTATE_KEYS** (const) `"⌥Space" | "Alt+Space"`
- **Dictate** (function) `({ target, className, label = "Dictate", onHearing, }: { target: RefObject<Field | null>; className?: string | undefined; label?: string | undefined; onHearing?: ((on: boolean) => void) | undefined; }): import("react").JSX.Element | null`
- **DictateEvents** (interface) `interface DictateEvents { phase(p: DictatePhase): void; level(n: number): void; partial(text: string): void; final(text: string): void; error(message: string): void; done(): void; }`
- **DictateField** (function) `({ target, line = false, off = false, label, className, children, }: { target: RefObject<Field | null>; off?: boolean | undefined; line?: boolean | undefined; label?: string | undefined; className?: string | undefined; children: ReactNode; }): import("react").JSX.Element`
- **DictateHandle** (interface) `interface DictateHandle { stop(): void; cancel(): void; }`
- **DictatePhase** (type) `type DictatePhase = | { kind: "loading"; progress: number | null } | { kind: "listening" } | { kind: "finishing" };`
- **DictateStatus** (type) `type DictateStatus = | { state: "ready"; adapter: string } | { state: "unavailable"; why: string } | { state: "off" };`
- **DictationEngine** (interface) `interface DictationEngine { status(): DictateStatus; subscribe(fn: () => void): () => void; start(on: DictateEvents): DictateHandle; }`
- **DictationProvider** (function) `({ engine, children, }: { engine: DictationEngine | null; children: ReactNode; }): import("react").JSX.Element`
- **useDictateStatus** (function) `(): DictateStatus`

## packages/ui/src/diff.tsx

- **Diff** (function) `({ a, b, names, layout = "auto", className, }: { a: string; b: string; names: [ReactNode, ReactNode]; layout?: "auto" | "split" | "unified"; className?: string | undefined; }): import("react").JSX.Element`
- **pairsOf** (function) `(lines: readonly DiffLine[]): Pair[]`

## packages/ui/src/display.ts

- **DISPLAY** (const) `Display`
- **DISPLAY_PREF** (const) `"display"`
- **Display** (interface) `interface Display { side: number; sideShut: boolean; pages: number; pagesShut: boolean; density: Density; text: TextSize; frame: boolean; counts: boolean; motion: Motion; }`
- **LOOK_PREF** (const) `"look"`
- **readDisplay** (function) `(v: unknown): Display`

## packages/ui/src/draft-save.ts

- **answerIn** (function) `(out: unknown): unknown`

## packages/ui/src/draft.tsx

- **DraftEditor** (type) `type DraftEditor = (p: DraftEditorProps) => ReactNode;`
- **DraftEditorProps** (interface) `interface DraftEditorProps { text: string; setText: (text: string) => void; flush: (next?: string) => Promise<boolean>; editable: boolean; }`
- **DraftText** (const) `import("react").Context<LiveText | null>`
- **DraftTurnLine** (interface) `interface DraftTurnLine { id: string; command: string; by: string | null; message: string | null; at: string; state: "thinking" | "done" | "failed"; reply: string | null; draft: string | null; error: string | null; }`
- **DraftTurns** (function) `({ turns }: { turns: readonly DraftTurnLine[] }): import("react").JSX.Element`
- **RecordDraft** (interface) `interface RecordDraft { field: string; label: string; text: string | null; turns?: DraftTurnLine[] | undefined; preview?: MessageKind | null | undefined; save: string; ask?: string | undefined; undo?: string | undefined; send?: string | undefined; editor?: DraftEditor | undefined; accounts?: AccountPick | null | undefined; }`
- **useDraftText** (function) `(): string | null`

## packages/ui/src/edit-form.tsx

- **AccountField** (function) `({ form, name, pick, }: Omit<FieldBase<V>, "label" | "hint" | "className"> & { pick: Omit<AccountPick, "current" | "picked">; }): import("react").JSX.Element`
- **CheckField** (function) `({ form, name, label, className, disabled, required, }: FieldBase<V> & { disabled?: boolean | undefined; required?: boolean | undefined }): import("react").JSX.Element`
- **ChecksField** (function) `({ form, name, label, className, options, }: FieldBase<V> & { options: readonly (readonly [string, ReactNode])[] }): import("react").JSX.Element`
- **centsOf** (function) `(text: string): number | null`
- **changedFrom** (function) `(from: Values, values: Values): Values`
- **DateField** (function) `(p: FieldBase<V> & Omit<ComponentProps<typeof Input>, "form" | "name" | "value" | "type">): import("react").JSX.Element`
- **EditForm** (interface) `interface EditForm<V extends FieldValues> extends UseFormReturn<V> { restored: boolean; conflict: { mine: Partial<V>; theirs: Partial<V> } | null; keepMine: () => void; takeTheirs: () => void; unsent: boolean; onSend: ( send: (values: V) => Promise<unknown> | unknown, o?: { clear?: boolean }, ) => (e?: BaseSyntheticEvent) => Promise<void>; forget: (next?: V) => void; error: string | null; }`
- **EditFormOptions** (interface) `interface EditFormOptions<V extends FieldValues> { key: string | null; defaults: V; schema?: z.ZodType<V> | undefined; base?: string | undefined; }`
- **FIELD_CLASS** (const) `"flex min-w-0 flex-col gap-1.5 text-[13px] text-(--ui-ink-2)"`
- **FormKept** (function) `({ form, what = "changes", labels, }: { form: Pick<EditForm<V>, "restored" | "conflict" | "unsent" | "keepMine" | "takeTheirs">; what?: string; labels?: Partial<Record<keyof V, string>>; }): import("react").JSX.Element | null`
- **forgetKept** (function) `(key: string): void`
- **HINT_CLASS** (const) `"text-[12px] text-(--ui-ink-3)"`
- **LABEL_CLASS** (const) `"text-[13px] font-medium text-(--ui-ink-2)"`
- **MoneyField** (function) `(p: FieldBase<V> & Omit<ComponentProps<typeof Input>, "form" | "name" | "value" | "type" | "inputMode">): import("react").JSX.Element`
- **RadioField** (function) `({ form, name, label, className, options, }: FieldBase<V> & { options: readonly (readonly [string, ReactNode])[] }): import("react").JSX.Element`
- **SELECT_CLASS** (const) `"min-h-[38px] w-full border border-(--ui-hair) bg-(--ui-paper) px-3 py-2 text-[14.5px] text-(--ui-ink) focus-visible:border-(--ui-focus) focus:outline-none"`
- **SelectField** (function) `({ form, name, label, hint, className, box: boxClass, options, ...box }: FieldBase<V> & { options: readonly (readonly [string, string] | readonly [string, string, boolean])[]; } & Omit<ComponentProps<"select">, "form" | "name" | "value" | "defaultValue" | "children">): import("react").JSX.Element`
- **TextAreaField** (function) `({ form, name, label, hint, className, box: boxClass, ref, onChange, ...box }: FieldBase<V> & Omit<ComponentProps<typeof Textarea>, "form" | "name" | "value" | "defaultValue">): import("react").JSX.Element`
- **TextField** (function) `({ form, name, label, hint, className, box: boxClass, ref, onChange, ...box }: FieldBase<V> & Omit<ComponentProps<typeof Input>, "form" | "name" | "value" | "defaultValue">): import("react").JSX.Element`
- **useEditForm** (function) `(o: EditFormOptions<V>): EditForm<V>`

## packages/ui/src/feedback.tsx

- **Alert** (function) `({ onRetry, className, children, }: { onRetry?: (() => void) | undefined; className?: string | undefined; children: ReactNode; }): import("react").JSX.Element`
- **Callout** (function) `({ tone, className, children, }: { tone?: "warn" | undefined; className?: string | undefined; children: ReactNode; }): import("react").JSX.Element`
- **Empty** (function) `({ title, action, className, children, }: { title?: ReactNode; action?: ReactNode; className?: string | undefined; children: ReactNode; }): import("react").JSX.Element`
- **failureOf** (function) `(err: unknown, what?: string): { line: string; again: boolean; raw: string }`
- **InDevelopment** (function) `({ className, children, }: { className?: string | undefined; children?: ReactNode; }): import("react").JSX.Element`
- **LoadFailed** (function) `({ error, onRetry, what, className, }: { error: unknown; onRetry?: (() => void) | undefined; what?: string | undefined; className?: string | undefined; }): import("react").JSX.Element`
- **Loading** (function) `({ lines = 5, shape = "lines", heading = false, label = "Loading", className, }: { lines?: number; shape?: "lines" | "rows" | "cards"; heading?: boolean; label?: string; className?: string | undefined; }): import("react").JSX.Element`
- **messageOf** (function) `(err: unknown): string`
- **ShowRawErrors** (const) `import("react").Provider<boolean>`

## packages/ui/src/fields.tsx

- **CiteTo** (interface) `interface CiteTo { order: string[]; lit: string | null; pick: PickSource; }`
- **Cue** (function) `({ state, mono, size }: { state: State; mono?: boolean; size?: number }): import("react").JSX.Element`
- **cueOf** (function) `(f: FieldMeta | undefined, value: string): State | null`
- **dateOf** (function) `(s: string): Date | null`
- **dateTip** (function) `(d: Date, now = Date.now()): import("./hint.js").TipProps`
- **exact** (function) `(d: Date): string`
- **FieldCell** (function) `({ field: f, cell: c }: { field: FieldMeta; cell: Cell | undefined }): import("react").JSX.Element | null`
- **FieldFilter** (function) `({ field: f, value, onChange, counts, }: { field: FieldMeta; value: string | null; onChange: (next: string | null) => void; counts?: Readonly<Record<string, number>> | undefined; }): import("react").JSX.Element | null`
- **FieldLine** (function) `({ field: f, cell: c, cite, }: { field: FieldMeta; cell: Cell | undefined; cite?: CiteTo | undefined; }): import("react").JSX.Element | null`
- **FieldTotal** (function) `({ field: f, total: t, to, }: { field: FieldMeta; total: Total | undefined; to: (change: Record<string, string | null>) => string; }): import("react").JSX.Element | null`
- **filterParts** (function) `(f: FieldMeta, s: string, now = new Date()): { op: string; value: string }`
- **filterShape** (function) `(f: FieldMeta): "states" | "range" | "words" | "set" | null`
- **readFilter** (function) `(f: FieldMeta, s: string | null, now = new Date()): Filter | undefined`
- **relative** (function) `(d: Date, now = Date.now()): string`
- **StateMark** (function) `({ state, mono }: { state: State; mono?: boolean }): import("react").JSX.Element`
- **wilson** (function) `(n: number, of: number): [number, number]`

## packages/ui/src/fixtures/graph.ts

- **LOOP_EDGES** (const) `GraphEdge[]`
- **RIBBON_EDGES** (const) `GraphEdge[]`
- **RIBBON_NODES** (const) `GraphNode[]`
- **wideGraph** (function) `(n = 40): { nodes: GraphNode[]; edges: GraphEdge[] }`

## packages/ui/src/fixtures/load.ts

- **answer** (function) `(data: T, ms = 0): () => Promise<T>`
- **fails** (function) `(message = "The server could not answer.", status = 500): () => Promise<T>`
- **pending** (function) `(): () => Promise<T>`

## packages/ui/src/fixtures/records.ts

- **pageOf** (function) `(rows: Row[], ask: ListAsk, meta: RecordMeta = LEAD_META): RecordsPage`

## packages/ui/src/fixtures/worst.ts

- **WORST** (const) `{ readonly longName: "Maximiliana Alexandrovna Featherstonehaugh-Montgomery-Vanderbilt the Third"; readonly shortName: "Q"; readonly longCompany: "International Consolidated Amalgamated Holdings and Subsidiary Enterprises, Ltd."; readonly email: "averyveryveryveryveryverylongmailboxnamewithoutbreaks…`

## packages/ui/src/flow-map.tsx

- **FlowEdit** (interface) `interface FlowEdit { ends(id: string): { from: boolean; to: boolean }; fits(from: string, to: string): boolean; connect(from: string, to: string): void; pick(from: string, to: string): void; }`
- **FlowMap** (function) `({ boxes, label, edit, tools, fit, }: { boxes: readonly MapBox[]; label: string; edit?: FlowEdit | undefined; tools?: boolean | undefined; fit?: boolean | undefined; }): import("react").JSX.Element`
- **MapBox** (interface) `interface MapBox { id: string; label: string; note?: string | undefined; after: string[]; href?: string | undefined; input?: boolean | undefined; dim?: boolean | undefined; count?: string | undefined; stacked?: boolean | undefined; labels?: Readonly<Record<string, string>> | undefined; }`

## packages/ui/src/flow.ts

- **Box** (interface) `interface Box { x: number; y: number; w: number; h: number; }`
- **edgePath** (function) `(a: Box, b: Box, span: number, axis: FlowAxis, gutter = 6, near?: "from" | "to"): string`
- **FlowAxis** (type) `type FlowAxis = "across" | "down";`
- **FlowEdge** (interface) `interface FlowEdge { from: string; to: string; span: number; }`
- **FlowGraph** (interface) `interface FlowGraph { nodes: FlowNode[]; edges: FlowEdge[]; cols: number; rows: number; }`
- **FlowNode** (interface) `interface FlowNode { id: string; col: number; index: number; of: number; }`
- **FlowStep** (interface) `interface FlowStep { id: string; after?: string[] | undefined; }`
- **flowOf** (function) `(steps: readonly FlowStep[], keep: (id: string) => boolean, ends: { input: boolean; output: boolean } = { input: false, output: false }, late = false): FlowGraph`

## packages/ui/src/fold.tsx

- **FoldList** (function) `({ messages, current, }: { messages: readonly FoldMessage[]; current: string; }): import("react").JSX.Element`
- **FoldPreview** (function) `({ messages, lines = 2, quiet, className, }: { messages: readonly FoldMessage[]; lines?: number; quiet?: boolean | undefined; className?: string; }): import("react").JSX.Element`
- **foldOf** (function) `(meta: Pick<RecordMeta, "fold">, row: Row): FoldMessage[] | null`

## packages/ui/src/form.tsx

- **RecordForm** (function) `({ record, api, columns, acts, empty, title }: RecordTemplateProps): import("react").JSX.Element`

## packages/ui/src/format.ts

- **ago** (function) `(day: string | null, today = new Date()): string`
- **cx** (function) `(...names: (string | false | null | undefined)[]): string`
- **hostOf** (function) `(url: string | null): string | null`
- **initials** (function) `(name: string): string`
- **money** (function) `(amount: number, currency: string, whole = false): string`
- **month** (function) `(day: string | null): string`
- **num** (function) `(n: number): string`
- **soon** (function) `(at: string | null, now = new Date()): string | null`

## packages/ui/src/frame.tsx

- **DisplayControl** (interface) `interface DisplayControl { display: Display; set: (patch: Partial<Display> | null) => void; }`
- **DisplayPanel** (function) `({ control, more, onKeys, }: { control: DisplayControl; more?: ReactNode; onKeys?: (() => void) | undefined; }): import("react").JSX.Element`
- **FRAME_KEYS** (const) `KeySection`
- **Key** (function) `({ children, className }: { children: ReactNode; className?: string }): import("react").JSX.Element`
- **KeyLine** (type) `type KeyLine = [keys: string, what: string];`
- **KeyList** (function) `({ section }: { section: KeySection }): import("react").JSX.Element`
- **KeySection** (interface) `interface KeySection { title: string; keys: KeyLine[]; }`
- **KeysSheet** (function) `({ open, onClose }: { open: boolean; onClose: () => void }): import("react").JSX.Element`
- **LIST_KEYS** (const) `KeySection`
- **showKeys** (function) `(): any`
- **useDisplay** (function) `(keep: KeepApi | undefined): DisplayControl`
- **useFrame** (function) `(): DisplayControl | null`
- **usePageKeys** (function) `(section: KeySection | null): void`

## packages/ui/src/graph/canvas.tsx

- **GraphDot** (interface) `interface GraphDot { id: string; edge?: string | undefined; node?: string | undefined; tone: GraphTone; }`
- **GraphEdit** (interface) `interface GraphEdit { ends(id: string): { from: boolean; to: boolean }; fits(from: string, to: string, ports?: GraphEnds): boolean; connect(from: string, to: string, ports?: GraphEnds): void; pick(from: string, to: string): void; why?(from: string, to: string, ports?: GraphEnds): string | null; renaming?: string | null; begin?(id: string): void; rename?(id: string, name: string | null): void; }`
- **GraphProps** (interface) `interface GraphProps { nodes: readonly GraphNode[]; edges: readonly GraphEdge[]; label: string; direction?: "auto" | "right" | "down" | undefined; edit?: GraphEdit | undefined; onOpen?: ((id: string) => void) | undefined; dots?: readonly GraphDot[] | undefined; tools?: boolean | undefined; name?: string | undefined; maxHeight?: number | undefined; focus?: readonly string[] | undefined; layout?: "layered" | "lanes" | undefined; selected?: string | null | undefined; onDrop?: ((id: string) => void) | undefined; onPane?: (() => void) | undefined; minHeight?: number | undefined; fill?: boolean | undefined; inset?: { left?: number; right?: number } | undefined; show?: readonly string[] | undefined; fit?: boolean | undefined; ribbons?: true | undefined; bare?: boolean | undefined; onEnter?: ((id: string) => void) | undefined; stretch?: boolean | undefined; }`

## packages/ui/src/graph/index.tsx

- **Graph** (function) `(props: GraphProps): import("react").JSX.Element`
- **Journey** (function) `({ touches, label, zone, }: { touches: readonly Touch[]; label: string; zone?: string | undefined; }): import("react").JSX.Element`

## packages/ui/src/graph/journey.ts

- **journeyOf** (function) `(touches: readonly Touch[], zone?: string): { nodes: GraphNode[]; edges: GraphEdge[] }`
- **Touch** (interface) `interface Touch { at: string; channel: string; kind: string; label: string; note?: string | undefined; }`

## packages/ui/src/graph/layout.ts

- **preloadMetro** (function) `(): Promise<ELK>`

## packages/ui/src/graph/look.ts

- **GraphPort** (interface) `interface GraphPort { id: string; label: string; kind?: string | undefined; }`
- **GraphRole** (type) `type GraphRole = "trigger" | "channel" | "logic" | "ai" | "data" | "deliver";`

## packages/ui/src/graph/model.ts

- **edgeId** (function) `(e: Pick<GraphEdge, "from" | "to">): string`
- **GRAPH_DROP** (const) `"application/x-wren-node"`
- **GraphEdge** (interface) `interface GraphEdge { from: string; to: string; fromPort?: string | undefined; toPort?: string | undefined; kind?: string | undefined; label?: string | undefined; count?: { value: number; today?: number | undefined } | undefined; rate?: { from: number; to: number } | undefined; when?: string | undefined; wait?: string | undefined; notes?: readonly string[] | undefined; mark?: GraphMark | undefined; weight?: number | undefined; loop?: true | undefined; }`
- **GraphKind** (type) `type GraphKind = "part" | "workflow" | "account" | "step" | "record" | "host";`
- **GraphMark** (type) `type GraphMark = "added" | "removed" | "changed";`
- **GraphNode** (interface) `interface GraphNode { id: string; kind: GraphKind; label: string; note?: string | undefined; state?: { label: string; tone: GraphTone } | undefined; number?: GraphNumber | undefined; more?: GraphNumber | undefined; lines?: { text: string; sign?: "+" | "−" | undefined }[] | undefined; hover?: readonly string[] | undefined; href?: string | undefined; dim?: boolean | undefined; dashed?: boolean | undefined; stacked?: boolean | undefined; role?: GraphRole | undefined; tint?: string | undefined; ins?: readonly GraphPort[] | undefined; outs?: readonly GraphPort[] | undefined; lane?: string | undefined; facets?: Readonly<Record<string, string>> | undefined; mark?: GraphMark | undefined; }`
- **GraphNumber** (interface) `interface GraphNumber { value: number; label: string; today?: number | undefined; href?: string | undefined; }`
- **GraphTone** (type) `type GraphTone = "good" | "warn" | "bad" | "accent" | "neutral";`
- **percent** (function) `(part: number, whole: number): string`
- **RIBBON** (const) `{ readonly min: 2; readonly max: 48; }`
- **ribbonMax** (function) `(edges: readonly GraphEdge[]): number`
- **ribbonWidth** (function) `(weight: number, max: number): number`
- **wireLines** (function) `(e: GraphEdge): string[]`

## packages/ui/src/graph/palette.tsx

- **FLOAT_PANEL** (const) `"absolute top-3 z-10 grid max-h-[calc(100%-24px)] min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5 overflow-x-hidden overflow-y-auto border border-(--ui-hair) bg-(--ui-paper) p-4 text-[13.5px] shadow-(--ui-shadow)"`
- **PaletteDrawer** (function) `({ groups, onAdd, onClose, label = "Add a node", className, }: { groups: readonly PaletteGroup[]; onAdd: (id: string) => void; onClose: () => void; label?: string; className?: string; }): import("react").JSX.Element`
- **PaletteEntry** (interface) `interface PaletteEntry { id: string; name: string; blurb: string; ready: boolean; effects: readonly string[]; tint: string; glyph?: IconName; }`
- **PaletteGroup** (interface) `interface PaletteGroup { title: string; entries: readonly PaletteEntry[]; }`
- **PanelBlock** (function) `({ title, level = 3, children, }: { title: string; level?: 2 | 3; children: ReactNode; }): import("react").JSX.Element`

## packages/ui/src/handler.tsx

- **HandlerCall** (interface) `interface HandlerCall { input: unknown; key?: string; confirm?: string; }`
- **HandlerForm** (function) `({ id, name, fields, keyed, effect, run, verb = "Run", }: { id: string; name: string; fields: readonly FormField[] | null; keyed: boolean; effect: string | null; run: (call: HandlerCall) => Promise<unknown>; verb?: string; }): import("react").JSX.Element`

## packages/ui/src/hint-layer.tsx

- **HintLayer** (function) `(): import("react").ReactPortal | null`
- **Why** (function) `({ text, keys, className, children, }: { text?: string | null | undefined; keys?: string | undefined; className?: string | undefined; children: ReactNode; }): import("react").JSX.Element`

## packages/ui/src/hint.ts

- **TipOptions** (interface) `interface TipOptions { keys?: string; side?: TipSide; clip?: boolean; as?: "description" | "name" | "none"; }`
- **TipProps** (interface) `interface TipProps { "data-tip"?: string; "data-tip-keys"?: string; "data-tip-side"?: TipSide; "data-tip-clip"?: ""; "aria-label"?: string; "aria-description"?: string; "aria-keyshortcuts"?: string; }`
- **tipProps** (function) `(text: string | undefined | null, o: TipOptions = {}): TipProps`
- **whenTip** (function) `(d: Date, relative: string, zone?: string): string`

## packages/ui/src/hover-pop.ts

- **HOVER_CLOSE_MS** (const) `200`
- **HOVER_OPEN_MS** (const) `120`
- **HoverPop** (interface) `interface HoverPop { open: boolean; byHover: boolean; setOpen: (open: boolean) => void; root: { open: boolean; onOpenChange: (open: boolean, details: Popover.Root.ChangeEventDetails) => void; }; trigger: { openOnHover?: boolean; delay?: number; closeDelay?: number }; }`
- **SUB_OPEN_MS** (const) `100`
- **typingInPopup** (function) `(): boolean`
- **useHoverPop** (function) `(o: { sub?: boolean; onOpen?: () => void } = {}): HoverPop`
- **useHovers** (function) `(): boolean`
- **useSubmenus** (function) `(): { open: string | null; close: () => void; rootOf: (key: string) => { open: boolean; onOpenChange: (next: boolean, details: Popover.Root.ChangeEventDetails) => void; }; trigger: { openOnHover?: boolean; delay?: number; closeDelay?: number; }; }`

## packages/ui/src/icons.tsx

- **Icon** (function) `({ name, size = 16, strokeWidth = 1.75, className, style, fill, label, }: { name: IconName; size?: number; label?: string; strokeWidth?: number; className?: string; style?: CSSProperties; fill?: string; }): import("react").JSX.Element`
- **IconName** (type) `type IconName = keyof typeof ICONS;`
- **isIconName** (function) `(name: string): name is IconName`

## packages/ui/src/launcher.tsx

- **AppCard** (function) `({ name, icon, href, blurb, note, children, }: { name: string; icon: IconName; href: string; blurb: string; note?: string | null | undefined; children?: ReactNode; }): import("react").JSX.Element`
- **AppGlance** (function) `({ figures, note }: { figures: GlanceFigure[] | null; note?: ReactNode }): import("react").JSX.Element`
- **AppGrid** (function) `({ label, children }: { label?: string | undefined; children: ReactNode }): import("react").JSX.Element`
- **GlanceFigure** (interface) `interface GlanceFigure { label: string; value: number | string; }`

## packages/ui/src/layout.tsx

- **ABOUT** (const) `"max-w-[70ch] text-[13.5px] leading-[1.55] text-pretty text-(--ui-ink-2)"`
- **AboutProvider** (const) `import("react").Provider<string | undefined>`
- **Fieldset** (function) `({ legend, note, className, children, }: { legend: string; note?: ReactNode; className?: string | undefined; children: ReactNode; }): import("react").JSX.Element`
- **FLAT_HEAD** (const) `"flex flex-wrap items-center justify-between gap-x-6 gap-y-2"`
- **FRAME** (const) `"relative rounded-(--ui-leaf-panel) bg-(--ui-paper) shadow-(--ui-raise)"`
- **FRAME_BODY** (const) `"p-5 [.ui-head+&]:pt-3 [&>:is(ul,ol,dl):first-child]:border-t-0 [&>:is(ul,ol,dl):last-child>:last-child]:border-b-0"`
- **FRAME_HEAD** (const) `"ui-head flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 pt-[18px]"`
- **GROUP_LABEL** (const) `"text-[12.5px] leading-4 font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-3) [text-transform:var(--ui-label-case)]"`
- **PAGE_TITLE** (const) `"font-(family-name:--ui-font-display) text-[22px] leading-[1.55] font-semibold tracking-[calc(-0.02em*var(--ui-display-squeeze))] text-balance"`
- **PageHeader** (function) `({ title, lede, kicker, hero, actions, className, }: { title: ReactNode; lede?: ReactNode; kicker?: ReactNode; hero?: boolean | undefined; actions?: ReactNode; className?: string | undefined; }): import("react").JSX.Element`
- **PageTitle** (function) `({ title, lede, kicker, hero = false, }: { title: ReactNode; lede?: ReactNode; kicker?: ReactNode; hero?: boolean | undefined; }): import("react").JSX.Element`
- **SECTION_TITLE** (const) `"text-[16px] leading-[1.55] font-semibold tracking-[-0.01em]"`
- **Section** (function) `({ title, cue, count, note, actions, className, children, }: { title?: string | undefined; cue?: ReactNode; count?: number | undefined; note?: ReactNode; actions?: ReactNode; className?: string | undefined; children: ReactNode; }): import("react").JSX.Element`
- **useAbout** (function) `(): string | undefined`

## packages/ui/src/lineage.tsx

- **Lineage** (function) `({ versions }: { versions: readonly LineageVersion[] }): import("react").JSX.Element`
- **LineageVersion** (interface) `interface LineageVersion { version: string; parent: string | null; at: string; live: boolean; added: { locus: string; text: string }[]; retired: { locus: string; text: string }[]; }`

## packages/ui/src/list-bar.tsx

- **CHIP** (const) `"inline-flex h-8 pointer-coarse:h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-[4px_10px_4px_10px] border-0 bg-transparent px-[9px] text-[13px] font-semibold whitespace-nowrap text-(--ui-ink-3) no-underline transition-[background-color,color] duration-150 ease-(--ui-ease) hover:bg-(--ui-a…`
- **CHIP_ON** (const) `"bg-(--ui-accent-tint) text-(--ui-active) hover:bg-(--ui-accent-tint) hover:text-(--ui-active)"`
- **KeepApi** (interface) `interface KeepApi { views(record: string): Promise<SavedViewLine[]>; save(v: { id?: number; record: string; name?: string; params?: string; shared?: boolean; }): Promise<SavedViewLine>; remove(id: number): Promise<unknown>; move(record: string, ids: number[]): Promise<SavedViewLine[]>; prefs(keys?: string[]): Promise<Record<string, unknown>>; setPref(key: string, value: unknown): Promise<unknown>; }`
- **SaveViewPop** (function) `({ record, params, keep, open: sv, onSaved, }: { record: string; params: string; keep: KeepApi; open?: SavedViewLine | undefined; onSaved: (v: SavedViewLine) => void; }): import("react").JSX.Element`
- **TAB** (const) `"relative isolate flex shrink-0 items-center gap-1.5 rounded-[4px_10px_4px_10px] px-[9px] py-1.5 text-[13px] font-semibold no-underline transition-colors duration-150 ease-(--ui-ease) hover:bg-(--ui-accent-wash) motion-reduce:transition-none"`
- **tabTone** (function) `(on: boolean): "text-(--ui-active) hover:bg-transparent" | "text-(--ui-ink-3) hover:text-(--ui-ink)"`
- **useNarrow** (function) `(): any`
- **useSavedViews** (function) `(keep: KeepApi | undefined, record: string): Saved`

## packages/ui/src/list-search.ts

- **LIST_FORMS** (const) `readonly ["rows", "timeline"]`
- **LIST_SEARCH** (const) `z.ZodObject<{ view: z.ZodCatch<z.ZodOptional<z.ZodString>>; sv: z.ZodCatch<z.ZodOptional<z.ZodCoercedNumber<unknown>>>; q: z.ZodCatch<z.ZodOptional<z.ZodString>>; sort: z.ZodCatch<z.ZodOptional<z.ZodString>>; group: z.ZodCatch<z.ZodOptional<z.ZodString>>; cols: z.ZodCatch<z.ZodOptional<z.ZodString>>…`
- **ListSearch** (type) `type ListSearch = z.infer<typeof LIST_SEARCH>;`
- **ListState** (interface) `interface ListState extends ListSearch { open?: string | undefined; account?: string | undefined; filters: Record<string, string>; }`
- **listChange** (function) `(meta: Pick<RecordMeta, "name" | "account">, change: Partial<Omit<ListState, "filters">> & { filters?: Record<string, string | null> }): Record<string, string | null>`
- **listStateOf** (function) `(meta: Pick<RecordMeta, "fields" | "name" | "account">, params: URLSearchParams): ListState`
- **paramsOf** (function) `(search: Readonly<Record<string, unknown>>): URLSearchParams`
- **searchOf** (function) `(params: URLSearchParams): Record<string, string | string[]>`

## packages/ui/src/look.tsx

- **Look** (type) `type Look = string | Record<string, unknown> | null;`
- **LookEditor** (function) `({ look, onSave, showcase, }: { look: unknown; onSave: (look: Look) => Promise<unknown>; showcase?: boolean; }): import("react").JSX.Element`
- **lookOf** (function) `(raw: unknown): Look`
- **ThemeGallery** (function) `({ current, onPick, showcase, }: { current: unknown; onPick: (look: Look) => Promise<unknown>; showcase?: boolean; }): import("react").JSX.Element`

## packages/ui/src/marks.tsx

- **hostMark** (function) `(site: string): "reddit" | "google" | "email" | "text" | "dm" | "web" | "linkedin" | "meta" | "youtube" | "x" | "tiktok" | "instagram" | "call" | "facebook" | "threads" | "whatsapp" | "discord" | "podcast" | undefined`
- **lineColor** (function) `(line: number): string`
- **markName** (function) `(mark: Mark): string`
- **PlatformMark** (function) `({ mark, size = 14, mono = false, label, className, }: { mark: string; size?: number; mono?: boolean; label?: string; className?: string; }): import("react").JSX.Element | null`
- **PlatformTile** (function) `({ mark, className }: { mark: string; className?: string }): import("react").JSX.Element`
- **StageSquare** (function) `({ line, className }: { line: number; className?: string }): import("react").JSX.Element`
- **TintSwatch** (function) `({ tint, className }: { tint: number; className?: string }): import("react").JSX.Element`
- **tintColor** (function) `(tint: number): "var(--ui-cue-1)" | "var(--ui-cue-2)" | "var(--ui-cue-3)" | "var(--ui-cue-4)" | "var(--ui-cue-5)" | "var(--ui-cue-6)" | "var(--ui-cue-7)" | "var(--ui-cue-8)"`
- **tintWash** (function) `(tint: number): string`

## packages/ui/src/metro/draw.tsx

- **landTimes** (function) `(scene: MetroScene): (x: number) => number`
- **MetroSvg** (function) `({ scene, still, bare, intro, selected, lit, width, ref }: MetroSvgProps): import("react").JSX.Element`
- **MetroSvgProps** (interface) `interface MetroSvgProps { scene: MetroScene; still?: boolean | undefined; bare?: boolean | undefined; selected?: string | null | undefined; intro?: boolean | undefined; lit?: string | null | undefined; width?: number | undefined; ref?: Ref<SVGSVGElement>; }`

## packages/ui/src/metro/focus.ts

- **FocusSpec** (type) `type FocusSpec = MetroPart | readonly MetroPart[];`
- **focusScene** (function) `(scene: MetroScene, spec: FocusSpec): MetroScene`
- **inPart** (function) `(s: SceneStation, spec: MetroPart): boolean`
- **nameOf** (function) `(scene: MetroScene, part: MetroPart): string`
- **partOf** (function) `(s: SceneStation, kind: MetroPart["kind"]): MetroPart`
- **partsOfSpec** (function) `(spec: FocusSpec): readonly MetroPart[]`
- **STUB** (const) `{ readonly reach: 90; readonly gap: 26; readonly pad: 24; }`
- **specKey** (function) `(spec: FocusSpec): string`
- **stubsOf** (function) `(scene: MetroScene): import("./types.js").StubSpec[]`

## packages/ui/src/metro/fold.ts

- **autoZoom** (function) `(scene: MetroScene): MetroZoom`
- **Flags** (type) `type Flags = Readonly<Record<string, boolean | undefined>>;`
- **flagZoom** (function) `(o: { nodes: readonly FoldNode[]; compose: (g: Flags) => MetroScene; total: number; foldId?: MetroZoom["foldId"]; }): MetroZoom`
- **foldScene** (function) `(scene: MetroScene, open: ReadonlySet<string>): MetroScene`
- **foldTwins** (function) `(view: MetroView): MetroView`
- **MetroZoom** (interface) `interface MetroZoom { nodes: readonly FoldNode[]; scene(open: ReadonlySet<string>): MetroScene | Promise<MetroScene>; foldId?: Readonly<Record<string, string>>; total: number; }`
- **TWIN_OUTLIER** (const) `{ readonly margin: 0.25; readonly people: 5; }`
- **twinRuns** (function) `(view: MetroView): Map<string, Run>`
- **viewScene** (function) `(view: MetroView, open: ReadonlySet<string>, step?: number): Promise<MetroScene>`
- **viewTree** (function) `(view: MetroView): ViewTree`
- **viewZoom** (function) `(view: MetroView, step?: number): MetroZoom`

## packages/ui/src/metro/geometry.ts

- **Box** (interface) `interface Box { x0: number; y0: number; x1: number; y1: number; }`
- **Boxed** (interface) `interface Boxed { id: string; box: Box; room?: true; }`
- **boxAt** (function) `(cx: number, cy: number, w: number, h: number): Box`
- **CHIP_ROOM** (const) `12`
- **crossingsOf** (function) `(scene: Pick<MetroScene, "st" | "tr">): number`
- **labelBoxes** (function) `(s: LabelStation): Box[]`
- **markBoxes** (function) `(s: LabelStation): Box[]`
- **octPath** (function) `(a: Point, b: Point, r?: number): string`
- **octPts** (function) `(a: Point, b: Point, bend?: "a" | "b", reach = Infinity): Point[]`
- **overlaps** (function) `(a: Box, b: Box, gap = 0): boolean`
- **rounded** (function) `(points: Point[], r = 18): string`
- **routeHits** (function) `(pts: readonly Point[], box: Box): boolean`
- **routeOf** (function) `(r: MetroTrack, a: Point, c: Point): Point[]`
- **SceneBoxes** (interface) `interface SceneBoxes { labels: Boxed[]; marks: Boxed[]; hub: Boxed[]; chips: Boxed[]; tracks: Boxed[]; }`
- **sceneBoxes** (function) `(scene: Pick<MetroScene, "st" | "tr">): SceneBoxes`
- **sceneClashes** (function) `(scene: Pick<MetroScene, "st" | "tr" | "zones">): string[]`
- **textWidth** (function) `(t: string, px = 14, bold = false): number`
- **xferGeometry** (function) `(a: Point, c: Point, f = 0.62): { d: string; m: Point; pts: Point[]; }`

## packages/ui/src/metro/layout.ts

- **lineKeyOf** (function) `(view: Pick<MetroView, "lines">, lineId: string): string`
- **SPACE** (const) `{ readonly exit: 70; readonly foot: 34; }`

## packages/ui/src/metro/map.tsx

- **MetroDepth** (function) `({ nodes, fold, onFold }: MetroDepthProps): import("react").JSX.Element | null`
- **MetroDepthProps** (interface) `interface MetroDepthProps { nodes: readonly FoldNode[]; fold: Fold; onFold: (fold: Fold) => void; }`
- **MetroLegend** (function) `({ over }: { over?: boolean | undefined }): import("react").JSX.Element`
- **MetroMap** (function) `(props: MetroMapProps): import("react").JSX.Element`
- **MetroMapProps** (interface) `interface MetroMapProps { zoom?: MetroZoom | undefined; scene?: MetroScene | undefined; view?: MetroView | undefined; depth?: number | undefined; defaultDepth?: number | undefined; onDepth?: ((depth: number) => void) | undefined; open?: OpenMap | undefined; onOpen?: ((open: OpenMap) => void) | undefined; onPick?: ((pick: MetroPick) => void) | undefined; selected?: string | null | undefined; lit?: string | null | undefined; controls?: boolean | undefined; focus?: FocusSpec | null | undefined; onStub?: ((part: MetroPart) => void) | undefined; still?: boolean | undefined; bare?: boolean | undefined; intro?: boolean | undefined; className?: string | undefined; children?: ReactNode; }`
- **MetroPick** (interface) `interface MetroPick { kind: "station" | "track" | "group"; id: string; group?: string | undefined; }`

## packages/ui/src/metro/marks.tsx

- **ACTION_GLYPH** (const) `Readonly<Record<string, IconName>>`
- **Badge** (function) `({ c, colours, selected, on, }: { c: BadgeStation; colours: Colours; selected?: boolean | undefined; on?: boolean | undefined; }): import("react").JSX.Element`
- **Capsule** (function) `({ c, selected, on, }: { c: CapsuleStation; selected?: boolean | undefined; on?: boolean | undefined; }): import("react").JSX.Element`
- **Chip** (function) `({ x, y, t, icon }: ChipSpec): import("react").JSX.Element`
- **CountDot** (function) `({ x, y, n, who, late, id, mark, }: { x: number; y: number; n: number; who: string; late?: boolean | undefined; mark?: Mark | undefined; id?: string | undefined; }): import("react").JSX.Element`
- **FoldTab** (function) `({ x, y, t, grp }: FoldSpec): ReactNode`
- **Leaf** (function) `({ x, y, w, h, a, b, className, }: { x: number; y: number; w: number; h: number; a: number; b: number; className?: string; }): import("react").JSX.Element`
- **MARK_GLYPH** (const) `Record<Mark, string>`
- **MARK_WORD** (const) `Record<Mark, string>`
- **Marker** (function) `({ s, click, selected, l, on, at, fold, }: { s: MarkStation; click?: boolean | undefined; selected?: boolean | undefined; l?: string | undefined; on?: boolean | undefined; at?: number | undefined; fold?: Pick<CapsuleStation, "steps"> | undefined; }): import("react").JSX.Element`
- **MarkTag** (function) `({ x, y, mark, l, named, label, }: { x: number; y: number; mark: Mark; l?: string | undefined; named?: boolean | undefined; label?: string | undefined; }): import("react").JSX.Element`
- **Pill** (function) `({ x, y, who, late, id, mark, }: { x: number; y: number; who: string; late?: boolean | undefined; mark?: Mark | undefined; id?: string | undefined; }): import("react").JSX.Element`
- **Ring** (function) `({ c, colours, selected, on, still, }: { c: RingStation; colours: Colours; selected?: boolean | undefined; on?: boolean | undefined; still?: boolean | undefined; }): import("react").JSX.Element`
- **RuleTag** (function) `({ x, y, t }: { x: number; y: number; t: string }): import("react").JSX.Element`
- **STATION_GLYPH** (const) `Record<Exclude<StationKind, "par">, IconName>`
- **XferLabel** (function) `({ m, lab, colour, l, on, id, mark, }: { m: Point; lab: string; colour: string; l: string; on?: boolean | undefined; id?: string | undefined; mark?: Mark | undefined; }): import("react").JSX.Element`

## packages/ui/src/metro/place.ts

- **Frame** (type) `type Frame = [number, number, number, number];`
- **layoutView** (function) `(view: MetroView, step?: number): Promise<MetroScene>`
- **PlaceBox** (interface) `interface PlaceBox { id: string; parent?: string | undefined; stations: readonly string[]; }`
- **Placed** (interface) `interface Placed { scene: MetroScene; frames: Map<string, Frame>; }`
- **placeMetro** (function) `(view: MetroView, o: { boxes?: readonly PlaceBox[]; step?: number } = {}): Promise<Placed>`
- **STEP** (const) `120`

## packages/ui/src/metro/skeleton.tsx

- **MetroSkeleton** (function) `({ className, label = "Loading your map", }: { className?: string | undefined; label?: string; }): import("react").JSX.Element`

## packages/ui/src/metro/tree.ts

- **allOpen** (function) `(nodes: readonly FoldNode[]): Set<string>`
- **Fold** (interface) `interface Fold { depth: number; open: OpenMap; }`
- **FoldNode** (interface) `interface FoldNode { id: string; parent?: string | undefined; label: string; hand?: boolean | undefined; }`
- **fullDepth** (function) `(nodes: readonly FoldNode[]): number`
- **OpenMap** (type) `type OpenMap = Readonly<Record<string, boolean>>;`
- **openKey** (function) `(open: ReadonlySet<string>): string`
- **openSet** (function) `(nodes: readonly FoldNode[], fold: Fold): Set<string>`
- **pathTo** (function) `(nodes: readonly FoldNode[], id: string): FoldNode[]`
- **reveal** (function) `(nodes: readonly FoldNode[], id: string | undefined): Fold`
- **stepDepth** (function) `(nodes: readonly FoldNode[], depth: number, d: number): Fold`
- **toggle** (function) `(nodes: readonly FoldNode[], fold: Fold, id: string, on: boolean): Fold`

## packages/ui/src/metro/types.ts

- **BadgeStation** (interface) `interface BadgeStation { id: string; badge: true; x: number; y: number; l: LineKey; n: string; s: string; w?: number; glyph?: IconName; grp?: string; }`
- **CapsuleStation** (interface) `interface CapsuleStation { id: string; cap: [number, number]; y: number; x?: number; l: LineKey; n: string; t?: StationKind; icon?: IconName; steps: number; io?: [number, number]; each?: string; s?: string; late?: boolean; grp?: string; mark?: Mark; bad?: number; p?: Side; }`
- **ChipSpec** (interface) `interface ChipSpec { x: number; y: number; t: string; icon?: IconName | null; }`
- **DEFAULT_COLOURS** (const) `Record<string, number>`
- **FoldSpec** (interface) `interface FoldSpec { x: number; y: number; t: string; grp: string; }`
- **FrameSpec** (interface) `interface FrameSpec { x: number; y: number; w: number; h: number; }`
- **isBadge** (function) `(s: SceneStation): s is BadgeStation`
- **isCapsule** (function) `(s: SceneStation): s is CapsuleStation`
- **isMark** (function) `(s: SceneStation): s is MarkStation`
- **isRing** (function) `(s: SceneStation): s is RingStation`
- **LineKey** (type) `type LineKey = string;`
- **lineColour** (function) `(scene: Pick<MetroScene, "colours">, l: LineKey): string`
- **Mark** (type) `type Mark = "added" | "changed" | "removed";`
- **MarkStation** (interface) `interface MarkStation { id: string; t: StationKind; x: number; y: number; r?: number; n?: string; s?: string; was?: string; icon?: IconName; p?: Side; bad?: boolean; bundle?: boolean; rule?: string; rep?: string; repGlyph?: IconName | null; plans?: string; ln?: string; g?: string; flow?: string; now?: number; arrived?: number; mark?: Mark; }`
- **MetroPart** (interface) `interface MetroPart { kind: "line" | "group" | "station" | "flow"; id: string; }`
- **MetroScene** (interface) `interface MetroScene { title?: string; x0?: number; w?: number; h: number; zones?: Zone[]; st: SceneStation[]; tr: MetroTrack[]; lines?: Record<string, { n: string; l: LineKey }>; groups?: Record<string, string>; colours?: Record<string, number>; click?: boolean; still?: boolean; chips?: ChipSpec[]; frames?: FrameSpec[]; folds?: FoldSpec[]; opened?: OpenedSpec[]; }`
- **MetroTrack** (interface) `interface MetroTrack { id?: string; a?: string; b?: string; l?: LineKey; w?: Weight; k?: "plan" | "ab" | "exit" | "xfer" | "back"; pts?: Point[]; r?: number; fill?: boolean; pa?: Point; pc?: Point; o?: number; oa?: number; ob?: number; bend?: "a" | "b"; reach?: number; who?: string; late?: boolean; at?: Point; bdy?: number; dot?: number; cond?: string; condGlyph?: IconName | null; no?: boolean; cat?: Point; back?: number; condShared?: boolean; mv?: boolean; dots?: number; dur?: number; lab?: string; f?: number; lat?: Point; task?: string; med?: string; mark?: Mark; stub?: StubSpec; }`
- **Point** (type) `type Point = [number, number];`
- **RingStation** (interface) `interface RingStation { id: string; ring: true; x: number; y: number; l: LineKey; n: string; s?: string; r?: number; grp?: string; }`
- **SceneStation** (type) `type SceneStation = MarkStation | CapsuleStation | RingStation | BadgeStation;`
- **StationKind** (type) `type StationKind = | "att" | "time" | "cash" | "exit" | "hub" | "plan" | "dec" | "race" | "par" | "ab" | "ok" | "link";`
- **StubSpec** (interface) `interface StubSpec { part: MetroPart; side: "in" | "out"; label: string; }`
- **WEIGHT** (const) `Record<Weight, number>`
- **Weight** (type) `type Weight = "out" | "front" | "core";`
- **Zone** (type) `type Zone = [number, number, string];`

## packages/ui/src/metro/view.ts

- **DEFAULT_COLUMNS** (const) `string[]`
- **LineTier** (type) `type LineTier = "out" | "front" | "core" | "content";`
- **MetroView** (interface) `interface MetroView { title?: string; lines: ViewLine[]; stations: ViewStation[]; tracks: ViewTrack[]; groups?: ViewGroup[]; columns?: string[]; }`
- **ViewGroup** (interface) `interface ViewGroup { id: string; label: string; parent?: string | undefined; lap?: string | undefined; }`
- **ViewKind** (type) `type ViewKind = | "att" | "time" | "cash" | "exit" | "hub" | "plan" | "dec" | "race" | "split" | "join" | "ab" | "ok" | "link";`
- **ViewLine** (interface) `interface ViewLine { id: string; label?: string; offer?: string; tier: LineTier; colour?: number; plan?: boolean; mark?: Mark; }`
- **ViewStation** (interface) `interface ViewStation { id: string; kind: ViewKind; line: string; column: string; spans?: string[]; group?: string; ring?: boolean; flow?: string; label?: string; icon?: IconName; sub?: string; was?: string; now?: number; arrived?: number; bad?: boolean; rule?: string; repeat?: string; repeatIcon?: IconName | null; plans?: string; bundle?: boolean; template?: string; platform?: string; mark?: Mark; }`
- **ViewTrack** (interface) `interface ViewTrack { id?: string; from: string; to: string; by: "system" | "person"; owner?: string; promise?: string; late?: boolean; label?: string; no?: boolean; task?: string; moving?: boolean; plan?: boolean; back?: boolean; mark?: Mark; }`

## packages/ui/src/motion.tsx

- **EASE** (const) `readonly [0.16, 1, 0.3, 1]`
- **FADE** (const) `{ readonly duration: 0.2; readonly ease: "linear"; }`
- **MOVE** (const) `{ duration: number; ease: readonly [0.2, 0.9, 0.25, 1.12]; }`
- **RingSlot** (function) `({ on, size }: { on: boolean; size?: BusySize }): import("react").JSX.Element`
- **SPRING** (const) `readonly [0.2, 0.9, 0.25, 1.12]`

## packages/ui/src/overview-queues.tsx

- **OverviewQueue** (interface) `interface OverviewQueue { label: string; record: string; view: string; href: string; icon: IconName; line?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; wait: string; promise: string; }`

## packages/ui/src/overview.tsx

- **OverviewProps** (interface) `interface OverviewProps { title: string; as?: "section" | undefined; api: RecordsApi; tiles: OverviewTile[]; queues?: OverviewQueue[] | undefined; top?: OverviewTop[] | undefined; keepAs?: string | undefined; }`
- **OverviewTile** (interface) `interface OverviewTile { label: string; record: string; href: string; period?: Period; at?: string; sum?: string; median?: string; needs?: true; pick?: string; none?: string; }`
- **OverviewTop** (interface) `interface OverviewTop { label: string; record: string; href: string; fields: string[]; line?: string; units?: Readonly<Record<string, string>>; empty: string; }`
- **RecordOverview** (function) `({ title, as, api, tiles: all, queues = [], top = [], keepAs, }: OverviewProps): import("react").JSX.Element`
- **TopRecords** (function) `({ top, meta, api, }: { top: OverviewTop; meta: RecordMeta; api: RecordsApi; }): import("react").JSX.Element`

## packages/ui/src/palette-brand.ts

- **BrandInput** (interface) `interface BrandInput { color: string; variant: Variant; harmony: Harmony; contrast: number; scheme: "light" | "dark"; }`
- **brandColorsOf** (function) `(rgba: ArrayLike<number>): string[]`
- **brandTheme** (function) `(brand: BrandInput): { theme: Theme; report: ContrastLine[] }`
- **CONTRASTS** (const) `readonly [0, 0.5, 1]`
- **ContrastLine** (interface) `interface ContrastLine { text: Token; on: Ground; need: number; ratio: number; was?: string; }`
- **HARMONIES** (const) `("split" | "analogous" | "complementary" | "triadic" | "tetradic")[]`
- **Harmony** (type) `type Harmony = keyof typeof HARMONY;`
- **readBrand** (function) `(raw: unknown): BrandInput | null`
- **VARIANTS** (const) `("content" | "neutral" | "tonal_spot" | "vibrant" | "expressive" | "fidelity" | "monochrome")[]`
- **Variant** (type) `type Variant = keyof typeof SCHEMES;`

## packages/ui/src/palette-scope.ts

- **Scope** (interface) `interface Scope { items: ScopeItem[]; search?: { label: string; run: (q: string) => void } | undefined; }`
- **ScopeItem** (interface) `interface ScopeItem { label: string; group: string; run: () => void; icon?: IconName | undefined; hint?: string | undefined; }`
- **useScope** (function) `(key: string, scope: () => Scope): void`

## packages/ui/src/palette.tsx

- **PaletteItem** (interface) `interface PaletteItem { label: string; group: string; href: string; icon?: IconName | undefined; hint?: string | undefined; }`
- **byRecent** (function) `(found: readonly PaletteItem[], recent: readonly string[]): PaletteItem[]`
- **CommandPalette** (function) `({ items, onPick, open, onOpenChange, ask, capture, card, find, recentKey, }: { items: PaletteItem[]; onPick: (href: string) => void; open: boolean; onOpenChange: (open: boolean) => void; ask?: ((question: string) => void) | undefined; capture?: ((words: string) => void) | undefined; card?: ((title: string) => void) | undefined; find?: ((q: string) => Promise<PaletteItem[]>) | undefined; recentKey?: string | undefined; }): import("react").JSX.Element`

## packages/ui/src/peek.tsx

- **PeekLine** (interface) `interface PeekLine { who?: string | undefined; channel?: string | undefined; at: string; text: string; }`
- **PeekSpec** (interface) `interface PeekSpec { fields?: string[] | undefined; }`

## packages/ui/src/phone-nav.ts

- **tabRuns** (function) `(tabs: readonly T[]): { group: string | undefined; tabs: T[] }[]`

## packages/ui/src/phone-shell.tsx

- **usePhone** (function) `(): boolean`

## packages/ui/src/phone.tsx

- **BottomSheet** (function) `({ label, onClose, stops = ["medium", "large"], start, head, children, modal = true, escape: shutsOnEscape = true, className, bodyClassName, }: { label: string; onClose: () => void; stops?: readonly Stop[]; start?: Stop | undefined; head?: ReactNode; children: ReactNode; modal?: boolean; escape?: boolean; className?: string | undefined; bodyClassName?: string | undefined; }): import("react").ReactPortal | null`
- **Segment** (interface) `interface Segment { id: string; label: string; href: string; count?: number | undefined; on: boolean; busy?: boolean | undefined; tip?: string | undefined; }`
- **Segmented** (function) `({ label, items, className, }: { label: string; items: Segment[]; className?: string | undefined; }): import("react").JSX.Element`
- **SwipeRow** (function) `({ swipes, className, onTap, children, measure, ...rest }: { swipes: Swipes | null; className?: string | undefined; onTap?: ((e: React.MouseEvent<HTMLLIElement>) => void) | undefined; children: ReactNode; measure?: ((el: HTMLLIElement | null) => void) | undefined; } & Omit<React.LiHTMLAttributes<HTMLLIElement>, "onClick" | "className">): import("react").JSX.Element`
- **Swipes** (interface) `interface Swipes { lead?: SwipeAct | undefined; trail: SwipeAct[]; }`

## packages/ui/src/preview.tsx

- **DeviceFrame** (function) `({ label, width, zoom = 1, children, }: { label?: string | undefined; width: number; zoom?: number; children: ReactNode; }): import("react").JSX.Element`
- **FeedPost** (function) `({ from, title, body, lines, size, }: { from: string; title?: string | null | undefined; body: string; lines: number | null; size: number; }): import("react").JSX.Element`
- **MessageKind** (type) `type MessageKind = | { kind: "email"; from?: string; subject?: string | null; fill?: (text: string) => { subject: string | null; body: string }; } | { kind: "sms"; from?: string; parts?: (text: string) => { parts: number; encoding: string }; fill?: (text: string) => { subject: string | null; body: string }; } | { kind: "post"; site: string; from?: string; title?: string | null; max?: number; feed: { laptop: number | null; phone: number | null }; } | { kind: "dm"; site: string; from?: string; subject?: string | null; max?: number; fill?: (text: string) => { subject: string | null; body: string }; };`
- **MessagePreview** (function) `({ message: kind, body: text, reader = false, }: { message: MessageKind; body: string; reader?: boolean; }): import("react").JSX.Element`
- **PHONE_WIDTH** (const) `393`
- **shapeOf** (function) `(kind: MessageKind, body: string): string[]`

## packages/ui/src/queue.tsx

- **RecordQueue** (function) `(props: RecordTemplateProps): import("react").JSX.Element`

## packages/ui/src/rail.tsx

- **RAIL_STATES** (const) `Record<RailState, string>`
- **Rail** (function) `({ groups, label = "Steps", states = RAIL_STATES, className, }: { groups: RailGroup[]; label?: string; states?: Record<RailState, string>; className?: string | undefined; }): import("react").JSX.Element`
- **RailGroup** (interface) `interface RailGroup { id: string; label: string; steps: RailStep[]; }`
- **RailState** (type) `type RailState = "done" | "next" | "waiting" | "yours" | "idle";`
- **RailStep** (interface) `interface RailStep { id: string; label: string; count?: ReactNode; note?: ReactNode; state: RailState; href?: string | undefined; }`

## packages/ui/src/read-aloud.tsx

- **ReadAloud** (function) `({ text, label = "Read aloud", className, }: { text: string | (() => string); label?: string | undefined; className?: string | undefined; }): import("react").JSX.Element | null`
- **ReadEvents** (interface) `interface ReadEvents { phase(p: ReadPhase): void; error(message: string): void; done(): void; }`
- **ReadHandle** (interface) `interface ReadHandle { stop(): void; }`
- **ReadingEngine** (interface) `interface ReadingEngine { status(): ReadStatus; subscribe(fn: () => void): () => void; read(text: string, on: ReadEvents): ReadHandle; }`
- **ReadingProvider** (function) `({ engine, children, }: { engine: ReadingEngine | null; children: ReactNode; }): import("react").JSX.Element`
- **ReadPhase** (type) `type ReadPhase = | { kind: "loading"; progress: number | null } | { kind: "reading"; at: number; of: number };`
- **ReadStatus** (type) `type ReadStatus = | { state: "ready" } | { state: "unavailable"; why: string } | { state: "off" };`
- **useReadAloud** (function) `(): ((text: string) => void) | null`
- **useReadStatus** (function) `(): ReadStatus`

## packages/ui/src/record-access.tsx

- **AccessApi** (interface) `interface AccessApi { client: string; readOnly?: boolean; issues(a: { record: string; id: string }): Promise<IssueLine[]>; raise(a: { record: string; id: string; body: string; title?: string; channel?: string | null; }): Promise<unknown>; resolve(id: number): Promise<unknown>; ask(a: { verbs: Permission[]; apps?: string[]; channels?: string[]; record?: string; until?: string; reason: string; }): Promise<unknown>; }`
- **IssueLine** (interface) `interface IssueLine { id: number; body: string; by: string; at: string; resolvedBy: string | null; resolvedAt: string | null; }`
- **rowTarget** (function) `(meta: Pick<RecordMeta, "id" | "app" | "channel">, row: Record<string, Cell>, client: string): Target`

## packages/ui/src/record-patch.ts

- **detailPatch** (function) `(record: string, id: string | number, fn: (detail: unknown) => { detail?: unknown; row?: Record<string, unknown> } | null): Patch`
- **patchRecord** (function) `(api: object, record: string, id: string | number, fields: Record<string, unknown>, edit?: EditMoved): void`
- **recordPatch** (function) `(record: string, id: string | number, fields: Record<string, unknown>, edit: EditMoved = {}): Patch`
- **Twin** (type) `type Twin = ( id: string, fields: Record<string, unknown>, ) => { record: string; id: string; fields: Record<string, unknown> } | null;`
- **twinRecord** (function) `(record: string, twin: Twin): void`

## packages/ui/src/records-list.tsx

- **pageAskOf** (function) `(meta: RecordMeta, params: URLSearchParams): ListAsk`
- **prefetchList** (function) `(api: RecordsApi, record: string, params: URLSearchParams): Promise<void>`
- **RecordList** (function) `(props: RecordTemplateProps): import("react").JSX.Element`
- **TierLabel** (function) `({ needs, n }: { needs: boolean; n: number }): import("react").JSX.Element`

## packages/ui/src/records-local.ts

- **LocalRecords** (interface) `interface LocalRecords { api: RecordsApi; callFor(record: string, actions: readonly Action[]): Call; }`
- **localRecords** (function) `(server: RecordsApi): LocalRecords`

## packages/ui/src/records-page.tsx

- **RecordPage** (function) `({ id, back, wide = false, ...props }: RecordTemplateProps & { id: string; back?: { href: string; label: string } | undefined; wide?: boolean | undefined; }): import("react").JSX.Element`

## packages/ui/src/records-panel.tsx

- **RecordPanel** (function) `({ meta, types, id, api, place, extras, acts, index, count, step, rev, onActed, peek, listRow, docked = false, }: { meta: RecordMeta; types: RecordMeta[]; id: string; api: RecordsApi; place: Place; extras: RecordTemplateProps["extras"]; acts: RecordActs | undefined; index: number; count: number; step: (by: number) => void; rev: number; onActed: (changed: (string | number)[]) => void; peek?: PeekWire | undefined; listRow?: Row | undefined; docked?: boolean; }): import("react").JSX.Element`
- **PeekWire** (interface) `interface PeekWire { fields: FieldMeta[]; reply: RowReplyBox | undefined; replyOn: (row: Row) => boolean; actsOf: (row: Row) => { main: Action[]; more: Action[] }; press: (action: Action, row: Row) => void; ask: (action: Action, row: Row, close: () => void) => ReactNode; busyOn: (action: Action, row: Row) => boolean; }`

## packages/ui/src/records-types.ts

- **ActPatch** (type) `type ActPatch = ( detail: unknown, answer: unknown, ) => { detail?: unknown; row?: Record<string, unknown> } | null;`
- **EntryKeep** (interface) `interface EntryKeep { get(key: string): unknown; set(key: string, value: unknown): void; }`
- **Needs** (type) `type Needs = Readonly<Record<string, readonly string[]>>;`
- **Place** (interface) `interface Place { params: URLSearchParams; link(change: Record<string, string | null>): string; page(id: string | number): string; list: string; go(to: string, replace?: boolean): void; entry?: EntryKeep; }`
- **pressAct** (function) `(call: Call, a: Action, id: string | number, record: string, input: Record<string, unknown>): Promise<unknown>`
- **RecordAct** (type) `type RecordAct = (( action: string, input?: Record<string, unknown>, o?: { patch?: ActPatch | undefined }, ) => Promise<unknown>) & { readonly record?: string; };`
- **RecordActs** (interface) `interface RecordActs { actions: readonly Action[]; viewer: Viewer; call: Call; }`
- **RecordExtras** (interface) `interface RecordExtras { hero?: ReactNode; lead?: ReactNode; top?: ReactNode; facts?: [string, ReactNode][]; sections?: [string, ReactNode][]; drawn?: readonly string[]; sources?: RecordSource[]; recent?: PeekLine[]; poll?: number; draft?: RecordDraft; form?: ReactNode; aside?: ReactNode; }`
- **RecordSource** (interface) `interface RecordSource { mark: string; kind: string; meta?: string; title?: string | null; sure?: number | null; detail?: [string, string][]; link?: { href: string | null; label: string } | null; }`
- **RecordsApi** (interface) `interface RecordsApi { types(): Promise<RecordMeta[]>; list(ask: ListAsk): Promise<RecordsPage>; get(ask: GetAsk): Promise<RecordAnswer>; export(ask: ExportAsk): Promise<RecordsFile>; stats?(ask: StatsAsk): Promise<RecordsStat>; edit?(ask: EditAsk): Promise<Edited>; undo?(ask: UndoAsk): Promise<Edited>; ask?(ask: RecordAskAsk): Promise<{ id: string }>; keep?: KeepApi; access?: AccessApi; }`
- **RecordTemplateProps** (interface) `interface RecordTemplateProps { record: string; title?: string | undefined; api: RecordsApi; place: Place; empty?: string | Readonly<Record<string, string>> | undefined; example?: ReactNode; columns?: string[] | undefined; sections?: ShopSections | undefined; art?: ((row: Row) => ReactNode) | undefined; extras?: | ((detail: unknown, row: Row, act: RecordAct, readAt: number) => RecordExtras) | undefined; acts?: RecordActs | undefined; head?: ((meta: RecordMeta, reload: () => void) => ReactNode) | undefined; reply?: RowReplyBox | undefined; needs?: Needs | undefined; late?: Late | undefined; peek?: false | PeekSpec | undefined; display?: ReactNode; }`
- **ShopSections** (interface) `interface ShopSections { field: string; order: readonly string[]; names: Readonly<Record<string, string>>; blurbs?: Readonly<Record<string, string>>; }`
- **useTypes** (function) `(api: RecordsApi): Load<RecordMeta[]>`
- **waitsOn** (function) `(needs: Needs, row: Row): boolean`

## packages/ui/src/row-acts.tsx

- **RowActions** (function) `({ title, main, more, reply, page, busy, run, still = false, lone = false, }: { title: string; main: readonly Action[]; more: readonly Action[]; reply: (() => void) | null; page?: string | undefined; busy: boolean; run: (a: Action) => void; still?: boolean; lone?: boolean; }): import("react").JSX.Element`
- **rowActsOf** (function) `(actions: readonly Action[], row: Record<string, unknown>, reply = false): { main: Action[]; more: Action[] }`

## packages/ui/src/rows.tsx

- **Age** (function) `({ hours, late, className }: RowsWait & { className?: string }): import("react").JSX.Element`
- **avatarOf** (function) `(title: string): string | null`
- **drawnOf** (function) `(lines: readonly RowsLine<T>[], folded: ReadonlySet<string> | undefined, wait: ((row: T) => RowsWait | null) | undefined): Drawn<T>[]`
- **KIND_ICON** (const) `Record<FieldMeta["kind"], IconName>`
- **Pill** (function) `({ color, className, children, }: { color?: string | undefined; className?: string | undefined; children: ReactNode; }): import("react").JSX.Element`
- **Rows** (function) `(p: RowsProps<T>): import("react").JSX.Element`
- **RowsAct** (interface) `interface RowsAct { main: Parameters<typeof RowActions>[0]["main"]; more: Parameters<typeof RowActions>[0]["more"]; reply: (() => void) | null; page?: string | undefined; busy: boolean; run: Parameters<typeof RowActions>[0]["run"]; }`
- **RowsColumn** (interface) `interface RowsColumn<T> { key: string; label: ReactNode; icon?: IconName | undefined; align?: "end" | undefined; width?: number | undefined; min?: number | undefined; className?: string | undefined; sort?: ReactNode; cell: (row: T, index: number) => ReactNode; phone?: boolean | undefined; quiet?: boolean | undefined; total?: ReactNode; }`
- **RowsLine** (type) `type RowsLine<T> = | { kind: "row"; key: string; index: number; row: T } | { kind: "box"; key: string; node: ReactNode } | { kind: "group"; key: string; label: ReactNode; color?: string | undefined } | { kind: "tier"; key: string; head: ReactNode };`
- **RowsName** (interface) `interface RowsName<T> { label: ReactNode; icon?: IconName | undefined; sort?: ReactNode; width?: number | undefined; min?: number | undefined; className?: string | undefined; title: (row: T) => string; href?: ((row: T) => string | null) | undefined; weight?: ((row: T) => string) | undefined; avatar?: ((row: T) => string | null) | undefined; mark?: ((row: T) => ReactNode) | undefined; sub?: ((row: T) => ReactNode) | undefined; tail?: ((row: T) => ReactNode) | undefined; }`
- **RowsPick** (interface) `interface RowsPick { picked: (id: string) => boolean; toggle: (id: string, range?: boolean) => void; all: boolean; some: boolean; toggleAll: () => void; count: number; }`
- **RowsProps** (interface) `interface RowsProps<T> { label: string; noun?: string | undefined; columns: RowsColumn<T>[]; name: RowsName<T>; lines: RowsLine<T>[]; loading?: boolean | undefined; empty?: boolean | undefined; pick?: RowsPick | undefined; act?: ((row: T) => RowsAct | null) | undefined; end?: ((row: T) => ReactNode) | undefined; open?: { id: string | null; onOpen: (row: T, index: number) => void } | undefined; cursor?: number | undefined; rowState?: | ((row: T) => { going?: string | undefined; changed?: boolean | undefined }) | undefined; onSettled?: (() => void) | undefined; wait?: ((row: T) => RowsWait | null) | undefined; group?: { folded: ReadonlySet<string>; toggle: (key: string) => void } | undefined; scroller: HTMLElement | null | "window"; narrow: boolean; swipes?: ((row: T) => Swipes | null) | undefined; rowProps?: ((row: T, index: number) => RowAttrs) | undefined; className?: string | undefined; }`
- **RowsWait** (interface) `interface RowsWait { hours: number; late: boolean; }`
- **stateColor** (function) `(s: State | undefined): string`
- **statsOf** (function) `(waits: readonly (RowsWait | null)[]): WaitStats`
- **WaitStats** (interface) `interface WaitStats { n: number; late: number; oldest: RowsWait | null; }`

## packages/ui/src/run.tsx

- **dwellOf** (function) `(line: RunLine | undefined, behind: number, live: boolean): number`
- **expectedOf** (function) `(lines: readonly RunLine[]): Record<string, number>`
- **mixOf** (function) `(v: RunStepView, expected: number): RunMix`
- **RUN_DWELL** (const) `Record<RunLineKind, number>`
- **RUN_MAX_SPEEDUP** (const) `2`
- **RunEnd** (interface) `interface RunEnd { label: string; note?: string; }`
- **RunFocus** (type) `type RunFocus = { step: string } | { subject: string } | null;`
- **RunLine** (interface) `interface RunLine { id: string | number; step: string; kind: RunLineKind; text: string; subject?: string | null; count?: number | null; source?: { label: string; href?: string | null } | null; detail?: string | null; }`
- **RunLineKind** (type) `type RunLineKind = "started" | "did" | "found" | "waiting" | "failed" | "done";`
- **RunMix** (interface) `interface RunMix { found: number; did: number; failed: number; waiting: number; }`
- **RunStep** (interface) `interface RunStep { id: string; label: string; short?: string; source?: string; found?: string; after?: string[]; }`
- **RunStepState** (type) `type RunStepState = "idle" | "active" | "done" | "waiting";`
- **RunStepView** (interface) `interface RunStepView { state: RunStepState; handled: number; found: number; failed: number; waiting: number; }`
- **RunView** (function) `({ steps, lines, live = false, label, results, input, output, pace = 1, work, className, }: { steps: RunStep[]; lines: RunLine[]; live?: boolean; label: ReactNode; results?: ReactNode; input?: RunEnd; output?: RunEnd; pace?: number; work?: ((line: RunLine) => ReactNode) | undefined; className?: string | undefined; }): import("react").JSX.Element`
- **stepsAt** (function) `(steps: readonly RunStep[], lines: readonly RunLine[], shown: number): Record<string, RunStepView>`

## packages/ui/src/save/clock.ts

- **tick** (function) `(): number`

## packages/ui/src/save/engine.ts

- **Conflict** (interface) `interface Conflict<T> { mine: T; theirs: T | null; }`
- **conflictOf** (function) `(err: unknown): boolean`
- **Failure** (type) `type Failure = "transient" | "conflict" | "refused";`
- **failureKind** (function) `(err: unknown, conflict: (err: unknown) => boolean = conflictOf): Failure`
- **SAVE_DELAY_MS** (const) `1200`
- **SaveAnswer** (interface) `interface SaveAnswer<T> { value?: T | undefined; version?: string | null | undefined; }`
- **SaveContext** (interface) `interface SaveContext<T> { expect: string | T | null; base: T; version: string | null; request: string; }`
- **SaveFn** (type) `type SaveFn<T> = ( value: T, ctx: SaveContext<T>, ) => Promise<SaveAnswer<T> | undefined | Answerless>;`
- **Saver** (class) `readonly key: string | null;; constructor(o: SaverOptions<T>); update(o: Partial<Pick<SaverOptions<T>, "save" | "onSaved" | "onConflict" | "conflictOf">>): void; readonly subscribe; readonly snapshot; open(): void; close(): void; set(value: T): void; flush(): Promise<boolean>; retry; keepMine(): Promise<boolean>; takeTheirs(): void; read(server: T, o: { version?: string | null | undefined; at?: number | undefined } = {}): void`
- **SaverOptions** (interface) `interface SaverOptions<T> { key: string | null; server: T; version?: string | null | undefined; at?: number | undefined; save: SaveFn<T>; same?: ((a: T, b: T) => boolean) | undefined; delay?: number | null | undefined; timeout?: number | undefined; conflictOf?: ((err: unknown) => boolean) | undefined; onSaved?: ((value: T, answer: SaveAnswer<T>) => void) | undefined; onConflict?: (() => void) | undefined; env?: Partial<SaveEnv> | undefined; }`
- **SaveState** (interface) `interface SaveState<T> { value: T; base: T; status: Status; error: string | null; conflict: Conflict<T> | null; dirty: boolean; restored: boolean; }`
- **SaveStatusName** (type) `type Status = "clean" | "edited" | "saving" | "saved" | "waiting" | "conflict" | "failed";`
- **SaveTimeout** (class) `constructor()`

## packages/ui/src/save/env.ts

- **SaveEnv** (interface) `interface SaveEnv { storage: Store | null; locks: Locks | null; listen(fn: (e: PageEvent) => void): () => void; id(): string; now(): number; }`

## packages/ui/src/save/latest.ts

- **LATEST** (const) `Latest`
- **Latest** (class) `write(key: string, value: T, send: (value: T) => Promise<unknown>): Promise<Wrote>; busy(key: string): boolean`
- **Wrote** (type) `type Wrote = | { status: "saved" } | { status: "replaced" } | { status: "failed"; error: unknown };`

## packages/ui/src/save/once.ts

- **ACTIONS** (const) `{ run: <R>(key: string, fn: (requestId: string) => Promise<R>, press?: Omit<PressOptions, "key">) => Promise<R>; busy: (key: string) => boolean; }`

## packages/ui/src/save/page.ts

- **SavePage** (class) `add(box: Flushable): () => void; flush(): Promise<boolean>; get size()`

## packages/ui/src/save/react.tsx

- **SaveConflict** (function) `({ conflict, show, onKeepMine, onTakeTheirs, }: { conflict: Conflict<T>; show?: ((theirs: T) => ReactNode) | undefined; onKeepMine: () => void; onTakeTheirs: () => void; }): import("react").JSX.Element`
- **Saved** (interface) `interface Saved<T> extends SaveState<T> { set: (value: T) => void; flush: () => Promise<boolean>; keepMine: () => Promise<boolean>; takeTheirs: () => void; retry: () => Promise<boolean>; }`
- **SaveScope** (function) `({ page, children }: { page: SavePage; children: ReactNode }): import("react").JSX.Element`
- **SaveStatus** (function) `({ state, onRetry, idle, }: { state: Pick<SaveState<unknown>, "status" | "error">; onRetry?: (() => void) | undefined; idle?: ReactNode; }): import("react").JSX.Element`
- **statusWords** (function) `(status: Status, error: string | null): string | null`
- **useSaved** (function) `(o: SaverOptions<T>): Saved<T>`
- **useSavePage** (function) `(): SavePage`

## packages/ui/src/save/writes.ts

- **PressOptions** (interface) `interface PressOptions { key: string; what?: string | null | undefined; label?: string | null | undefined; records?: readonly string[] | undefined; input?: Record<string, unknown> | null | undefined; hide?: boolean | undefined; }`
- **Retry** (interface) `interface Retry { count: number; reason: string; }`
- **recordKey** (function) `(scope: string, id: string | number): string`
- **stableKey** (function) `(v: unknown): string`
- **WireState** (type) `type WireState = | { state: "sending"; retry?: Retry } | { state: "sent"; answer?: unknown } | { state: "failed"; error: string } | { state: "unknown" };`
- **WRITES** (const) `Writes`
- **Write** (interface) `interface Write { id: string; key: string; what: string | null; label: string | null; records: string[]; input: Record<string, unknown> | null; status: WriteStatus; error: string | null; at: number; settled: number | null; due: number | null; hide: boolean; read: boolean; told: boolean; page: string; retried: boolean; accepted: boolean; retry?: Retry | null; calls: WireCall[]; }`
- **WriteHooks** (interface) `interface WriteHooks { send?: (path: string, body: Record<string, unknown>) => Promise<unknown>; status?: (path: string, id: string) => Promise<WireState>; reread?: () => Promise<void>; tell?: (w: Write) => void; landed?: (records: string[]) => void; }`
- **WriteStatus** (type) `type WriteStatus = "held" | "sending" | "unsure" | "sent" | "failed";`
- **Writes** (class) `constructor(private readonly env: WriteEnv); use(hooks: WriteHooks): void; start(): void; stop(): void; readonly subscribe; readonly snapshot; lastOn(record: string, what?: readonly string[]): Write | null; goingIn(scope: string): { what: string; ids: string[] } | null; hiddenIn(scope: string): Set<string>; sendingIn(scope: string): Map<string, string | null>; landed(): number; showing(): boolean; get pending(): number; dismiss(id: string): void; press(o: PressOptions, fn: (requestId: string) => Promise<R>): Promise<R>; busy(key: string): boolean; hold(o: PressOptions & { ms: number }, commit: (requestId: string) => Promise<unknown>): { id: string; undo: () => boolean } | null; undo(id: string): boolean; call(path: string, body: Record<string, unknown>, send: (body: Record<string, unknown>) => Promise<R>): Promise<R>; back(first = false): Promise<void>; gone(): void; due(): Promise<void>; pushed(on: boolean): void; heard(id: string, got: WireState): undefined`

## packages/ui/src/settings.ts

- **NOT_SET** (const) `"Not set"`
- **SettingField** (interface) `interface SettingField { field: string; label: string; options?: readonly string[] | undefined; labels?: Readonly<Record<string, string>> | undefined; }`
- **SettingRow** (type) `type SettingRow = [label: string, value: string | string[]];`
- **settingRows** (function) `(values: Readonly<Record<string, unknown>> | null | undefined, fields?: readonly SettingField[] | null): SettingRow[]`
- **settingText** (function) `(v: unknown): string`

## packages/ui/src/shell.tsx

- **AppShell** (function) `({ brand, workspace, launcher, home, areas, dock, app, pins, actions, bar, page, theme, wide = false, bleed = false, display, customize, onGo, at, deep = false, className, children, }: { brand: Brand; workspace: Workspace; launcher?: string | undefined; home?: NavHome | undefined; areas?: NavArea[] | undefined; dock?: DockItem[] | undefined; app: OpenApp | null; pins?: RailPins | undefined; actions?: ReactNode; bar?: ReactNode; page: string; theme?: Theme | undefined; wide?: boolean | undefined; bleed?: boolean | undefined; display?: DisplayControl | undefined; customize?: ReactNode; onGo?: ((href: string) => void) | undefined; at?: string | undefined; deep?: boolean | undefined; className?: string | undefined; children: ReactNode; }): import("react").JSX.Element`
- **Brand** (interface) `interface Brand { name: string; href: string; stamp: string; }`
- **DockItem** (interface) `interface DockItem { id: string; label: string; icon: IconName; href: string; count?: number | undefined; on?: boolean | undefined; holds?: string[] | undefined; }`
- **Gate** (function) `({ stamp, title, theme, className, children, }: { stamp: string; title: string; theme?: Theme | undefined; className?: string | undefined; children: ReactNode; }): import("react").JSX.Element`
- **NavApp** (interface) `interface NavApp { id: string; name: string; icon: IconName; href: string; count?: number | undefined; off?: boolean | undefined; pages?: NavItem[] | undefined; }`
- **NavArea** (interface) `interface NavArea { id: string; label: string; apps: NavApp[]; shut?: boolean | undefined; }`
- **NavHome** (interface) `interface NavHome { label: string; href: string; icon?: IconName | undefined; count?: number | undefined; }`
- **NavItem** (interface) `interface NavItem { id: string; label: string; href: string; count?: number | undefined; group?: string | undefined; depth?: number | undefined; drop?: NavDrop | undefined; }`
- **OpenApp** (interface) `interface OpenApp { id?: string | undefined; name: string; icon: IconName; href: string; tabs: NavItem[]; current: string; action?: ReactNode; dock?: DockItem[] | undefined; }`
- **RailPins** (interface) `interface RailPins { pins: PinLine[]; here: boolean; current?: string | undefined; onToggle: () => void; onMove: (from: number, to: number) => void; onRemove: (href: string) => void; onClear: () => void; }`
- **Workspace** (interface) `interface Workspace { current: WorkspaceOption | null; chip?: { label: string; href: string } | undefined; href?: string | undefined; label: string; }`
- **WorkspaceOption** (interface) `interface WorkspaceOption { id: string; name: string; }`

## packages/ui/src/shop.tsx

- **RecordShop** (function) `(props: RecordTemplateProps): import("react").JSX.Element`

## packages/ui/src/snippets.tsx

- **FavoriteStar** (function) `({ on, label, onToggle, }: { on: boolean; label: string; onToggle: () => void; }): import("react").JSX.Element`
- **InsertSnippet** (function) `({ box, value, onChange, channel, }: { box: RefObject<HTMLTextAreaElement | null>; value: string; onChange: (next: string) => void; channel?: string | undefined; }): import("react").JSX.Element | null`
- **SnippetLine** (interface) `interface SnippetLine { id: number; title: string; body: string; tags: string[]; channel: string; }`
- **SnippetsProvider** (function) `({ source, children, }: { source: SnippetsSource | null; children: ReactNode; }): import("react").JSX.Element`
- **SnippetsSource** (interface) `interface SnippetsSource { list: () => Promise<SnippetLine[]>; favorites: () => Promise<number[]>; setFavorites: (ids: number[]) => Promise<unknown>; }`
- **useFavorites** (function) `(source: SnippetsSource | null): { ids: number[]; toggle: (id: number) => void; }`
- **useSnippets** (function) `(): SnippetsSource | null`

## packages/ui/src/sources.tsx

- **Cite** (function) `({ n, label, href, on = false, onPick, className, }: { n: number; label?: string | undefined; href?: string | undefined; on?: boolean | undefined; onPick?: (() => void) | undefined; className?: string | undefined; }): import("react").JSX.Element`
- **Cited** (function) `({ text, order, lit, onPick, }: { text: string; order: string[]; lit?: string | null | undefined; onPick: PickSource; }): import("react").JSX.Element`
- **MARKS** (const) `RegExp`
- **marksOf** (function) `(text: string): string[]`
- **PickSource** (type) `type PickSource = (mark: string) => void;`
- **SourceCard** (function) `({ id, n, kind, meta, title, sure, detail = [], link, lit = false, className, }: { id?: string | undefined; n?: number | undefined; kind: ReactNode; meta?: ReactNode; title?: ReactNode; sure?: number | null | undefined; detail?: [label: string, value: ReactNode][] | undefined; link?: { href: string | null; label: string } | null | undefined; lit?: boolean | undefined; className?: string | undefined; }): import("react").JSX.Element`
- **SourceList** (function) `({ className, children, }: { className?: string | undefined; children: ReactNode; }): import("react").JSX.Element`
- **SURE_LEVELS** (const) `SureLevel[]`
- **Sure** (function) `({ value, levels = SURE_LEVELS, className, }: { value: number; levels?: SureLevel[] | undefined; className?: string | undefined; }): import("react").JSX.Element`
- **SureLevel** (interface) `interface SureLevel { min: number; label: string; }`
- **stripMarks** (function) `(s: string): string`
- **Traced** (function) `({ onTrace, label = "Why", title = "Why this line", on = false, className, children, }: { onTrace: () => void; label?: string | undefined; title?: string | undefined; on?: boolean | undefined; className?: string | undefined; children: ReactNode; }): import("react").JSX.Element`
- **Trail** (function) `({ steps, className, }: { steps: TrailStep[]; className?: string | undefined; }): import("react").JSX.Element`
- **TrailStep** (interface) `interface TrailStep { id: string; label: ReactNode; children: ReactNode; }`
- **useSourcePick** (function) `(): [string | null, PickSource]`

## packages/ui/src/split.tsx

- **SplitGhost** (function) `({ label, lines, shape = "bar", }: { label: string; lines: number; shape?: "bar" | "ring"; }): import("react").JSX.Element`
- **SplitPanel** (function) `({ label, total, line, rows, shape = "bar", }: { label: string; total: ReactNode; line: ReactNode; rows: readonly SplitRow[]; shape?: "bar" | "ring"; }): import("react").JSX.Element`
- **SplitRow** (interface) `interface SplitRow { key: string; label: string; note?: ReactNode; noteTone?: "late" | "bad" | undefined; weight: number; value: ReactNode; color: string; href: string; icon?: IconName | undefined; }`
- **sliceColor** (function) `(i: number): string`

## packages/ui/src/steps.tsx

- **HOLD** (const) `600`
- **JobStep** (interface) `interface JobStep { title: string; state: StepState; detail?: string | undefined; cards?: StepCard[] | undefined; count?: string | undefined; }`
- **StepCard** (interface) `interface StepCard { key: string; label: string; mark: string; }`
- **StepState** (type) `type StepState = "wait" | "run" | "done";`
- **Steps** (function) `({ title, steps, summary, startedAt, }: { title: string; steps: JobStep[]; summary?: string | undefined; startedAt?: number | undefined; }): import("react").JSX.Element`

## packages/ui/src/sweep.tsx

- **Sweep** (function) `({ band = false, open = false, radius, }: { band?: boolean; open?: boolean; radius?: number | undefined; }): import("react").JSX.Element`

## packages/ui/src/switch-bar.tsx

- **RecordSwitch** (function) `({ api, place, field, waits, record, label, children, }: { api: RecordsApi; place: Place; field: string; waits: readonly SwitchWait[]; record?: string | undefined; label: string; children: ReactNode; }): import("react").JSX.Element`
- **SwitchWait** (interface) `interface SwitchWait { record: string; view: string; }`

## packages/ui/src/tab-bar.tsx

- **TabBar** (function) `({ row }: { row: string }): import("react").JSX.Element`

## packages/ui/src/table.tsx

- **cellsOf** (function) `(head: readonly (string | readonly [string, "r"])[], rows: readonly ReactNode[][]): { columns: TableColumn<ReactNode[]>[]; data: readonly ReactNode[][] }`
- **DataTable** (function) `({ columns, data, rowKey, stack = false, look = "plain", rowProps, className, }: { columns: TableColumn<T>[]; data: readonly T[]; rowKey?: (row: T, index: number) => string | number; stack?: boolean; look?: keyof typeof LOOKS; rowProps?: (row: T, index: number) => RowAttrs; className?: string; }): import("react").JSX.Element`
- **FactsTable** (function) `({ head, rows, stack = false, }: { head: readonly (string | readonly [string, "r"])[]; rows: readonly ReactNode[][]; stack?: boolean; }): import("react").JSX.Element`
- **ListLine** (type) `type ListLine = | { kind: "group"; key: string; field: FieldMeta; value: string; first: Row; n: number } | { kind: "tier"; key: string; needs: boolean; n: number } | { kind: "row"; key: string; row: Row; index: number };`
- **ListTable** (interface) `interface ListTable { cols: FieldMeta[]; rows: Row[]; lines: ListLine[]; sorted: (key: string) => false | "asc" | "desc"; all: boolean; some: boolean; toggleAll: () => void; picked: (id: string) => boolean; toggle: (id: string) => void; }`
- **RowAttrs** (type) `type RowAttrs = HTMLAttributes<HTMLTableRowElement> & { [data: 'data-${string}']: string | number | boolean | undefined; };`
- **sortingOf** (function) `(sort: string | undefined): { id: string; desc: boolean }[]`
- **TABLE_FEATURES** (const) `{ rowSortingFeature: import("@tanstack/react-table").TableFeature; columnVisibilityFeature: import("@tanstack/react-table").TableFeature; columnOrderingFeature: import("@tanstack/react-table").TableFeature; columnGroupingFeature: import("@tanstack/react-table").TableFeature; rowExpandingFeature: imp…`
- **TableColumn** (interface) `interface TableColumn<T extends RowData> { key: string; label: ReactNode; end?: boolean; className?: string; cell: (row: T, index: number) => ReactNode; }`
- **useLines** (function) `({ count, scroller, root, estimate, }: { count: number; scroller: HTMLElement | null | "window"; root: () => HTMLElement | null; estimate: number; }): Lines`
- **useListTable** (function) `({ meta, rows, cols, sort, group, split, picked, onPicked, }: { meta: Pick<RecordMeta, "fields">; rows: Row[]; cols: FieldMeta[]; sort: string | undefined; group: FieldMeta | null; split: number; picked: ReadonlySet<string>; onPicked: (next: Set<string>) => void; }): ListTable`
- **VIRTUAL_FROM** (const) `120`

## packages/ui/src/theme.tsx

- **applyTheme** (function) `(theme: Theme, el: HTMLElement = document.documentElement): () => void`
- **BASE** (const) `Theme`
- **dropPreloadedLook** (function) `(root: HTMLElement = document.documentElement): void`
- **isShowcase** (function) `(name: unknown): name is ShowcaseName`
- **LOOK_NOTES** (const) `Readonly<Record<PresetName | ShowcaseName, string>>`
- **PRESETS** (const) `{ wren: {}; night: { "chart-2": string; "chart-3": string; "chart-4": string; "chart-5": string; "line-0": string; "line-1": string; "line-2": string; "line-3": string; "line-4": string; "line-5": string; "line-6": string; "line-7": string; "line-out": string; scheme: string; canvas: string; paper: …`
- **PresetName** (type) `type PresetName = keyof typeof PRESETS;`
- **readTheme** (function) `(raw: unknown): Theme`
- **SHOWCASE** (const) `{ aurora: { scheme: string; canvas: string; paper: string; tile: string; ink: string; "ink-2": string; "ink-3": string; accent: string; "on-accent": string; good: string; "good-ink": string; bad: string; warn: string; "warn-ink": string; shade: string; scrim: string; font: string; "display-weight": …`
- **ShowcaseName** (type) `type ShowcaseName = keyof typeof SHOWCASE;`
- **Theme** (type) `type Theme = Partial<Record<Token, string>>;`
- **TOKENS** (const) `readonly ["scheme", "canvas", "paper", "ink", "ink-2", "ink-3", "accent", "on-accent", "good", "good-ink", "bad", "warn", "warn-ink", "shade", "font", "font-display", "display-weight", "display-squeeze", "label-case", "label-tracking", "button-case", "button-tracking", "button-weight", "radius", "le…`
- **Token** (type) `type Token = (typeof TOKENS)[number];`
- **themeVars** (function) `(theme: Theme): Record<string, string>`
- **usePageTheme** (function) `(theme: Theme | undefined): void`
- **wholeVars** (function) `(look: Theme): Record<string, string>`
- **NIGHT_LINES** (const) `{ "line-0": string; "line-1": string; "line-2": string; "line-3": string; "line-4": string; "line-5": string; "line-6": string; "line-7": string; "line-out": string; }`
- **NIGHT_CHARTS** (const) `{ "chart-2": string; "chart-3": string; "chart-4": string; "chart-5": string; }`

## packages/ui/src/timeline.tsx

- **MiniLine** (interface) `interface MiniLine { id: string; at: string; summary: string; href: string; source?: string | null; context?: string | null; note?: string | null; kind?: State | null; kindKey?: string | null; channel?: State | null; }`
- **RecordTimeline** (function) `(props: RecordTimelineProps): import("react").JSX.Element`
- **TimelineMini** (function) `({ lines: items, icons, all, }: { lines: readonly MiniLine[]; icons?: Readonly<Record<string, IconName>>; all?: { href: string; label: string } | undefined; }): import("react").JSX.Element`
- **TimelineSpec** (interface) `interface TimelineSpec { at: string; kind?: string; channel?: string; who?: string; whoLink?: string; link?: string; context?: string; note?: string; icons?: Readonly<Record<string, IconName>>; }`
- **TimelineSwitch** (function) `({ on, place }: { on: "timeline" | "list"; place: Place }): import("react").JSX.Element`

## packages/ui/src/vendor-marks.tsx

- **vendorOf** (function) `(key: string): string | null`
- **vendorName** (function) `(key: string): string`
- **VendorMark** (function) `({ vendor, size = 16, mono = false, label, className, }: { vendor: string; size?: number; mono?: boolean; label?: string; className?: string; }): import("react").JSX.Element | null`

## packages/ui/src/view-says.ts

- **orList** (function) `(xs: readonly string[]): string`
- **sayFilter** (function) `(f: Pick<FieldMeta, "key" | "label" | "kind" | "states"> | undefined, key: string, filter: Filter, now = new Date()): string`
- **sayFilters** (function) `(params: URLSearchParams, fields: readonly FieldMeta[], now = new Date()): string`
- **sayRaw** (function) `(f: FieldMeta, raw: string, now = new Date()): string`
- **saySaved** (function) `(meta: Named & Pick<RecordMeta, "views">, params: string, now = new Date()): string`
- **saySort** (function) `(meta: Pick<RecordMeta, "fields">, sort: string | undefined): string | null`
- **sayView** (function) `(meta: Named, v: SavedView, now = new Date()): string`
- **sortTip** (function) `(f: Pick<FieldMeta, "key" | "label" | "kind">, sort: string | undefined, next: string): string`

## packages/ui/src/work.tsx

- **PageChip** (function) `({ page, tone, }: { page: RunWorkLink; tone?: "kept" | "dropped" | undefined; }): import("react").JSX.Element`
- **RunWork** (interface) `interface RunWork { steps: RunWorkStep[]; facts: RunWorkFact[]; reasons: { reason: string; points: number }[]; }`
- **RunWorkFact** (interface) `interface RunWorkFact { kind: string; title: string | null; fields: [string, string][]; sure: number | null; page: RunWorkLink | null; seen: string | null; }`
- **RunWorkIcon** (type) `type RunWorkIcon = "mail" | "search" | "page" | "board" | "wait" | "rank" | "write";`
- **RunWorkLink** (interface) `interface RunWorkLink { label: string; href: string | null; }`
- **RunWorkStep** (interface) `interface RunWorkStep { icon: RunWorkIcon; did: string; query: string | null; queryHref?: string | null | undefined; page: RunWorkLink | null; read?: RunWorkLink | null | undefined; result: string | null; options: { page: RunWorkLink; verdict: string; kept: boolean }[]; tone: "kept" | "dropped" | "plain"; detail: string | null; }`
- **RunWorkTrail** (function) `({ work, title, className, }: { work: RunWork; title: ReactNode; className?: string | undefined; }): import("react").JSX.Element`
- **SiteMark** (function) `({ site }: { site: string }): import("react").JSX.Element`
