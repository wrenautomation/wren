/** Notes handlers that read a note: the home list, a page, its versions, links, people, files and settings. */
import { can, WREN } from "@wren/core/access";
import { clients } from "@wren/core/clients";
import { isDemo, isOperator, PortalRefusal, type PortalRequest } from "@wren/core/portal";
import { asc } from "drizzle-orm";
import { atLeast, clientWho } from "./access.js";
import { boardById } from "./boards.js";
import { iso, type NotesApiContext, numOf, type Req, str } from "./console-context.js";
import { blame, counts } from "./diff.js";
import { fromB64, nameOf, toB64 } from "./doc.js";
import type { Board, Note } from "./schema.js";
import {
  backlinks,
  childrenOf,
  isNoteId,
  type ListView,
  listNotes,
  NotASuggestion,
  noteById,
  roleOn,
  seen,
  settingsOf,
  syncNote,
  versionRange,
  versionsOf,
} from "./store.js";
import { isAgent, UPDATE_MAX } from "./types.js";

const VIEWS: readonly ListView[] = ["recent", "mine", "shared", "starred", "archived", "all"];

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

export function pagesHandlers(notes: NotesApiContext) {
  const {
    deps,
    main,
    placeOf,
    readerOf,
    byOf,
    locate,
    rowOut,
    peopleOf,
    tell,
    sharesOut,
    whoAt,
    isStarred,
  } = notes;
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
      // A card says where it stands: its column, or Closed.
      const boardIds = [...new Set(rows.flatMap((r) => (r.boardId ? [r.boardId] : [])))];
      const columns = new Map<string, Board["columns"]>();
      for (const id of boardIds) columns.set(id, (await boardById(place.db, id))?.columns ?? []);
      return {
        notes: rows.map((r) => ({
          id: r.id,
          name: nameOf(r.title, r.text),
          excerpt: r.text.replace(/\s+/g, " ").slice(0, 200),
          owner: r.owner,
          updatedAt: iso(r.updatedAt) as string,
          card:
            r.kind === "task" && r.boardId
              ? {
                  column:
                    columns.get(r.boardId)?.find((c) => c.id === r.columnId)?.name ?? r.columnId,
                  closed: r.closedAt !== null,
                }
              : null,
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
  };
}
