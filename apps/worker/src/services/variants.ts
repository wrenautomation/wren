/** Variants: the review page, and the live numbers loop (designs/2026-11-05-variants.md). */
import { makeFoldersConsole } from "@wren/folders/restate";
import { makePathsConsole } from "@wren/paths/restate";
import { enqueueAdd } from "@wren/research/canon-adds";
import { type Media, makeCanonConsole } from "@wren/research/canon-console";
import { makeCreatorFindDesk } from "@wren/research/creator-find-desk";
import { signMediaPut } from "@wren/starling-inbound";
import { makeVariantsCollect, makeVariantsConsole } from "@wren/variants/restate";
import type { AnyService, Deps } from "./deps.js";

export function variantsServices(deps: Deps): AnyService[] {
  const signer = deps.mediaSigner;
  const media: Media | null = signer
    ? {
        bucket: signer.bucket,
        sign: (uri) => signer.host.host(uri),
        signPut: (f) => signMediaPut({ bucket: signer.bucket }, f),
        ...(deps.settings.mediaOrigin ? { origin: deps.settings.mediaOrigin } : {}),
      }
    : null;
  return [
    // a kept board pin goes to Canon's Add queue (vireo board B4); uploads land in the media bucket
    makeVariantsConsole(deps.db, signer ? (uri) => signer.host.host(uri) : null, {
      keep: ({ what, note, by }) => enqueueAdd(deps.db, { what, note, askedBy: by }),
      ...(signer ? { bucket: signer.bucket } : {}),
    }),
    makeVariantsCollect({ db: deps.db, ...deps.notify }),
    // the one folder tree: Variants subjects, agent chats, Weaver runs (designs/2026-11-08-folders.md)
    makeFoldersConsole(deps.db),
    // Canon: reads schema `canon` (designs/2026-11-12-canon-references.md)
    makeCanonConsole(deps.db, media, deps.settings.canonRemote),
    // Add creator: the find's desk calls (designs/2026-11-16-creator-add.md D2)
    makeCreatorFindDesk(deps.db),
    // Explorer's server roots: Canon as a tree (designs/2026-11-12-explorer.md)
    makePathsConsole({ db: deps.db, media, canonRemote: deps.settings.canonRemote }),
  ];
}
