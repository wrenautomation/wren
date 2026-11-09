// The durable runtime's one door (designs/2026-11-09-own-runtime.md). Restate's API; RestatePromise
// statics also serve the Postgres runtime's promises.
export * from "@restatedev/restate-sdk";
export { isRestatePromise, RestatePromise } from "./promise.js";
