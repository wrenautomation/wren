/**
 * NotesConsole: Notes in the portal (designs/2026-10-07-notes.md). The workspace is Wren's for a
 * team login naming no client, else the named client's (its own database). Every route checks
 * the note's own role on top of the guard's app check: owner, a share, or the workspace's access,
 * held to what the login may do in Notes there.
 */
import type * as restate from "@restatedev/restate-sdk";
import { can, WREN } from "@wren/core/access";
import { type Client, clientMembers, clients, operators } from "@wren/core/clients";
import {
  accessOf,
  answer,
  canAt,
  isDemo,
  isOperator,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  portalService,
  whoIs,
} from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { atLeast, clientWho, effectiveRole, isShareRole, type Reader, TEAM } from "./access.js";
import { NOTES_CONSOLE_APPS, NOTES_CONSOLE_ROUTES } from "./console-routes.js";
import { blame, counts } from "./diff.js";
import {
  appendBody,
  captureBlock,
  cleanBody,
  fromB64,
  fromMarkdown,
  nameOf,
  toB64,
} from "./doc.js";
import { driveIdOf, type NoteDrive } from "./drive.js";
import { inboxMentionsOf, unseenInboxMentions } from "./inbox.js";
import { mailMentions, type SendMention } from "./mention-mail.js";
import { type Note, type NoteComment, noteStars } from "./schema.js";
import {
  addComment,
  appendNote,
  backlinks,
  changeNote,
  childrenOf,
  commentById,
  commentsOf,
  createNote,
  deleteComment,
  dumpOf,
  editComment,
  isNoteId,
  type ListView,
  listNotes,
  mentionsOf,
  move,
  NotASuggestion,
  type NoteRow,
  nameVersion,
  noteById,
  readMentions,
  renameNote,
  resolveComment,
  restoreVersion,
  roleOn,
  seen,
  setArchived,
  setGeneral,
  setTrain,
  settingsOf,
  setWorkspaceTrain,
  share,
  sharesOf,
  star,
  syncNote,
  transfer,
  unseenMentions,
  versionRange,
  versionsOf,
} from "./store.js";
import {
  COMMENT_MAX,
  type CommentAnchor,
  type General,
  isAgent,
  QUOTE_MAX,
  type Role,
  type ShareRole,
  UPDATE_MAX,
} from "./types.js";

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

/** An image a note takes, by type. */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};
export const IMAGE_MAX = 20 * 1024 * 1024;
/** Biggest body an import appends, as JSON: images go up on their own. */
const BODY_MAX = 4_000_000;
/** How an image's `src` names a stored file. */
export const FILE_SRC = "wren-file:";

const VIEWS: readonly ListView[] = ["recent", "mine", "shared", "starred", "archived", "all"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Place {
  /** `wren`, or the client's id. */
  ws: string;
  db: Db;
  client: Client | null;
}

type Req<T = object> = PortalRequest & T;
const str = (v: unknown, max: number, what: string): string => {
  if (typeof v !== "string") throw new PortalRefusal(`${what} is missing`, 400);
  if (v.length > max) throw new PortalRefusal(`${what} is too long`, 400);
  return v;
};
const idOf = (v: unknown): string => {
  if (!isNoteId(v)) throw new PortalRefusal("no such note", 404);
  return v;
};
const numOf = (v: unknown, what: string): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new PortalRefusal(`no such ${what}`, 404);
  return n;
};
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
/** `@someone@firm.com` in a comment's words. */
const AT_EMAIL = /(?:^|[^\w.@])@([^\s@]+@[^\s@]+\.[\w-]+)/g;
const anchorOf = (v: unknown): CommentAnchor | null => {
  if (!v || typeof v !== "object") return null;
  const a = v as { from?: unknown; to?: unknown };
  if (!a.from || !a.to || typeof a.from !== "object" || typeof a.to !== "object") return null;
  if (JSON.stringify(a).length > 2000) throw new PortalRefusal("that range is too long", 400);
  return { from: a.from, to: a.to };
};
const commentOut = (c: NoteComment, me: string) => ({
  id: c.id,
  parentId: c.parentId,
  anchor: c.anchor,
  quote: c.quote,
  body: c.body,
  mentions: c.mentions,
  by: c.by,
  mine: c.by === me,
  at: iso(c.at) as string,
  editedAt: iso(c.editedAt),
  resolvedAt: iso(c.resolvedAt),
  resolvedBy: c.resolvedBy,
});

