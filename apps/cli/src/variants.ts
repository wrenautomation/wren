/**
 * `wren variants`: the agent's hands on the Variants ledger (designs/2026-11-05-variants.md).
 * JSON out. William judges in the portal (Campaigns › Variants); the agent reads `show`.
 */
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { Settings } from "@wren/config";
import type { Db } from "@wren/db";
import { checkMediaStore, uploadMedia } from "@wren/starling-inbound";
import { FPS, getEdit, keepSegments, shortCutsOver } from "@wren/starling-studio";
import {
  addBatch,
  addGuide,
  addNote,
  CHANNELS,
  type Channel,
  catalog,
  closeBatch,
  collect as collectLive,
  feedback,
  GUIDE_SOURCES,
  type GuideState,
  judge,
  KINDS,
  type Kind,
  keep,
  listSubjects,
  type NewSample,
  newSubject,
  queue,
  type Source,
  setGuide,
  ship,
  shipsOf,
  subjectOf,
  unship,
  VERDICTS,
  type Verdict,
} from "@wren/variants";
import type { Command } from "commander";
import { collect } from "./args.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const id = (v: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`not an id: ${v}`);
  return n;
};
const oneOf = <T extends string>(v: string, all: readonly T[], what: string): T => {
  if (!(all as readonly string[]).includes(v)) throw new Error(`${what}: one of ${all.join(", ")}`);
  return v as T;
};

/** A batch file's sample: inline body, or a local file the CLI uploads. */
interface SampleIn extends NewSample {
  file?: string;
  posterFile?: string;
  /** A studio edit's spans: the cut as it plays (long) or its Short. */
  studio?: { edit: number; format?: "long" | "short" };
}
interface BatchIn {
  why: string;
  agent?: string;
  samples: SampleIn[];
}

const PLAYABLE = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".pdf",
]);

