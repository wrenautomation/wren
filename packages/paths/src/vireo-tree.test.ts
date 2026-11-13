import { columns, homeAt, PathError, wholeAt } from "@wren/core/paths";
import { describe, expect, it } from "vitest";
import {
  type VireoBatch,
  type VireoSample,
  type VireoSource,
  type VireoSubjectSeen,
  vireoTree,
} from "./vireo-tree.js";

const sample = (id: number, position: number, o: Partial<VireoSample> = {}): VireoSample => ({
  id,
  position,
  name: null,
  body: `body ${id}`,
  posterUrl: null,
  mediaUrl: null,
  parents: [],
  guides: [],
  verdict: null,
  score: null,
  keptAt: null,
  detail: {},
  ...o,
});
const batch = (id: number, n: number, samples: VireoSample[], o: Partial<VireoBatch> = {}) => ({
  id,
  n,
  ref: `hooks:${n}`,
  title: `Batch ${n} title`,
  why: `why ${n}`,
  state: "closed",
  note: null,
  blind: false,
  detail: {},
  samples,
  ...o,
});

// batch 1 closed: 11 kept, 12 a leaf; batch 2: 21 grew from 11 and applies guide 7
const seen = (blind: boolean): VireoSubjectSeen => ({
  subject: { id: 1, slug: "hooks", name: "Video hooks", kind: "video", brief: "open strong" },
  guides: [{ id: 7 }],
  batches: [
    batch(10, 1, [
      sample(11, 0, {
        name: "Named place",
        keptAt: "2026-11-01",
        verdict: "good",
        score: 7,
        posterUrl: "https://s/11.jpg",
      }),
      sample(12, 1),
    ]),
    batch(20, 2, [sample(21, 0, blind ? {} : { parents: [{ id: 11 }], guides: [7] })], {
      state: "open",
      blind,
      why: blind ? null : "why 2",
    }),
  ],
});

const source = (o: { blind?: boolean; calls?: string[] } = {}): VireoSource => ({
  subjects: async () => {
    o.calls?.push("subjects");
    return [
      {
        id: 1,
        slug: "hooks",
        name: "Video hooks",
        kind: "video",
        state: "open",
        samples: 3,
        kept: 1,
        toPick: 1,
      },
      {
        id: 2,
        slug: "subject-lines",
        name: "Subject lines",
        kind: "text",
        state: "paused",
        samples: 0,
        kept: 0,
        toPick: 0,
      },
    ];
  },
  subject: async (slug) => {
    o.calls?.push(`subject ${slug}`);
    return slug === "hooks"
      ? seen(o.blind ?? false)
      : {
          subject: { id: 2, slug, name: "Subject lines", kind: "text", brief: null },
          guides: [],
          batches: [],
        };
  },
  guides: async () => [
    {
      id: 7,
      text: "Name a real place in the first line",
      source: "study",
      ref: "hooks-study",
      kind: null,
      state: "testing",
      subject: "hooks",
    },
    {
      id: 8,
      text: "Keep it under 8 words",
      source: "agent",
      ref: null,
      kind: "text",
      state: "locked",
      subject: null,
    },
  ],
  appliedIn: async (id) =>
    id === 7 && !o.blind
      ? [{ id: 21, name: null, position: 0, posterUrl: null, batch: 20, subject: "hooks" }]
      : [],
});

const S = "vireo/subjects/hooks";

