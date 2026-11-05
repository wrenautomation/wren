/** Variants: the portal's review page (designs/2026-11-05-variants.md). */
import { makeVariantsConsole } from "@wren/variants/restate";
import type { AnyService, Deps } from "./deps.js";

export function variantsServices(deps: Deps): AnyService[] {
  const signer = deps.mediaSigner;
  return [makeVariantsConsole(deps.db, signer ? (uri) => signer.host.host(uri) : null)];
}
