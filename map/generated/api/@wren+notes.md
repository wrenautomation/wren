# @wren/notes: interface

Exports: 235. Files: 25.

## packages/notes/src/access.ts

- **noteRole** (function) `(note: NoteAccess, shares: readonly { who: string; role: ShareRole }[], r: Omit<Reader, "cap">): Role | null`
- **effectiveRole** (function) `(own: Role | null, cap: ShareRole | null): Role | null`
- **atLeast** (function) `(r: Role | null, need: Role): boolean`
- **bestRole** (function) `(a: Role | null, b: Role | null): Role | null`
- **Reader** (interface) `interface Reader { email: string; team: boolean; inWorkspace: boolean; client: string | null; cap: ShareRole | null; }`
- **TEAM** (const) `"team"`
- **clientWho** (function) `(id: string): string`
- **isShareRole** (function) `(r: unknown): r is ShareRole`

## packages/notes/src/boards.ts

- **boardById** (function) `(db: Queryable, id: string): Promise<Board | null>`
- **boardRoleOn** (function) `(db: Queryable, board: Board, r: Omit<Reader, "cap">): Promise<Role | null>`
- **boardVisible** (function) `(r: Omit<Reader, "cap">, alias = "boards"): SQL`
- **defaultBoard** (function) `(db: Db, by: string): Promise<Board>`
- **listBoards** (function) `(db: Queryable, r: Omit<Reader, "cap">, o: BoardListOpts = {}): Omit<import("drizzle-orm/pg-core").PgSelectBase<"boards", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "boards"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRunt…`
- **createBoard** (function) `(db: Db, o: NewBoard): Promise<Board>`
- **saveBoard** (function) `(db: Db, id: string, o: { name?: unknown; columns?: unknown; expect?: number }): Promise<Board>`
- **shareBoard** (function) `(db: Queryable, id: string, who: string, role: ShareRole | null, by: string): Promise<void>`
- **setBoardGeneral** (function) `(db: Queryable, id: string, general: General, role: ShareRole): Promise<void>`
- **setBoardArchived** (function) `(db: Queryable, id: string, on: boolean): Promise<void>`
- **TaskRefusal** (class) `constructor(message: string, readonly status = 400)`
- **isBoardId** (function) `(s: unknown): s is string`
- **boardSharesOf** (function) `(db: Queryable, id: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"board_shares", { boardId: import("drizzle-orm/pg-core").PgColumn<{ name: "board_id"; tableName: "board_shares"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoi…`
- **NewBoard** (interface) `interface NewBoard { name: string; columns?: unknown; owner: string; general?: General; generalRole?: ShareRole; }`

## packages/notes/src/chips.ts

- **chipCardId** (function) `(m: { id?: unknown; label?: unknown }): string | null`
- **chipWords** (function) `(saved: string, now: CardChip | undefined): string`
- **makeChips** (function) `(read: (ids: string[]) => Promise<CardChip[]>, o: { wait?: number; after?: (fn: () => void, ms: number) => unknown; } = {}): Chips`
- **CARD_LABEL** (const) `"Card: "`
- **CardChip** (interface) `interface CardChip { id: string; column: string; closed: boolean; }`
- **CHIPS_PER_READ** (const) `100`
- **Chips** (interface) `interface Chips { get(id: string): CardChip | undefined; ask(ids: Iterable<string>): void; refresh(): void; watch(fn: () => void): () => void; }`

## packages/notes/src/console-context.ts

- **NoteFiles** (interface) `interface NoteFiles { putUrl(key: string, type: string, size: number): Promise<string>; getUrl(key: string): Promise<string>; }`
- **NotesDeps** (interface) `interface NotesDeps { main: Db; open: (client: Client) => Db; files?: NoteFiles | undefined; zone?: string; drive?: NoteDrive | undefined; mail?: { send: SendMention; portal: string } | undefined; turns?: NoteTurns | undefined; write?: ((prompt: string) => Promise<string>) | null | undefined; }`
- **NoteTurns** (interface) `interface NoteTurns { draft( ctx: restate.Context, o: { client: string | null; text: string; by: string }, ): Promise<void>; sop(o: { client: string; db: Db; noteId: string; sop: string; title: string; text: string; by: string; }): Promise<{ sop: string; state: "asked" | "added"; note: string | null }>; }`

