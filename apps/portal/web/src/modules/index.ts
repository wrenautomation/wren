/** The portal's sections, in sidebar order: the work first, then each product, then Wren's own. */
import type { Module } from "../module.js";
import { ops } from "./ops/index.js";
import { reactivation } from "./reactivation/index.js";
import { work } from "./work/index.js";

export const MODULES: Module[] = [work, reactivation, ops];