export function notesApi(deps: NotesDeps) {
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
    const viewing = typeof req.viewAs === "string" && req.viewAs !== "";
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
    if (typeof req.viewAs === "string" && req.viewAs)
      throw new PortalRefusal("View as is read-only", 403);
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

  return {
    /** Notes' home: a view (Recent, Mine, Shared with me, Starred, Archived) or a search. */
    async home(req: Req<{ view?: unknown; q?: unknown; limit?: unknown; parentId?: unknown }>) {
      const place = await placeOf(req);
      const reader = await readerOf(req, place);
      const view = VIEWS.includes(req.view as ListView) ? (req.view as ListView) : "recent";
      const q = typeof req.q === "string" ? req.q.slice(0, 200) : null;
      const limit = Number(req.limit) || 100;
      const rows = (
        await listNotes(place.db, reader, {
          view,
          q,
          limit,
          ...(isNoteId(req.parentId) ? { parentId: req.parentId } : {}),
        })
      ).map((r) => rowOut(r, reader.email, place.ws));
      // A client's people also see Wren's notes shared to their client.
      if (place.ws !== WREN && !reader.team && view !== "mine" && view !== "archived") {
        const wren = await listNotes(
          main,
          { ...reader, team: false, inWorkspace: false },
          { view: view === "recent" ? "all" : view, q, limit, sharedTo: [clientWho(place.ws)] },
        );
        rows.push(...wren.map((r) => rowOut(r, reader.email, WREN)));
        if (!q) rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }
      return {
        notes: rows,
        me: reader.email,
        workspace: place.ws,
        canWrite: reader.cap === "edit" && !!reader.email,
        canManage:
          !isDemo(req.viewer) && can(await whoAt(req, place), "manage", { client: place.ws }),
        train: (await settingsOf(place.db)).train,
      };
    },

    /** One note: its doc, what the viewer may do, sharing (for its owner), parent and children. */
    async open(req: Req<{ id?: unknown }>) {
      const { db, note, role, home, as, reader } = await locate(req, req.id, "view");
      if (reader.email) await seen(db, note.id, reader.email);
      const versions = await versionsOf(db, note.id);
      const parent = note.parentId ? await noteById(db, note.parentId) : null;
      const kids = await childrenOf(db, as, note.id);
      const starred = await isStarred(db, note.id, reader.email);
      return {
        ...noteOut(note),
        role,
        home,
        /** Who's reading: their cursor and suggestions carry it. */
        me: reader.email,
        starred,
        state: toB64(note.yState ?? new Uint8Array([0, 0])),
        version: versions[0]?.number ?? 0,
        versions: versions.length,
        parent: parent ? { id: parent.id, name: nameOf(parent.title, parent.text) } : null,
        children: kids.map((k) => ({ id: k.id, name: nameOf(k.title, k.text) })),
        shares: role === "owner" ? await sharesOut(db, note.id) : [],
      };
    },

    /**
     * The browser's sync: its update in (when it may edit), what it lacks out. `sv` is its Yjs
     * state vector; none answers the whole doc.
     */
    async sync(req: Req<{ id?: unknown; update?: unknown; sv?: unknown }>) {
      const { db, note, role, home, place } = await locate(req, req.id, "view");
      const upd = typeof req.update === "string" && req.update ? req.update : null;
      if (upd && upd.length > UPDATE_MAX) throw new PortalRefusal("that change is too big", 400);
      const update = upd ? fromB64(upd) : null;
      const editing = !!update && update.length > 2;
      if (editing) {
        byOf(req);
        if (!atLeast(role, "comment")) throw new PortalRefusal("you can't edit this note", 403);
      }
      const sv = typeof req.sv === "string" && req.sv ? fromB64(req.sv) : null;
      // A commenter's change is taken when it only suggests (`suggest.ts`).
      const out = await syncNote(
        db,
        note.id,
        editing ? byOf(req) : "",
        editing ? update : null,
        sv,
        {
          suggestOnly: !atLeast(role, "edit"),
        },
      ).catch((err: unknown) => {
        if (err instanceof NotASuggestion) throw new PortalRefusal(err.message, 403);
        throw err;
      });
      if (out.changed) await tell(home, place);
      return {
        update: toB64(out.missing),
        sv: toB64(out.sv),
        version: out.version,
        changed: out.changed,
        title: out.note.title,
        name: nameOf(out.note.title, out.note.text),
        updatedAt: iso(out.note.updatedAt),
        editedBy: out.note.editedBy,
        /** Theirs now: the live room checks it on every poll. */
        role,
      };
    },

    /** The timeline, newest first, with words added and removed in each. */
    async versions(req: Req<{ id?: unknown }>) {
      const { db, note } = await locate(req, req.id, "view");
      const list = await versionsOf(db, note.id);
      const newest = list.slice(0, 100);
      const texts = newest.length
        ? await versionRange(db, note.id, newest.at(-1)?.number ?? 1, newest[0]?.number ?? 1)
        : [];
      const before = (n: number) => texts.find((t) => t.number === n - 1)?.text ?? "";
      return {
        versions: list.map((v) => {
          const t = texts.find((x) => x.number === v.number);
          const c = t && v.number > 1 ? counts(blame(before(v.number), [t])) : null;
          return {
            number: v.number,
            kind: v.kind,
            name: v.name,
            title: v.title,
            authors: v.authors,
            startedAt: iso(v.startedAt) as string,
            at: iso(v.at) as string,
            restoredFrom: v.restoredFrom,
            added:
              c?.added ?? (v.number === 1 ? (t?.text.match(/[\p{L}\p{N}]+/gu) ?? []).length : null),
            removed: c?.removed ?? 0,
          };
        }),
      };
    },

    /** One version's doc. */
    async version(req: Req<{ id?: unknown; number?: unknown }>) {
      const { db, note } = await locate(req, req.id, "view");
      const n = numOf(req.number, "version");
      const [v] = await versionRange(db, note.id, n, n);
      if (!v) throw new PortalRefusal("no such version", 404);
      return {
        number: v.number,
        kind: v.kind,
        name: v.name,
        title: v.title,
        body: v.body,
        text: v.text,
        authors: v.authors,
        at: iso(v.at) as string,
      };
    },

    /** Two versions word by word, each change credited to the version (and its author) that made it. */
    async compare(req: Req<{ id?: unknown; from?: unknown; to?: unknown }>) {
      const { db, note } = await locate(req, req.id, "view");
      let from = numOf(req.from, "version");
      let to = numOf(req.to, "version");
      if (from > to) [from, to] = [to, from];
      if (to - from > 500) throw new PortalRefusal("compare up to 500 versions apart", 400);
      const range = await versionRange(db, note.id, from, to);
      const base = range.find((v) => v.number === from);
      if (!base || !range.some((v) => v.number === to))
        throw new PortalRefusal("no such version", 404);
      const steps = range.filter((v) => v.number > from);
      const pieces = blame(base.text, steps);
      return {
        from,
        to,
        pieces,
        authors: Object.fromEntries(range.map((v) => [v.number, v.authors])),
        ...counts(pieces),
      };
    },

    /** Notes that link to a record (`<type>:<id>`), a note or a person, that the viewer may open. */
    async backlinks(req: Req<{ target?: unknown }>) {
      const target = str(req.target, 300, "the record");
      if (!/^[\w.-]+:.+$/.test(target)) throw new PortalRefusal("no such record", 404);
      const place = await placeOf(req);
      const reader = await readerOf(req, place);
      const rows = await backlinks(place.db, reader, target);
      return {
        notes: rows.map((r) => ({
          id: r.id,
          name: nameOf(r.title, r.text),
          excerpt: r.text.replace(/\s+/g, " ").slice(0, 200),
          owner: r.owner,
          updatedAt: iso(r.updatedAt) as string,
        })),
      };
    },

    /**
     * Who's in this workspace: for sharing and `@`. With a note, whether each can open it: a
     * mention never shares, so the menu says when they can't.
     */
    async people(req: Req<{ id?: unknown }>) {
      const at = req.id ? await locate(req, req.id, "view") : null;
      const place = at?.place ?? (await placeOf(req));
      // At Wren, the team can share a note with a client's people: which clients there are.
      const toClients =
        place.ws === WREN && isOperator(req.viewer)
          ? await main
              .select({ id: clients.id, name: clients.name })
              .from(clients)
              .orderBy(asc(clients.name))
          : [];
      const people = await peopleOf(place);
      const opens = async (p: { email: string; team: boolean }) => {
        if (!at) return true;
        const inWs = at.home === WREN ? p.team : at.home === place.ws;
        const own = await roleOn(at.db, at.note, {
          email: p.email,
          team: p.team,
          inWorkspace: inWs,
          client: place.client?.id ?? null,
        });
        return own !== null;
      };
      return {
        people: await Promise.all(people.map(async (p) => ({ ...p, opens: await opens(p) }))),
        workspace: place.ws,
        client: place.client?.name ?? null,
        clients: toClients,
      };
    },

    /** A signed link to one of a note's images, good for minutes. */
    async file(req: Req<{ id?: unknown; key?: unknown }>) {
      const { note, home } = await locate(req, req.id, "view");
      const key = str(req.key, 500, "the file");
      if (!key.startsWith(`notes/${home}/${note.id}/`))
        throw new PortalRefusal("no such file", 404);
      if (!deps.files) throw new PortalRefusal("files aren't set up here", 503);
      return { url: await deps.files.getUrl(key) };
    },

    async settings(req: PortalRequest) {
      const place = await placeOf(req);
      return { ...(await settingsOf(place.db)), drive: deps.drive?.who() ?? null };
    },

    /** The note's comment threads, each with its replies, oldest first. */
    async comments(req: Req<{ id?: unknown }>) {
      const { db, note, reader, role } = await locate(req, req.id, "view");
      const rows = await commentsOf(db, note.id);
      const me = reader.email;
      const threads = rows
        .filter((c) => !c.parentId)
        .map((c) => ({
          ...commentOut(c, me),
          replies: rows.filter((r) => r.parentId === c.id).map((r) => commentOut(r, me)),
        }));
      return { threads, canComment: atLeast(role, "comment") && !!me, owner: role === "owner" };
    },

    /** Where this person was `@`ed, and how many they haven't opened: the Notes tab's number. */
    async mentions(req: Req<{ limit?: unknown }>) {
      const place = await placeOf(req);
      const reader = await readerOf(req, place);
      if (!reader.email) return { mentions: [], unseen: 0 };
      const out = (rows: Awaited<ReturnType<typeof mentionsOf>>, home: string) =>
        rows.map((m) => ({
          id: m.id,
          noteId: m.noteId as string | null,
          name: nameOf(m.title, m.text),
          commentId: m.commentId,
          comment: m.comment,
          by: m.by,
          at: iso(m.at) as string,
          seen: m.seenAt !== null,
          home,
          thread: null as string | null,
        }));
      const limit = Number(req.limit) || 50;
      const mentions = out(await mentionsOf(place.db, reader, limit), place.ws);
      let unseen = await unseenMentions(place.db, reader);
      // A client's Inbox notes: its people and the team on it tag each other there. Wren's own
      // land in Inbox -> Mentions.
      if (place.ws !== WREN) {
        const inbox = await inboxMentionsOf(place.db, reader.email, limit);
        mentions.push(
          ...inbox.map((m) => ({
            id: m.id,
            noteId: null,
            name: "an Inbox thread",
            commentId: null,
            comment: m.text,
            by: m.by,
            at: iso(m.at) as string,
            seen: m.seenAt !== null,
            home: place.ws,
            thread: m.thread,
          })),
        );
        unseen += await unseenInboxMentions(place.db, reader.email);
        mentions.sort((a, b) => b.at.localeCompare(a.at));
      }
      // A client's people are also `@`ed in Wren's notes shared to their client.
      if (place.ws !== WREN && !reader.team) {
        const wr = { ...reader, team: false, inWorkspace: false };
        mentions.push(...out(await mentionsOf(main, wr, limit), WREN));
        unseen += await unseenMentions(main, wr);
        mentions.sort((a, b) => b.at.localeCompare(a.at));
      }
      return { mentions: mentions.slice(0, limit), unseen };
    },

    /**
     * Mark these mentions of the signed-in person read, here and, for a client's people, in
     * Wren's notes shared to them. Only their own: anyone else's id is skipped.
     */
    mentionsRead: (req: Req<{ ids?: unknown }>) => markMentions(req, true),
    /** Mark them unread again: Mark read's Undo. */
    mentionsUnread: (req: Req<{ ids?: unknown }>) => markMentions(req, false),

    /**
     * A new thread on a range, or a reply in one. `@email` in the words tells that person, if
     * they're in this workspace; it never shares the note.
     */
    async comment(
      req: Req<{
        id?: unknown;
        body?: unknown;
        parentId?: unknown;
        anchor?: unknown;
        quote?: unknown;
      }>,
    ) {
      const { db, note, place, reader, home } = await locate(req, req.id, "comment");
      const by = byOf(req);
      const body = str(req.body, COMMENT_MAX, "the comment").trim();
      if (!body) throw new PortalRefusal("write something", 400);
      let parentId: string | null = null;
      if (req.parentId !== undefined && req.parentId !== null) {
        const parent = await commentById(db, note.id, String(req.parentId));
        if (!parent || parent.parentId) throw new PortalRefusal("no such comment", 404);
        parentId = parent.id;
      }
      const anchor = parentId ? null : anchorOf(req.anchor);
      if (!parentId && !anchor) throw new PortalRefusal("select the words to comment on", 400);
      const c = await addComment(db, {
        noteId: note.id,
        by,
        body,
        parentId,
        anchor,
        quote: typeof req.quote === "string" ? req.quote.slice(0, QUOTE_MAX) : "",
        mentions: await mentioned(place, body),
      });
      await tell(home, place);
      return commentOut(c, reader.email);
    },

    /** Its author's new words. */
    async commentEdit(req: Req<{ id?: unknown; commentId?: unknown; body?: unknown }>) {
      const { db, note, place, reader, home } = await locate(req, req.id, "comment");
      const by = byOf(req);
      const c = await commentById(db, note.id, String(req.commentId ?? ""));
      if (!c) throw new PortalRefusal("no such comment", 404);
      if (c.by !== by) throw new PortalRefusal("only its author can change it", 403);
      const body = str(req.body, COMMENT_MAX, "the comment").trim();
      if (!body) throw new PortalRefusal("write something", 400);
      const edited = await editComment(db, c, body, await mentioned(place, body));
      await tell(home, place);
      return commentOut(edited, reader.email);
    },

    /** Gone, with its replies when it starts a thread: its author's, or the note owner's call. */
    async commentDelete(req: Req<{ id?: unknown; commentId?: unknown }>) {
      const { db, note, role } = await locate(req, req.id, "comment");
      const by = byOf(req);
      const c = await commentById(db, note.id, String(req.commentId ?? ""));
      if (!c) throw new PortalRefusal("no such comment", 404);
      if (c.by !== by && role !== "owner")
        throw new PortalRefusal("only its author or the note's owner can delete it", 403);
      await deleteComment(db, c.id);
      return { deleted: c.id };
    },

    /** Resolve a thread, or open it again. */
    async resolve(req: Req<{ id?: unknown; commentId?: unknown; on?: unknown }>) {
      const { db, note } = await locate(req, req.id, "comment");
      const by = byOf(req);
      const c = await commentById(db, note.id, String(req.commentId ?? ""));
      if (!c || c.parentId) throw new PortalRefusal("no such thread", 404);
      const on = req.on !== false;
      await resolveComment(db, c.id, on ? by : null);
      return { resolved: on };
    },

    /** Star or unstar, for this person only. */
    async star(req: Req<{ id?: unknown; on?: unknown }>) {
      const { db, note } = await locate(req, req.id, "view");
      await star(db, note.id, byOf(req), req.on !== false);
      return { starred: req.on !== false };
    },

    /** A new note, private to its author unless under a parent (it takes the parent's sharing). */
    async create(req: Req<{ title?: unknown; markdown?: unknown; parentId?: unknown }>) {
      const by = byOf(req);
      const place = await placeOf(req);
      const reader = await readerOf(req, place);
      if (reader.cap !== "edit") throw new PortalRefusal("your role can't do that", 403);
      if (req.parentId !== undefined && req.parentId !== null)
        await locate(req, req.parentId, "edit");
      const title = typeof req.title === "string" ? req.title.slice(0, 300) : "";
      const md = typeof req.markdown === "string" ? req.markdown.slice(0, 500_000) : "";
      const note = await createNote(place.db, {
        owner: by,
        by,
        title,
        ...(md ? { body: fromMarkdown(md) } : {}),
        parentId: isNoteId(req.parentId) ? req.parentId : null,
      });
      return { id: note.id };
    },

    /**
     * Blocks at the end of a note, from editor JSON: an import's body once its images are up.
     * `from` names the file, and makes it an `import` version so the history says so.
     */
    async append(req: Req<{ id?: unknown; body?: unknown; from?: unknown }>) {
      const { db, note, home, place } = await locate(req, req.id, "edit");
      const by = byOf(req);
      if (JSON.stringify(req.body ?? null).length > BODY_MAX)
        throw new PortalRefusal("that's too long for one note", 400);
      const body = cleanBody(req.body);
      if (!body) throw new PortalRefusal("that isn't a note's body", 400);
      const from = typeof req.from === "string" ? req.from.trim().slice(0, 200) : "";
      const c = await changeNote(
        db,
        note.id,
        by,
        (doc) => appendBody(doc, body),
        from ? { kind: "import", name: `From ${from}` } : {},
      );
      await tell(home, place);
      return { version: c.version };
    },

    /** A Google Doc or Word file in Drive, as `.docx` bytes for the browser to turn into a note. */
    async drive(req: Req<{ link?: unknown }>) {
      byOf(req);
      const place = await placeOf(req);
      const reader = await readerOf(req, place);
      if (reader.cap !== "edit") throw new PortalRefusal("your role can't do that", 403);
      if (!deps.drive) throw new PortalRefusal("Google Drive isn't set up here", 503);
      const id = driveIdOf(str(req.link, 2000, "the link"));
      if (!id) throw new PortalRefusal("Paste a Google Docs or Drive link.", 400);
      const file = await deps.drive.get(id);
      return { name: file.name, data: toB64(file.bytes) };
    },

    /** Quick capture: a timestamped line at the end of the person's Dump note, or a new note. */
    async capture(req: Req<{ words?: unknown; open?: unknown }>) {
      const by = byOf(req);
      const words = str(req.words, 20_000, "the note").trim();
      if (!words) throw new PortalRefusal("write something", 400);
      const place = await placeOf(req);
      const reader = await readerOf(req, place);
      if (reader.cap !== "edit") throw new PortalRefusal("your role can't do that", 403);
      if (req.open === true) {
        const note = await createNote(place.db, { owner: by, by, body: fromMarkdown(words) });
        return { id: note.id, dump: false };
      }
      const dump = await dumpOf(place.db, by);
      await appendNote(place.db, dump.id, by, captureBlock(words, new Date(), deps.zone));
      return { id: dump.id, dump: true };
    },

    async rename(req: Req<{ id?: unknown; title?: unknown }>) {
      const { db, note } = await locate(req, req.id, "edit");
      const c = await renameNote(db, note.id, byOf(req), str(req.title, 300, "the title").trim());
      return { title: c.note.title, version: c.version };
    },

    /** Version `number` back as a new version; nothing is lost. */
    async restore(req: Req<{ id?: unknown; number?: unknown }>) {
      const { db, note, home, place } = await locate(req, req.id, "edit");
      const c = await restoreVersion(db, note.id, numOf(req.number, "version"), byOf(req));
      await tell(home, place);
      return { version: c.version };
    },

    async nameVersion(req: Req<{ id?: unknown; number?: unknown; name?: unknown }>) {
      const { db, note } = await locate(req, req.id, "edit");
      byOf(req);
      const name = req.name === null ? null : str(req.name, 200, "the name");
      const v = await nameVersion(db, note.id, numOf(req.number, "version"), name);
      return { number: v.number, name: v.name };
    },

    /** Share with a person, the team, or (from Wren) a client's people; a null role takes it back. */
    async share(req: Req<{ id?: unknown; who?: unknown; role?: unknown }>) {
      const { db, note, home, place } = await locate(req, req.id, "owner");
      const by = byOf(req);
      const who = str(req.who, 200, "who").trim().toLowerCase();
      const role = req.role === null ? null : isShareRole(req.role) ? req.role : undefined;
      if (role === undefined) throw new PortalRefusal("pick view, comment or edit", 400);
      if (who.startsWith("client:")) {
        if (home !== WREN || !isOperator(req.viewer))
          throw new PortalRefusal("only Wren's notes are shared with a client", 400);
        const [c] = await main
          .select({ id: clients.id })
          .from(clients)
          .where(eq(clients.id, who.slice("client:".length)));
        if (!c) throw new PortalRefusal("no such client", 404);
      } else if (who !== TEAM && !EMAIL.test(who))
        throw new PortalRefusal("share with an email, the team, or a client", 400);
      if (who === note.owner.toLowerCase()) throw new PortalRefusal("they own it", 400);
      await share(db, note.id, who, role, by);
      // A mention that waited for this share is mailed now.
      if (role) await tell(home, place);
      return { shares: await sharesOut(db, note.id) };
    },

    /** Who else gets it: only those named, or everyone in the workspace with a role. */
    async general(req: Req<{ id?: unknown; general?: unknown; role?: unknown }>) {
      const { db, note, home, place } = await locate(req, req.id, "owner");
      byOf(req);
      const general: General = req.general === "workspace" ? "workspace" : "private";
      const role = isShareRole(req.role) ? req.role : "view";
      await setGeneral(db, note.id, general, role);
      if (general === "workspace") await tell(home, place);
      return { general, generalRole: role };
    },

    /** A new owner from the workspace's people; the old one keeps edit. */
    async transfer(req: Req<{ id?: unknown; to?: unknown }>) {
      const { db, note, place } = await locate(req, req.id, "owner");
      const by = byOf(req);
      const to = str(req.to, 200, "the new owner").trim().toLowerCase();
      if (!(await peopleOf(place)).some((p) => p.email === to))
        throw new PortalRefusal("they aren't in this workspace", 400);
      await transfer(db, note.id, to, by);
      return { owner: to };
    },

    /** Archive (Docs' trash) or bring back; nothing is deleted. */
    async archive(req: Req<{ id?: unknown; on?: unknown }>) {
      const { db, note } = await locate(req, req.id, "owner");
      byOf(req);
      await setArchived(db, note.id, req.on !== false);
      return { archived: req.on !== false };
    },

    /** Under another note, or back to the top. */
    async move(req: Req<{ id?: unknown; parentId?: unknown }>) {
      const { db, note } = await locate(req, req.id, "edit");
      byOf(req);
      const parent =
        req.parentId === null || req.parentId === undefined ? null : idOf(req.parentId);
      if (parent) {
        const p = await locate(req, parent, "edit");
        if (p.db !== db) throw new PortalRefusal("move it within one workspace", 400);
      }
      await move(db, note.id, parent).catch((err: Error) => {
        throw new PortalRefusal(err.message, 400);
      });
      return { parentId: parent };
    },

    /** In training exports or not (`wren train export --notes`); off by default. */
    async train(req: Req<{ id?: unknown; on?: unknown }>) {
      const { db, note } = await locate(req, req.id, "owner");
      byOf(req);
      await setTrain(db, note.id, req.on === true);
      return { train: req.on === true };
    },

    /**
     * Words to draft from: the selection, else the whole note. Drafts go to the viewer's own
     * workspace, never the note's home: a Wren note shared to a client drafts for that client.
     */
    async drafting(req: Req<{ id?: unknown; text?: unknown }>) {
      const { note, place } = await locate(req, req.id, "view");
      const by = byOf(req);
      const text = (str(req.text ?? "", 20_000, "the words").trim() || note.text.trim()).slice(
        0,
        20_000,
      );
      if (!text) throw new PortalRefusal("the note is empty", 400);
      return { client: place.client?.id ?? null, text, by };
    },

    /** Words into an SOP: the selection, else the whole note. */
    async toSop(req: Req<{ id?: unknown; text?: unknown; sop?: unknown }>) {
      const { note, place } = await locate(req, req.id, "view");
      const by = byOf(req);
      if (!deps.turns) throw new PortalRefusal("SOPs aren't set up here", 503);
      const text = str(req.text ?? "", 200_000, "the words").trim() || note.text.trim();
      if (!text) throw new PortalRefusal("the note is empty", 400);
      try {
        return await deps.turns.sop({
          client: place.ws,
          db: place.db,
          noteId: note.id,
          sop: str(req.sop, 64, "the SOP"),
          title: nameOf(note.title, note.text),
          text,
          by,
        });
      } catch (e) {
        if (e instanceof PortalRefusal) throw e;
        throw new PortalRefusal((e as Error).message, 400);
      }
    },

    /** Every note in this workspace in training exports, or only those opted in. */
    async workspaceTrain(req: Req<{ on?: unknown }>) {
      const by = byOf(req);
      const place = await placeOf(req);
      await setWorkspaceTrain(place.db, req.on === true, by);
      return { train: req.on === true };
    },

    /** A signed PUT for an image pasted into a note; its `src` goes in the doc. */
    async upload(req: Req<{ id?: unknown; name?: unknown; type?: unknown; size?: unknown }>) {
      const { note, home } = await locate(req, req.id, "edit");
      byOf(req);
      if (!deps.files) throw new PortalRefusal("files aren't set up here", 503);
      const type = str(req.type, 100, "the type");
      if (!Object.hasOwn(IMAGE_TYPES, type))
        throw new PortalRefusal("paste a PNG, JPEG, WebP or GIF", 400);
      const size = Number(req.size);
      if (!Number.isSafeInteger(size) || size <= 0)
        throw new PortalRefusal("that image is empty", 400);
      if (size > IMAGE_MAX) throw new PortalRefusal("images go up to 20 MB", 400);
      const safe =
        String(req.name ?? "image")
          .normalize("NFKD")
          .replace(/[^\w.-]+/g, "-")
          .replace(/^[-.]+|-+$/g, "")
          .slice(-80) || "image";
      const key = `notes/${home}/${note.id}/${crypto.randomUUID().slice(0, 8)}-${safe}`;
      return { key, src: `${FILE_SRC}${key}`, url: await deps.files.putUrl(key, type, size) };
    },
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
}
export type NotesApi = ReturnType<typeof notesApi>;

/** A note's own fields as the web reads them. */
export function noteOut(n: Note) {
  return {
    id: n.id,
    name: nameOf(n.title, n.text),
    title: n.title,
    kind: n.kind,
    owner: n.owner,
    createdBy: n.createdBy,
    via: n.via,
    general: n.general,
    generalRole: n.generalRole,
    train: n.train,
    archived: n.archivedAt !== null,
    parentId: n.parentId,
    createdAt: iso(n.createdAt) as string,
    updatedAt: iso(n.updatedAt) as string,
    editedBy: n.editedBy,
    agent: isAgent(n.owner) || n.via === "agent",
  };
}

/**
 * Up to `limit` notes this viewer may open that match `q`, as context for Ask Claude: title,
 * link and excerpt each. Empty when nothing matches.
 */
export async function notesContext(deps: NotesDeps, req: PortalRequest, q: string, limit = 5) {
  const api = notesApi(deps);
  const words = q
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 12)
    .join(" or ");
  if (!words) return "";
  const { notes: rows } = await api.home({ ...req, view: "all", q: words, limit });
  if (!rows.length) return "";
  return rows
    .slice(0, limit)
    .map(
      (r) =>
        `- ${r.name} (/notes/doc/${r.id}): ${r.excerpt.replaceAll("«", "").replaceAll("»", "")}`,
    )
    .join("\n");
}

