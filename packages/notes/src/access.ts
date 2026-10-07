/**
 * Who holds what on a note (designs/2026-10-07-notes.md, Sharing). Pure: the store reads the
 * rows, this answers.
 */
import { isAgent, ROLES, type Role, type ShareRole } from "./types.js";

/** Lowest first; owner above edit. */
const RANK: Record<Role, number> = { view: 1, comment: 2, edit: 3, owner: 4 };
export const atLeast = (r: Role | null, need: Role): boolean => !!r && RANK[r] >= RANK[need];
const best = (a: Role | null, b: Role | null): Role | null =>
  !a ? b : !b ? a : RANK[a] >= RANK[b] ? a : b;

/** The person asking, as notes sees them. */
export interface Reader {
  email: string;
  /** On Wren's team. */
  team: boolean;
  /** In the workspace the note belongs to: Wren's team at Wren, a client's people (or its team) there. */
  inWorkspace: boolean;
  /** The client whose people they are, for `client:<id>` shares. */
  client: string | null;
  /** What their app permissions allow at most: view (read), comment, edit (act). */
  cap: ShareRole | null;
}

export interface NoteAccess {
  owner: string;
  general: "private" | "workspace";
  generalRole: ShareRole;
}

/** A share's `who` for Wren's team, and for one client's people. */
export const TEAM = "team";
export const clientWho = (id: string) => `client:${id}`;

/**
 * The note's own role for this reader, before app permissions: owner, an email share, `team`,
 * `client:<id>`, or the general access when they're in its workspace. A note an agent owns is
 * run by whoever may edit it.
 */
export function noteRole(
  note: NoteAccess,
  shares: readonly { who: string; role: ShareRole }[],
  r: Omit<Reader, "cap">,
): Role | null {
  const email = r.email.toLowerCase();
  if (note.owner.toLowerCase() === email) return "owner";
  let role: Role | null = null;
  for (const s of shares) {
    const hit =
      s.who.toLowerCase() === email ||
      (s.who === TEAM && r.team) ||
      (r.client !== null && s.who === clientWho(r.client));
    if (hit) role = best(role, s.role);
  }
  if (note.general === "workspace" && r.inWorkspace) role = best(role, note.generalRole);
  if (role === "edit" && isAgent(note.owner)) return "owner";
  return role;
}

/** What the reader may do: the note's role, held to their app permissions. Owner needs edit. */
export function effectiveRole(own: Role | null, cap: ShareRole | null): Role | null {
  if (!own || !cap) return null;
  if (own === "owner") return cap === "edit" ? "owner" : cap;
  return RANK[own] <= RANK[cap] ? own : cap;
}

export const isShareRole = (r: unknown): r is ShareRole =>
  typeof r === "string" && (ROLES as readonly string[]).includes(r);
