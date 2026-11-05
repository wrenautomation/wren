/**
 * Notes' calls (NotesConsole, designs/2026-10-07-notes.md). Wren's workspace names no client; a
 * client's names its own. Types come from the service.
 */
import { knownOf, mergeChanged } from "@wren/core/records/delta";
import type { NotesApi } from "@wren/notes/console";
import { call } from "../../api.js";
import { WREN } from "../../module.js";

type Out<K extends keyof NotesApi> = Awaited<ReturnType<NotesApi[K]>>;
export type NotesHome = Out<"home">;
export type NoteRow = NotesHome["notes"][number];
export type NoteVersion = Out<"version">;
export type NotePeople = Out<"people">;
export type NoteComments = Out<"comments">;
export type NoteMention = Out<"mentions">["mentions"][number];
type BoardOpen = Out<"board">;
export type Card = BoardOpen["cards"][number];

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

export const VIEWS = [
  ["recent", "Recent"],
  ["mine", "Owned by me"],
  ["shared", "Shared with me"],
  ["starred", "Starred"],
  ["archived", "Archived"],
] as const;
export type View = (typeof VIEWS)[number][0];

export const docPath = (id: string) => `/notes/doc/${id}`;

/** Which of the eight kind hues is a person's, 1 to 8, the same for them everywhere. */
function hueIndex(email: string): number {
  let h = 0;
  for (const c of email.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 8) + 1;
}

/** A person's mark: their hue as a color. */
export const hueOf = (email: string): string => `var(--ui-cue-${hueIndex(email)})`;

const ROLE_LABEL = { view: "Can view", comment: "Can comment", edit: "Can edit" } as const;
export type ShareRole = keyof typeof ROLE_LABEL;
