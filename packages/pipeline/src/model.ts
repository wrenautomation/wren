/**
 * A funnel version's body and its rules (designs/2026-10-18-journeys.md, "Funnel and funnel
 * version"). Pure: the known triggers, the funnel lookup and the composition graph come in as
 * arguments, so this file imports nothing from the spine.
 */
import { SOURCE_ID } from "@wren/core/logic";

export interface Advance {
  /** A trigger component id: `trigger.booking`, `trigger.touch`, ... */
  trigger: string;
  /** That trigger's settings, as a node's `with`. */
  with?: Record<string, string | number>;
}

export interface Stage {
  /** The spine node id rule. Never goes, moves or gets renamed. */
  key: string;
  label: string;
  /** Exactly one stage: reaching it makes the deal. */
  sale?: true;
  /** What moves a journey to this stage. */
  on: Advance[];
  /** How much research the person gets on entering. Default `none`. Run once per journey and stage on arrival (`research.ts`). */
  research?: Research;
  /** Whole days an open journey may sit here before it reads stale (1 to 365). Default `STALE_DAYS`. */
  idleDays?: number;
}

/** The longest `idleDays` a stage may set. */
export const IDLE_DAYS_MAX = 365;

export const RESEARCH_LEVELS = ["none", "light", "full"] as const;
export type Research = (typeof RESEARCH_LEVELS)[number];

export const ENTRY_KINDS = [
  "organic",
  "outbound",
  "ads",
  "referral",
  "funnel",
  "sourced",
  "group",
  "manual",
] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export interface Entry {
  /** `youtube`, `linkedin`, `ads`, `referral`, ... */
  id: string;
  kind: EntryKind;
  /** The platform or channel the cause must come from. */
  channel?: string;
  /** An ads campaign id or a `/go/` campaign. */
  campaign?: string;
  /** Kind `funnel`: that funnel's stage. Default: its sale stage. */
  funnel?: { id: string; at?: string };
  /** Kind `sourced`: the list the person was added to, `import:<batch id>` (an import batch). */
  source?: string;
  /** Kind `group`: the saved query whose members enter. */
  group?: string;
  /** The stage a journey opens at. Default: the first. */
  to?: string;
}

export interface FunnelBody {
  name: string;
  /** The registry id the sale stage sells. */
  offer: string;
  /** Ordered; index is order. */
  stages: Stage[];
  /** Ordered; order is priority (first match wins). */
  entries: Entry[];
}

/** A group is a segment: its id as text, a positive whole number. */
export const GROUP_ID = /^[1-9][0-9]{0,9}$/;
export const STAGE_KEY = /^[a-z][a-z0-9_]*$/;
/** The key of the node a drop arrives at; no stage may take it. */
export const DROPPED = "dropped";

/** What `checkFunnel` needs from outside. */
export interface FunnelContext {
  /** The funnel being checked. */
  id: string;
  /** Trigger component ids that exist. */
  triggers: ReadonlySet<string>;
  /** A stored funnel's stage keys and its sale stage, or undefined if there is none. */
  funnel(id: string): { stages: readonly string[]; sale: string } | undefined;
  /**
   * A stored group (a segment in this workspace) by id as text, or undefined if there is none.
   * `active` is false once it is archived: an archived group tells no one.
   */
  group(id: string): { active: boolean } | undefined;
  /** A sourced list by id (`import:<batch id>`), or undefined if there is none. */
  source(id: string): { exists: true } | undefined;
  /** Funnel ids each stored funnel takes entries from. This funnel's own edges are replaced by `next`. */
  feeds: Readonly<Record<string, readonly string[]>>;
}

/**
 * Check a new funnel version against the one before it (`prev`, null for the first).
 * Returns what is wrong, in plain English. Empty means ok.
 */