## packages/notes/src/console-pages.ts

- **noteOut** (function) `(n: Note): { id: string; name: string; title: string; kind: "note" | "dump" | "task"; owner: string; createdBy: string; via: "person" | "agent"; general: "private" | "workspace"; generalRole: "comment" | "view" | "edit"; train: boolean; archived: boolean; parentId: string | null; createdAt: string; updatedAt: …`

## packages/notes/src/console-routes.ts

- **NOTES_CONSOLE_ROUTES** (const) `{ readonly home: "read"; readonly open: "read"; readonly sync: "read"; readonly versions: "read"; readonly version: "read"; readonly compare: "read"; readonly backlinks: "read"; readonly people: "read"; readonly file: "read"; readonly settings: "read"; readonly comments: "read"; readonly mentions: "…`
- **NOTES_CONSOLE_APPS** (const) `{ readonly "*": "notes"; readonly toDraft: "marketing"; readonly toSop: "learn"; }`
- **NOTES_CONSOLE_WRITES** (const) `readonly (keyof typeof NOTES_CONSOLE_ROUTES)[]`

## packages/notes/src/console-writes.ts

- **FILE_SRC** (const) `"wren-file:"`
- **IMAGE_MAX** (const) `number`
- **IMAGE_TYPES** (const) `Readonly<Record<string, string>>`

## packages/notes/src/console.ts

- **notesApi** (function) `(deps: NotesDeps): { train(req: import("./console-context.js").Req<{ id?: unknown; on?: unknown; }>): Promise<{ train: boolean; }>; drafting(req: import("./console-context.js").Req<{ id?: unknown; text?: unknown; }>): Promise<{ client: string | null; text: string; by: string; }>; toSop(req: import("./console-context.j…`
- **notesContext** (function) `(deps: NotesDeps, req: PortalRequest, q: string, limit = 5): Promise<string>`
- **makeNotesConsole** (function) `(deps: NotesDeps): restate.ServiceDefinition<"NotesConsole", { home: (_: restate.Context, req: import("./console-context.js").Req<{ view?: unknown; q?: unknown; limit?: unknown; parentId?: unknown; }>) => Promise<unknown>; open: (_: restate.Context, req: import("./console-context.js").Req<{ id?: unknown; }>) => Promis…`
- **NotesApi** (type) `type NotesApi = ReturnType<typeof notesApi>;`

## packages/notes/src/diff.ts

- **diffTokens** (function) `(a: readonly string[], b: readonly string[], maxD = 4000): Op[]`
- **blame** (function) `(base: string, steps: readonly { number: number; text: string }[]): Piece[]`
- **counts** (function) `(pieces: readonly Piece[]): { added: number; removed: number }`
- **tokens** (function) `(s: string): string[]`
- **Op** (type) `type Op = "same" | "ins" | "del";`
- **Piece** (interface) `interface Piece { op: Op; text: string; by: number | null; }`

## packages/notes/src/doc.ts

- **readBody** (function) `(doc: Y.Doc): NoteJson`
- **writeBody** (function) `(doc: Y.Doc, json: NoteJson): void`
- **appendBody** (function) `(doc: Y.Doc, json: NoteJson): void`
- **writeTitle** (function) `(doc: Y.Doc, title: string): void`
- **docOf** (function) `(json: NoteJson, title = ""): Y.Doc`
- **textOf** (function) `(json: NoteJson): string`
- **nameOf** (function) `(title: string, text: string): string`
- **linksOf** (function) `(json: NoteJson): Link[]`
- **toMarkdown** (function) `(json: NoteJson): string`
- **fromMarkdown** (function) `(md: string): NoteJson`
- **captureBlock** (function) `(words: string, at: Date, zone = "America/New_York"): NoteJson`
- **cleanBody** (function) `(json: unknown): NoteJson | null`
- **toB64** (function) `(u: Uint8Array): string`
- **fromB64** (function) `(s: string): Uint8Array`
- **readTitle** (function) `(doc: Y.Doc): string`
- **Link** (interface) `interface Link { target: string; label: string; }`
- **peopleIn** (function) `(json: NoteJson): string[]`

