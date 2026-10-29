# @wren/notes: interface

Exports: 235. Files: 25.

## packages/notes/src/access.ts

- **Reader** (interface) `interface Reader { email: string; team: boolean; inWorkspace: boolean; client: string | null; cap: ShareRole | null; }`
- **TEAM** (const) `"team"`
- **atLeast** (function) `(r: Role | null, need: Role): boolean`
- **bestRole** (function) `(a: Role | null, b: Role | null): Role | null`
- **clientWho** (function) `(id: string): string`
- **effectiveRole** (function) `(own: Role | null, cap: ShareRole | null): Role | null`
- **isShareRole** (function) `(r: unknown): r is ShareRole`
- **noteRole** (function) `(note: NoteAccess, shares: readonly { who: string; role: ShareRole }[], r: Omit<Reader, "cap">): Role | null`

## packages/notes/src/boards.ts

- **NewBoard** (interface) `interface NewBoard { name: string; columns?: unknown; owner: string; general?: General; generalRole?: ShareRole; }`
- **TaskRefusal** (class) `constructor(message: string, readonly status = 400)`
- **boardById** (function) `(db: Queryable, id: string): Promise<Board | null>`
- **boardRoleOn** (function) `(db: Queryable, board: Board, r: Omit<Reader, "cap">): Promise<Role | null>`
- **boardSharesOf** (function) `(db: Queryable, id: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"board_shares", { boardId: import("drizzle-orm/pg-core").PgColumn<{ name: "board_id"; tableName: "board_shares"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoi…`
- **boardVisible** (function) `(r: Omit<Reader, "cap">, alias = "boards"): SQL`
- **createBoard** (function) `(db: Db, o: NewBoard): Promise<Board>`
- **defaultBoard** (function) `(db: Db, by: string): Promise<Board>`
- **isBoardId** (function) `(s: unknown): s is string`
- **listBoards** (function) `(db: Queryable, r: Omit<Reader, "cap">, o: BoardListOpts = {}): Omit<import("drizzle-orm/pg-core").PgSelectBase<"boards", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "boards"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRunt…`
- **saveBoard** (function) `(db: Db, id: string, o: { name?: unknown; columns?: unknown; expect?: number }): Promise<Board>`
- **setBoardArchived** (function) `(db: Queryable, id: string, on: boolean): Promise<void>`
- **setBoardGeneral** (function) `(db: Queryable, id: string, general: General, role: ShareRole): Promise<void>`
- **shareBoard** (function) `(db: Queryable, id: string, who: string, role: ShareRole | null, by: string): Promise<void>`

## packages/notes/src/chips.ts

- **CARD_LABEL** (const) `"Card: "`
- **CHIPS_PER_READ** (const) `100`
- **CardChip** (interface) `interface CardChip { id: string; column: string; closed: boolean; }`
- **Chips** (interface) `interface Chips { get(id: string): CardChip | undefined; ask(ids: Iterable<string>): void; refresh(): void; watch(fn: () => void): () => void; }`
- **chipCardId** (function) `(m: { id?: unknown; label?: unknown }): string | null`
- **chipWords** (function) `(saved: string, now: CardChip | undefined): string`
- **makeChips** (function) `(read: (ids: string[]) => Promise<CardChip[]>, o: { wait?: number; after?: (fn: () => void, ms: number) => unknown; } = {}): Chips`

## packages/notes/src/console-context.ts

- **NoteFiles** (interface) `interface NoteFiles { putUrl(key: string, type: string, size: number): Promise<string>; getUrl(key: string): Promise<string>; }`
- **NoteTurns** (interface) `interface NoteTurns { draft( ctx: restate.Context, o: { client: string | null; text: string; by: string }, ): Promise<void>; sop(o: { client: string; db: Db; noteId: string; sop: string; title: string; text: string; by: string; }): Promise<{ sop: string; state: "asked" | "added"; note: string | null }>; }`
- **NotesDeps** (interface) `interface NotesDeps { main: Db; open: (client: Client) => Db; files?: NoteFiles | undefined; zone?: string; drive?: NoteDrive | undefined; mail?: { send: SendMention; portal: string } | undefined; turns?: NoteTurns | undefined; write?: ((prompt: string) => Promise<string>) | null | undefined; }`

