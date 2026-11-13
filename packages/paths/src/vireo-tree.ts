/**
 * Vireo as a tree (designs/2026-11-12-explorer.md D4): `vireo/subjects/<slug>/batches/<batch id>/
 * <sample id>`, `vireo/guides/<id>`. A sample's `grew-from` / `grew-into` hold its parents and
 * children, `applies` its guides; a guide's `applied-in` its samples. Reads only through a
 * `VireoSource`, which has applied the blind rule already: an open batch's samples come with no
 * parents and no guides, so their links never show. Browser-safe: core only.
 * One adapter per request: subjects load once.
 */

import {
  type Adapter,
  aliasOf,
  type Item,
  itemFromParent,
  join,
  linksOf,
  PAGE_SIZE,
  type Page,
  PathError,
  pageOf,
  relationRow,
  segments,
  type Whole,
} from "@wren/core/paths";

const ROOT = "vireo";

export interface VireoSubject {
  id: number;
  slug: string;
  name: string;
  kind: string;
  state: string;
  samples: number;
  kept: number;
  toPick: number;
}
export interface VireoGuide {
  id: number;
  text: string;
  source: string;
  ref: string | null;
  kind: string | null;
  state: string;
  /** the subject it is scoped to; null: a kind, or all */
  subject: string | null;
}
export interface VireoSample {
  id: number;
  position: number;
  name: string | null;
  body: string | null;
  /** a still the browser can show (signed) */
  posterUrl: string | null;
  /** the file itself (signed): a video, an image, a pdf */
  mediaUrl: string | null;
  parents: { id: number }[];
  guides: number[];
  verdict: string | null;
  score: number | null;
  keptAt: unknown;
  /** the rest a viewer may see: change, agent, calls, notes, strength */
  detail: Record<string, unknown>;
}
export interface VireoBatch {
  id: number;
  n: number;
  ref: string;
  title: string | null;
  /** null: blind */
  why: string | null;
  state: string;
  note: string | null;
  /** the source hid its lineage and guides from this viewer (open batch) */
  blind: boolean;
  /** good rate, judges */
  detail: Record<string, unknown>;
  samples: VireoSample[];
}
/** One subject as a viewer may see it: blind applied, stills signed. */
export interface VireoSubjectSeen {
  subject: { id: number; slug: string; name: string; kind: string; brief: string | null };
  batches: VireoBatch[];
  guides: { id: number }[];
}
/** A sample that applied a guide, with where it lives. */
export interface VireoApplied {
  id: number;
  name: string | null;
  position: number;
  posterUrl: string | null;
  batch: number;
  subject: string;
}

/** What the tree reads. A subject or guide not there rejects with PathError `unknown-path`. */
export interface VireoSource {
  subjects(): Promise<VireoSubject[]>;
  subject(slug: string): Promise<VireoSubjectSeen>;
  guides(): Promise<VireoGuide[]>;
  appliedIn(guide: number): Promise<VireoApplied[]>;
}

const SAMPLE_RELS = new Set(["grew-from", "grew-into", "applies"]);
/** An open batch's samples came with no parents or guides: their folders are blind, not empty. */
const blindTo = (b: Pick<VireoBatch, "blind">, rel: string) => {
  if (b.blind && (rel === "grew-from" || rel === "applies"))
    throw new PathError("blind", `${rel} of a sample stays hidden while its batch is open`);
};

const sampleName = (s: Pick<VireoSample, "name" | "position">) =>
  s.name ?? `Sample ${s.position + 1}`;

/** the row a subject shows as, here and in a folder */
export const subjectRow = (s: VireoSubject): Item => ({
  path: join(ROOT, "subjects", s.slug),
  name: s.name,
  sub: `${s.slug} · ${s.kind} · ${s.samples} samples, ${s.kept} kept${s.toPick ? `, ${s.toPick} to pick` : ""}`,
  kind: "subject",
  ...(s.state !== "open" ? { mark: s.state } : {}),
});

