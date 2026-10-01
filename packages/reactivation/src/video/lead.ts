/**
 * One firm's video, start to stored: skip it when this walk version already
 * made one, else record, publish and keep it as a `video` enrichment (model =
 * the walk, prompt version = its version). The enrichment's `url` is the
 * watch page an email links to; `recruiting_facts.video_url` carries it.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "@wren/db";
import { dossiers } from "@wren/research/dossier";
import { upsertEnrichment } from "@wren/research/enrichment";
import { enrichments } from "@wren/research/schema";
import { newVideoId, type PublishOptions, publish } from "@wren/video/publish";
import { and, eq } from "drizzle-orm";
import { videoBrief } from "./brief.js";
import { renderWalk, WALK, type WalkOptions } from "./walk.js";

export interface LeadVideoOptions extends Omit<WalkOptions, "dir"> {
  /** Work directory; each render gets its own folder, removed after. */
  workDir: string;
  store: PublishOptions;
  /** The watch page for an id: "https://wrenautomation.com/v/<id>". */
  watchUrl: (id: string) => string;
  runId?: string | null;
}

export type LeadVideo =
  | { status: "had"; companyId: number; url: string }
  | { status: "skipped"; companyId: number; why: string }
  | { status: "made"; companyId: number; url: string; seconds: number };

export async function videoForCompany(
  db: Db,
  companyId: number,
  o: LeadVideoOptions,
): Promise<LeadVideo> {
  const [had] = await db
    .select({ output: enrichments.output })
    .from(enrichments)
    .where(
      and(
        eq(enrichments.companyId, companyId),
        eq(enrichments.kind, "video"),
        eq(enrichments.model, WALK.name),
        eq(enrichments.promptVersion, WALK.version),
      ),
    );
  if (had) return { status: "had", companyId, url: String((had.output as { url?: unknown }).url) };

  const [dossier] = await dossiers(db, [companyId]);
  if (!dossier) return { status: "skipped", companyId, why: "no such company" };
  const brief = videoBrief(dossier);
  if ("skip" in brief) return { status: "skipped", companyId, why: brief.skip };

  const id = newVideoId();
  const dir = join(o.workDir, id);
  try {
    const encoded = await renderWalk(brief, { ...o, dir });
    const url = o.watchUrl(id);
    const published = await publish(encoded, id, { firm: brief.firm }, o.store);
    await upsertEnrichment(db, {
      kind: "video",
      model: WALK.name,
      promptVersion: WALK.version,
      companyId,
      runId: o.runId ?? null,
      output: {
        id,
        url,
        mp4: published.mp4,
        poster: published.poster,
        seconds: Math.round(encoded.seconds * 10) / 10,
        firm: brief.firm,
      },
    });
    return { status: "made", companyId, url, seconds: encoded.seconds };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