## packages/notes/src/docx.ts

- **toDocx** (function) `(json: NoteJson, o: DocxOptions = {}): Promise<Uint8Array>`
- **DocxImage** (interface) `interface DocxImage { data: Uint8Array; type: "png" | "jpg" | "gif" | "bmp"; width: number; height: number; }`

## packages/notes/src/drive.ts

- **driveIdOf** (function) `(link: string): string | null`
- **googleDrive** (function) `(o: { token?: (() => Promise<string>) | undefined; who?: (() => string | null) | undefined; fetch?: Fetch; }): NoteDrive`
- **DRIVE_READ_SCOPE** (const) `"https://www.googleapis.com/auth/drive.readonly"`
- **DRIVE_MAX** (const) `number`
- **DriveFile** (interface) `interface DriveFile { name: string; bytes: Uint8Array; }`
- **NoteDrive** (interface) `interface NoteDrive { who: () => string | null; get: (id: string) => Promise<DriveFile>; title: (id: string) => Promise<string | null>; }`
- **DriveRefusal** (class) ``

## packages/notes/src/inbox.ts

- **teamEmails** (function) `(main: Queryable, client: string | null = null): Promise<string[]>`
- **addInboxNote** (function) `(db: Db, o: { thread: string; personId: number | null; body: string; by: string; team: readonly string[]; now?: Date; }): Promise<{ note: InboxNote; mentioned: string[] }>`
- **inboxNotesOf** (function) `(db: Queryable, o: { threads: readonly string[]; personId: number | null }): Promise<InboxNote[]>`
- **inboxMentionsOf** (function) `(db: Queryable, email: string, limit = 50): Omit<import("drizzle-orm/pg-core").PgSelectBase<"note_mentions", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_mentions"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: …`
- **unseenInboxMentions** (function) `(db: Queryable, email: string): Promise<number>`
- **atEmails** (function) `(body: string): string[]`

## packages/notes/src/mention-mail.ts

- **mailMentions** (function) `(db: Queryable, o: MailMentionsOpts): Promise<number>`
- **MentionMail** (interface) `interface MentionMail { to: string; subject: string; text: string; }`
- **SendMention** (type) `type SendMention = (m: MentionMail) => Promise<void>;`

## packages/notes/src/position.ts

- **positionBetween** (function) `(before: string | null, after: string | null): string`

## packages/notes/src/records.ts

- **MENTION** (const) `"notes.mention"`
- **mentionRecord** (const) `RecordType`
- **NOTES_RECORDS** (const) `readonly RecordType[]`

## packages/notes/src/room.ts

- **LIVE_PREFIX** (const) `"/api/notes/live/"`
- **PROTOCOL** (const) `"wren-notes"`
- **FLUSH_AFTER** (const) `1500`
- **POLL_EVERY** (const) `15000`
- **FRAME_MAX** (const) `number`
- **Socket** (interface) `interface Socket { send(frame: string): void; close(code: number, reason: string): void; }`
- **Seat** (interface) `interface Seat { email: string; as: Record<string, unknown>; }`
- **RoomRefusal** (class) `constructor(message: string, readonly status: number)`
- **SyncAnswer** (type) `type SyncAnswer = | { ok: true; update: string; sv: string; version: number; name: string; updatedAt: string | null; editedBy: string | null; role: Role; } | { ok: false; status: number; message: string };`
- **Room** (class) `readonly doc; readonly awareness; constructor(readonly id: string, private readonly deps: RoomDeps); get size(); get closed(); join(socket: Socket, seat: Seat): Promise<Peer>; message(p: Peer, raw: string): void; leave(p: Peer): void; close(): void; flush(): Promise<void>; poll(): Promise<void>`