export function vireoTree(src: VireoSource): Adapter {
  let subjectsP: Promise<VireoSubject[]> | undefined;
  const subjects = () => {
    subjectsP ??= src.subjects();
    return subjectsP;
  };
  let guidesP: Promise<VireoGuide[]> | undefined;
  const guides = () => {
    guidesP ??= src.guides();
    return guidesP;
  };
  const seen = new Map<string, Promise<VireoSubjectSeen>>();
  const subject = (slug: string) => {
    let p = seen.get(slug);
    if (!p) {
      p = subjects().then((all) => {
        if (!all.some((s) => s.slug === slug))
          throw new PathError("unknown-path", `Vireo has no subject ${slug}`);
        return src.subject(slug);
      });
      seen.set(slug, p);
    }
    return p;
  };

  const guideRow = (g: VireoGuide): Item => ({
    path: join(ROOT, "guides", String(g.id)),
    name: g.text,
    sub: [g.ref ? `${g.source}: ${g.ref}` : g.source, g.subject ?? g.kind ?? "every subject"].join(
      " · ",
    ),
    kind: "guide",
    mark: g.state,
  });
  const batchHome = (slug: string, b: number) => join(ROOT, "subjects", slug, "batches", String(b));
  const batchRow = (slug: string, b: VireoBatch): Item => {
    const poster = b.samples.find((s) => s.posterUrl)?.posterUrl;
    return {
      path: batchHome(slug, b.id),
      name: b.title ?? `Batch ${b.n}`,
      sub: `${b.ref} · ${b.samples.length} samples`,
      kind: "batch",
      ...(b.state === "open" ? { mark: "open" } : {}),
      ...(poster ? { poster } : {}),
    };
  };

  /** A subject's samples by id, each with its batch, and who grew from whom. */
  const lineOf = async (slug: string) => {
    const x = await subject(slug);
    const at = new Map<number, { s: VireoSample; b: VireoBatch }>();
    for (const b of x.batches) for (const s of b.samples) at.set(s.id, { s, b });
    const into = new Map<number, number[]>();
    for (const { s } of at.values())
      for (const p of s.parents) into.set(p.id, [...(into.get(p.id) ?? []), s.id]);
    return { x, at, into };
  };
  const sampleRow = (slug: string, b: VireoBatch, s: VireoSample, kids: number): Item => {
    const linked = s.parents.length > 0 || s.guides.length > 0 || kids > 0;
    return {
      path: join(batchHome(slug, b.id), String(s.id)),
      name: sampleName(s),
      sub: s.verdict ? `${s.verdict} · ${s.score}` : `#${s.id}`,
      kind: "sample",
      ...(s.keptAt ? { mark: "kept" } : {}),
      ...(s.posterUrl ? { poster: s.posterUrl } : {}),
      ...(linked ? {} : { leaf: true }),
    };
  };
  /** One sample, its rows of kin and guides. */
  const sampleOf = async (slug: string, batch: string, id: string) => {
    const l = await lineOf(slug);
    const hit = l.at.get(Number(id));
    if (!hit || String(hit.b.id) !== batch)
      throw new PathError("unknown-path", `batch ${batch} of ${slug} holds no sample ${id}`);
    // kin sit in other batches: the sub names theirs
    const rowOf = (n: number) => {
      const k = l.at.get(n);
      if (!k) return [];
      const r = sampleRow(slug, k.b, k.s, l.into.get(n)?.length ?? 0);
      return [{ ...r, sub: `${k.b.title ?? `Batch ${k.b.n}`} · ${r.sub}` }];
    };
    const byId = new Map((await guides()).map((g) => [g.id, g]));
    return {
      ...hit,
      row: sampleRow(slug, hit.b, hit.s, l.into.get(hit.s.id)?.length ?? 0),
      from: hit.s.parents.flatMap((p) => rowOf(p.id)),
      into: (l.into.get(hit.s.id) ?? []).flatMap(rowOf),
      applies: hit.s.guides.flatMap((g) => {
        const r = byId.get(g);
        return r ? [guideRow(r)] : [];
      }),
    };
  };
  const appliedRows = async (id: number) =>
    (await src.appliedIn(id)).map(
      (a): Item => ({
        path: join(batchHome(a.subject, a.batch), String(a.id)),
        name: sampleName(a),
        sub: a.subject,
        kind: "sample",
        ...(a.posterUrl ? { poster: a.posterUrl } : {}),
      }),
    );
  const guideOf = async (id: string) => {
    const g = (await guides()).find((x) => String(x.id) === id);
    if (!g) throw new PathError("unknown-path", `Vireo has no guide ${id}`);
    return g;
  };

  const children = async (path: string, after?: string): Promise<Page> => {
    const segs = segments(path);
    const [root, area, a, b, c, d, rel] = segs;
    if (root !== ROOT) throw new PathError("unknown-path", `not a Vireo path: ${path}`);
    if (!area)
      return {
        items: [
          {
            path: join(ROOT, "subjects"),
            name: "Subjects",
            kind: "area",
            count: (await subjects()).length,
          },
          {
            path: join(ROOT, "guides"),
            name: "Guides",
            kind: "area",
            count: (await guides()).length,
          },
        ],
      };
    if (area === "guides") {
      if (!a) return pageOf((await guides()).map(guideRow), after);
      const g = await guideOf(a);
      const home = guideRow(g).path;
      if (!b) return { items: relationRow(home, "applied-in", await appliedRows(g.id)) };
      if (b === "applied-in" && segs.length === 4)
        return pageOf(
          (await appliedRows(g.id)).map((r) => aliasOf(join(home, b), r)),
          after,
        );
      throw new PathError("unknown-path", `${path} is an alias: read it at its home`);
    }
    if (area !== "subjects") throw new PathError("unknown-path", `Vireo has no ${area}`);
    if (!a) return pageOf((await subjects()).map(subjectRow), after);
    const x = await subject(a);
    const base = join(ROOT, "subjects", a);
    if (!b)
      return {
        items: [
          { path: join(base, "batches"), name: "Batches", kind: "layer", count: x.batches.length },
          { path: join(base, "guides"), name: "Guides", kind: "layer", count: x.guides.length },
        ],
      };
    if (b === "guides") {
      if (c) throw new PathError("unknown-path", `${path} is an alias: read it at its home`);
      const byId = new Map((await guides()).map((g) => [g.id, g]));
      return {
        items: x.guides.flatMap((g) => {
          const r = byId.get(g.id);
          return r ? [aliasOf(path, guideRow(r))] : [];
        }),
      };
    }
    if (b !== "batches") throw new PathError("unknown-path", `a subject holds no ${b}`);
    if (!c) {
      const newest = [...x.batches].sort((p, q) => q.n - p.n);
      return pageOf(
        newest.map((y) => batchRow(a, y)),
        after,
      );
    }
    const batch = x.batches.find((y) => String(y.id) === c);
    if (!batch) throw new PathError("unknown-path", `${a} has no batch ${c}`);
    if (!d) {
      const l = await lineOf(a);
      return {
        items: [...batch.samples]
          .sort((p, q) => p.position - q.position)
          .map((s) => sampleRow(a, batch, s, l.into.get(s.id)?.length ?? 0)),
      };
    }
    const s = await sampleOf(a, c, d);
    const home = s.row.path;
    if (!rel)
      return {
        items: [
          ...relationRow(home, "grew-from", s.from),
          ...relationRow(home, "grew-into", s.into),
          ...relationRow(home, "applies", s.applies),
        ],
      };
    if (segs.length === 7 && rel && SAMPLE_RELS.has(rel)) {
      blindTo(batch, rel);
      const rows = rel === "grew-from" ? s.from : rel === "grew-into" ? s.into : s.applies;
      return { items: rows.map((r) => aliasOf(join(home, rel), r)) };
    }
    throw new PathError("unknown-path", `${path} is an alias: read it at its home`);
  };

  const adapter: Adapter = {
    root: ROOT,
    children,
    item: async (path) => {
      const segs = segments(path);
      const [root, area, a, b, c, d] = segs;
      if (root !== ROOT) throw new PathError("unknown-path", `not a Vireo path: ${path}`);
      if (!area) return { path: ROOT, name: "Vireo", kind: "root" };
      if (segs.length === 2) {
        if (area !== "subjects" && area !== "guides")
          throw new PathError("unknown-path", `Vireo has no ${area}`);
        return { path, name: area === "subjects" ? "Subjects" : "Guides", kind: "area" };
      }
      if (area === "guides" && a && segs.length === 3) return guideRow(await guideOf(a));
      if (area === "subjects" && a && segs.length === 3) {
        const s = (await subjects()).find((y) => y.slug === a);
        if (!s) throw new PathError("unknown-path", `Vireo has no subject ${a}`);
        return subjectRow(s);
      }
      if (area === "subjects" && a && (b === "batches" || b === "guides") && segs.length === 4) {
        const x = await subject(a);
        return {
          path,
          name: b === "batches" ? "Batches" : "Guides",
          kind: "layer",
          count: b === "batches" ? x.batches.length : x.guides.length,
        };
      }
      if (area === "subjects" && a && b === "batches" && c && segs.length === 5) {
        const batch = (await subject(a)).batches.find((y) => String(y.id) === c);
        if (!batch) throw new PathError("unknown-path", `${a} has no batch ${c}`);
        return batchRow(a, batch);
      }
      if (area === "subjects" && a && b === "batches" && c && d && segs.length === 6)
        return (await sampleOf(a, c, d)).row;
      // the walk asks here first: say blind, not "nothing at"
      if (area === "subjects" && a && b === "batches" && c && d && segs.length === 7)
        blindTo((await sampleOf(a, c, d)).b, segs[6] ?? "");
      return itemFromParent(adapter, path);
    },
    whole: async (path) => {
      const it = await adapter.item(path);
      const segs = segments(it.path);
      const [, area, a, b, c, d] = segs;
      const out: Whole = { ...it, links: await linksOf(adapter, it) };
      if (area === "guides" && a && segs.length === 3) {
        const g = await guideOf(a);
        return { ...out, body: g.text, data: g };
      }
      if (area !== "subjects" || !a) return out;
      if (segs.length === 3) {
        const x = await subject(a);
        return {
          ...out,
          body: x.subject.brief ?? "",
          data: { subject: x.subject, batches: x.batches.length, guides: x.guides.length },
        };
      }
      if (b === "batches" && c && segs.length === 5) {
        const batch = (await subject(a)).batches.find((y) => String(y.id) === c);
        if (!batch) return out;
        const { samples, ...rest } = batch;
        return { ...out, body: batch.why ?? "", data: { ...rest, samples: samples.length } };
      }
      if (b === "batches" && c && d && segs.length === 6) {
        const s = await sampleOf(a, c, d);
        const { kind } = (await subject(a)).subject;
        return {
          ...out,
          body: s.s.body ?? "",
          // kind: how to draw it (text, image, video, page)
          data: { sample: s.s, kind, batch: s.b.ref, state: s.b.state, blind: s.b.blind },
        };
      }
      return out;
    },
    find: async (q, under) => {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const has = (...texts: (string | null | undefined)[]) => {
        const t = texts.filter(Boolean).join(" ").toLowerCase();
        return words.every((w) => t.includes(w));
      };
      const [, area, a] = segments(under ?? ROOT);
      if (area === "subjects" && a) {
        const l = await lineOf(a);
        return [...l.at.values()]
          .filter(({ s }) => has(s.name, s.body))
          .map(({ s, b }) => sampleRow(a, b, s, l.into.get(s.id)?.length ?? 0))
          .slice(0, PAGE_SIZE);
      }
      const subs =
        area === "guides"
          ? []
          : (await subjects()).filter((s) => has(s.name, s.slug)).map(subjectRow);
      const gs =
        area === "subjects" ? [] : (await guides()).filter((g) => has(g.text, g.ref)).map(guideRow);
      return [...subs, ...gs].slice(0, PAGE_SIZE);
    },
  };
  return adapter;
}