## packages/notes/src/console-pages.ts

- **noteOut** (function) `(n: Note): { id: string; name: string; title: string; kind: "note" | "dump" | "task"; owner: string; createdBy: string; via: "person" | "agent"; general: "private" | "workspace"; generalRole: "comment" | "view" | "edit"; train: boolean; archived: boolean; parentId: string | null; createdAt: string; updatedAt: …`

## packages/notes/src/console-routes.ts

- **NOTES_CONSOLE_APPS** (const) `{ readonly "*": "notes"; readonly toDraft: "marketing"; readonly toSop: "learn"; }`
- **NOTES_CONSOLE_ROUTES** (const) `{ readonly home: "read"; readonly open: "read"; readonly sync: "read"; readonly versions: "read"; readonly version: "read"; readonly compare: "read"; readonly backlinks: "read"; readonly people: "read"; readonly file: "read"; readonly settings: "read"; readonly comments: "read"; readonly mentions: "…`
- **NOTES_CONSOLE_WRITES** (const) `readonly (keyof typeof NOTES_CONSOLE_ROUTES)[]`

## packages/notes/src/console-writes.ts

- **FILE_SRC** (const) `"wren-file:"`
- **IMAGE_MAX** (const) `number`
- **IMAGE_TYPES** (const) `Readonly<Record<string, string>>`

## packages/notes/src/console.ts

- **NotesApi** (type) `type NotesApi = ReturnType<typeof notesApi>;`
- **makeNotesConsole** (function) `(deps: NotesDeps): restate.ServiceDefinition<"NotesConsole", { home: (_: restate.Context, req: import("./console-context.js").Req<{ view?: unknown; q?: unknown; limit?: unknown; parentId?: unknown; }>) => Promise<unknown>; open: (_: restate.Context, req: import("./console-context.js").Req<{ id?: unknown; }>) => Promis…`
- **notesApi** (function) `(deps: NotesDeps): { train(req: import("./console-context.js").Req<{ id?: unknown; on?: unknown; }>): Promise<{ train: boolean; }>; drafting(req: import("./console-context.js").Req<{ id?: unknown; text?: unknown; }>): Promise<{ client: string | null; text: string; by: string; }>; toSop(req: import("./console-context.j…`
- **notesContext** (function) `(deps: NotesDeps, req: PortalRequest, q: string, limit = 5): Promise<string>`

## packages/notes/src/diff.ts

- **Op** (type) `type Op = "same" | "ins" | "del";`
- **Piece** (interface) `interface Piece { op: Op; text: string; by: number | null; }`
- **blame** (function) `(base: string, steps: readonly { number: number; text: string }[]): Piece[]`
- **counts** (function) `(pieces: readonly Piece[]): { added: number; removed: number }`
- **diffTokens** (function) `(a: readonly string[], b: readonly string[], maxD = 4000): Op[]`
- **tokens** (function) `(s: string): string[]`

## packages/notes/src/doc.ts

- **Link** (interface) `interface Link { target: string; label: string; }`
- **appendBody** (function) `(doc: Y.Doc, json: NoteJson): void`
- **captureBlock** (function) `(words: string, at: Date, zone = "America/New_York"): NoteJson`
- **cleanBody** (function) `(json: unknown): NoteJson | null`
- **docOf** (function) `(json: NoteJson, title = ""): Y.Doc`
- **fromB64** (function) `(s: string): Uint8Array`
- **fromMarkdown** (function) `(md: string): NoteJson`
- **linksOf** (function) `(json: NoteJson): Link[]`
- **nameOf** (function) `(title: string, text: string): string`
- **peopleIn** (function) `(json: NoteJson): string[]`
- **readBody** (function) `(doc: Y.Doc): NoteJson`
- **readTitle** (function) `(doc: Y.Doc): string`
- **textOf** (function) `(json: NoteJson): string`
- **toB64** (function) `(u: Uint8Array): string`
- **toMarkdown** (function) `(json: NoteJson): string`
- **writeBody** (function) `(doc: Y.Doc, json: NoteJson): void`
- **writeTitle** (function) `(doc: Y.Doc, title: string): void`

