/** The notes console's context, built once: where a request reads from, who is reading, and the helpers every handler group shares. */
import type * as restate from "@restatedev/restate-sdk";
import { WREN } from "@wren/core/access";
import { type Client, clientMembers, operators } from "@wren/core/clients";
import {
  accessOf,
  canAt,
  isDemo,
  isOperator,
  lookingOnly,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  viewingAs,
  whoIs,
} from "@wren/core/portal";
import { fenceFor, meOf, type RecordsApi, serveRecords } from "@wren/core/records/serve";
import { type Db, snapshot } from "@wren/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { atLeast, effectiveRole, type Reader } from "./access.js";
import { boardsApi } from "./console-boards.js";
import { nameOf } from "./doc.js";
import type { NoteDrive } from "./drive.js";
import { mailMentions, type SendMention } from "./mention-mail.js";
import { noteStars } from "./schema.js";
import { isNoteId, type NoteRow, noteById, readMentions, roleOn, sharesOf } from "./store.js";
import { taskRecordFor } from "./task-records.js";
import type { Role, ShareRole } from "./types.js";

/** Where note images go: a signed PUT up, a signed GET down. `@wren/delivery`'s store fits. */
export interface NoteFiles {
  putUrl(key: string, type: string, size: number): Promise<string>;
  getUrl(key: string): Promise<string>;
}

export interface NotesDeps {
  main: Db;
  /** A client's own database. */
  open: (client: Client) => Db;
  files?: NoteFiles | undefined;
  /** Capture stamps' clock. */
  zone?: string;
  /** Google Drive, for import; left out, the import says it's off here. */
  drive?: NoteDrive | undefined;
  /** Mail for a mention, with the portal's origin for its link; left out, mentions stay in the app. */
  mail?: { send: SendMention; portal: string } | undefined;
  /** Selected words made real elsewhere; each left out says it's off here. */
  turns?: NoteTurns | undefined;
  /** The model, for Turn into cards; left out or null, it says it's off here. */
  write?: ((prompt: string) => Promise<string>) | null | undefined;
}

/** Where selected words go: Marketing's drafts, an SOP. The worker wires them; notes can't import them. */
export interface NoteTurns {
  /** Drafts from the words, into the workspace's To approve. Started, not awaited; refuses with why. */
  draft(
    ctx: restate.Context,
    o: { client: string | null; text: string; by: string },
  ): Promise<void>;
  /** The words into an SOP: asked (Wren's, for the Mac) or added (a client's, into its Notes). */
  sop(o: {
    client: string;
    db: Db;
    noteId: string;
    sop: string;
    title: string;
    text: string;
    by: string;
  }): Promise<{ sop: string; state: "asked" | "added"; note: string | null }>;
}

interface Place {
  /** `wren`, or the client's id. */
  ws: string;
  db: Db;
  client: Client | null;
}

export type Req<T = object> = PortalRequest & T;

export const str = (v: unknown, max: number, what: string): string => {
  if (typeof v !== "string") throw new PortalRefusal(`${what} is missing`, 400);
  if (v.length > max) throw new PortalRefusal(`${what} is too long`, 400);
  return v;
};

export const idOf = (v: unknown): string => {
  if (!isNoteId(v)) throw new PortalRefusal("no such note", 404);
  return v;
};

export const numOf = (v: unknown, what: string): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new PortalRefusal(`no such ${what}`, 404);
  return n;
};

export const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/** `@someone@firm.com` in a comment's words. */
const AT_EMAIL = /(?:^|[^\w.@])@([^\s@]+@[^\s@]+\.[\w-]+)/g;

