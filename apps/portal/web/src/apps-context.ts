/**
 * The apps this viewer may open in the workspace on screen: what `App` shows, handed to a page that
 * lists them (Admin → Systems). One list, so a page never works out access a second way.
 */
import { createContext, useContext } from "react";
import type { Module } from "./module.js";

const Apps = createContext<readonly Module[]>([]);
export const AppsProvider = Apps.Provider;
export const useApps = (): readonly Module[] => useContext(Apps);
