/**
 * The standard's rows and his calls, read from Canon (designs/2026-11-09-knowledge-repo.md,
 * WA-1317): each live source with a `breakdown` is a row; his `verdict` records from `owner` are
 * the calls. A piece counts toward a standard once someone picked it (a hand breakdown, a saved
 * link, a followed feed's piece, or his keep); a piece he dropped whole never counts.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Loaded, loadWorking } from "@wrenautomation/knowledge";
import { factRows, ITEM_PATH, isFactCall } from "./calls.js";
import { type Breakdown, isBrokenDown } from "./labels.js";
import {
  callsMarkdown,
  draftScope,
  inScope,
  type PlaybookStandard,
  type SopCall,
  type SopScope,
  type StandardRow,
  scopeOf,
  standardMarkdown,
  standardOf,
} from "./standard.js";

type Fm = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const obj = (v: unknown): Fm | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Fm) : null;

/** Host → platform where the name differs from the host's first label. */
const HOSTS: Record<string, string> = { "youtu.be": "youtube", "twitter.com": "x" };

/** The platform: the source's own `platform`, else the URL's host. */
export function platformOf(fm: Fm): string | null {
  const own = str(fm.platform);
  if (own) return own;
  const url = str(fm.url);
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^(www|m)\./, "");
    return HOSTS[host] ?? host.split(".")[0] ?? null;
  } catch {
    return null;
  }
}

/** Views, else likes plus comments; null with neither. */
const reachOf = (stats: Fm | null): number | null => {
  const views = num(stats?.views);
  if (views !== null) return views;
  const sum = (num(stats?.likes) ?? 0) + (num(stats?.comments) ?? 0);
  return sum || null;
};

/** His calls: owner verdicts, the newest per source and path. */
export function verdictsOf(docs: Loaded[]): Map<string, Map<string, Fm>> {
  const by = new Map<string, Map<string, Fm>>();
  for (const { doc } of docs) {
    const fm = doc.fm as Fm;
    if (fm.type !== "verdict" || fm.status !== "live" || fm.from !== "owner") continue;
    const source = (fm.cites as unknown[] | undefined)?.find((c) => typeof c === "string") as
      | string
      | undefined;
    const call = str(fm.call);
    if (!source || !call || !isFactCall(call)) continue;
    const path = str(fm.path) ?? ITEM_PATH;
    const paths = by.get(source) ?? new Map<string, Fm>();
    const prev = paths.get(path);
    if (!prev || String(fm.at ?? "") >= String(prev.at ?? "")) paths.set(path, fm);
    by.set(source, paths);
  }
  return by;
}

export interface StandardPiece {
  row: StandardRow;
  breakdown: Breakdown;
  tags: string[];
  /** Counts toward a standard. */
  picked: boolean;
}

/** Every live source with a breakdown, as a row, with whether it counts. */
export function piecesOf(docs: Loaded[]): StandardPiece[] {
  const calls = verdictsOf(docs);
  const out: StandardPiece[] = [];
  for (const { doc } of docs) {
    const fm = doc.fm as Fm;
    if (fm.type !== "source" || fm.status !== "live") continue;
    const b = obj(fm.breakdown) as unknown as Breakdown | null;
    if (!b || !isBrokenDown(String(b.kind))) continue;
    const f = obj(b.facts) ?? {};
    const whole = str(calls.get(String(fm.id))?.get(ITEM_PATH)?.call);
    const picked =
      whole !== "drop" && (b.by === "hand" || !!fm.saved || !!fm.feed || whole === "keep");
    out.push({
      breakdown: b,
      tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
      picked,
      row: {
        id: String(fm.id),
        kind: b.kind,
        platform: platformOf(fm),
        creator: str(fm.handle) ?? str(obj(fm.feed)?.name),
        title: str(fm.title) ?? String(fm.id),
        reach: reachOf(obj(fm.stats)),
        at: str(fm.date) ?? str(fm.created),
        by: b.by === "hand" ? "hand" : "model",
        hookStyle: str(b.hookStyle),
        ctaKind: str(b.ctaKind),
        format: str(f.format),
        shape: str(f.shape),
        link: str(f.link),
        chars: num(f.chars),
        lines: num(f.lines),
        firstLineChars: num(f.first_line_chars),
        hashtags: num(f.hashtags),
        durationS: num(f.duration_s),
        cuts: num(f.cuts),
        shotMedianS: num(f.shot_median_s),
        shotP90S: num(f.shot_p90_s),
        firstProductS: num(f.first_product_s),
        logoS: num(f.logo_s),
        ctaS: num(f.cta_s),
        cutsTrust: str(f.cuts_trust),
        music: bool(f.music),
        vo: bool(f.vo),
      },
    });
  }
  return out;
}

