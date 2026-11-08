/**
 * The one folder tree for every list (designs/2026-11-08-folders.md): one read for the whole
 * tree, every write shown at once and then the server's tree put in its place.
 */
import type { FolderActs, FolderNode } from "@wren/ui";
import { useMemo } from "react";
import { call } from "./api.js";
import { patchCalls, useCall } from "./load.js";

type Kind = "chat" | "subject" | "run";
interface Tree {
  folders: FolderNode[];
  filed: { kind: Kind; ref: string; folder: number }[];
}

const KEY = "folders:tree";
const read = () => call<Tree>("folders/tree", {});
const put = (fn: (t: Tree) => Tree) =>
  patchCalls((key, data) => (key === KEY && data ? fn(data as Tree) : data));

/** The write, shown first; then the server's tree, whether it took or not. */
async function write<T>(path: string, body: Record<string, unknown>, guess: (t: Tree) => Tree) {
  put(guess);
  try {
    return await call<T>(path, body);
  } finally {
    const fresh = await read().catch(() => null);
    if (fresh) put(() => fresh);
  }
}

/** The tree for one kind of item, and the writes a list needs. Wren's team only: `on` false reads nothing. */
export function useFolders(kind: Kind, on = true) {
  const got = useCall(on ? KEY : null, read);
  const tree = got.data;
  return useMemo(() => {
    const at = new Map(
      (tree?.filed ?? []).filter((f) => f.kind === kind).map((f) => [f.ref, f.folder]),
    );
    const acts: FolderActs = {
      make: (name, parent) => write<FolderNode>("folders/make", { name, parent }, (t) => t),
      rename: (id, name) =>
        write("folders/rename", { id, name }, (t) => ({
          ...t,
          folders: t.folders.map((f) => (f.id === id ? { ...f, name } : f)),
        })),
      move: (id, to) =>
        write("folders/move", { id, to }, (t) => ({
          ...t,
          folders: t.folders.map((f) => (f.id === id ? { ...f, parent: to } : f)),
        })),
      drop: (id) =>
        write("folders/drop", { id }, (t) => {
          const up = t.folders.find((f) => f.id === id)?.parent ?? null;
          return {
            folders: t.folders
              .filter((f) => f.id !== id)
              .map((f) => (f.parent === id ? { ...f, parent: up } : f)),
            filed: t.filed.flatMap((f) =>
              f.folder !== id ? [f] : up == null ? [] : [{ ...f, folder: up }],
            ),
          };
        }),
      file: (refs, folder) =>
        write("folders/file", { kind, refs, folder }, (t) => ({
          ...t,
          filed: [
            ...t.filed.filter((f) => !(f.kind === kind && refs.includes(f.ref))),
            ...(folder == null ? [] : refs.map((ref) => ({ kind, ref, folder }))),
          ],
        })),
    };
    return {
      /** null until the first read (or off): a list draws without folders. */
      folders: tree && on ? tree.folders : null,
      folderOf: (ref: string) => at.get(ref) ?? null,
      acts,
    };
  }, [tree, kind, on]);
}
