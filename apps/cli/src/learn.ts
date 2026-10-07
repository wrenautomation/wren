/**
 * `wren learn …` (designs/2026-10-07-learn.md): save a link, follow a source, list and search
 * what Learn kept, and the Mac's reader. `read` reads videos and reels waiting for the Mac with
 * the `sop add` readers (yt-dlp, the Gemini key fleet), scores them, then writes items asked into
 * an SOP into its folder and extracts their points. Nothing here signs in to any social account.
 */
import { join, resolve } from "node:path";
import type { Settings } from "@wren/config";
import { contentPlaybooks } from "@wren/content/schema";
import type { Db } from "@wren/db";
import {
  askSop,
  follow,
  listItems,
  needsMac,
  type Practice,
  practiceOf,
  readItem,
  readOnMac,
  saveLink,
  scoreItem,
  searchItems,
  TELLS,
  type Tell,
  type VideoReader,
  waitingForMac,
  writeAsked,
} from "@wren/learn";
import { ClaudeCodeLlm, fleetKeys, type LlmClient, loadLlmEnv, makeLlm } from "@wren/llm";
import { addSource, extractPoints, videoSource, youtubeSource } from "@wren/research/sops";
import type { Command } from "commander";
import { desc } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

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
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
): void {
  const sopsDir = resolve(rootDir, settings.sopsDir);
  /** The `sop add` readers: YouTube by captions plus the screen, other video by Gemini. */
  const reader = (): VideoReader => {
    // Gemini keys come from llm.env; never logged.
    loadLlmEnv(settings.llmEnvPath, rootDir);
    const geminiKeys = fleetKeys(process.env, "gemini");
    return async (url) => {
      const youtube = /^https:\/\/youtube\.com\//.test(url);
      const s = youtube
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

  /** Read what waits for the Mac, score it, then write what was asked into SOPs. */
  const pass = async (
    db: Db,
    o: { limit: number; retry?: boolean; model: string; sopModel: string; sops: boolean },
  ) => {
    const read = reader();
    const llm = scorer(o.model);
    const practices = await practicesOf(db);
    const out: Array<{ id: number; read: string | null; verdict: string | null }> = [];
    for (const w of await waitingForMac(db, { limit: o.limit, retry: o.retry ?? false })) {
      const r = await readOnMac(db, read, w.id);
      const verdict = r === "read" ? await scoreItem(db, llm, practices, w.id) : null;
      out.push({ id: w.id, read: r, verdict });
      console.error(`${w.id} ${r}${verdict ? ` ${verdict}` : ""} ${w.url}`);
    }
    const sops = o.sops ? await writeAsked(db, sopsDir, writer(o.sopModel)) : [];
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
        await withDb(async (db) => {
          const saved = await saveLink(db, { url, by: BY, via: "cli", title: o.title ?? null });
          if (!saved.unread || !o.read) return saved;
          const r = needsMac(saved.kind)
            ? await readOnMac(db, reader(), saved.id)
            : await readItem(db, fetch, saved.id);
          const verdict =
            r === "read"
              ? await scoreItem(db, scorer(o.model), await practicesOf(db), saved.id)
              : null;
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
        await withDb((db) =>
          follow(db, fetch, { url, name: o.name ?? null, tell: tellOf(o.tell), by: BY }),
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
        await withDb((db) =>
          listItems(db, { saved: !!o.saved, waiting: !!o.waiting, limit: o.limit }),
        ),
      ),
    );

  learn
    .command("search <words...>")
    .description('every transcript, best match first: words, "a phrase", -not')
    .option("--limit <n>", "how many", (v) => Number.parseInt(v, 10), 20)
    .action(async (words: string[], o: { limit: number }) =>
      json(
        (await withDb((db) => searchItems(db, words.join(" "), o.limit))).map((h) => ({
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
      "the Mac's reader: videos and reels waiting, read with yt-dlp and Gemini and scored, then SOP asks written",
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
        for (;;) {
          json(await withDb((db) => pass(db, o)));
          if (!o.every) return;
          const every = o.every;
          await new Promise((r) => setTimeout(r, every * 60_000));
        }
      },
    );

  learn
    .command("to-sop <id> <sop>")
    .description("add an item to an SOP's sources and extract its points (sop add, then extract)")
    .option("--sop-model <name>", "Claude Code model for `sop extract`", "opus")
    .option("--later", "only ask: the next `learn read` writes it")
    .action(async (id: string, sop: string, o: { sopModel: string; later?: boolean }) =>
      json(
        await withDb(async (db) => {
          const ask = await askSop(db, { itemId: Number(id), sop, by: BY });
          if (o.later) return ask;
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
