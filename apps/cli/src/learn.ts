/**
 * `wren learn …` (designs/2026-10-07-learn.md): save a link, follow a source, list, show, move,
 * archive and search what Learn kept, and the Mac's reader. Every command works in one workspace:
 * Wren's own, or the client `--client` names; another's items are "no such item". `read` reads
 * videos and reels waiting for the Mac with the `sop add` readers (yt-dlp, the Gemini key fleet)
 * for every workspace (or the one named), a client's on its models allowance, scores them, then
 * writes items asked into an SOP: Wren's into its folder, a client's into its own Notes. `catalog`
 * reads a creator's back catalog a few reels a pass (Instagram through the desk, TikTok by yt-dlp).
 * Nothing here signs in to any social account.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Settings } from "@wren/config";
import { WREN } from "@wren/core/access";
import type { Db } from "@wren/db";
import {
  addCollection,
  askSop,
  BROKEN_DOWN,
  breakdownItem,
  breakdowns,
  catalogSummary,
  creatorOf,
  embedMissing,
  FACT_CALLS,
  factFindings,
  follow,
  isFactCall,
  itemPage,
  items,
  listItems,
  mark,
  moveItems,
  needsMac,
  pullCreators,
  readCatalog,
  readItem,
  readQueued,
  readVideo,
  recordFactCall,
  saveLink,
  scoreItem,
  searchItems,
  seedFilmFacts,
  seedStudySchema,
  sourcesByKind,
  TELLS,
  type Tell,
  tagItems,
  tiktokReader,
  unfollowSources,
  unscore,
  waitingForMac,
  writeAsked,
  writeClientAsked,
} from "@wren/learn";
import { ITEM_KINDS, type ItemKind, SHOT_INS, SHOT_MOVES, SHOT_TYPES } from "@wren/learn/schema";
import { labelMatch, labelShots } from "@wrenautomation/falcon/video";
import { download } from "@wrenautomation/weaver/video";
import { collect } from "./args.js";
import { watchKeys } from "./video-watch.js";

const itemKindOf = (raw: string): ItemKind => {
  if ((ITEM_KINDS as readonly string[]).includes(raw)) return raw as ItemKind;
  throw new Error(`--kind is one of ${ITEM_KINDS.join(", ")}`);
};

import { ClaudeCodeLlm, gatewayEmbed } from "@wren/llm";
import { addSource, extractPoints } from "@wren/research/sops";
import type { Command } from "commander";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { learnReaders } from "./learn-readers.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/** How the commands reach their databases: main, a client's own, and `--client`'s id. */
interface LearnDbs {
  withMainDb: WithDb;
  /** A client's own database (its Notes), opened for the call. */
  withClientDb: <T>(client: string, fn: (db: Db) => Promise<T>) => Promise<T>;
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
/** Seconds as `4m12s`. */
const spent = (s: number) =>
  s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;

const tellOf = (v: string | undefined): Tell | null => {
  if (!v) return null;
  if (!(TELLS as readonly string[]).includes(v))
    throw new Error(`--tell is one of ${TELLS.join(", ")}`);
  return v as Tell;
};

export function registerLearn(
  program: Command,
  dbs: LearnDbs,
  settings: Settings,
  rootDir: string,
): void {
  const { withMainDb: withDb, withClientDb } = dbs;
  /** Main, and the workspace the command works in. */
  const inWorkspace = <T>(fn: (db: Db, client: string) => Promise<T>) =>
    withDb(async (db) => fn(db, await dbs.workspace()));
  const sopsDir = resolve(rootDir, settings.sopsDir);
  const { reader, judgeFor, catalogReader } = learnReaders(settings, rootDir);
  const writer = (model: string) => {
    const llm = new ClaudeCodeLlm(model, { timeoutMs: 1_800_000 });
    return {
      add: (dir: string, source: { name: string; md: string }) => addSource(dir, source),
      extract: async (dir: string, stem: string) => {
        await extractPoints(dir, llm, stem);
      },
    };
  };

  /** After a read: a client's item's asked SOPs go into its Notes. */
  const notesFor = async (db: Db, client: string, itemId: number) =>
    client === WREN
      ? []
      : withClientDb(client, (notesDb) => writeClientAsked(db, client, notesDb, { itemId }));

  /**
   * Read what waits for the Mac in every workspace (or `client`'s), score it, then write what was
   * asked into SOPs: Wren's into folders, a client's into its Notes as each is read.
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
    const out: Array<{
      id: number;
      read: string | null;
      verdict: string | null;
    }> = [];
    // TikTok creators are listed here (yt-dlp, the home IP); their new videos read below.
    const tiktok = await pullCreators(db, tiktokReader(settings.ytDlp), new Date(), {
      kinds: ["tiktok"],
      macReads: true,
    });
    for (const f of tiktok.failed) console.error(`tiktok ${f.source}: ${f.error}`);
    const waiting = await waitingForMac(db, {
      limit: o.limit,
      retry: o.retry ?? false,
      client: o.client ?? null,
    });
    for (const w of waiting) {
      const r = await readVideo(db, read, w.id);
      const verdict = r === "read" ? await scoreItem(db, judge, w.id) : null;
      if (r === "read" && o.sops) await notesFor(db, w.client, w.id);
      out.push({ id: w.id, read: r, verdict });
      console.error(`${w.id} ${r}${verdict ? ` ${verdict}` : ""} ${w.url}`);
    }
    const sops =
      o.sops && (!o.client || o.client === WREN)
        ? await writeAsked(db, sopsDir, writer(o.sopModel))
        : [];
    return { read: out, sops };
  };

  /**
   * Queue a creator's next `reels` posts Learn has not taken, then read and score them here, one
   * at a time. It says on stderr what it is doing (a page, a reel, the end); the JSON answer
   * comes last.
   */
  const catalog = (
    url: string,
    o: { reels: number; allPosts?: boolean; read: boolean; model: string },
  ) =>
    inWorkspace(async (db, client) => {
      const began = Date.now();
      const took = () => Math.round((Date.now() - began) / 1000);
      say(`catalog ${url}: walking for ${o.reels} ${o.allPosts ? "posts" : "reels"}`);
      const pass = await readCatalog(db, catalogReader(), {
        client,
        url,
        want: o.reels,
        now: new Date(),
        reelsOnly: !o.allPosts,
        onPage: (p) =>
          say(
            `page ${p.pages}: ${p.queued.length + p.revived.length} to read, ${p.skipped} skipped`,
          ),
      });
      const waiting = [...pass.revived, ...pass.queued];
      say(
        `${pass.creator}: ${pass.queued.length} queued, ${pass.revived.length} taken back, ${pass.skipped} skipped, ${pass.pages} pages${pass.end ? ", oldest post reached" : ""} (${spent(took())})`,
      );
      if (!o.read || !waiting.length) return pass;
      const { reads, stopped } = await readQueued(db, waiting, {
        read: reader(),
        judge: judgeFor(db, o.model),
        onRead: (r, n, of) =>
          say(
            `[${n}/${of}] ${r.id} ${r.read ?? "gone"}${r.verdict ? ` ${r.verdict}` : ""} ${spent(r.seconds)}${r.why ? `: ${r.why}` : ""}`,
          ),
      });
      const summary = catalogSummary(reads, took(), stopped);
      say(
        `done in ${spent(summary.seconds)}: ${summary.read} read (${summary.show} show, ${summary.hold} hold, ${summary.drop} drop${summary.unscored ? `, ${summary.unscored} unscored` : ""}), ${summary.failed} failed${summary.waits ? `, ${summary.waits} waiting on models` : ""}${stopped ? `. Stopped: ${stopped}` : ""}`,
      );
      return { ...pass, read: reads, summary };
    });

  const learn = program
    .command("learn")
    .description("Learn: saved links and followed sources, read, scored and searchable");

  learn
    .command("add <url>")
    .description("save a link (a reel, a video, a post), read it and score it now")
    .option("--title <title>", "blank takes the page's own")
    .option("--model <name>", "the scoring model", "cohere")
    .option("--no-read", "only save it: the Mac's next `learn read` takes it")
    .option("--kind <kind>", `what it is, when the link doesn't say: ${ITEM_KINDS.join(", ")}`)
    .action(
      async (url: string, o: { title?: string; model: string; read: boolean; kind?: string }) =>
        json(
          // A profile is its newest reels: the catalog's first pass.
          creatorOf(url)
            ? await catalog(url, { reels: 12, read: o.read, model: o.model })
            : await inWorkspace(async (db, client) => {
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
                  : await readItem(db, fetch, saved.id);
                const verdict =
                  r === "read" ? await scoreItem(db, judgeFor(db, o.model), saved.id) : null;
                return { ...saved, read: r, verdict };
              }),
        ),
    );

  learn
    .command("catalog <profile>")
    .description(
      "a creator's back catalog (Instagram, TikTok): a profile address or an Instagram handle (name or @name); the next reels Learn hasn't taken, newest first, read and scored one at a time with a line each on stderr; run it again for older ones",
    )
    .option("--reels <n>", "how many this pass", (v) => Number.parseInt(v, 10), 12)
    .option("--all-posts", "photos too, read from their captions")
    .option("--model <name>", "the scoring model", "cohere")
    .option("--no-read", "only queue them: the Mac's next `learn read` takes them")
    .action(
      async (url: string, o: { reels: number; allPosts?: boolean; read: boolean; model: string }) =>
        json(await catalog(url, o)),
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
      const keys = watchKeys(settings, rootDir);
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
            cohereKeys: keys.cohereKeys,
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
    .command("follow <url>")
    .description("follow a YouTube channel, a Substack, a blog or a podcast: its page or its feed")
    .option("--name <name>", "blank takes the feed's own title")
    .option("--tell <when>", `${TELLS.join(", ")}: every item, score 8 and up, or the digest`)
    .action(async (url: string, o: { name?: string; tell?: string }) =>
      json(
        await inWorkspace((db, client) =>
          follow(db, fetch, {
            client,
            url,
            name: o.name ?? null,
            tell: tellOf(o.tell),
            by: BY,
          }),
        ),
      ),
    );

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
    .description("one item whole: its summary, score, transcript and where it's kept")
    .action(async (id: string) =>
      json(
        await inWorkspace(async (db, client) => {
          const [n] = idsOf([id]);
          const got = n ? await itemPage(db, client, n) : null;
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
    .command("collection <name>")
    .description("a new collection to move items into")
    .option("--in <collection>", "inside this collection's id")
    .action(async (name: string, o: { in?: string }) =>
      json(
        await inWorkspace((db, client) =>
          addCollection(db, client, {
            name,
            parentId: o.in ? (idsOf([o.in])[0] ?? null) : null,
            by: BY,
          }),
        ),
      ),
    );

  learn
    .command("move <ids...>")
    .description("put items in a collection, or take them out of every one")
    .option("--to <collection>", "the collection's id; leave it off for none")
    .action(async (ids: string[], o: { to?: string }) =>
      json(
        await inWorkspace(async (db, client) => ({
          done: await moveItems(db, client, idsOf(ids), o.to ? (idsOf([o.to])[0] ?? null) : null),
        })),
      ),
    );

  learn
    .command("tag <ids...>")
    .description("add or remove tags on items: a line's find takes items tagged with its SOP")
    .option("--add <tag>", "a tag to add, repeatable", collect)
    .option("--remove <tag>", "a tag to remove, repeatable", collect)
    .action(async (ids: string[], o: { add?: string[]; remove?: string[] }) =>
      json(
        await inWorkspace(async (db, client) => ({
          done: await tagItems(db, client, idsOf(ids), {
            add: o.add ?? [],
            remove: o.remove ?? [],
          }),
        })),
      ),
    );

  learn
    .command("archive <ids...>")
    .description("archive items: out of the inbox, kept and searchable")
    .action(async (ids: string[]) =>
      json(
        await inWorkspace(async (db, client) => ({
          done: await mark(db, client, idsOf(ids), "archive"),
        })),
      ),
    );

  learn
    .command("rescore <ids...>")
    .description("score read items again, under today's rubric")
    .option("--model <name>", "the scoring model", "cohere")
    .action(async (ids: string[], o: { model: string }) =>
      json(
        await inWorkspace(async (db, client) => {
          const judge = judgeFor(db, o.model);
          const out: { id: number; verdict: string | null }[] = [];
          for (const id of await unscore(db, client, idsOf(ids)))
            out.push({ id, verdict: await scoreItem(db, judge, id) });
          return out;
        }),
      ),
    );

  learn
    .command("breakdown [ids...]")
    .description(
      "break read reels and videos down (hook style, beats, call to action); no ids: every one not done yet",
    )
    .option("--model <name>", "the model", "cohere")
    .option("--limit <n>", "at most this many", Number, 50)
    .action(async (ids: string[], o: { model: string; limit: number }) =>
      json(
        await inWorkspace(async (db, client) => {
          const judge = judgeFor(db, o.model);
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
          const done: number[] = [];
          for (const id of todo) if (await breakdownItem(db, judge, id)) done.push(id);
          return { tried: todo.length, done };
        }),
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
    .command("sources")
    .description("followed sources, by kind")
    .action(async () => json(await inWorkspace((db, client) => sourcesByKind(db, client))));

  learn
    .command("unfollow <ids...>")
    .description("stop reading sources; their items stay")
    .action(async (ids: string[]) =>
      json(
        await inWorkspace(async (db, client) => ({
          done: await unfollowSources(db, client, idsOf(ids)),
        })),
      ),
    );

  learn
    .command("embed")
    .description(
      "embed read items that have none yet, for search by meaning (the Monitor does this each pass)",
    )
    .option("--limit <n>", "how many", (v) => Number.parseInt(v, 10), 200)
    .action(async (o: { limit: number }) => {
      const embed = gatewayEmbed(process.env);
      if (!embed) throw new Error("needs WREN_LLM_GATEWAY_URL and WREN_LLM_GATEWAY_TOKEN");
      json(await withDb((db) => embedMissing(db, embed, o.limit)));
    });

  learn
    .command("search <words...>")
    .description(
      'every transcript, best match first: words, "a phrase", -not; with the gateway set, by meaning too',
    )
    .option("--limit <n>", "how many", (v) => Number.parseInt(v, 10), 20)
    .action(async (words: string[], o: { limit: number }) =>
      json(
        (
          await inWorkspace((db, client) =>
            searchItems(db, client, words.join(" "), o.limit, gatewayEmbed(process.env)),
          )
        ).map((h) => ({
          id: h.id,
          title: h.title,
          source: h.source,
          score: h.score,
          url: h.url,
          snippet: h.snippet,
        })),
      ),
    );

  learn
    .command("read")
    .description(
      "the Mac's reader: videos and reels waiting in every workspace (or --client's), read with yt-dlp and Gemini and scored, then SOP asks written",
    )
    .option("--limit <n>", "items a pass", (v) => Number.parseInt(v, 10), 20)
    .option("--retry", "take failed reads too")
    .option("--every <minutes>", "keep going, a pass this often", (v) => Number.parseInt(v, 10))
    .option("--model <name>", "the scoring model", "cohere")
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
    .description(
      "add an item to an SOP: Wren's folder (sop add, then extract), or a client's own Notes",
    )
    .option("--sop-model <name>", "Claude Code model for `sop extract`", "opus")
    .option("--later", "only ask: the next `learn read` writes it")
    .action(async (id: string, sop: string, o: { sopModel: string; later?: boolean }) =>
      json(
        await inWorkspace(async (db, client) => {
          const itemId = Number(id);
          const ask = await askSop(db, { client, itemId, sop, by: BY });
          if (o.later) return ask;
          if (client !== WREN) {
            const [done] = await notesFor(db, client, itemId);
            return (
              done ?? {
                asked: ask.sop,
                note: "Not read yet: the next `learn read` writes it.",
              }
            );
          }
          const done = await writeAsked(db, sopsDir, writer(o.sopModel), {
            itemId,
            sop: ask.sop,
          });
          return done.length
            ? { ...done[0], folder: join(sopsDir, ask.sop) }
            : {
                asked: ask.sop,
                note: "Not read yet: the next `learn read` writes it.",
              };
        }),
      ),
    );
}
