/** His own look over Wren's workspace (Settings → Look), read by the frame and its settings page. */
import type { Pref } from "@wren/ui";
import { createContext, useContext } from "react";

const LookContext = createContext<Pref<unknown> | null>(null);
export const LookProvider = LookContext.Provider;
/** Null outside Wren's workspace. */
export const useMyLook = () => useContext(LookContext);
