/**
 * Notes' calls (NotesConsole, designs/2026-10-07-notes.md). Wren's workspace names no client; a
 * client's names its own. Types come from the service.
 */
import type { NotesApi } from "@wren/notes/console";
import { call } from "../../api.js";
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

/** A call in `client`'s workspace. */
export const notes = <K extends keyof NotesApi>(
  client: string,
  route: K,
  body: Record<string, unknown> = {},
): Promise<Out<K>> =>
  call<Out<K>>(`notes/${route}`, client === WREN.id ? body : { client, ...body });

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
export function hueIndex(email: string): number {
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
