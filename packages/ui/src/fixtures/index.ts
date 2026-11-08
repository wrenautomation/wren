/**
 * One fixture set for `@wren/ui`, shared by stories (`*.stories.tsx`) and unit tests. Synthetic
 * data only: the repo is public. Add to these files; never copy a fixture into a story.
 */

export { LOOP_EDGES, RIBBON_EDGES, RIBBON_NODES, wideGraph } from "./graph.js";
export { answer, fails, pending } from "./load.js";
export { pageOf } from "./records.js";
export { REEL_READ, RUN_ASKS } from "./research.js";
export {
  fakeRunGraph,
  RUN_GRAPH,
  RUN_GRAPH_EMPTY,
  RUN_GRAPH_ONE_ROUND,
  RUN_GRAPH_WORST,
} from "./run-graph.js";
export { islandsWeb } from "./web.js";
export { WORST } from "./worst.js";
