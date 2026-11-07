/**
 * VariantsConsole: the portal's Variants app. Reads the queue blind (no change notes,
 * names, parents, guides or agent), signs media for the player, writes William's calls and notes.
 */
import type * as restate from "@restatedev/restate-sdk";
import {
  answer,
  PortalRefusal,
  type PortalRequest,
  portalService,
  type SignedViewer,
} from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import {
  type Anchor,
  GUIDE_STATES,
  KINDS,
  type Kind,
  type SampleRow,
  TONES,
  VERDICTS,
  VireoError,
} from "@wrenautomation/vireo";
import { z } from "zod";
import { VARIANTS_CONSOLE_APPS, VARIANTS_CONSOLE_ROUTES } from "./console-routes.js";
import { variants } from "./index.js";

/** s3:// → a URL the browser can play; absent in local runs (media shows as missing). An https:// link (a live page) needs no signer. */
export type Sign = (uri: string) => Promise<string>;

type Req = PortalRequest & Record<string, unknown>;
const by = (req: PortalRequest) => (req.viewer as SignedViewer).email;
const num = (v: unknown, what: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new PortalRefusal(`which ${what}?`, 400);
  return n;
};
/** Vireo's no → a PortalRefusal; `answer` sends its status. */
const refuse = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof VireoError) throw new PortalRefusal(err.message, err.status);
    throw err;
  }
};

export function variantsConsoleApi(db: Db, sign: Sign | null = null) {
  const v = variants(db);
  const url = async (uri: string | null) =>
    !uri ? null : /^https:\/\//i.test(uri) ? uri : sign ? sign(uri).catch(() => null) : null;
  const media = async <T extends Pick<SampleRow, "media" | "poster">>(s: T) => ({
    ...s,
    mediaUrl: await url(s.media),
    posterUrl: await url(s.poster),
  });
  return {
    queue: (req: Req) =>
      refuse(async () => {
        const open = await v.queue((req.subject as string | undefined) ?? undefined);
        return Promise.all(
          open.map(async (o) => ({
            batch: {
              id: o.batch.id,
              n: o.batch.n,
              createdAt: o.batch.createdAt,
              note: o.batch.note,
            },
            subject: {
              id: o.subject.id,
              slug: o.subject.slug,
              name: o.subject.name,
              kind: o.subject.kind,
              brief: o.subject.brief,
            },
            // Blind: what William sees is the work, not where it came from.
            samples: await Promise.all(
              o.samples.map((s) =>
                media({
                  id: s.id,
                  body: s.body,
                  media: s.media,
                  poster: s.poster,
                  // footage spans: lets the page play cuts of one footage in step
                  source: s.source,
                  score: s.score,
                  verdict: s.verdict,
                  keptAt: s.keptAt,
                  notes: s.notes,
                }),
              ),
            ),
          })),
        );
      }),
    subjects: () => refuse(() => v.listSubjects()),
    subject: (req: Req) =>
      refuse(async () => {
        const f = await v.feedback(num(req.id, "subject"));
        return {
          ...f,
          batches: await Promise.all(
            f.batches.map(async (b) => ({
              ...b,
              // blind: an open batch shows no idea and no parent until it closes
              why: b.state === "open" ? null : b.why,
              samples: await Promise.all(
                b.samples.map((x) =>
                  media(b.state === "open" ? { ...x, change: null, name: null, parents: [] } : x),
                ),
              ),
            })),
          ),
        };
      }),
    /** Every batch of every subject, newest first, whole: each sample with its call, notes and
     * the idea it tested. An open batch stays blind: no change notes. */
    batches: () =>
      refuse(async () => {
        const subjects = await v.listSubjects();
        const all = await Promise.all(
          subjects.map(async (s) => {
            const f = await v.feedback(s.id);
            const subject = { id: s.id, slug: s.slug, name: s.name, kind: s.kind, brief: s.brief };
            return Promise.all(
              f.batches.map(async (b) => ({
                id: b.id,
                n: b.n,
                why: b.state === "open" ? null : b.why,
                note: b.note,
                state: b.state,
                createdAt: b.createdAt,
                goodRate: b.goodRate,
                subject,
                samples: await Promise.all(
                  // made order: #n stays the same sample on every visit
                  [...b.samples]
                    .sort((x, y) => x.id - y.id)
                    .map((x) =>
                      media({
                        id: x.id,
                        body: x.body,
                        media: x.media,
                        poster: x.poster,
                        source: x.source,
                        score: x.score,
                        verdict: x.verdict,
                        keptAt: x.keptAt,
                        notes: x.notes,
                        change: b.state === "open" ? null : x.change,
                      }),
                    ),
                ),
              })),
            );
          }),
        );
        return all
          .flat()
          .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt) || b.id - a.id);
      }),
    catalog: (req: Req) =>
      refuse(async () => {
        const kind = KINDS.includes(req.kind as Kind) ? (req.kind as Kind) : null;
        const rows = await v.catalog(kind ? { kind } : {});
        return Promise.all(rows.map(async (r) => ({ ...r, sample: await media(r.sample) })));
      }),
    judge: (req: Req) =>
      refuse(() => {
        // a 1-10 score, or a verdict (its tap score); vireo checks the range
        const call = req.score ?? req.verdict ?? null;
        if (typeof call === "string" && !(VERDICTS as readonly string[]).includes(call))
          throw new PortalRefusal(`1-10 or one of ${VERDICTS.join(", ")}`, 400);
        if (call != null && typeof call !== "string" && typeof call !== "number")
          throw new PortalRefusal("1-10 or a verdict", 400);
        return v.judge(
          num(req.sample, "sample"),
          call as number | (typeof VERDICTS)[number] | null,
          by(req),
        );
      }),
    note: (req: Req) =>
      refuse(() => {
        const tone = req.tone == null ? null : String(req.tone);
        if (tone && !(TONES as readonly string[]).includes(tone))
          throw new PortalRefusal("good or bad", 400);
        return v.addNote(
          num(req.sample, "sample"),
          {
            anchor: (req.anchor as Anchor | undefined) ?? null,
            tone: tone as "good" | "bad" | null,
            text: (req.text as string) ?? null,
          },
          by(req),
        );
      }),
    unnote: (req: Req) => refuse(() => v.dropNote(num(req.id, "note"), by(req))),
    close: (req: Req) =>
      refuse(() => v.closeBatch(num(req.batch, "batch"), (req.note as string) ?? null, by(req))),
    keep: (req: Req) => refuse(() => v.keep(num(req.sample, "sample"), req.on !== false, by(req))),
    guide: (req: Req) =>
      refuse(() =>
        v.addGuide({
          text: String(req.text ?? ""),
          subject: req.subject == null ? null : num(req.subject, "subject"),
          kind: KINDS.includes(req.kind as Kind) ? (req.kind as Kind) : null,
          by: by(req),
        }),
      ),
    setGuide: (req: Req) =>
      refuse(() => {
        const state = String(req.state);
        if (!(GUIDE_STATES as readonly string[]).includes(state))
          throw new PortalRefusal(`one of ${GUIDE_STATES.join(", ")}`, 400);
        return v.setGuide(num(req.id, "guide"), state as (typeof GUIDE_STATES)[number], by(req));
      }),
  };
}

