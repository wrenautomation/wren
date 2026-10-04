/**
 * Who may see a node, page, app or action. No React, so a server can ask the same question.
 *
 * - audience `team`: Wren's team in team view.
 * - audience `client`: a signed-in workspace's own (plan, contract, prices): never on the demo.
 * - audience `demo`: the public demo's own (what in it is real), never a signed-in workspace.
 * - role `owner`: the workspace's owner, as the delivery service's `read()` checks.
 * - feature: the client's offers grant it. Wren's team passes every role and feature.
 */
export interface Access {
  audience?: "team" | "client" | "demo";
  role?: "owner";
  feature?: string;
}

export interface Viewer {
  /** Wren's team, not looking as the client. */
  team: boolean;
  /** The public demo, or not known yet: shown only what the demo shows. */
  demo: boolean;
  role?: "owner" | "member";
  features?: readonly string[];
}

export function can(viewer: Viewer, access: Access | undefined): boolean {
  if (!access) return true;
  if (access.audience === "team" && !viewer.team) return false;
  if (access.audience === "client" && viewer.demo) return false;
  if (access.audience === "demo" && !viewer.demo) return false;
  if (viewer.team) return true;
  if (access.role === "owner" && viewer.role !== "owner") return false;
  if (access.feature !== undefined && !viewer.features?.includes(access.feature)) return false;
  return true;
}
