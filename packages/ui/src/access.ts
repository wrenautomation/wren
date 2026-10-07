/**
 * Who may see a node, page, app or action. No React, so a server can ask the same question.
 *
 * - audience `team`: Wren's team in team view.
 * - audience `client`: a signed-in workspace's own (plan, contract, prices): never on the demo.
 * - audience `demo`: the public demo's own (what in it is real), never a signed-in workspace.
 * - role `owner`: the workspace's owner, as the delivery service's `read()` checks.
 * - feature: the client's offers grant it. Wren's team passes every role and feature.
 * - needs: a permission (`@wren/core/access`) this login holds in this workspace, as `delivery/me`
 *   says. What a login can't do is hidden, not greyed out.
 * - flag: a feature flag (`@wren/core/flags`) that's on for this login here. The team passes.
 * - at: where `needs` is checked (an app, a channel, a record), against the login's grants as
 *   `portalMe` sent them, the same check the server's guard makes, so a hidden button and a
 *   refused call agree.
 */
import { can as allows, type Permission, type Target, type Who } from "@wren/core/access";

export interface Access {
  audience?: "team" | "client" | "demo";
  role?: "owner";
  feature?: string;
  needs?: Permission;
  flag?: string;
  at?: Target;
}

export interface Viewer {
  /** Wren's team, not looking as the client. */
  team: boolean;
  /** The public demo, or not known yet: shown only what the demo shows. */
  demo: boolean;
  role?: "owner" | "member" | "viewer";
  features?: readonly string[];
  /** What this login may do here; left out (the demo, a preview), `needs` isn't checked. */
  can?: readonly string[];
  /** Each flag's variant here, as `delivery/me` evaluated it. */
  flags?: Readonly<Record<string, string>>;
  /** This login's access as `portalMe` sent it: the role and its grants. Checks `at`. */
  who?: Who;
}

/** May this login do `verb` at `at`? No `who` (the demo, a preview): the `can` list alone. */
export function canAt(viewer: Viewer, verb: Permission, at: Target = {}): boolean {
  if (viewer.who !== undefined) return allows(viewer.who, verb, at);
  return !viewer.can || viewer.can.includes(verb);
}

export function can(viewer: Viewer, access: Access | undefined): boolean {
  if (!access) return true;
  if (access.audience === "team" && !viewer.team) return false;
  if (access.audience === "client" && viewer.demo) return false;
  if (access.audience === "demo" && !viewer.demo) return false;
  if (access.needs && viewer.can && !viewer.can.includes(access.needs)) return false;
  if (
    access.needs &&
    access.at &&
    viewer.who !== undefined &&
    !allows(viewer.who, access.needs, access.at)
  )
    return false;
  if (viewer.team) return true;
  if (access.role === "owner" && viewer.role !== "owner") return false;
  if (access.feature !== undefined && !viewer.features?.includes(access.feature)) return false;
  if (access.flag !== undefined && (viewer.flags?.[access.flag] ?? "off") === "off") return false;
  return true;
}
