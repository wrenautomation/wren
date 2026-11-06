/**
 * A compacted chat whole. The SDK's reader starts at the last compaction and drops the boundary's
 * numbers and the summary's flag (SDK 0.3.318), so a chat with a boundary is read from its file:
 * the chain from the leaf, across each boundary by `logicalParentUuid`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Row = Record<string, unknown>;
const TURN = new Set(["user", "assistant", "system"]);

/** The file of a session, in any project dir: ids are UUIDs. */
function transcriptFile(session: string, root = configRoot()): string | undefined {
  if (!/^[\w-]+$/.test(session)) return undefined;
  const projects = join(root, "projects");
  if (!existsSync(projects)) return undefined;
  for (const d of readdirSync(projects)) {
    const f = join(projects, d, `${session}.jsonl`);
    if (existsSync(f)) return f;
  }
  return undefined;
}

const configRoot = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");

/** The chain's turns in order, as the stored frames the page folds; undefined: no boundary in it. */
export function compactedChain(rows: readonly Row[], session: string): Row[] | undefined {
  // attachments are links in the chain too; only turns are kept
  const linked = rows.filter((r) => typeof r.uuid === "string" && !r.isSidechain);
  const by = new Map(linked.map((r) => [r.uuid as string, r]));
  const out: Row[] = [];
  let at = linked.findLast((r) => TURN.has(String(r.type)));
  let crossed = false;
  const seen = new Set<string>();
  while (at && !seen.has(at.uuid as string)) {
    seen.add(at.uuid as string);
    out.push(at);
    const next = (at.parentUuid ?? at.logicalParentUuid) as string | null | undefined;
    if (!at.parentUuid && at.logicalParentUuid) crossed = true;
    at = next ? by.get(next) : undefined;
  }
  if (!crossed) return undefined;
  return out
    .reverse()
    .filter((r) => TURN.has(String(r.type)))
    .map((r) => ({
      ...r,
      session_id: session,
      parent_tool_use_id: null,
      ...(r.toolUseResult !== undefined ? { tool_use_result: r.toolUseResult } : {}),
    }));
}

/** The compacted chat's frames, or undefined to read it the SDK's way. */
export function readCompacted(session: string, root?: string): Row[] | undefined {
  const f = transcriptFile(session, root);
  if (!f) return undefined;
  const text = readFileSync(f, "utf8");
  if (!text.includes('"compact_boundary"')) return undefined;
  const rows: Row[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      rows.push(JSON.parse(line) as Row);
    } catch {
      // a torn last line while the CLI writes
    }
  }
  return compactedChain(rows, session);
}