const ID = z.string().max(64).describe("The note's id");
const ON = z.boolean().describe("On or off");
const NUM = z.number().int().positive();
const ROLE = z.enum(["view", "comment", "edit"]);
/** Each handler's input: the portal's own fields and the route's. The handlers check them again. */
const INPUTS = {
  home: {
    view: z.enum(["recent", "mine", "shared", "starred", "archived", "all"]).optional(),
    q: z.string().max(500).optional().describe("Words to search for"),
    limit: z.number().int().optional(),
    parentId: ID.nullable().optional(),
  },
  open: { id: ID },
  sync: {
    id: ID,
    update: z.string().optional().describe("A Yjs update, base64"),
    sv: z.string().optional().describe("The browser's state vector, base64"),
  },
  versions: { id: ID },
  version: { id: ID, number: NUM },
  compare: { id: ID, from: NUM, to: NUM },
  backlinks: { target: z.string().max(300).describe("A record, `<type>:<id>`") },
  people: { id: ID.optional().describe("A note: whether each person can open it") },
  file: { id: ID, key: z.string().max(400) },
  settings: {},
  comments: { id: ID },
  mentions: { limit: z.number().int().optional() },
  mentionsRead: { ids: z.array(z.string().max(64)).max(200).describe("Mention ids") },
  mentionsUnread: { ids: z.array(z.string().max(64)).max(200).describe("Mention ids") },
  star: { id: ID, on: ON },
  comment: {
    id: ID,
    body: z.string().max(10_000).describe("The words; `@email` tells that person"),
    parentId: z.string().max(64).nullable().optional().describe("A reply: the thread's id"),
    anchor: z
      .object({ from: z.unknown(), to: z.unknown() })
      .nullable()
      .optional()
      .describe("A new thread's range: Yjs relative positions"),
    quote: z.string().max(2000).optional().describe("The words it's on"),
  },
  commentEdit: { id: ID, commentId: z.string().max(64), body: z.string().max(10_000) },
  commentDelete: { id: ID, commentId: z.string().max(64) },
  resolve: { id: ID, commentId: z.string().max(64), on: ON },
  append: {
    id: ID,
    body: z.unknown().describe("Editor JSON: a doc"),
    from: z.string().max(200).optional().describe("The file it came from: an import version"),
  },
  drive: { link: z.string().max(2000).describe("A Google Docs or Drive link") },
  create: {
    title: z.string().max(300).optional(),
    markdown: z.string().optional().describe("The body, as Markdown"),
    parentId: ID.optional(),
  },
  capture: {
    words: z.string().max(20_000),
    open: z.boolean().optional().describe("As a note of its own"),
  },
  rename: { id: ID, title: z.string().max(300) },
  restore: { id: ID, number: NUM },
  nameVersion: { id: ID, number: NUM, name: z.string().max(200).nullable() },
  share: { id: ID, who: z.string().max(320), role: ROLE.nullable().describe("None removes them") },
  general: { id: ID, general: z.enum(["private", "workspace"]), role: ROLE },
  transfer: { id: ID, to: z.string().max(320) },
  archive: { id: ID, on: ON },
  move: { id: ID, parentId: ID.nullable() },
  train: { id: ID, on: ON },
  upload: { id: ID, name: z.string().max(200), type: z.string().max(100), size: z.number().int() },
  workspaceTrain: { on: ON },
  toDraft: {
    id: ID,
    text: z.string().max(20_000).optional().describe("The selection; none is the note"),
  },
  toSop: {
    id: ID,
    text: z.string().max(200_000).optional().describe("The selection; none is the note"),
    sop: z.string().max(64).describe("The SOP's name: lowercase letters, digits and dashes"),
  },
} as const satisfies Record<keyof typeof NOTES_CONSOLE_ROUTES, z.ZodRawShape>;
const input = (route: keyof typeof INPUTS) => ({
  input: z.looseObject({ ...PORTAL_FIELDS, ...INPUTS[route] }),
});