## packages/notes/src/docx.ts

- **DocxImage** (interface) `interface DocxImage { data: Uint8Array; type: "png" | "jpg" | "gif" | "bmp"; width: number; height: number; }`
- **toDocx** (function) `(json: NoteJson, o: DocxOptions = {}): Promise<Uint8Array>`

## packages/notes/src/drive.ts

- **DRIVE_MAX** (const) `number`
- **DRIVE_READ_SCOPE** (const) `"https://www.googleapis.com/auth/drive.readonly"`
- **DriveFile** (interface) `interface DriveFile { name: string; bytes: Uint8Array; }`
- **DriveRefusal** (class) ``
- **NoteDrive** (interface) `interface NoteDrive { who: () => string | null; get: (id: string) => Promise<DriveFile>; title: (id: string) => Promise<string | null>; }`
- **driveIdOf** (function) `(link: string): string | null`
- **googleDrive** (function) `(o: { token?: (() => Promise<string>) | undefined; who?: (() => string | null) | undefined; fetch?: Fetch; }): NoteDrive`

## packages/notes/src/inbox.ts

- **addInboxNote** (function) `(db: Db, o: { thread: string; personId: number | null; body: string; by: string; team: readonly string[]; now?: Date; }): Promise<{ note: InboxNote; mentioned: string[] }>`
- **atEmails** (function) `(body: string): string[]`
- **inboxMentionsOf** (function) `(db: Queryable, email: string, limit = 50): Omit<import("drizzle-orm/pg-core").PgSelectBase<"note_mentions", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_mentions"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: …`
- **inboxNotesOf** (function) `(db: Queryable, o: { threads: readonly string[]; personId: number | null }): Promise<InboxNote[]>`
- **teamEmails** (function) `(main: Queryable, client: string | null = null): Promise<string[]>`
- **unseenInboxMentions** (function) `(db: Queryable, email: string): Promise<number>`

## packages/notes/src/mention-mail.ts

- **MentionMail** (interface) `interface MentionMail { to: string; subject: string; text: string; }`
- **SendMention** (type) `type SendMention = (m: MentionMail) => Promise<void>;`
- **mailMentions** (function) `(db: Queryable, o: MailMentionsOpts): Promise<number>`

## packages/notes/src/position.ts

- **positionBetween** (function) `(before: string | null, after: string | null): string`

## packages/notes/src/records.ts

- **MENTION** (const) `"notes.mention"`
- **NOTES_RECORDS** (const) `readonly RecordType[]`
- **mentionRecord** (const) `RecordType`

## packages/notes/src/room.ts

- **FLUSH_AFTER** (const) `1500`
- **FRAME_MAX** (const) `number`
- **LIVE_PREFIX** (const) `"/api/notes/live/"`
- **POLL_EVERY** (const) `15000`
- **PROTOCOL** (const) `"wren-notes"`
- **Room** (class) `readonly doc; readonly awareness; constructor(readonly id: string, private readonly deps: RoomDeps); get size(); get closed(); join(socket: Socket, seat: Seat): Promise<Peer>; message(p: Peer, raw: string): void; leave(p: Peer): void; close(): void; flush(): Promise<void>; poll(): Promise<void>`
- **RoomRefusal** (class) `constructor(message: string, readonly status: number)`
- **Seat** (interface) `interface Seat { email: string; as: Record<string, unknown>; }`
- **Socket** (interface) `interface Socket { send(frame: string): void; close(code: number, reason: string): void; }`
- **SyncAnswer** (type) `type SyncAnswer = | { ok: true; update: string; sv: string; version: number; name: string; updatedAt: string | null; editedBy: string | null; role: Role; } | { ok: false; status: number; message: string };`

