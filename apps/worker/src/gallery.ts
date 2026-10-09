/**
 * The public template gallery (designs/2026-10-09-gallery.md): the code's client templates as
 * JSON for the lander to build pages from. Only what a stranger may read: names, what each step
 * does, what it sends or spends. Saved templates stay in the portal; they are a client's wiring.
 */
import type { Component } from "@wren/core/components";
import { type Template, templatesOf } from "@wren/core/templates/install";
import type { Workflow } from "@wren/core/workflows";

/** Bumped when the shape changes, so the lander can refuse one it doesn't know. */
export const GALLERY_VERSION = 1;

export interface GalleryTemplate {
  id: string;
  name: string;
  blurb: string;
  icon: string;
  /** What it does in the world: `sends`, `spends`, `posts`. */
  effects: string[];
  /** Its steps in order: the part's name, and what it does here. */
  steps: { name: string; does: string }[];
}

export interface Gallery {
  version: number;
  note: string;
  templates: GalleryTemplate[];
}

const stepsOf = (t: Template, components: readonly Component[]) =>
  t.workflow.nodes.flatMap((n) => {
    const c = components.find((x) => x.id === n.uses);
    if (!c && !n.note) return [];
    return [{ name: c?.name ?? n.id, does: n.note ?? c?.blurb ?? "" }];
  });

export function gallery(workflows: readonly Workflow[], components: readonly Component[]): Gallery {
  return {
    version: GALLERY_VERSION,
    note: "Generated from wren by `pnpm templates:export`. Edit the template there, not here.",
    templates: templatesOf(workflows, components)
      .filter((t) => t.workflow.for === "client" && t.workflow.kind !== "setup")
      .map((t) => ({
        id: t.id.replace(/_/g, "-"),
        name: t.name,
        blurb: t.blurb,
        icon: t.icon,
        effects: [...t.effects].sort(),
        steps: stepsOf(t, components),
      })),
  };
}

export const galleryText = (g: Gallery): string => `${JSON.stringify(g, null, 2)}\n`;
