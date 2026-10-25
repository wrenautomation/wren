/**
 * Notes' calls (NotesConsole, designs/2026-10-07-notes.md). Wren's workspace names no client; a
 * client's names its own. Types come from the service.
 */
import { knownOf, mergeChanged } from "@wren/core/records/delta";
import type { NotesApi } from "@wren/notes/console";
import { call } from "../../api.js";
import { type Load, useCall } from "../../load.js";
import { WREN } from "../../module.js";

type Out<K extends keyof NotesApi> = Awaited<ReturnType<NotesApi[K]>>;
export type NotesHome = Out<"home">;
export type NoteRow = NotesHome["notes"][number];
export type NoteOpen = Out<"open">;
export type NoteSynced = Out<"sync">;
export type NoteVersions = Out<"versions">["versions"];
export type NoteVersion = Out<"version">;
export type NoteCompare = Out<"compare">;
export type NotePeople = Out<"people">;
export type NoteShare = NoteOpen["shares"][number];
export type NoteBacklink = Out<"backlinks">["notes"][number];
export type NoteComments = Out<"comments">;
export type NoteMention = Out<"mentions">["mentions"][number];
type BoardList = Out<"boards">;
export type BoardInfo = BoardList["boards"][number];
type BoardOpen = Out<"board">;
export type Card = BoardOpen["cards"][number];
export type CardOpen = Out<"task">;
export type CardMoves = Out<"taskMoves">["moves"];

/** A call in `client`'s workspace. */
export const notes = <K extends keyof NotesApi>(
  client: string,
  route: K,
  body: Record<string, unknown> = {},
): Promise<Out<K>> =>
  call<Out<K>>(`notes/${route}`, client === WREN.id ? body : { client, ...body });

/**
 * A board with its cards, asking only for the cards that changed since `before` (each card's
 * mark is its row version, `cardMark`). A stub it can't fill reads the board again in full.
 */
export async function readBoard(
  client: string,
  id: string,
  before: BoardOpen | undefined,
): Promise<BoardOpen> {
  const held = before?.board.id === id ? { rows: before.cards, hashes: before.hashes } : undefined;
  const known = knownOf(held);
  if (!known.length) return notes(client, "board", { id });
  const got = await notes(client, "board", { id, known });
  const whole = mergeChanged({ rows: got.cards, hashes: got.hashes, same: got.same ?? [] }, held);
  if (!whole) return notes(client, "board", { id });
  const { same: _, ...rest } = got;
  return { ...rest, cards: whole.rows };
}

/** The board on screen, or beside a card: one key, so the board and its cards' pages share it. */
const boardKey = (client: string, id: string) => `notes:board:${client}:${id}`;

/** A board read through the data layer: kept on the device, change-only after the first read. */
export const useBoard = (client: string, id: string | null | undefined): Load<BoardOpen> =>
  useCall(id ? boardKey(client, id) : null, (before) => readBoard(client, id as string, before));

export const VIEWS = [
  ["recent", "Recent"],
  ["mine", "Owned by me"],
  ["shared", "Shared with me"],
  ["starred", "Starred"],
  ["archived", "Archived"],
] as const;
export type View = (typeof VIEWS)[number][0];

export const docPath = (id: string) => `/notes/doc/${id}`;

/** Where a mention goes: a note, or a record's page. A person stays a name. */
export function mentionHref(id: string): string | null {
  const at = id.indexOf(":");
  const kind = id.slice(0, at);
  const rest = id.slice(at + 1);
  if (kind === "note") return docPath(rest);
  if (kind === "console.client") return `/clients/all/${encodeURIComponent(rest)}`;
  return null;
}

/** Which of the eight kind hues is a person's, 1 to 8, the same for them everywhere. */
function hueIndex(email: string): number {
  let h = 0;
  for (const c of email.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 8) + 1;
}

/** A person's mark: their hue as a color. */
export const hueOf = (email: string): string => `var(--ui-cue-${hueIndex(email)})`;

/** Their hue as a class (`note-who-N`), where an inline style can't go (the editor's DOM). */
export const hueClass = (email: string): string => `note-who-${hueIndex(email)}`;

export const ROLE_LABEL = { view: "Can view", comment: "Can comment", edit: "Can edit" } as const;
export type ShareRole = keyof typeof ROLE_LABEL;
