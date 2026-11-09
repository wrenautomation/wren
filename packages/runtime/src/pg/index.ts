/** The Postgres runtime (designs/2026-11-09-own-runtime.md). */

export { default as postgres } from "postgres";
export { rtAdmin, rtPatch } from "./admin.js";
export {
  bridgeTurn,
  type Ingress,
  proxy,
  proxyRowId,
  replier,
  returnState,
  takeState,
} from "./bridge.js";
export { Dispatcher, type DispatcherOptions } from "./dispatcher.js";
export { type DoorOptions, serveDoor } from "./door.js";
export { DEFAULT_LEASE_MS, type ExecutorOptions, runTurn } from "./executor.js";
export { Registry } from "./registry.js";
export { migrate } from "./schema.js";
export { type Claim, type Lane, register, release, renameService, setPgServices } from "./store.js";
export { Crash, type Outcome } from "./turn.js";
