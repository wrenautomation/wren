/**
 * Vireo's tree on the server (designs/2026-11-12-explorer.md D4): its store through
 * `blindFeedback`, so a viewer never sees an open batch's lineage; stills signed. No viewer
 * (the CLI, an agent): nothing hidden.
 */

import { PathError } from "@wren/core/paths";
import type { Db } from "@wren/db";
import type { Media } from "@wren/research/canon-console";
import { allGuides, blindFeedback, playableUrl, samplesApplying, variants } from "@wren/variants";
import { VireoError } from "@wrenautomation/vireo";
import { type VireoSource, vireoTree } from "./vireo-tree.js";

/** an image sample is its own still */
const IMAGE = /\.(jpe?g|png|gif|webp|avif)$/i;

/** Vireo's 404 → `unknown-path`; any other no stays as it is. */
const known = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof VireoError && e.status === 404) throw new PathError("unknown-path", e.message);
    throw e;
  }
};

function vireoSource(db: Db, viewer: string | null, media: Media | null): VireoSource {
  const v = variants(db);
  const url = playableUrl(media ? media.sign : null);
  return {
    subjects: async () =>
      (await v.listSubjects()).map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        kind: s.kind,
        state: s.state,
        samples: s.samples,
        kept: s.kept,
        toPick: s.toPick,
      })),
    subject: (slug) =>
      known(async () => {
        const f = blindFeedback(await v.feedback(slug), viewer);
        return {
          subject: {
            id: f.subject.id,
            slug: f.subject.slug,
            name: f.subject.name,
            kind: f.subject.kind,
            brief: f.subject.brief,
          },
          guides: f.guides.map((g) => ({ id: g.id })),
          batches: await Promise.all(
            f.batches.map(async (b) => ({
              id: b.id,
              n: b.n,
              ref: b.ref,
              title: b.title,
              why: b.why,
              state: b.state,
              note: b.note,
              blind: viewer != null && b.state === "open",
              // judges: a count; their emails stay in Vireo
              detail: { goodRate: b.goodRate, judges: b.judges.length, agent: b.agent },
              samples: await Promise.all(
                b.samples.map(async (s) => ({
                  id: s.id,
                  position: s.position,
                  name: s.name,
                  body: s.body,
                  posterUrl: await url(
                    s.poster ?? (s.media && IMAGE.test(s.media) ? s.media : null),
                  ),
                  mediaUrl: await url(s.media),
                  parents: s.parents.map((p) => ({ id: p.id })),
                  guides: s.guides,
                  verdict: s.verdict,
                  score: s.score,
                  keptAt: s.keptAt,
                  detail: {
                    change: s.change,
                    agent: s.agent,
                    strength: s.strength,
                    calls: s.calls,
                    notes: s.notes,
                    source: s.source,
                  },
                })),
              ),
            })),
          ),
        };
      }),
    guides: () => allGuides(db),
    appliedIn: async (id) =>
      Promise.all(
        (await samplesApplying(db, id, viewer)).map(async (a) => ({
          id: a.id,
          name: a.name,
          position: a.position,
          batch: a.batch,
          subject: a.subject,
          posterUrl: await url(a.poster),
        })),
      ),
  };
}

/** One adapter per request: what `viewer` may see of Vireo. */
export const vireoPaths = (db: Db, viewer: string | null, media: Media | null) =>
  vireoTree(vireoSource(db, viewer, media));
