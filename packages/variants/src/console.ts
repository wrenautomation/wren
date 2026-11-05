/**
 * VariantsConsole: Campaigns › Variants in the portal. Reads the queue blind (no change notes,
 * parents, guides or agent), signs media for the player, writes William's calls and notes.
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
import { z } from "zod";
import { VARIANTS_CONSOLE_APPS, VARIANTS_CONSOLE_ROUTES } from "./console-routes.js";
import { type Anchor, GUIDE_STATES, KINDS, type Kind, TONES, VERDICTS } from "./schema.js";
import {
  addGuide,
  addNote,
  catalog,
  closeBatch,
  dropNote,
  feedback,
  judge,
  keep,
  listSubjects,
  queue,
  type SampleRow,
  setGuide,
} from "./store.js";

/** s3:// → a URL the browser can play; absent in local runs (media shows as missing). */
export type Sign = (uri: string) => Promise<string>;

type Req = PortalRequest & Record<string, unknown>;
const by = (req: PortalRequest) => (req.viewer as SignedViewer).email;
const num = (v: unknown, what: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new PortalRefusal(`which ${what}?`, 400);
  return n;
};
/** Store refusals are PortalRefusals already; `answer` sends their status. */
const refuse = <T>(fn: () => Promise<T>) => fn();

export function variantsConsoleApi(db: Db, sign: Sign | null = null) {
  const url = async (uri: string | null) => (uri && sign ? sign(uri).catch(() => null) : null);
  const media = async <T extends Pick<SampleRow, "media" | "poster">>(s: T) => ({
    ...s,
    mediaUrl: await url(s.media),
    posterUrl: await url(s.poster),
  });
  return {
    queue: (req: Req) =>
      refuse(async () => {
        const open = await queue(db, (req.subject as string | undefined) ?? undefined);
        return Promise.all(
          open.map(async (o) => ({
            batch: { id: o.batch.id, createdAt: o.batch.createdAt, note: o.batch.note },
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
                  verdict: s.verdict,
                  keptAt: s.keptAt,
                  notes: s.notes,
                }),
              ),
            ),
          })),
        );
      }),
    subjects: () => refuse(() => listSubjects(db)),
    subject: (req: Req) =>
      refuse(async () => {
        const f = await feedback(db, num(req.id, "subject"));
        return {
          ...f,
          batches: await Promise.all(
            f.batches.map(async (b) => ({
              ...b,
              samples: await Promise.all(b.samples.map(media)),
            })),
          ),
        };
      }),
    catalog: (req: Req) =>
      refuse(async () => {
        const kind = KINDS.includes(req.kind as Kind) ? (req.kind as Kind) : null;
        const rows = await catalog(db, kind ? { kind } : {});
        return Promise.all(rows.map(async (r) => ({ ...r, sample: await media(r.sample) })));
      }),
    judge: (req: Req) =>
      refuse(() => {
        const v = req.verdict == null ? null : String(req.verdict);
        if (v && !(VERDICTS as readonly string[]).includes(v))
          throw new PortalRefusal(`one of ${VERDICTS.join(", ")}`, 400);
        return judge(db, num(req.sample, "sample"), v as (typeof VERDICTS)[number] | null, by(req));
      }),
    note: (req: Req) =>
      refuse(() => {
        const tone = req.tone == null ? null : String(req.tone);
        if (tone && !(TONES as readonly string[]).includes(tone))
          throw new PortalRefusal("good or bad", 400);
        return addNote(
          db,
          num(req.sample, "sample"),
          {
            anchor: (req.anchor as Anchor | undefined) ?? null,
            tone: tone as "good" | "bad" | null,
            text: (req.text as string) ?? null,
          },
          by(req),
        );
      }),
    unnote: (req: Req) => refuse(() => dropNote(db, num(req.id, "note"), by(req))),
    close: (req: Req) =>
      refuse(() => closeBatch(db, num(req.batch, "batch"), (req.note as string) ?? null, by(req))),
    keep: (req: Req) =>
      refuse(() => keep(db, num(req.sample, "sample"), req.on !== false, by(req))),
    guide: (req: Req) =>
      refuse(() =>
        addGuide(db, {
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
        return setGuide(db, num(req.id, "guide"), state as (typeof GUIDE_STATES)[number], by(req));
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
  catalog: { kind: z.string().nullish() },
  judge: {
    sample: ID,
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
