/** The portal's apps, in launcher order: the work first, then each product, then Wren's own. Account is a menu app, never a card. */
import type { Module } from "../module.js";
import { account } from "./account/index.js";
import { ops } from "./ops/index.js";
import { pipeline } from "./pipeline/index.js";
import { reactivation } from "./reactivation/index.js";
import { work } from "./work/index.js";

export const MODULES: Module[] = [work, reactivation, ops, pipeline, account];