export function checkFunnel(
  prev: FunnelBody | null,
  next: FunnelBody,
  ctx: FunnelContext,
): string[] {
  const errors: string[] = [];
  const keys = next.stages.map((s) => s.key);

  if (keys.length === 0) errors.push("The funnel needs at least one stage.");
  for (const [i, k] of keys.entries()) {
    if (!STAGE_KEY.test(k)) {
      errors.push(
        `Stage key "${k}" must be lowercase letters, digits and underscores, starting with a letter.`,
      );
    }
    if (keys.indexOf(k) !== i) errors.push(`Stage key "${k}" is used twice.`);
    if (k === DROPPED) errors.push(`Stage key "${k}" is reserved for dropped journeys.`);
  }

  const sales = next.stages.filter((s) => s.sale);
  if (sales.length !== 1) {
    errors.push(`The funnel needs exactly one sale stage, not ${sales.length}.`);
  }

  for (const s of next.stages) {
    if (s.research !== undefined && !RESEARCH_LEVELS.includes(s.research)) {
      errors.push(`Stage "${s.key}" has research "${s.research}". Use none, light or full.`);
    }
    if (
      s.idleDays !== undefined &&
      !(Number.isInteger(s.idleDays) && s.idleDays >= 1 && s.idleDays <= IDLE_DAYS_MAX)
    ) {
      errors.push(
        `Stage "${s.key}" has idleDays ${JSON.stringify(s.idleDays)}. Use a whole number of days from 1 to ${IDLE_DAYS_MAX}.`,
      );
    }
    for (const a of s.on) {
      if (!ctx.triggers.has(a.trigger)) {
        errors.push(`Stage "${s.key}" uses "${a.trigger}", which is not a known trigger.`);
      }
    }
  }

  if (prev) {
    if (prev.offer !== next.offer) {
      errors.push(
        `The offer cannot change from "${prev.offer}" to "${next.offer}". Make a new funnel.`,
      );
    }
    for (const [i, p] of prev.stages.entries()) {
      const k = keys[i];
      if (k === p.key) continue;
      errors.push(
        k === undefined
          ? `Stage "${p.key}" cannot be removed.`
          : `Stage ${i + 1} must stay "${p.key}", not "${k}". Stages are append only.`,
      );
    }
  }

  const entryIds = new Set<string>();
  for (const e of next.entries) {
    if (entryIds.has(e.id)) errors.push(`Entry "${e.id}" is used twice.`);
    entryIds.add(e.id);
    if (e.to !== undefined && !keys.includes(e.to)) {
      errors.push(`Entry "${e.id}" opens at "${e.to}", which is not a stage of this funnel.`);
    }
    if (e.kind === "funnel" && !e.funnel)
      errors.push(`Entry "${e.id}" has kind funnel but names no funnel.`);
    if (e.kind === "sourced") {
      if (!e.source) errors.push(`Entry "${e.id}" has kind sourced but names no source.`);
      else if (!SOURCE_ID.test(e.source))
        errors.push(
          `Entry "${e.id}" names source "${e.source}", which is not a list's id (import:12).`,
        );
      else if (!ctx.source(e.source))
        errors.push(`Entry "${e.id}" names source ${e.source}, which does not exist.`);
    }
    if (e.kind === "group") {
      if (!e.group) errors.push(`Entry "${e.id}" has kind group but names no group.`);
      else if (!GROUP_ID.test(e.group))
        errors.push(`Entry "${e.id}" names group "${e.group}", which is not a group's number.`);
      else {
        const g = ctx.group(e.group);
        if (!g) errors.push(`Entry "${e.id}" names group ${e.group}, which does not exist.`);
        else if (!g.active)
          errors.push(
            `Entry "${e.id}" names group ${e.group}, which is archived. Restore it first.`,
          );
      }
    }
    if (!e.funnel) continue;
    const target =
      e.funnel.id === ctx.id
        ? { stages: keys, sale: sales[0]?.key ?? "" }
        : ctx.funnel(e.funnel.id);
    if (!target) {
      errors.push(`Entry "${e.id}" names funnel "${e.funnel.id}", which does not exist.`);
    } else if (e.funnel.at !== undefined && !target.stages.includes(e.funnel.at)) {
      errors.push(
        `Entry "${e.id}" names stage "${e.funnel.at}", which "${e.funnel.id}" does not have.`,
      );
    }
  }

  const loop = cycleThrough(ctx.id, next, ctx.feeds);
  if (loop) errors.push(`Funnels feed each other in a loop: ${loop.join(" -> ")}.`);
  return errors;
}

/** A path from `id` back to `id` through entries of kind funnel, or null. */
function cycleThrough(
  id: string,
  next: FunnelBody,
  feeds: Readonly<Record<string, readonly string[]>>,
): string[] | null {
  const edges = (f: string): readonly string[] =>
    f === id ? next.entries.flatMap((e) => (e.funnel ? [e.funnel.id] : [])) : (feeds[f] ?? []);
  const walk = (f: string, path: string[]): string[] | null => {
    for (const g of edges(f)) {
      if (g === id) return [...path, g];
      if (path.includes(g)) continue;
      const found = walk(g, [...path, g]);
      if (found) return found;
    }
    return null;
  };
  return walk(id, [id]);
}