const ID = z.union([z.string(), z.number()]);
const ANCHOR = z.union([
  z.object({
    type: z.literal("quote"),
    exact: z.string().max(2000),
    prefix: z.string().max(200).optional(),
    suffix: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal("box"), x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  z.object({
    type: z.literal("time"),
    start: z.number().min(0),
    end: z.number().min(0).optional(),
    box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
  }),
]);
const INPUTS = {
  queue: { subject: ID.nullish() },
  subjects: {},
  subject: { id: ID },
  batches: {},
  catalog: { kind: z.string().nullish() },
  judge: {
    sample: ID,
    score: z.number().int().min(1).max(10).nullish().describe("1-10; wins over verdict"),
    verdict: z
      .string()
      .nullish()
      .describe(`${VERDICTS.join(", ")}; null clears`),
  },
  note: {
    sample: ID,
    anchor: ANCHOR.nullish(),
    tone: z.string().nullish(),
    text: z.string().max(4000).nullish(),
  },
  unnote: { id: ID },
  close: {
    batch: ID,
    note: z.string().max(8000).nullish().describe("Guide note for the next batch"),
  },
  keep: { sample: ID, on: z.boolean().nullish() },
  guide: { text: z.string().max(2000), subject: ID.nullish(), kind: z.string().nullish() },
  setGuide: { id: ID, state: z.string() },
} as const;

export function makeVariantsConsole(db: Db, sign: Sign | null) {
  const api = variantsConsoleApi(db, sign);
  const h = (k: keyof typeof INPUTS) =>
    serviceHandler(
      { input: z.looseObject({ ...PORTAL_FIELDS, ...INPUTS[k] }) },
      (_: restate.Context, req: Req): Promise<unknown> =>
        answer(() => (api[k] as (r: Req) => Promise<unknown>)(req)),
    );
  const handlers = {
    queue: h("queue"),
    subjects: h("subjects"),
    subject: h("subject"),
    batches: h("batches"),
    catalog: h("catalog"),
    judge: h("judge"),
    note: h("note"),
    unnote: h("unnote"),
    close: h("close"),
    keep: h("keep"),
    guide: h("guide"),
    setGuide: h("setGuide"),
  };
  return portalService({
    name: "VariantsConsole",
    main: db,
    routes: VARIANTS_CONSOLE_ROUTES,
    apps: VARIANTS_CONSOLE_APPS,
    unnamed: "wren",
    handlers,
  });
}
