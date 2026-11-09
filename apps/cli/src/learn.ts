/**
 * `wren learn …` (designs/2026-10-07-learn.md): save a link, list, show, call and break down what
 * Learn kept, and the Mac's reader. Every command works in one workspace: Wren's own, or the client
 * `--client` names; another's items are "no such item". `read` reads videos and reels waiting for
 * the Mac with the `sop add` readers (yt-dlp, the Gemini key fleet), a client's on its models
 * allowance, breaks each down, then writes Wren's items asked into SOP folders.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Settings } from "@wren/config";
import { WREN } from "@wren/core/access";
import type { Db } from "@wren/db";
import {
  askSop,
  BROKEN_DOWN,
  breakdownAsk,
  breakdownItem,
  breakdowns,
  FACT_CALLS,
  factFindings,
  isFactCall,
  itemOf,
  items,
  listItems,
  needsMac,
  pageFetcher,
  promoteItems,
  readItem,
  readVideo,
  recordFactCall,
  saveBreakdown,
  saveLink,
  seedFilmFacts,
  seedStudySchema,
  waitingForMac,
  writeAsked,
} from "@wren/learn";
import { ITEM_KINDS, type ItemKind, SHOT_INS, SHOT_MOVES, SHOT_TYPES } from "@wren/learn/schema";
import { loadLlmEnv } from "@wren/llm";
import { anthropicBatch } from "@wrenautomation/models/batch";
import { download, labelMatch, labelShots } from "@wrenautomation/read/video";
import { watchEyes } from "./video-watch.js";

const itemKindOf = (raw: string): ItemKind => {
  if ((ITEM_KINDS as readonly string[]).includes(raw)) return raw as ItemKind;
  throw new Error(`--kind is one of ${ITEM_KINDS.join(", ")}`);
};

import { modelLlm } from "@wren/llm";
import { addSource, extractPoints, topicDir } from "@wren/research/sops";
import { claudeCode } from "@wrenautomation/models/command";
import type { Command } from "commander";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { learnReaders } from "./learn-readers.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/** How the commands reach their databases: main, a client's own, and `--client`'s id. */
interface LearnDbs {
  withMainDb: WithDb;
  /** Unused since the Notes cut; main.ts (a peer's file) still passes it. */
  withClientDb?: <T>(client: string, fn: (db: Db) => Promise<T>) => Promise<T>;
  /** The workspace `--client` names, checked to exist; Wren's own when none. */
  workspace: () => Promise<string>;
  /** `--client` as given, unchecked: `read` narrows to it. */
  named: () => string | undefined;
}

const idsOf = (raw: string[]): number[] => {
  const ids = raw.map(Number);
  if (!ids.length || ids.some((n) => !Number.isSafeInteger(n) || n <= 0))
    throw new Error("item ids are whole numbers");
  return ids;
};

