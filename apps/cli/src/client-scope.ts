/**
 * Which commands honour `--client`. Everything else runs Wren's own loops or the registry, so
 * `--client` there is refused rather than silently ignored.
 */
import type { Command } from "commander";

const CLIENT_SCOPED = new Set([
  "db",
  "email",
  "crm",
  "audit",
  "delivery",
  "sms",
  "hooks",
  "lake",
  "learn",
  "notes",
  "people",
  "segments",
  "channels",
  "sites",
  "templates",
  "workflows",
  "write",
]);
/** Under a client-scoped command, the parts that cover every database or only Wren's. */
const NOT_PER_CLIENT = new Set([
  "audit sealer",
  "sms numbers",
  "sms forms",
  "templates sync",
  "lake build",
  "lake sql",
  "lake status",
]);

/**
 * Before each action: hand `onPath` the command's path (`["audit", "sealer", "status"]`), then
 * refuse `--client` where the command doesn't take it.
 */
export function guardClient(program: Command, onPath: (path: string[]) => void = () => {}): void {
  program.hook("preAction", (_root, action) => {
    const path: string[] = [];
    for (let c: Command | null = action; c && c !== program; c = c.parent) path.unshift(c.name());
    onPath(path);
    if (!program.opts<{ client?: string }>().client) return;
    const top = path[0] ?? "";
    if (!CLIENT_SCOPED.has(top) || NOT_PER_CLIENT.has(path.slice(0, 2).join(" ")))
      throw new Error(`\`wren ${path.slice(0, 2).join(" ")}\` does not take --client`);
  });
}
