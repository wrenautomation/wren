/**
 * The Map's drafts and history lines, pure (no reads, so a test imports it alone): the address of
 * an opened draft, the key its device edits live under, what each draft state allows, and the
 * words of a blame line. The wire types are `@wren/pipeline/history`'s; nothing here copies them.
 */
import type { State } from "@wren/core/records";
import type {
  BlameLine,
  DraftRow,
  DraftState,
  MirrorRef,
  ShapeRef,
  VersionLine,
} from "@wren/pipeline/history";

/** `shapeDiff` names a draft as `draft:<id>`. */
export const draftRef = (id: string): ShapeRef => `draft:${id}`;

/** The draft an address names (`?draft=<id>`); null when it names none. */
export const draftIdOf = (s: string | null): string | null => {
  const id = s?.trim() ?? "";
  return id ? id : null;
};

/**
 * Where a draft's unsaved edits live on this device. A draft's edits and the live shape's never
 * share a key, so they never mix.
 */
export const draftStoreKey = (client: string, draft: string | null): string =>
  draft ? `map:draft:${client}:${draft}` : `map:draft:${client}`;

/** What History opens on: `?history=drafts` opens it on Drafts, `?history=1` on Versions. */
export type HistoryTab = "versions" | "drafts";
export const historyOf = (s: string | null): HistoryTab | null =>
  s === "drafts" ? "drafts" : s === "versions" || s === "1" ? "versions" : null;

/** What a person may do to a draft in each state. */
export interface DraftActions {
  open: boolean;
  compare: boolean;
  propose: boolean;
  apply: boolean;
  drop: boolean;
}

export function actionsOf(state: DraftState): DraftActions {
  const open = state === "draft" || state === "proposed";
  return {
    open,
    compare: true,
    propose: state === "draft",
    apply: open,
    drop: open,
  };
}

/** A draft state as the kit's state mark. */
export const DRAFT_LOOK: Record<DraftState, State> = {
  draft: { tone: "neutral", label: "Draft" },
  proposed: { tone: "warn", label: "Proposed" },
  applied: { tone: "good", label: "Applied" },
  dropped: { tone: "neutral", label: "Dropped" },
};

/** Live moved on since the draft started: its base is older than the newest version. */
export const liveMoved = (base: number, newest: number): boolean => base < newest;

/** The newest version's number; 0 when there are none. */
export const newestOf = (versions: readonly Pick<VersionLine, "number">[]): number =>
  versions.reduce((m, v) => Math.max(m, v.number), 0);

/** The open drafts of a list, count only; "Drafts (2)". */
export const openCount = (rows: readonly Pick<DraftRow, "state">[]): number =>
  rows.filter((r) => r.state === "draft" || r.state === "proposed").length;

/** A mirror's short sha, seven characters; empty when there is none. */
export const shortSha = (m: MirrorRef | null | undefined): string => m?.sha.slice(0, 7) ?? "";

/** What a version came from, when it came from a draft. */
export const fromDraft = (v: Pick<VersionLine, "draft">): string | null =>
  v.draft ? `from draft ${v.draft}` : null;

/** What a blame line did, in words: "Renamed Joined to Signed". */
export function blameHow(l: BlameLine): string {
  if (l.how === "renamed") return l.from && l.to ? `Renamed ${l.from} to ${l.to}` : "Renamed";
  return { added: "Added", removed: "Removed", changed: "Changed" }[l.how];
}

/**
 * The version a blame line opens in History, with its parent picked: the two versions in the
 * order History picks them. Version 1 has no parent, so only itself.
 */
export function blamePick(
  l: Pick<BlameLine, "version">,
  versions: readonly VersionLine[],
): number[] {
  const v = versions.find((x) => x.number === l.version);
  return v?.parent != null ? [v.parent, v.number] : [l.version];
}

/** "1 shape proposal waits", "3 shape proposals wait"; null when none do. */
export function proposalsLine(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? "1 shape proposal waits" : `${n} shape proposals wait`;
}

/** The sentence a stale draft carries over the apply dialog. */
export const LIVE_MOVED = "Live changed since this draft started.";

const DAY = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "America/Toronto" });
/** A time as its day, "Oct 19, 2026"; empty when it is not a time. */
export const dayOf = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : DAY.format(d);
};

/** A diff side in words: "Version 3", or "Draft Spring offer" when the draft is in `names`. */
export function refLabel(ref: ShapeRef, names: ReadonlyMap<string, string> = new Map()): string {
  if (typeof ref === "number") return `Version ${ref}`;
  const id = ref.slice("draft:".length);
  return `Draft ${names.get(id) ?? id}`;
}

/** The pair a diff reads, older version first; null until two are picked. */
export function pairOf(picked: readonly number[]): [number, number] | null {
  if (picked.length !== 2) return null;
  const [a, b] = [...picked].sort((x, y) => x - y);
  return a !== undefined && b !== undefined ? [a, b] : null;
}

/** A blame line's meta: "Ada North · Oct 19, 2026". */
export const blameMeta = (l: Pick<BlameLine, "by" | "at">): string =>
  [l.by, dayOf(l.at)].filter(Boolean).join(" · ");