export function registerVariants(
  program: Command,
  withDb: WithDb,
  settings: Settings,
  by: string,
): void {
  const v = program
    .command("variants")
    .description(
      "Variants: batches the agent makes, William's calls and notes, guides, the catalog",
    );

  v.command("new <slug>")
    .description("A subject to iterate on; --brief is William's direction (none: from scratch)")
    .requiredOption("--name <name>")
    .requiredOption("--kind <kind>", KINDS.join("|"))
    .option("--brief <text>")
    .option("--seed <ref>", "a study slug, SOP path, sample id or file (repeat)", collect, [])
    .action((slug: string, o: { name: string; kind: string; brief?: string; seed: string[] }) =>
      withDb(async (db) =>
        json(
          await newSubject(db, {
            slug,
            name: o.name,
            kind: oneOf(o.kind, KINDS, "kind"),
            brief: o.brief ?? null,
            seeds: o.seed,
            by,
          }),
        ),
      ),
    );

  v.command("list")
    .description("Subjects with sample, kept and to-pick counts")
    .action(() => withDb(async (db) => json(await listSubjects(db))));

  v.command("show <subject>")
    .alias("feedback")
    .description(
      "Everything for the next batch: brief, guides with with-vs-without rates, each batch's why, note, calls, anchored notes, strengths",
    )
    .action((s: string) => withDb(async (db) => json(await feedback(db, s))));

  v.command("add <subject> [file]")
    .description(
      "One batch from JSON (file or stdin): {why, agent, samples:[{body | file, posterFile?, parent?, guides?, change?, source? | studio?}]}. Files go to the media bucket",
    )
    .action((s: string, file: string | undefined) =>
      withDb(async (db) => {
        const raw = file ? await readFile(file, "utf8") : await stdin();
        const b = JSON.parse(raw) as BatchIn;
        const base = file ? resolve(file, "..") : process.cwd();
        const needsUpload = b.samples.some((x) => x.file || x.posterFile);
        const bucket = settings.mediaBucket;
        if (needsUpload) {
          if (!bucket) throw new Error("WREN_MEDIA_BUCKET unset: nowhere to upload");
          await checkMediaStore({ bucket });
        }
        const up = async (p: string | undefined) => {
          if (!p) return null;
          const path = resolve(base, p);
          if (!PLAYABLE.has(extname(path).toLowerCase()))
            throw new Error(`can't show ${p} in the portal`);
          return uploadMedia(path, { bucket: bucket as string });
        };
        await subjectOf(db, s);
        const samples: NewSample[] = [];
        for (const x of b.samples)
          samples.push({
            body: x.body ?? null,
            media: x.media ?? (await up(x.file)),
            poster: x.poster ?? (await up(x.posterFile)),
            parent: x.parent ?? null,
            guides: x.guides ?? [],
            change: x.change ?? null,
            source: x.source ?? (x.studio ? await studioSource(db, x.studio) : null),
          });
        json(await addBatch(db, s, { why: b.why, agent: b.agent ?? by, samples }));
      }),
    );

  v.command("queue [subject]")
    .description("Open batches waiting on William, with their samples and notes")
    .action((s?: string) => withDb(async (db) => json(await queue(db, s))));

  v.command("judge <sample> <verdict>")
    .description(`${VERDICTS.join("|")}|clear`)
    .action((s: string, verdict: string) =>
      withDb(async (db) =>
        json(
          await judge(
            db,
            id(s),
            verdict === "clear" ? null : oneOf<Verdict>(verdict, VERDICTS, "verdict"),
            by,
          ),
        ),
      ),
    );

  v.command("note <sample> [text]")
    .description("A note on a sample; --quote, --at or --box anchors it")
    .option("--tone <tone>", "good|bad")
    .option("--quote <words>", "the exact words it points at")
    .option("--at <range>", "seconds on a video: 12.5 or 12.5-15")
    .option("--box <x,y,w,h>", "fractions of the frame")
    .action(
      (
        s: string,
        text: string | undefined,
        o: { tone?: string; quote?: string; at?: string; box?: string },
      ) =>
        withDb(async (db) => {
          const box = o.box ? boxOf(o.box) : undefined;
          const [start, end] = (o.at ?? "").split("-").map(Number);
          const anchor = o.quote
            ? { type: "quote" as const, exact: o.quote }
            : o.at
              ? {
                  type: "time" as const,
                  start: start ?? 0,
                  ...(end ? { end } : {}),
                  ...(box ? { box } : {}),
                }
              : box
                ? { type: "box" as const, ...box }
                : null;
          const tone = o.tone ? oneOf(o.tone, ["good", "bad"] as const, "tone") : null;
          json(await addNote(db, id(s), { anchor, tone, text: text ?? null }, by));
        }),
    );

  v.command("close <batch>")
    .description("Close a batch; --note is the guide for the next one")
    .option("--note <text>")
    .action((b: string, o: { note?: string }) =>
      withDb(async (db) => json(await closeBatch(db, id(b), o.note ?? null, by))),
    );

  v.command("keep <sample>")
    .description("Put a sample in the catalog (--off takes it out)")
    .option("--off")
    .action((s: string, o: { off?: boolean }) =>
      withDb(async (db) => json(await keep(db, id(s), !o.off, by))),
    );

  v.command("catalog")
    .description("Kept samples, newest first")
    .option("--kind <kind>")
    .option("--subject <subject>")
    .action((o: { kind?: string; subject?: string }) =>
      withDb(async (db) =>
        json(
          await catalog(db, {
            ...(o.kind ? { kind: oneOf<Kind>(o.kind, KINDS, "kind") } : {}),
            ...(o.subject ? { subject: o.subject } : {}),
          }),
        ),
      ),
    );

  v.command("ship <sample>")
    .description("A sample goes live; its channel numbers come back per segment (`live`)")
    .option("--post <draft>", "content draft id")
    .option("--site <page>", "site page id")
    .option("--email <template@version>")
    .option("--why <text>")
    .action((s: string, o: { post?: string; site?: string; email?: string; why?: string }) =>
      withDb(async (db) => {
        const set = CHANNELS.filter((c) => o[c]);
        if (set.length !== 1) throw new Error(`one of --${CHANNELS.join(", --")}`);
        const channel = set[0] as Channel;
        json(
          await ship(db, id(s), { channel, target: o[channel] as string, why: o.why ?? null }, by),
        );
      }),
    );

  v.command("unship <ship>")
    .description("End a ship; its numbers stay")
    .action((x: string) => withDb(async (db) => json(await unship(db, id(x), by))));

  v.command("live <subject>")
    .description(
      "Live numbers per segment: each shipped sample's rates, 95% range, P(best); and its ships",
    )
    .action((s: string) =>
      withDb(async (db) => {
        const f = await feedback(db, s);
        json({ ...f.live, ships: await shipsOf(db, s) });
      }),
    );

  v.command("collect")
    .description("Read every live ship's numbers now (the loop runs this every 6h)")
    .option("--ship <ship>")
    .action((o: { ship?: string }) =>
      withDb(async (db) => json(await collectLive(db, o.ship ? { ship: id(o.ship) } : {}))),
    );

  const g = v
    .command("guide")
    .description("Tips the agent writes from: testing, locked (a rule), dropped");
  g.command("add <text>")
    .option("--subject <subject>", "only this subject")
    .option("--kind <kind>", "every subject of this kind")
    .option("--source <source>", GUIDE_SOURCES.join("|"), "william")
    .option("--ref <ref>", "study slug, SOP path or skill name")
    .action((text: string, o: { subject?: string; kind?: string; source: string; ref?: string }) =>
      withDb(async (db) =>
        json(
          await addGuide(db, {
            text,
            subject: o.subject ?? null,
            kind: o.kind ? oneOf<Kind>(o.kind, KINDS, "kind") : null,
            source: oneOf(o.source, GUIDE_SOURCES, "source"),
            ref: o.ref ?? null,
            by,
          }),
        ),
      ),
    );
  for (const [verb, state] of [
    ["lock", "locked"],
    ["drop", "dropped"],
    ["test", "testing"],
  ] as const)
    g.command(`${verb} <guide>`).action((x: string) =>
      withDb(async (db) => json(await setGuide(db, id(x), state as GuideState, by))),
    );
}

/** A studio edit's kept spans: the long cut, or the Short's tighter one. */
async function studioSource(
  db: Db,
  x: { edit: number; format?: "long" | "short" },
): Promise<Source> {
  const e = await getEdit(db, x.edit);
  const cuts = x.format === "short" ? shortCutsOver(e.cuts, e.shortCuts ?? []) : e.cuts;
  return { ref: `studio:${e.id}`, spans: keepSegments(cuts, e.tracks.main.durationS, FPS) };
}

function boxOf(s: string) {
  const [x, y, w, h] = s.split(",").map(Number);
  if ([x, y, w, h].some((n) => n == null || !Number.isFinite(n))) throw new Error("--box x,y,w,h");
  return { x: x as number, y: y as number, w: w as number, h: h as number };
}

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