export function notesApiContext(deps: NotesDeps) {
  const { main } = deps;
  const placeOf = async (req: PortalRequest): Promise<Place> => {
    const named = typeof req.client === "string" && req.client && req.client !== WREN;
    if (!named && isOperator(req.viewer)) return { ws: WREN, db: main, client: null };
    const c = await pickClient(main, req);
    return { ws: c.id, db: deps.open(c), client: c };
  };
  /** Who's asking, as notes sees them. View as sees what the workspace shares, never private notes. */
  const readerOf = async (req: PortalRequest, place: Place): Promise<Reader> => {
    const at = { client: place.ws, app: "notes" };
    const cap: ShareRole | null = (await canAt(main, req, "act", at))
      ? "edit"
      : (await canAt(main, req, "comment", at))
        ? "comment"
        : (await canAt(main, req, "read", at))
          ? "view"
          : null;
    const v = req.viewer;
    if (isDemo(v)) return { email: "", team: false, inWorkspace: true, client: place.ws, cap };
    const team = isOperator(v);
    const viewing = viewingAs(req);
    return {
      email: viewing ? "" : v.email.toLowerCase(),
      team,
      inWorkspace: place.ws === WREN ? team : true,
      client: place.client?.id ?? null,
      cap,
    };
  };
  /** Mark the signed-in person's own mentions read or unread: `{done, skipped}` as actions answer. */
  const markMentions = async (req: PortalRequest & { ids?: unknown }, read: boolean) => {
    const by = byOf(req);
    const ids = z.array(z.uuid()).max(200).safeParse(req.ids);
    if (!ids.success) throw new PortalRefusal("say which mentions", 400);
    const place = await placeOf(req);
    const done = await readMentions(place.db, ids.data, by, read);
    // A client's people are also `@`ed in Wren's notes shared to their client.
    if (place.ws !== WREN && !isOperator(req.viewer))
      done.push(...(await readMentions(main, ids.data, by, read)));
    return { done, skipped: ids.data.filter((id) => !done.includes(id)) };
  };
  /** The person a change is by: never the demo, never under View as. */
  const byOf = (req: PortalRequest): string => {
    if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
    if (lookingOnly(req)) throw new PortalRefusal("Look reads only", 403);
    return req.viewer.email.toLowerCase();
  };
  /**
   * The note and the viewer's role on it, refused below `need`. A client's people also reach a
   * Wren note shared to their client: it's read from main.
   */
  const locate = async (req: PortalRequest, rawId: unknown, need: Role) => {
    const id = idOf(rawId);
    const place = await placeOf(req);
    const reader = await readerOf(req, place);
    let db = place.db;
    let note = await noteById(db, id);
    let home = place.ws;
    let as: Omit<Reader, "cap"> = reader;
    if (!note && place.ws !== WREN) {
      const n = await noteById(main, id);
      if (n) {
        note = n;
        db = main;
        home = WREN;
        as = { ...reader, team: false, inWorkspace: false };
      }
    }
    if (!note) throw new PortalRefusal("no such note", 404);
    const own = await roleOn(db, note, as);
    const role = effectiveRole(own, reader.cap);
    if (!role) throw new PortalRefusal("no such note", 404);
    if (!atLeast(role, need))
      throw new PortalRefusal(
        need === "owner" ? "only its owner can do that" : "you can't edit this note",
        403,
      );
    return { place, reader, db, note, role, home, as };
  };
  const rowOut = (r: NoteRow, me: string, home: string) => ({
    id: r.id,
    name: nameOf(r.title, r.text),
    title: r.title,
    kind: r.kind,
    owner: r.owner,
    mine: r.owner.toLowerCase() === me,
    via: r.via,
    general: r.general,
    parentId: r.parentId,
    starred: r.starred,
    createdAt: iso(r.createdAt) as string,
    updatedAt: iso(r.updatedAt) as string,
    editedBy: r.editedBy,
    seenAt: iso(r.seenAt),
    archived: r.archivedAt !== null,
    excerpt: r.excerpt.replace(/\s+/g, " ").trim(),
    home,
  });
  /** The workspace's people: who a note can be shared with, and who `@` finds. */
  const peopleOf = async (place: Place) => {
    const team = await main
      .select({ email: operators.email, clients: operators.clients })
      .from(operators)
      .orderBy(asc(operators.email));
    const inScope = (c: readonly string[] | null) =>
      c === null || c.includes(place.ws) || (place.ws === WREN && c.includes(WREN));
    const out = team
      .filter((t) => place.ws === WREN || inScope(t.clients))
      .map((t) => ({ email: t.email.toLowerCase(), team: true }));
    if (place.client) {
      const members = await main
        .select({ email: clientMembers.email })
        .from(clientMembers)
        .where(eq(clientMembers.clientId, place.client.id))
        .orderBy(asc(clientMembers.email));
      out.push(...members.map((m) => ({ email: m.email.toLowerCase(), team: false })));
    }
    return out;
  };
  /**
   * Mail whoever a change just `@`ed, in the note's own workspace: Wren's when it lives there. A
   * failed mail never fails the change; the mention waits for the next one.
   */
  const tell = async (home: string, place: Place) => {
    if (!deps.mail) return;
    const at: Place = home === WREN ? { ws: WREN, db: main, client: null } : place;
    let people: Awaited<ReturnType<typeof peopleOf>> | null = null;
    await mailMentions(at.db, {
      send: deps.mail.send,
      portal: deps.mail.portal,
      client: at.client?.id ?? null,
      readerOf: async (email) => {
        people ??= await peopleOf(at);
        const p = people.find((x) => x.email === email.toLowerCase());
        if (!p) return null;
        return {
          email: p.email,
          team: p.team,
          inWorkspace: at.ws === WREN ? p.team : true,
          client: at.client?.id ?? null,
        };
      },
    }).catch((e: unknown) => console.warn(`mention mail: ${(e as Error).message}`));
  };
  const sharesOut = async (db: Db, id: string) =>
    (await sharesOf(db, id)).map((s) => ({ who: s.who, role: s.role, by: s.by, at: iso(s.at) }));
  const boards = boardsApi({ main, placeOf, readerOf, byOf, locate, write: deps.write ?? null });
  /** The cards as records, over this workspace's database, for the Board's List. */
  const cardRecords = async <T>(req: PortalRequest, use: (api: RecordsApi) => Promise<T>) => {
    const place = await placeOf(req);
    const type = taskRecordFor(place.client?.id ?? null);
    return snapshot(place.db, (tx) =>
      use(serveRecords([type], tx, undefined, fenceFor(req, place.ws), meOf(req))),
    );
  };
  /** The workspace's people a comment `@`s. */
  async function mentioned(place: Place, body: string): Promise<string[]> {
    const named = new Set([...body.matchAll(AT_EMAIL)].map((m) => (m[1] ?? "").toLowerCase()));
    if (!named.size) return [];
    return (await peopleOf(place)).filter((p) => named.has(p.email)).map((p) => p.email);
  }
  async function whoAt(req: PortalRequest, place: Place) {
    const v = req.viewer;
    if (!isDemo(v) && !v.access && !v.operator)
      return whoIs(main, v, place.ws === WREN ? undefined : place.ws);
    return accessOf(req);
  }
  async function isStarred(db: Db, id: string, email: string) {
    if (!email) return false;
    const rows = await db
      .select({ at: noteStars.at })
      .from(noteStars)
      .where(and(eq(noteStars.noteId, id), eq(noteStars.email, email)));
    return rows.length > 0;
  }
  return {
    deps,
    main,
    placeOf,
    readerOf,
    markMentions,
    byOf,
    locate,
    rowOut,
    peopleOf,
    tell,
    sharesOut,
    boards,
    cardRecords,
    mentioned,
    whoAt,
    isStarred,
  };
}

export type NotesApiContext = ReturnType<typeof notesApiContext>;