/** The Restate service. A write is journaled once, so a retry never writes twice. */
export function makeNotesConsole(deps: NotesDeps) {
  const api = notesApi(deps);
  const read = <K extends keyof typeof INPUTS & keyof NotesApi>(route: K) =>
    serviceHandler(input(route), (_: restate.Context, req: Parameters<NotesApi[K]>[0]) =>
      answer(() => (api[route] as (r: typeof req) => Promise<unknown>)(req)),
    );
  const write = <K extends keyof typeof INPUTS & keyof NotesApi>(route: K, name: string) =>
    serviceHandler(input(route), (ctx: restate.Context, req: Parameters<NotesApi[K]>[0]) =>
      answer(() =>
        ctx.run(name, () => answer(() => (api[route] as (r: typeof req) => Promise<unknown>)(req))),
      ),
    );
  return portalService({
    name: "NotesConsole",
    main: deps.main,
    routes: NOTES_CONSOLE_ROUTES,
    apps: NOTES_CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      home: read("home"),
      open: read("open"),
      // Yjs merges an update it has once: a retry changes nothing, so no journal (the answer can be big).
      sync: read("sync"),
      versions: read("versions"),
      version: read("version"),
      compare: read("compare"),
      backlinks: read("backlinks"),
      people: read("people"),
      file: read("file"),
      settings: read("settings"),
      comments: read("comments"),
      mentions: read("mentions"),
      mentionsRead: write("mentionsRead", "read mentions"),
      mentionsUnread: write("mentionsUnread", "unread mentions"),
      star: write("star", "star"),
      comment: write("comment", "comment"),
      commentEdit: write("commentEdit", "edit comment"),
      commentDelete: write("commentDelete", "delete comment"),
      resolve: write("resolve", "resolve"),
      // A Drive read: big bytes and no write, so no journal.
      drive: read("drive"),
      append: write("append", "append"),
      create: write("create", "create"),
      capture: write("capture", "capture"),
      rename: write("rename", "rename"),
      restore: write("restore", "restore"),
      nameVersion: write("nameVersion", "name version"),
      share: write("share", "share"),
      general: write("general", "general"),
      transfer: write("transfer", "transfer"),
      archive: write("archive", "archive"),
      move: write("move", "move"),
      train: write("train", "train"),
      upload: write("upload", "upload"),
      workspaceTrain: write("workspaceTrain", "workspace train"),
      toDraft: serviceHandler(
        input("toDraft"),
        (ctx: restate.Context, req: Parameters<NotesApi["drafting"]>[0]) =>
          answer(async () => {
            const turns = deps.turns;
            if (!turns) throw new PortalRefusal("drafting isn't set up here", 503);
            const go = await ctx.run("check", () => answer(() => api.drafting(req)));
            await turns.draft(ctx, go);
            return { started: true };
          }),
      ),
      toSop: write("toSop", "to sop"),
    },
  });
}
