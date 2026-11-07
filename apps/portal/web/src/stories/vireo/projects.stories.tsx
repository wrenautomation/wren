/** Vireo (Variants) › Projects: the generation tree. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { ADMIN } from "../../mocks/data/me.js";
import { pageAt } from "../../mocks/page.js";

const meta: Meta = { title: "Vireo/Projects" };
export default meta;

export const Default = pageAt("/variants/projects", { me: ADMIN });

/** A subject's generation tree: four rounds, one open (blind). */
export const Tree = pageAt("/variants/projects?subject=3", { me: ADMIN });

/** Notes only, no calls: grew and unmarked carry the tree (prod's shape). */
export const TreeNotes = pageAt("/variants/projects?subject=4", { me: ADMIN });

/** One sample's line only (`branch=`): its parents up to the brief and all it grew. */
export const TreeBranch = pageAt("/variants/projects?subject=3&branch=14", { me: ADMIN });

/** A folded sample (`fold=`): what grew only from it goes to "+N". */
export const TreeFold = pageAt("/variants/projects?subject=4&fold=109", { me: ADMIN });
