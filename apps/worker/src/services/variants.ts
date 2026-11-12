/** Variants: the review page, and the live numbers loop (designs/2026-11-05-variants.md). */
import { makeFoldersConsole } from "@wren/folders/restate";
import { makeCanonConsole } from "@wren/research/canon-console";
import { makeVariantsCollect, makeVariantsConsole } from "@wren/variants/restate";
import type { AnyService, Deps } from "./deps.js";

export function variantsServices(deps: Deps): AnyService[] {
  const signer = deps.mediaSigner;
  return [
    makeVariantsConsole(deps.db, signer ? (uri) => signer.host.host(uri) : null),
    makeVariantsCollect({ db: deps.db, ...deps.notify }),
    // the one folder tree: Variants subjects, agent chats, Weaver runs (designs/2026-11-08-folders.md)
    makeFoldersConsole(deps.db),
    // Canon › References: reads schema `canon` (designs/2026-11-12-canon-references.md)
    makeCanonConsole(
      deps.db,
      signer ? { bucket: signer.bucket, sign: (uri) => signer.host.host(uri) } : null,
    ),
  ];
}
