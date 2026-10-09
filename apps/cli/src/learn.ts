/**
 * `wren learn …` (designs/2026-10-07-learn.md): save a link, follow a source, list, show, move,
 * archive and search what Learn kept, and the Mac's reader. Every command works in one workspace:
 * Wren's own, or the client `--client` names; another's items are "no such item". `read` reads
 * videos and reels waiting for the Mac with the `sop add` readers (yt-dlp, the Gemini key fleet)
 * for every workspace (or the one named), a client's on its models allowance, scores them, then
 * writes items asked into an SOP: Wren's into its folder, a client's into its own Notes. Nothing
 * here signs in to any social account.
 */
import { join, resolve } from "node:path";
import type { Settings } from "@wren/config";
import { contentPlaybooks } from "@wren/content/schema";
import { WREN } from "@wren/core/access";
import type { Db } from "@wren/db";
import {
  askSop,
  embedMissing,
  follow,
  itemPage,
  judges,
  listItems,
  mark,
  moveItems,
  needsMac,
  type Practice,
  practiceOf,
  readItem,
  readVideo,
  saveLink,
  scoreItem,
  searchItems,
  sourcesByKind,
  TELLS,
  type Tell,
  unfollowSources,
  type VideoReader,
  waitingForMac,
  writeAsked,
  writeClientAsked,
} from "@wren/learn";
import {
  ClaudeCodeLlm,
  fleetKeys,
  gatewayEmbed,
  type LlmClient,
  loadLlmEnv,
  makeLlm,
} from "@wren/llm";
import {
  addSource,
  audioSource,
  extractPoints,
  videoSource,
  youtubeSource,
} from "@wren/research/sops";
import type { Command } from "commander";
import { desc } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/** How the commands reach their databases: main, a client's own, and `--client`'s id. */
export interface LearnDbs {
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

/** Each pushed SOP's newest text: what an item is scored against. */
async function practicesOf(db: Db): Promise<Practice[]> {
  const rows = await db
    .selectDistinctOn([contentPlaybooks.sop], {
      sop: contentPlaybooks.sop,
      text: contentPlaybooks.text,
    })
    .from(contentPlaybooks)
    .orderBy(contentPlaybooks.sop, desc(contentPlaybooks.createdAt));
  return rows.map((r) => practiceOf(r.sop, r.text));
}

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
  /** The `sop add` readers: YouTube by captions plus the screen, other video by Gemini, audio cut by ffmpeg. */
  const reader = (): VideoReader => {
    // Gemini keys come from llm.env; never logged.
    loadLlmEnv(settings.llmEnvPath, rootDir);
    const geminiKeys = fleetKeys(process.env, "gemini");
    return async ({ url, kind, title, creator, mediaUrl }) => {
      const youtube = /^https:\/\/youtube\.com\//.test(url);
      const s =
        kind === "episode" && mediaUrl
          ? await audioSource(mediaUrl, { url, title, creator, geminiKeys })
          : youtube
            ? await youtubeSource(url, settings.ytDlp, undefined, { geminiKeys })
            : await videoSource(url, settings.ytDlp, undefined, { geminiKeys });
      return { file: s.name, md: s.md };
    };
  };
  const scorer = (model: string): LlmClient => {
    loadLlmEnv(settings.llmEnvPath, rootDir);
    return makeLlm(model, process.env);
  };
  const writer = (model: string) => {
    const llm = new ClaudeCodeLlm(model, { timeoutMs: 1_800_000 });
    return {
      add: (dir: string, source: { name: string; md: string }) => addSource(dir, source),
      extract: async (dir: string, stem: string) => {
        await extractPoints(dir, llm, stem);
      },
    };
  };

  /** Each workspace's judge: Wren's pushed SOPs; a client's own, on its models allowance. */
  const judgeFor = (db: Db, model: string) =>
    judges({ db, llm: scorer(model), wrenPractices: () => practicesOf(db) });
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
    const out: Array<{ id: number; read: string | null; verdict: string | null }> = [];
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

  const learn = program
    .command("learn")
    .description("Learn: saved links and followed sources, read, scored and searchable");

  learn
    .command("add <url>")
    .description("save a link (a reel, a video, a post), read it and score it now")
    .option("--title <title>", "blank takes the page's own")
    .option("--model <name>", "the scoring model", "cohere")
    .option("--no-read", "only save it: the Mac's next `learn read` takes it")
    .action(async (url: string, o: { title?: string; model: string; read: boolean }) =>
      json(
        await inWorkspace(async (db, client) => {
          const saved = await saveLink(db, {
            client,
            url,
            by: BY,
            via: "cli",
            title: o.title ?? null,
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
    .command("follow <url>")
    .description("follow a YouTube channel, a Substack, a blog or a podcast: its page or its feed")
    .option("--name <name>", "blank takes the feed's own title")
    .option("--tell <when>", `${TELLS.join(", ")}: every item, score 8 and up, or the digest`)
    .action(async (url: string, o: { name?: string; tell?: string }) =>
      json(
        await inWorkspace((db, client) =>
          follow(db, fetch, { client, url, name: o.name ?? null, tell: tellOf(o.tell), by: BY }),
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
          listItems(db, client, { saved: !!o.saved, waiting: !!o.waiting, limit: o.limit }),
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
          const ask = await askSop(db, { client, itemId: Number(id), sop, by: BY });
          if (o.later) return ask;
          if (client !== WREN) {
            const [done] = await notesFor(db, client, ask.itemId);
            return (
              done ?? { asked: ask.sop, note: "Not read yet: the next `learn read` writes it." }
            );
          }
          const done = await writeAsked(db, sopsDir, writer(o.sopModel), {
            itemId: ask.itemId,
            sop: ask.sop,
          });
          return done.length
            ? { ...done[0], folder: join(sopsDir, ask.sop) }
            : { asked: ask.sop, note: "Not read yet: the next `learn read` writes it." };
        }),
      ),
    );
}