const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const BY = "cli";
/** Progress goes to stderr, a line each, so stdout stays the JSON answer. */
const say = (line: string) => console.error(line);
export function registerLearn(
  program: Command,
  dbs: LearnDbs,
  settings: Settings,
  rootDir: string,
): void {
  const { withMainDb: withDb } = dbs;
  /** Main, and the workspace the command works in. */
  const inWorkspace = <T>(fn: (db: Db, client: string) => Promise<T>) =>
    withDb(async (db) => fn(db, await dbs.workspace()));
  const knowledgeDir = resolve(rootDir, settings.knowledgeDir);
  const { reader, judgeFor } = learnReaders(settings, rootDir);
  const writer = (model: string) => {
    const llm = modelLlm(claudeCode(model, { timeoutMs: 1_800_000 }));
    return {
      add: (sop: string, source: { name: string; md: string }) =>
        addSource(knowledgeDir, sop, source, { by: BY, why: "asked into the SOP from Learn" }),
      extract: async (sop: string, stem: string) => {
        await extractPoints(knowledgeDir, sop, llm, { by: BY }, stem);
      },
    };
  };

  /**
   * Read what waits for the Mac in every workspace (or `client`'s), break each down, then write
   * Wren's items asked into SOP folders.
   */
  const pass = async (
    db: Db,
    o: {
      limit: number;
      retry?: boolean;
      model: string;
      sopModel: string;
      sops: boolean;
      client?: string | undefined;
    },
  ) => {
    const read = reader();
    const judge = judgeFor(db, o.model);
    const out: Array<{ id: number; read: string | null; broken: boolean }> = [];
    const waiting = await waitingForMac(db, {
      limit: o.limit,
      retry: o.retry ?? false,
      client: o.client ?? null,
    });
    for (const w of waiting) {
      const r = await readVideo(db, read, w.id);
      const broken = r === "read" && (await breakdownItem(db, judge, w.id));
      out.push({ id: w.id, read: r, broken });
      say(`${w.id} ${r}${broken ? " broken down" : ""} ${w.url}`);
    }
    const sops =
      o.sops && (!o.client || o.client === WREN) ? await writeAsked(db, writer(o.sopModel)) : [];
    return { read: out, sops };
  };

  const learn = program.command("learn").description("Learn: saved links, read and broken down");

  learn
    .command("add <url>")
    .description("save a link (a reel, a video, a post), read it and break it down now")
    .option("--title <title>", "blank takes the page's own")
    .option("--model <name>", "the breakdown model", "cohere")
    .option("--no-read", "only save it: the Mac's next `learn read` takes it")
    .option("--kind <kind>", `what it is, when the link doesn't say: ${ITEM_KINDS.join(", ")}`)
    .action(
      async (url: string, o: { title?: string; model: string; read: boolean; kind?: string }) =>
        json(
          await inWorkspace(async (db, client) => {
            const saved = await saveLink(db, {
              client,
              url,
              by: BY,
              via: "cli",
              title: o.title ?? null,
              ...(o.kind ? { kind: itemKindOf(o.kind) } : {}),
            });
            if (!saved.unread || !o.read) return saved;
            const r = needsMac(saved.kind)
              ? await readVideo(db, reader(), saved.id)
              : await readItem(db, pageFetcher(), saved.id);
            const broken =
              r === "read" && (await breakdownItem(db, judgeFor(db, o.model), saved.id));
            return { ...saved, read: r, broken };
          }),
        ),
    );

  learn
    .command("import-films <json>")
    .description(
      "the launch-films seed study (designs/studies): each film saved as a film item, watched here (yt-dlp, the cut detectors, Cohere), then broken down with the study's hand facts in place of code's",
    )
    .option("--model <name>", "the labelling model", "cohere")
    .action(async (file: string, o: { model: string }) =>
      json(
        await inWorkspace(async (db, client) => {
          const { films } = seedStudySchema.parse(
            JSON.parse(await readFile(resolve(file), "utf8")),
          );
          const read = reader();
          const judge = judgeFor(db, o.model);
          const out: Array<{
            id: number;
            slug: string;
            read: string;
            breakdown: boolean;
          }> = [];
          for (const f of films) {
            const saved = await saveLink(db, {
              client,
              url: f.url,
              by: BY,
              via: "cli",
              title: `${f.brand}: ${f.slug}`,
              kind: "film",
            });
            const r = saved.unread ? ((await readVideo(db, read, saved.id)) ?? "gone") : "read";
            const broke =
              r === "read" &&
              (await breakdownItem(db, judge, saved.id, {
                facts: seedFilmFacts(f),
                by: "hand",
              }));
            say(`${f.slug}: ${saved.id} ${r}${broke ? " broken down" : ""}`);
            out.push({ id: saved.id, slug: f.slug, read: r, breakdown: broke });
          }
          return out;
        }),
      ),
    );

  learn
    .command("shot-proof <json>")
    .description(
      "the 80% proof for shot labels: each hand-labelled film of a seed study downloaded, its hand shots labelled by Cohere vision, and each label's match to the hand printed (no database)",
    )
    .option("--no-bright", "send frames as shot, not brightened")
    .option("--out <file>", "write the per-shot answers and the scores as JSON")
    .action(async (file: string, o: { bright: boolean; out?: string }) => {
      const { films } = seedStudySchema.parse(JSON.parse(await readFile(resolve(file), "utf8")));
      const { eye } = watchEyes(settings, rootDir);
      const sets = { type: SHOT_TYPES, move: SHOT_MOVES, in: SHOT_INS };
      const rows: { slug: string; t: number; hand: object; machine: object }[] = [];
      for (const f of films.filter((x) => x.labels === "hand")) {
        const dir = await mkdtemp(join(tmpdir(), "wren-proof-"));
        try {
          // YouTube refuses a download now and then; once more before the film is skipped.
          const video = await download(f.url, settings.ytDlp, dir)
            .catch(() => download(f.url, settings.ytDlp, dir))
            .then((d) => d.file)
            .catch((err: unknown) => {
              say(`${f.slug}: not downloaded, skipped (${String(err).split("\n")[0]})`);
              return null;
            });
          if (!video) continue;
          const got = await labelShots(video, f.shots, sets, {
            eye,
            ffmpeg: settings.ffmpeg,
            bright: o.bright,
          });
          rows.push(
            ...f.shots.map((s, i) => ({
              slug: f.slug,
              t: s.t,
              hand: { type: s.type, move: s.move, in: s.in },
              machine: got[i] ?? {},
            })),
          );
          say(`${f.slug}: ${f.shots.length} shots`);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
      const score = labelMatch(
        rows.map((r) => r.hand),
        rows.map((r) => r.machine as never),
      );
      if (o.out)
        await writeFile(
          resolve(o.out),
          `${JSON.stringify({ bright: o.bright, score, rows }, null, 2)}\n`,
        );
      json(
        Object.fromEntries(
          Object.entries(score).map(([l, v]) => [
            l,
            { n: v.n, hits: v.hits, share: Math.round(v.share * 1000) / 10 },
          ]),
        ),
      );
    });

  learn
    .command("list")
    .description("items, newest first")
    .option("--saved", "only what was saved")
    .option("--waiting", "only what still has to be read")
    .option("--limit <n>", "how many", (v) => Number.parseInt(v, 10), 30)
    .action(async (o: { saved?: boolean; waiting?: boolean; limit: number }) =>
      json(
        await inWorkspace((db, client) =>
          listItems(db, client, {
            saved: !!o.saved,
            waiting: !!o.waiting,
            limit: o.limit,
          }),
        ),
      ),
    );

  learn
    .command("show <id>")
    .description("one item whole: its transcript and the SOPs it was asked into")
    .action(async (id: string) =>
      json(
        await inWorkspace(async (db, client) => {
          const [n] = idsOf([id]);
          const got = n ? await itemOf(db, client, n) : null;
          if (!got) throw new Error(`No item ${id}`);
          return got;
        }),
      ),
    );

  learn
    .command("call <id> <path> <call> [comment...]")
    .description(
      "your keep, tune or drop on an item (`/`) or one of its facts (hook, beats/2, facts/shots/5), with your words; `show <id>` lists the paths",
    )
    .action(async (id: string, path: string, call: string, comment: string[]) =>
      json(
        await inWorkspace(async (db, client) => {
          const [n] = idsOf([id]);
          if (!n) throw new Error(`No item ${id}`);
          if (!isFactCall(call)) throw new Error(`call is one of ${FACT_CALLS.join(", ")}`);
          return recordFactCall(db, {
            client,
            id: n,
            path,
            call,
            comment: comment.join(" "),
            by: BY,
            source: "cli",
          });
        }),
      ),
    );

  learn
    .command("breakdown [ids...]")
    .description(
      "break read reels and videos down (hook style, beats, call to action); no ids: every one not done yet",
    )
    .option("--model <name>", "the model (--batch: a Claude model, default haiku)", "cohere")
    .option("--limit <n>", "at most this many", Number, 50)
    .option(
      "--batch",
      "send as one Anthropic batch: half price, answers within 24 h; Wren's items only",
    )
    .option("--collect <batch>", "save a sent batch's answers; says running until it ends")
    .action(
      async (
        ids: string[],
        o: { model: string; limit: number; batch?: boolean; collect?: string },
      ) =>
        json(
          await inWorkspace(async (db, client) => {
            let batcher: ReturnType<typeof anthropicBatch> | null = null;
            if (o.batch || o.collect) {
              if (client !== WREN) throw new Error("batches are for Wren's own items for now");
              loadLlmEnv(settings.llmEnvPath, rootDir);
              const key = process.env.ANTHROPIC_API_KEY;
              if (!key) throw new Error("no ANTHROPIC_API_KEY in the model keys file");
              batcher = anthropicBatch({ key, model: o.model === "cohere" ? "haiku" : o.model });
              if (o.collect) {
                const s = await batcher.batchResults(o.collect);
                if (s.state === "running") return s;
                const saved: number[] = [];
                const failed: Array<{ id: number; why: string }> = [];
                let usd = 0;
                for (const a of s.answers) {
                  const id = Number(a.id.replace(/^item-/, ""));
                  usd += a.reply?.usage.usd ?? 0;
                  const r = a.reply
                    ? await saveBreakdown(db, id, a.reply.text)
                    : (a.error ?? "no reply");
                  if (r === true) saved.push(id);
                  else failed.push({ id, why: r });
                }
                return { batch: s.id, saved, failed, usd };
              }
            }
            const todo = ids.length
              ? idsOf(ids)
              : (
                  await db
                    .select({ id: items.id })
                    .from(items)
                    .leftJoin(breakdowns, eq(breakdowns.itemId, items.id))
                    .where(
                      and(
                        eq(items.client, client),
                        inArray(items.kind, [...BROKEN_DOWN]),
                        isNotNull(items.transcript),
                        isNull(breakdowns.itemId),
                      ),
                    )
                    .orderBy(desc(items.id))
                    .limit(o.limit)
                ).map((r) => r.id);
            if (batcher) {
              const asks = (
                await Promise.all(todo.map(async (id) => ({ id, ask: await breakdownAsk(db, id) })))
              ).flatMap(({ id, ask }) =>
                ask
                  ? [
                      {
                        id: `item-${id}`,
                        request: {
                          prompt: ask.prompt,
                          system: ask.system,
                          maxTokens: ask.maxTokens,
                        },
                      },
                    ]
                  : [],
              );
              if (!asks.length) return { batch: null, items: [] };
              const { id } = await batcher.batch(asks);
              return {
                batch: id,
                items: asks.map((a) => a.id),
                collect: `wren learn breakdown --collect ${id}`,
              };
            }
            const judge = judgeFor(db, o.model);
            const done: number[] = [];
            for (const id of todo) if (await breakdownItem(db, judge, id)) done.push(id);
            return { tried: todo.length, done };
          }),
        ),
    );

  learn
    .command("promote")
    .description(
      "every item of the workspace as a source record in the knowledge repo: caption and transcript, breakdown, score, saves. One commit; a rerun edits only what changed",
    )
    .option("--why <text>", "why, on the commit", "Learn's items as sources")
    .action(async (o: { why: string }) =>
      json(
        await inWorkspace((db, client) =>
          promoteItems(db, knowledgeDir, client, { by: "wren-learn", why: o.why }),
        ),
      ),
    );

  learn
    .command("findings")
    .description(
      "write every breakdown's facts as findings on its item's document (one-shot backfill; a breakdown writes its own after)",
    )
    .action(async () =>
      json(
        await inWorkspace(async (db, client) => {
          const rows = await db
            .select({ b: breakdowns })
            .from(breakdowns)
            .innerJoin(items, eq(items.id, breakdowns.itemId))
            .where(eq(items.client, client));
          let facts = 0;
          for (const { b } of rows) facts += await factFindings(db, b);
          return { breakdowns: rows.length, facts };
        }),
      ),
    );

  learn
    .command("read")
    .description(
      "the Mac's reader: videos and reels waiting in every workspace (or --client's), read with yt-dlp and Gemini and broken down, then Wren's SOP asks written",
    )
    .option("--limit <n>", "items a pass", (v) => Number.parseInt(v, 10), 20)
    .option("--retry", "take failed reads too")
    .option("--every <minutes>", "keep going, a pass this often", (v) => Number.parseInt(v, 10))
    .option("--model <name>", "the breakdown model", "cohere")
    .option("--sop-model <name>", "Claude Code model for `sop extract`", "opus")
    .option("--no-sops", "skip writing items asked into SOPs")
    .action(
      async (o: {
        limit: number;
        retry?: boolean;
        every?: number;
        model: string;
        sopModel: string;
        sops: boolean;
      }) => {
        // Checked once: a misspelt --client stops here, not on every pass.
        const client = dbs.named() ? await dbs.workspace() : undefined;
        for (;;) {
          json(await withDb((db) => pass(db, { ...o, client })));
          if (!o.every) return;
          const every = o.every;
          await new Promise((r) => setTimeout(r, every * 60_000));
        }
      },
    );

  learn
    .command("to-sop <id> <sop>")
    .description("add one of Wren's items to an SOP folder (sop add, then extract)")
    .option("--sop-model <name>", "Claude Code model for `sop extract`", "opus")
    .option("--later", "only ask: the next `learn read` writes it")
    .action(async (id: string, sop: string, o: { sopModel: string; later?: boolean }) =>
      json(
        await inWorkspace(async (db, client) => {
          if (client !== WREN) throw new Error("to-sop is Wren's own: SOP folders are Wren's");
          const itemId = Number(id);
          const ask = await askSop(db, { client, itemId, sop, by: BY });
          if (o.later) return ask;
          const done = await writeAsked(db, writer(o.sopModel), {
            itemId,
            sop: ask.sop,
          });
          return done.length
            ? { ...done[0], folder: topicDir(knowledgeDir, ask.sop) }
            : {
                asked: ask.sop,
                note: "Not read yet: the next `learn read` writes it.",
              };
        }),
      ),
    );
}