/**
 * His standing calls on the pieces an SOP covers: in its scope (a dropped piece too, so its drop
 * shows) or tagged with the SOP. A call on a path the breakdown no longer lists is dropped.
 */
export function callsOf(
  docs: Loaded[],
  pieces: StandardPiece[],
  scopes: SopScope[],
  sop: string,
): SopCall[] {
  const verdicts = verdictsOf(docs);
  const out: SopCall[] = [];
  for (const p of pieces) {
    if (!p.tags.includes(sop) && !scopes.some((s) => inScope(p.row, s))) continue;
    for (const [path, v] of verdicts.get(p.row.id) ?? []) {
      const fact =
        path === ITEM_PATH
          ? { label: "Whole piece", value: "" }
          : factRows(p.breakdown).find((r) => r.path === path);
      if (!fact) continue;
      out.push({
        id: p.row.id,
        title: p.row.title,
        creator: p.row.creator,
        path,
        label: fact.label,
        value: fact.value,
        call: v.call as SopCall["call"],
        comment: str(v.comment),
        at: String(v.at ?? ""),
      });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id) || a.path.localeCompare(b.path));
}

const picked = (pieces: StandardPiece[]) => pieces.filter((p) => p.picked).map((p) => p.row);

/**
 * Write `standard.md` and `calls.md` into an SOP's folder from its scope. Null when the notes
 * name no kinds: the SOP governs no pieces, and the two files are not written.
 */
export async function writeSopFiles(
  root: string,
  dir: string,
  sop: string,
  notes: string,
): Promise<{ scope: SopScope; files: string[]; pieces: number; calls: number } | null> {
  const scope = scopeOf(notes, sop);
  if (!scope) return null;
  const { docs } = loadWorking(root);
  const pieces = piecesOf(docs);
  const standard = standardOf(picked(pieces), scope);
  const calls = callsOf(docs, pieces, [scope], sop);
  const files = [join(dir, "standard.md"), join(dir, "calls.md")];
  await writeFile(files[0] as string, standardMarkdown(scope, standard));
  await writeFile(files[1] as string, callsMarkdown(scope, calls));
  return { scope, files, pieces: standard.reduce((n, k) => n + k.n, 0), calls: calls.length };
}

/**
 * The snapshot `wren topic push` stores on a playbook: each kind the SOP names over its scope, and
 * `post` on the pushed platform when it governs posts (what a draft is held to), with his calls.
 */
export function playbookStandard(
  root: string,
  sop: string,
  scope: SopScope | null,
  platform: string,
  now = new Date(),
): PlaybookStandard {
  const { docs } = loadWorking(root);
  const pieces = piecesOf(docs);
  const rows = picked(pieces);
  const posts = !scope?.kinds.length || scope.kinds.includes("post");
  const scopes: SopScope[] = [
    ...(scope?.kinds ?? [])
      .filter((k) => k !== "post")
      .map((k) => ({ ...scope, kinds: [k] }) as SopScope),
    ...(posts ? [draftScope(scope ? { sop, scope } : null, "post", platform)] : []),
  ];
  return {
    at: now.toISOString(),
    kinds: scopes.flatMap((s) => standardOf(rows, s)),
    calls: callsOf(docs, pieces, scopes, sop),
  };
}