describe("vireoTree", () => {
  it("holds subjects and guides; a subject holds batches and its guides", async () => {
    const t = vireoTree(source());
    expect((await t.children("vireo")).items.map((i) => [i.path, i.count])).toEqual([
      ["vireo/subjects", 2],
      ["vireo/guides", 2],
    ]);
    const subs = (await t.children("vireo/subjects")).items;
    expect(subs.map((i) => [i.path, i.mark])).toEqual([
      [S, undefined],
      ["vireo/subjects/subject-lines", "paused"],
    ]);
    expect((await t.children(S)).items.map((i) => [i.path, i.count])).toEqual([
      [`${S}/batches`, 2],
      [`${S}/guides`, 1],
    ]);
    expect((await t.children(`${S}/guides`)).items.map((i) => [i.path, i.original])).toEqual([
      [`${S}/guides/7`, "vireo/guides/7"],
    ]);
  });

  it("lists batches newest first, each with a poster; a batch's samples by position", async () => {
    const t = vireoTree(source());
    const bs = (await t.children(`${S}/batches`)).items;
    expect(bs.map((i) => [i.path, i.mark, i.poster])).toEqual([
      [`${S}/batches/20`, "open", undefined],
      [`${S}/batches/10`, undefined, "https://s/11.jpg"],
    ]);
    const ss = (await t.children(`${S}/batches/10`)).items;
    expect(ss.map((i) => [i.path, i.name, i.mark, i.leaf])).toEqual([
      [`${S}/batches/10/11`, "Named place", "kept", undefined],
      [`${S}/batches/10/12`, "Sample 2", undefined, true],
    ]);
  });

  it("links a sample to its parent, child and guide, both ways", async () => {
    const t = vireoTree(source());
    const at = `${S}/batches/20/21`;
    expect((await t.children(at)).items.map((i) => i.path)).toEqual([
      `${at}/grew-from`,
      `${at}/applies`,
    ]);
    expect((await t.children(`${at}/grew-from`)).items.map((i) => [i.path, i.original])).toEqual([
      [`${at}/grew-from/11`, `${S}/batches/10/11`],
    ]);
    expect((await t.children(`${S}/batches/10/11/grew-into`)).items.map((i) => i.original)).toEqual(
      [at],
    );
    expect((await t.children(`${at}/applies`)).items.map((i) => i.original)).toEqual([
      "vireo/guides/7",
    ]);
    expect((await t.children("vireo/guides/7/applied-in")).items.map((i) => i.original)).toEqual([
      at,
    ]);
    const w = await wholeAt(t, at);
    expect(w.links.map((l) => [l.rel, l.dir, l.items.length])).toEqual([
      ["grew-from", "out", 1],
      ["applies", "out", 1],
    ]);
  });

  it("keeps an open batch's lineage hidden from a viewer: blind", async () => {
    const t = vireoTree(source({ blind: true }));
    const at = `${S}/batches/20/21`;
    expect((await t.children(`${S}/batches/20`)).items[0]?.leaf).toBe(true);
    await expect(t.children(`${at}/grew-from`)).rejects.toMatchObject({ code: "blind" });
    await expect(t.children(`${at}/applies`)).rejects.toMatchObject({ code: "blind" });
    // the parent no longer shows its child either
    expect((await t.children(`${S}/batches/10/11`)).items).toEqual([]);
    expect((await wholeAt(t, `${S}/batches/20`)).body).toBe("");
  });

  it("resolves an alias to its home, and reads a sample whole", async () => {
    const t = vireoTree(source());
    expect(await homeAt(t, `${S}/batches/20/21/grew-from/11`)).toBe(`${S}/batches/10/11`);
    const w = await wholeAt(t, `${S}/batches/10/11`);
    expect([w.body, (w.data as { batch: string }).batch]).toEqual(["body 11", "hooks:1"]);
    expect((await wholeAt(t, "vireo/guides/7")).body).toBe("Name a real place in the first line");
    expect((await wholeAt(t, S)).body).toBe("open strong");
    const shown = await columns(t, `${S}/batches/20/21/grew-from/11`);
    expect(shown.columns.at(-1)?.home).toBe(`${S}/batches/10/11`);
    expect(shown.whole?.body).toBe("body 11");
  });

  it("refuses what is not there", async () => {
    const t = vireoTree(source());
    for (const p of [
      "vireo/subjects/nope",
      `${S}/batches/99`,
      `${S}/batches/10/21`,
      "vireo/guides/99",
      "vireo/things",
    ])
      await expect(t.children(p)).rejects.toBeInstanceOf(PathError);
  });

  it("finds subjects and guides at the root, samples inside a subject", async () => {
    const t = vireoTree(source());
    // guide 7's ref is hooks-study
    expect((await t.find("hooks")).map((i) => i.path)).toEqual([S, "vireo/guides/7"]);
    expect((await t.find("real place")).map((i) => i.path)).toEqual(["vireo/guides/7"]);
    expect((await t.find("named", S)).map((i) => i.path)).toEqual([`${S}/batches/10/11`]);
  });

  it("loads the subject list and a subject once per adapter", async () => {
    const calls: string[] = [];
    const t = vireoTree(source({ calls }));
    await t.children(`${S}/batches/10`);
    await t.children(`${S}/batches/20/21`);
    await wholeAt(t, `${S}/batches/10/11`);
    expect(calls).toEqual(["subjects", "subject hooks"]);
  });
});
