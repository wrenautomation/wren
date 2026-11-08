/**
 * The folder tree's fake server (designs/2026-11-08-folders.md): one tree in memory, so a story's
 * writes show on its next read. Synthetic names.
 */
import type { Answers } from "../api.js";

interface Node {
  id: number;
  parent: number | null;
  name: string;
}
interface Filed {
  kind: string;
  ref: string;
  folder: number;
}

const START = {
  folders: [
    { id: 1, parent: null, name: "Bakeries" },
    { id: 2, parent: 1, name: "Buyers" },
    { id: 3, parent: null, name: "Plumbers" },
    { id: 4, parent: null, name: "Launch week" },
  ] as Node[],
  filed: [
    { kind: "chat", ref: "00000000-0000-4000-8000-000000000001", folder: 2 },
    { kind: "subject", ref: "1", folder: 1 },
    { kind: "subject", ref: "4", folder: 4 },
    { kind: "run", ref: "r2", folder: 1 },
  ] as Filed[],
};

let tree = structuredClone(START);
let next = 10;

/** A story that writes starts from the same tree. */
export const resetFolders = () => {
  tree = structuredClone(START);
};

export const FOLDERS_ANSWERS: Answers = {
  "folders/tree": () => structuredClone(tree),
  "folders/make": (b: Record<string, unknown>) => {
    const f = { id: next++, parent: (b.parent as number | null) ?? null, name: String(b.name) };
    tree.folders.push(f);
    return f;
  },
  "folders/rename": (b: Record<string, unknown>) => {
    const f = tree.folders.find((x) => x.id === b.id);
    if (f) f.name = String(b.name);
    return f;
  },
  "folders/move": (b: Record<string, unknown>) => {
    const f = tree.folders.find((x) => x.id === b.id);
    if (f) f.parent = (b.to as number | null) ?? null;
    return f;
  },
  "folders/drop": (b: Record<string, unknown>) => {
    const f = tree.folders.find((x) => x.id === b.id);
    const up = f?.parent ?? null;
    tree.folders = tree.folders
      .filter((x) => x.id !== b.id)
      .map((x) => (x.parent === b.id ? { ...x, parent: up } : x));
    tree.filed = tree.filed.flatMap((x) =>
      x.folder !== b.id ? [x] : up == null ? [] : [{ ...x, folder: up }],
    );
    return { dropped: b.id, to: up };
  },
  "folders/file": (b: Record<string, unknown>) => {
    const refs = b.refs as string[];
    tree.filed = [
      ...tree.filed.filter((x) => !(x.kind === b.kind && refs.includes(x.ref))),
      ...(b.folder == null
        ? []
        : refs.map((ref) => ({ kind: String(b.kind), ref, folder: b.folder as number }))),
    ];
    return b;
  },
};