## packages/notes/src/schema.ts

- **Board** (type) `type Board = typeof boards.$inferSelect;`
- **InboxNote** (type) `type InboxNote = typeof inboxNotes.$inferSelect;`
- **Note** (type) `type Note = typeof notes.$inferSelect;`
- **NoteComment** (type) `type NoteComment = typeof noteComments.$inferSelect;`
- **NoteMention** (type) `type NoteMention = typeof noteMentions.$inferSelect;`
- **NoteVersion** (type) `type NoteVersion = typeof noteVersions.$inferSelect;`
- **TaskMove** (type) `type TaskMove = typeof taskMoves.$inferSelect;`
- **boardShares** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "board_shares"; schema: undefined; columns: { boardId: import("drizzle-orm/pg-core").PgColumn<{ name: "board_id"; tableName: "board_shares"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault…`
- **boards** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "boards"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "boards"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: f…`
- **inboxNotes** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "inbox_notes"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "inbox_notes"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPri…`
- **noteComments** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_comments"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_comments"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; i…`
- **noteLinks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_links"; schema: undefined; columns: { noteId: import("drizzle-orm/pg-core").PgColumn<{ name: "note_id"; tableName: "note_links"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: fals…`
- **noteMentions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_mentions"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_mentions"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; i…`
- **noteSeen** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_seen"; schema: undefined; columns: { noteId: import("drizzle-orm/pg-core").PgColumn<{ name: "note_id"; tableName: "note_seen"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: false;…`
- **noteShares** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_shares"; schema: undefined; columns: { noteId: import("drizzle-orm/pg-core").PgColumn<{ name: "note_id"; tableName: "note_shares"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: fa…`
- **noteStars** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_stars"; schema: undefined; columns: { noteId: import("drizzle-orm/pg-core").PgColumn<{ name: "note_id"; tableName: "note_stars"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: fals…`
- **noteUpdates** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_updates"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_updates"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **noteVersions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_versions"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_versions"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **notes** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "notes"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "notes"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: fal…`
- **notesSettings** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "notes_settings"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "notes_settings"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDe…`
- **taskBlocks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "task_blocks"; schema: undefined; columns: { taskId: import("drizzle-orm/pg-core").PgColumn<{ name: "task_id"; tableName: "task_blocks"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: fa…`
- **taskMoves** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "task_moves"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "task_moves"; dataType: "number"; columnType: "PgBigSerial53"; data: number; driverParam: number; notNull: true; hasDefault: true; …`

## packages/notes/src/sheet.ts

- **FileLink** (type) `type FileLink = { kind: "doc" | "sheet" | "slides" | "drive" | "dropbox" | "onedrive"; label: string; };`
- **SHEET_FIELDS** (const) `readonly ["title", "column", "owner", "due", "labels", "blocked by", "link"]`
- **SheetField** (type) `type SheetField = (typeof SHEET_FIELDS)[number];`
- **cardIdIn** (function) `(link: string | undefined): string | null`
- **cellOf** (function) `(v: string | undefined): string`
- **fileLinkOf** (function) `(href: string): FileLink | null`
- **guessMap** (function) `(headers: readonly string[]): (SheetField | null)[]`
- **mapRows** (function) `(table: readonly (readonly string[])[], map: readonly (SheetField | null)[], header = true): SheetRow[]`
- **parseTable** (function) `(text: string): string[][]`
- **toCsv** (function) `(rows: readonly (readonly string[])[]): string`

## packages/notes/src/store.ts

- **Changed** (interface) `interface Changed { note: Note; update: Uint8Array | null; version: number; }`
- **ListOpts** (interface) `interface ListOpts { view: ListView; q?: string | null; limit?: number; sharedTo?: readonly string[]; everything?: boolean; parentId?: string | null; tasks?: boolean; }`
- **ListView** (type) `type ListView = "recent" | "mine" | "shared" | "starred" | "archived" | "all";`
- **NotASuggestion** (class) `constructor()`
- **NoteRow** (interface) `interface NoteRow { id: string; title: string; kind: NoteKind; owner: string; via: Via; general: General; generalRole: ShareRole; parentId: string | null; createdAt: Date; updatedAt: Date; editedBy: string | null; archivedAt: Date | null; starred: boolean; seenAt: Date | null; excerpt: string; text: string; rank: number; }`
- **addComment** (function) `(db: Db, c: NewComment): Promise<NoteComment>`
- **appendNote** (function) `(db: Db, id: string, by: string, body: NoteJson): Promise<Changed>`
- **backlinks** (function) `(db: Queryable, r: Omit<Reader, "cap">, target: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"note_links", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "notes"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasR…`
- **changeNote** (function) `(db: Db, id: string, by: string, fn: (doc: Y.Doc) => void, opts: ChangeOpts = {}): Promise<Changed>`
- **childrenOf** (function) `(db: Queryable, r: Omit<Reader, "cap">, id: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"notes", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "notes"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntim…`
- **commentById** (function) `(db: Queryable, noteId: string, id: string): Promise<NoteComment | null>`
- **commentsOf** (function) `(db: Queryable, id: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"note_comments", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_comments"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: …`
- **createNote** (function) `(db: Queryable, o: NewNote): Promise<Note>`
- **deleteComment** (function) `(db: Queryable, id: string): Omit<import("drizzle-orm/pg-core").PgDeleteBase<import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_comments"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_comments"; dataType: "string"; columnType: "PgUUID"; data: string; driverP…`
- **dumpOf** (function) `(db: Db, email: string): Promise<Note>`
- **editComment** (function) `(db: Db, c: NoteComment, body: string, mentions: readonly string[]): Promise<NoteComment>`
- **isNoteId** (function) `(s: unknown): s is string`
- **listNotes** (function) `(db: Queryable, r: Omit<Reader, "cap">, o: ListOpts): Promise<NoteRow[]>`
- **mentionsOf** (function) `(db: Queryable, r: Omit<Reader, "cap">, limit = 50): Omit<import("drizzle-orm/pg-core").PgSelectBase<"note_mentions", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_mentions"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: …`
- **move** (function) `(db: Db, id: string, parentId: string | null): Promise<void>`
- **nameVersion** (function) `(db: Db, id: string, number: number, name: string | null): Promise<{ id: number; noteId: string; number: number; kind: "auto" | "restore" | "import" | "named"; name: string | null; title: string; body: NoteJson; text: string; authors: string[]; startedAt: Date; at: Date; restoredFrom: number | null; }>`
- **noteById** (function) `(db: Queryable, id: string): Promise<Note | null>`
- **readMentions** (function) `(db: Queryable, ids: readonly string[], email: string, read = true): Promise<string[]>`
- **renameNote** (function) `(db: Db, id: string, by: string, title: string): Promise<Changed>`
- **resolveComment** (function) `(db: Queryable, id: string, by: string | null): Omit<import("drizzle-orm/pg-core").PgUpdateBase<import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "note_comments"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_comments"; dataType: "string"; columnType: "PgUUID"; data: string; driverP…`
- **restoreVersion** (function) `(db: Db, id: string, number: number, by: string): Promise<Changed>`
- **roleOn** (function) `(db: Queryable, note: Note, r: Omit<Reader, "cap">): Promise<Role | null>`
- **seen** (function) `(db: Queryable, id: string, email: string): Promise<void>`
- **setArchived** (function) `(db: Queryable, id: string, on: boolean): Promise<void>`
- **setGeneral** (function) `(db: Queryable, id: string, general: General, role: ShareRole): Promise<void>`
- **setTrain** (function) `(db: Queryable, id: string, on: boolean): Promise<void>`
- **setWorkspaceTrain** (function) `(db: Queryable, on: boolean, by: string): Promise<void>`
- **settingsOf** (function) `(db: Queryable): Promise<{ train: boolean }>`
- **share** (function) `(db: Queryable, id: string, who: string, role: ShareRole | null, by: string): Promise<void>`
- **sharesOf** (function) `(db: Queryable, id: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"note_shares", { noteId: import("drizzle-orm/pg-core").PgColumn<{ name: "note_id"; tableName: "note_shares"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincre…`
- **star** (function) `(db: Queryable, id: string, email: string, on: boolean): Promise<void>`
- **syncNote** (function) `(db: Db, id: string, by: string, update: Uint8Array | null, sv: Uint8Array | null, o: { suggestOnly?: boolean } = {}): Promise<{ note: Note; missing: Uint8Array; sv: Uint8Array; version: number; changed: boolean; }>`
- **trainingNotes** (function) `(db: Queryable): Promise<{ note: { id: string; parentId: string | null; kind: "note" | "dump" | "task"; title: string; body: NoteJson; text: string; search: string | null; yState: Uint8Array<ArrayBufferLike> | null; owner: string; createdBy: string; via: "person" | "agent"; general: "private" | "workspace"; generalR…`
- **transfer** (function) `(db: Db, id: string, to: string, by: string): Promise<void>`
- **unseenMentions** (function) `(db: Queryable, r: Omit<Reader, "cap">): Promise<number>`
- **versionRange** (function) `(db: Queryable, id: string, from: number, to: number): Omit<import("drizzle-orm/pg-core").PgSelectBase<"note_versions", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "note_versions"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement…`
- **versionsOf** (function) `(db: Queryable, id: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"note_versions", { number: import("drizzle-orm/pg-core").PgColumn<{ name: "number"; tableName: "note_versions"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: fal…`
- **visible** (function) `(r: Omit<Reader, "cap">): SQL`

## packages/notes/src/suggest.ts

- **onlySuggests** (function) `(before: NoteJson, after: NoteJson, by: string): boolean`
- **withoutSuggestionsBy** (function) `(json: NoteJson, by: string): NoteJson`

## packages/notes/src/task-records.ts

- **taskRecord** (const) `RecordType`
- **taskRecordFor** (function) `(client: string | null): RecordType`

## packages/notes/src/tasks.ts

- **LABELS_MAX** (const) `12`
- **LABEL_MAX** (const) `30`
- **Moved** (interface) `interface Moved { task: TaskRow; moved: boolean; redirected: BoardColumn | null; }`
- **TaskRef** (interface) `interface TaskRef { id: string; title: string; text: string; columnId: string | null; boardId: string | null; closedAt: Date | null; }`
- **TaskRow** (interface) `interface TaskRow { id: string; title: string; text: string; boardId: string; columnId: string; position: string; owner: string; via: Via; assignee: string | null; due: string | null; closedAt: Date | null; archivedAt: Date | null; createdAt: Date; updatedAt: Date; labels: string[]; blocked: number; blocks: number; comments: number; clients: { id: string; name: string }[]; version: number; }`
- **assignTask** (function) `(db: Db, id: string, who: unknown, o: { by: string; why?: string | null }): Promise<TaskRow>`
- **assigneeOf** (function) `(raw: unknown): string | null`
- **blockTask** (function) `(db: Queryable, id: string, blockedBy: string, by: string): Promise<void>`
- **blockersOf** (function) `(db: Queryable, id: string): Promise<TaskRef[]>`
- **blockingOf** (function) `(db: Queryable, id: string): Promise<TaskRef[]>`
- **closeTask** (function) `(db: Db, id: string, o: { by: string; why?: string | null }): Promise<Moved>`
- **columnOf** (function) `(board: Pick<Board, "columns">, ref: string): BoardColumn | null`
- **createTask** (function) `(db: Db, o: NewTask): Promise<Note>`
- **dueOf** (function) `(raw: unknown): string | null`
- **labelsOf** (function) `(raw: unknown): string[]`
- **listTasks** (function) `(db: Queryable, f: TaskFilter = {}): Promise<TaskRow[]>`
- **moveTask** (function) `(db: Db, id: string, o: MoveOpts): Promise<Moved>`
- **moveToBoard** (function) `(db: Db, id: string, boardId: string, o: { by: string; column?: string }): Promise<TaskRow>`
- **movesOf** (function) `(db: Queryable, id: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"task_moves", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "task_moves"; dataType: "number"; columnType: "PgBigSerial53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement:…`
- **needsYou** (function) `(db: Queryable, email: string, today: string): Promise<number>`
- **readyTasks** (function) `(db: Queryable, me: string, o: { board?: string; limit?: number } = {}): Promise<TaskRow[]>`
- **reopenTask** (function) `(db: Db, id: string, o: { by: string; why?: string | null; column?: string }): Promise<Moved>`
- **setDue** (function) `(db: Queryable, id: string, due: unknown): Promise<TaskRow>`
- **setLabels** (function) `(db: Queryable, id: string, raw: unknown): Promise<TaskRow>`
- **taskById** (function) `(db: Queryable, id: string): Promise<TaskRow | null>`
- **unblockTask** (function) `(db: Queryable, id: string, blockedBy: string): Promise<void>`

## packages/notes/src/train.ts

- **NoteLine** (interface) `interface NoteLine { schema: "wren.note/1"; workspace: string; id: string; title: string; text: string; via: "person" | "agent"; createdAt: string; updatedAt: string; versions: { number: number; kind: string; name: string | null; at: string; authors: string[]; text: string; }[]; }`
- **noteLines** (function) `(db: Queryable, workspace: string, people = false): Promise<NoteLine[]>`

## packages/notes/src/types.ts

- **AGENT** (const) `"agent:"`
- **BoardColumn** (interface) `interface BoardColumn { id: string; name: string; done: boolean; }`
- **COMMENT_MAX** (const) `10000`
- **CommentAnchor** (interface) `interface CommentAnchor { from: unknown; to: unknown; }`
- **DEFAULT_BOARD** (const) `"Work"`
- **DEFAULT_COLUMNS** (const) `readonly BoardColumn[]`
- **EMPTY** (const) `NoteJson`
- **GENERAL** (const) `readonly ["private", "workspace"]`
- **General** (type) `type General = (typeof GENERAL)[number];`
- **KINDS** (const) `readonly ["note", "dump", "task"]`
- **MOVE_KINDS** (const) `readonly ["create", "move", "assign", "close", "reopen"]`
- **MoveKind** (type) `type MoveKind = (typeof MOVE_KINDS)[number];`
- **NoteJson** (interface) `interface NoteJson { type: string; attrs?: Record<string, unknown>; content?: NoteJson[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[]; }`
- **NoteKind** (type) `type NoteKind = (typeof KINDS)[number];`
- **QUOTE_MAX** (const) `500`
- **ROLES** (const) `readonly ["view", "comment", "edit"]`
- **Role** (type) `type Role = ShareRole | "owner";`
- **SUGGEST_ADD** (const) `"suggestAdd"`
- **SUGGEST_DEL** (const) `"suggestDel"`
- **ShareRole** (type) `type ShareRole = (typeof ROLES)[number];`
- **UPDATE_MAX** (const) `number`
- **VERSION_KINDS** (const) `readonly ["auto", "named", "restore", "import"]`
- **VIA** (const) `readonly ["person", "agent"]`
- **VersionKind** (type) `type VersionKind = (typeof VERSION_KINDS)[number];`
- **Via** (type) `type Via = (typeof VIA)[number];`
- **Y_BODY** (const) `"default"`
- **Y_TITLE** (const) `"title"`
- **isAgent** (function) `(who: string | null | undefined): boolean`
- **moveWords** (function) `(m: { kind: MoveKind; to: string | null; assignee: string | null; why: string | null }, nameOfPerson: (who: string) => string = (w) => w): string`
- **ownerName** (function) `(who: string | null | undefined, first = false): string`