## packages/notes/src/schema.ts

- **boards** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "boards"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "boards"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: f…`
- **Board** (type) `type Board = typeof boards.$inferSelect;`
- **boardShares** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "board_shares"; schema: undefined; columns: { boardId: import("drizzle-orm/pg-core").PgColumn<{ name: "board_id"; tableName: "board_shares"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault…`
- **notes** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "notes"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "notes"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: fal…`
- **Note** (type) `type Note = typeof notes.$inferSelect;`
- **noteShares** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_shares"; schema: undefined; columns: { noteId: import("drizzle-orm/pg-core").PgColumn<{ name: "note_id"; tableName: "note_shares"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: fa…`
- **noteStars** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_stars"; schema: undefined; columns: { noteId: import("drizzle-orm/pg-core").PgColumn<{ name: "note_id"; tableName: "note_stars"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: fals…`
- **noteSeen** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_seen"; schema: undefined; columns: { noteId: import("drizzle-orm/pg-core").PgColumn<{ name: "note_id"; tableName: "note_seen"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: false;…`
- **noteUpdates** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_updates"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_updates"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **noteVersions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_versions"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_versions"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **NoteVersion** (type) `type NoteVersion = typeof noteVersions.$inferSelect;`
- **noteLinks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_links"; schema: undefined; columns: { noteId: import("drizzle-orm/pg-core").PgColumn<{ name: "note_id"; tableName: "note_links"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: fals…`
- **notesSettings** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "notes_settings"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "notes_settings"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDe…`
- **noteComments** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_comments"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_comments"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; i…`
- **NoteComment** (type) `type NoteComment = typeof noteComments.$inferSelect;`
- **inboxNotes** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "inbox_notes"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "inbox_notes"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPri…`
- **InboxNote** (type) `type InboxNote = typeof inboxNotes.$inferSelect;`
- **noteMentions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_mentions"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_mentions"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; i…`
- **NoteMention** (type) `type NoteMention = typeof noteMentions.$inferSelect;`
- **taskBlocks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "task_blocks"; schema: undefined; columns: { taskId: import("drizzle-orm/pg-core").PgColumn<{ name: "task_id"; tableName: "task_blocks"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: fa…`
- **taskMoves** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "task_moves"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "task_moves"; dataType: "number"; columnType: "PgBigSerial53"; data: number; driverParam: number; notNull: true; hasDefault: true; …`
- **TaskMove** (type) `type TaskMove = typeof taskMoves.$inferSelect;`

## packages/notes/src/sheet.ts

- **parseTable** (function) `(text: string): string[][]`
- **toCsv** (function) `(rows: readonly (readonly string[])[]): string`
- **guessMap** (function) `(headers: readonly string[]): (SheetField | null)[]`
- **mapRows** (function) `(table: readonly (readonly string[])[], map: readonly (SheetField | null)[], header = true): SheetRow[]`
- **fileLinkOf** (function) `(href: string): FileLink | null`
- **SHEET_FIELDS** (const) `readonly ["title", "column", "owner", "due", "labels", "blocked by", "link"]`
- **SheetField** (type) `type SheetField = (typeof SHEET_FIELDS)[number];`
- **cellOf** (function) `(v: string | undefined): string`
- **cardIdIn** (function) `(link: string | undefined): string | null`
- **FileLink** (type) `type FileLink = { kind: "doc" | "sheet" | "slides" | "drive" | "dropbox" | "onedrive"; label: string; };`

## packages/notes/src/store.ts

- **createNote** (function) `(db: Queryable, o: NewNote): Promise<Note>`
- **changeNote** (function) `(db: Db, id: string, by: string, fn: (doc: Y.Doc) => void, opts: ChangeOpts = {}): Promise<Changed>`
- **syncNote** (function) `(db: Db, id: string, by: string, update: Uint8Array | null, sv: Uint8Array | null, o: { suggestOnly?: boolean } = {}): Promise<{ note: Note; missing: Uint8Array; sv: Uint8Array; version: number; changed: boolean; }>`
- **restoreVersion** (function) `(db: Db, id: string, number: number, by: string): Promise<Changed>`
- **nameVersion** (function) `(db: Db, id: string, number: number, name: string | null): Promise<{ id: number; noteId: string; number: number; kind: "auto" | "restore" | "import" | "named"; name: string | null; title: string; body: NoteJson; text: string; authors: string[]; startedAt: Date; at: Date; restoredFrom: number | null; }>`
- **versionsOf** (function) `(db: Queryable, id: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"note_versions", { number: import("drizzle-orm/pg-core").PgColumn<{ name: "number"; tableName: "note_versions"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: fal…`
- **versionRange** (function) `(db: Queryable, id: string, from: number, to: number): Omit<import("drizzle-orm/pg-core").PgSelectBase<"note_versions", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_versions"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement…`
- **noteById** (function) `(db: Queryable, id: string): Promise<Note | null>`
- **roleOn** (function) `(db: Queryable, note: Note, r: Omit<Reader, "cap">): Promise<Role | null>`
- **visible** (function) `(r: Omit<Reader, "cap">): SQL`
- **listNotes** (function) `(db: Queryable, r: Omit<Reader, "cap">, o: ListOpts): Promise<NoteRow[]>`
- **backlinks** (function) `(db: Queryable, r: Omit<Reader, "cap">, target: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"note_links", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "notes"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasR…`
- **childrenOf** (function) `(db: Queryable, r: Omit<Reader, "cap">, id: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"notes", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "notes"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntim…`
- **star** (function) `(db: Queryable, id: string, email: string, on: boolean): Promise<void>`
- **seen** (function) `(db: Queryable, id: string, email: string): Promise<void>`
- **dumpOf** (function) `(db: Db, email: string): Promise<Note>`
- **share** (function) `(db: Queryable, id: string, who: string, role: ShareRole | null, by: string): Promise<void>`
- **setGeneral** (function) `(db: Queryable, id: string, general: General, role: ShareRole): Promise<void>`
- **transfer** (function) `(db: Db, id: string, to: string, by: string): Promise<void>`
- **setArchived** (function) `(db: Queryable, id: string, on: boolean): Promise<void>`
- **setTrain** (function) `(db: Queryable, id: string, on: boolean): Promise<void>`
- **move** (function) `(db: Db, id: string, parentId: string | null): Promise<void>`
- **settingsOf** (function) `(db: Queryable): Promise<{ train: boolean }>`
- **setWorkspaceTrain** (function) `(db: Queryable, on: boolean, by: string): Promise<void>`
- **trainingNotes** (function) `(db: Queryable): Promise<{ note: { id: string; parentId: string | null; kind: "note" | "dump" | "task"; title: string; body: NoteJson; text: string; search: string | null; yState: Uint8Array<ArrayBufferLike> | null; owner: string; createdBy: string; via: "person" | "agent"; general: "private" | "workspace"; generalR…`
- **commentById** (function) `(db: Queryable, noteId: string, id: string): Promise<NoteComment | null>`
- **addComment** (function) `(db: Db, c: NewComment): Promise<NoteComment>`
- **editComment** (function) `(db: Db, c: NoteComment, body: string, mentions: readonly string[]): Promise<NoteComment>`
- **mentionsOf** (function) `(db: Queryable, r: Omit<Reader, "cap">, limit = 50): Omit<import("drizzle-orm/pg-core").PgSelectBase<"note_mentions", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_mentions"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: …`
- **readMentions** (function) `(db: Queryable, ids: readonly string[], email: string, read = true): Promise<string[]>`
- **unseenMentions** (function) `(db: Queryable, r: Omit<Reader, "cap">): Promise<number>`
- **NotASuggestion** (class) `constructor()`
- **isNoteId** (function) `(s: unknown): s is string`
- **Changed** (interface) `interface Changed { note: Note; update: Uint8Array | null; version: number; }`
- **appendNote** (function) `(db: Db, id: string, by: string, body: NoteJson): Promise<Changed>`
- **renameNote** (function) `(db: Db, id: string, by: string, title: string): Promise<Changed>`
- **sharesOf** (function) `(db: Queryable, id: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"note_shares", { noteId: import("drizzle-orm/pg-core").PgColumn<{ name: "note_id"; tableName: "note_shares"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincre…`
- **ListView** (type) `type ListView = "recent" | "mine" | "shared" | "starred" | "archived" | "all";`
- **ListOpts** (interface) `interface ListOpts { view: ListView; q?: string | null; limit?: number; sharedTo?: readonly string[]; everything?: boolean; parentId?: string | null; tasks?: boolean; }`
- **NoteRow** (interface) `interface NoteRow { id: string; title: string; kind: NoteKind; owner: string; via: Via; general: General; generalRole: ShareRole; parentId: string | null; createdAt: Date; updatedAt: Date; editedBy: string | null; archivedAt: Date | null; starred: boolean; seenAt: Date | null; excerpt: string; text: string; rank: number; }`
- **commentsOf** (function) `(db: Queryable, id: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"note_comments", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_comments"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: …`
- **deleteComment** (function) `(db: Queryable, id: string): Omit<import("drizzle-orm/pg-core").PgDeleteBase<import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_comments"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_comments"; dataType: "string"; columnType: "PgUUID"; data: string; driverP…`
- **resolveComment** (function) `(db: Queryable, id: string, by: string | null): Omit<import("drizzle-orm/pg-core").PgUpdateBase<import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_comments"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_comments"; dataType: "string"; columnType: "PgUUID"; data: string; driverP…`

## packages/notes/src/suggest.ts

- **withoutSuggestionsBy** (function) `(json: NoteJson, by: string): NoteJson`
- **onlySuggests** (function) `(before: NoteJson, after: NoteJson, by: string): boolean`

## packages/notes/src/task-records.ts

- **taskRecordFor** (function) `(client: string | null): RecordType`
- **taskRecord** (const) `RecordType`

## packages/notes/src/tasks.ts

- **assigneeOf** (function) `(raw: unknown): string | null`
- **labelsOf** (function) `(raw: unknown): string[]`
- **dueOf** (function) `(raw: unknown): string | null`
- **columnOf** (function) `(board: Pick<Board, "columns">, ref: string): BoardColumn | null`
- **listTasks** (function) `(db: Queryable, f: TaskFilter = {}): Promise<TaskRow[]>`
- **taskById** (function) `(db: Queryable, id: string): Promise<TaskRow | null>`
- **readyTasks** (function) `(db: Queryable, me: string, o: { board?: string; limit?: number } = {}): Promise<TaskRow[]>`
- **needsYou** (function) `(db: Queryable, email: string, today: string): Promise<number>`
- **createTask** (function) `(db: Db, o: NewTask): Promise<Note>`
- **moveTask** (function) `(db: Db, id: string, o: MoveOpts): Promise<Moved>`
- **closeTask** (function) `(db: Db, id: string, o: { by: string; why?: string | null }): Promise<Moved>`
- **reopenTask** (function) `(db: Db, id: string, o: { by: string; why?: string | null; column?: string }): Promise<Moved>`
- **assignTask** (function) `(db: Db, id: string, who: unknown, o: { by: string; why?: string | null }): Promise<TaskRow>`
- **setDue** (function) `(db: Queryable, id: string, due: unknown): Promise<TaskRow>`
- **setLabels** (function) `(db: Queryable, id: string, raw: unknown): Promise<TaskRow>`
- **moveToBoard** (function) `(db: Db, id: string, boardId: string, o: { by: string; column?: string }): Promise<TaskRow>`
- **blockTask** (function) `(db: Queryable, id: string, blockedBy: string, by: string): Promise<void>`
- **unblockTask** (function) `(db: Queryable, id: string, blockedBy: string): Promise<void>`
- **LABELS_MAX** (const) `12`
- **LABEL_MAX** (const) `30`
- **TaskRow** (interface) `interface TaskRow { id: string; title: string; text: string; boardId: string; columnId: string; position: string; owner: string; via: Via; assignee: string | null; due: string | null; closedAt: Date | null; archivedAt: Date | null; createdAt: Date; updatedAt: Date; labels: string[]; blocked: number; blocks: number; comments: number; clients: { id: string; name: string }[]; version: number; }`
- **TaskRef** (interface) `interface TaskRef { id: string; title: string; text: string; columnId: string | null; boardId: string | null; closedAt: Date | null; }`
- **blockersOf** (function) `(db: Queryable, id: string): Promise<TaskRef[]>`
- **blockingOf** (function) `(db: Queryable, id: string): Promise<TaskRef[]>`
- **movesOf** (function) `(db: Queryable, id: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"task_moves", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "task_moves"; dataType: "number"; columnType: "PgBigSerial53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement:…`
- **Moved** (interface) `interface Moved { task: TaskRow; moved: boolean; redirected: BoardColumn | null; }`

## packages/notes/src/train.ts

- **noteLines** (function) `(db: Queryable, workspace: string, people = false): Promise<NoteLine[]>`
- **NoteLine** (interface) `interface NoteLine { schema: "wren.note/1"; workspace: string; id: string; title: string; text: string; via: "person" | "agent"; createdAt: string; updatedAt: string; versions: { number: number; kind: string; name: string | null; at: string; authors: string[]; text: string; }[]; }`

## packages/notes/src/types.ts

- **ownerName** (function) `(who: string | null | undefined, first = false): string`
- **moveWords** (function) `(m: { kind: MoveKind; to: string | null; assignee: string | null; why: string | null }, nameOfPerson: (who: string) => string = (w) => w): string`
- **KINDS** (const) `readonly ["note", "dump", "task"]`
- **NoteKind** (type) `type NoteKind = (typeof KINDS)[number];`
- **VIA** (const) `readonly ["person", "agent"]`
- **Via** (type) `type Via = (typeof VIA)[number];`
- **GENERAL** (const) `readonly ["private", "workspace"]`
- **General** (type) `type General = (typeof GENERAL)[number];`
- **ROLES** (const) `readonly ["view", "comment", "edit"]`
- **ShareRole** (type) `type ShareRole = (typeof ROLES)[number];`
- **Role** (type) `type Role = ShareRole | "owner";`
- **VERSION_KINDS** (const) `readonly ["auto", "named", "restore", "import"]`
- **VersionKind** (type) `type VersionKind = (typeof VERSION_KINDS)[number];`
- **NoteJson** (interface) `interface NoteJson { type: string; attrs?: Record<string, unknown>; content?: NoteJson[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[]; }`
- **AGENT** (const) `"agent:"`
- **isAgent** (function) `(who: string | null | undefined): boolean`
- **EMPTY** (const) `NoteJson`
- **Y_BODY** (const) `"default"`
- **Y_TITLE** (const) `"title"`
- **UPDATE_MAX** (const) `number`
- **CommentAnchor** (interface) `interface CommentAnchor { from: unknown; to: unknown; }`
- **SUGGEST_ADD** (const) `"suggestAdd"`
- **SUGGEST_DEL** (const) `"suggestDel"`
- **COMMENT_MAX** (const) `10000`
- **QUOTE_MAX** (const) `500`
- **BoardColumn** (interface) `interface BoardColumn { id: string; name: string; done: boolean; }`
- **DEFAULT_COLUMNS** (const) `readonly BoardColumn[]`
- **DEFAULT_BOARD** (const) `"Work"`
- **MOVE_KINDS** (const) `readonly ["create", "move", "assign", "close", "reopen"]`
- **MoveKind** (type) `type MoveKind = (typeof MOVE_KINDS)[number];`
