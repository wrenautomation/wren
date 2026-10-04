/**
 * The portal's apps, in launcher order: a client's work first, then each product, then Wren's
 * own (Wren's workspace only). Account is a menu app, never a card.
 */
import type { Module } from "../module.js";
import { account } from "./account/index.js";
import { reactivation } from "./reactivation/index.js";
import { work } from "./work/index.js";
import { WREN_APPS } from "./wren/index.js";

export const MODULES: Module[] = [work, reactivation, ...WREN_APPS, account];
