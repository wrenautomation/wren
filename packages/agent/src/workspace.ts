/**
 * A workspace: a project folder Vireo builds a subject's samples in (designs/2026-11-05-variants.md,
 * 11-17, W4). Its rules are rows in wren's database, written by the owner only; its recipe is the
 * folder's VIREO.md. A run for a subject is the `vireo` setup with its workspace on top.
 */
import { z } from "zod";
import type { Setup } from "./setup.js";

const names = z.array(z.string().min(1));

// strict: a misspelt key fails the write, never drops a limit without a word
export const WorkspaceRules = z.strictObject({
  /** Absolute: the project folder on this Mac. */
  cwd: z.string().regex(/^\//, "an absolute path"),
  /** Vireo subjects (slugs) built here; one workspace per subject. */
  subjects: names.min(1),
  model: z.string().min(1).optional(),
  /** Built-in tools; none: Vireo's. */
  tools: names.min(1).optional(),
  /** `permissions.allow` rules, on top of Vireo's. */
  allow: names.default([]),
  /** The CLI's `sandbox` settings, as they are. */
  sandbox: z.record(z.string(), z.unknown()).optional(),
});
export type WorkspaceRules = z.infer<typeof WorkspaceRules>;

export interface Workspace extends WorkspaceRules {
  name: string;
}

/** The recipe a run reads: how to build in this project. */
export const RECIPE = "VIREO.md";

export const WORKSPACE_NAME = /^[a-z][a-z0-9-]*$/;

/** The setup a run of `base` uses in `w`: the folder, its rules on top, its recipe appended. */
export function inWorkspace(base: Setup, w: Workspace, recipe: string | null): Setup {
  const model = w.model ?? base.model;
  return {
    ...base,
    cwd: w.cwd,
    model,
    models: [...new Set([model, ...(base.models ?? [])])],
    tools: w.tools ?? base.tools,
    allow: [...new Set([...base.allow, ...w.allow])],
    ...(w.sandbox ? { sandbox: w.sandbox } : {}),
    append: [base.append, recipe?.trim()].filter(Boolean).join("\n\n"),
  };
}
