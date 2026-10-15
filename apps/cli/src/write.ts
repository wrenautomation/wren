/**
 * `wren [--client <id>] write`: one post in your own words, stored as a draft per platform and
 * waiting in To approve (what Marketing → Write does, with no model). A platform that needs a
 * file, TikTok's video, takes it from `--media`: a laptop file goes into the media store first.
 */
import type { Settings } from "@wren/config";
import { writeOwn } from "@wren/content";
import { PLATFORMS, type Platform } from "@wren/core/content";
import type { Db } from "@wren/db";
import type { Command } from "commander";
import { mediaOf } from "./content.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

export function registerWrite(program: Command, withDb: WithDb, settings: Settings): void {
  program
    .command("write")
    .description(
      "Write one post in your own words as a draft per platform, no model; --media for a video platform (TikTok)",
    )
    .argument("<text>", "the words (the caption, for a video)")
    .requiredOption("--platforms <list>", "comma-separated platforms")
    .option("--media <path>", "a video or image file, URL or s3:// object")
    .option("--kind <kind>", "video | image (default: by extension)")
    .option("--title <text>", "the title, where the platform has one")
    .action(
      async (
        text: string,
        o: { platforms: string; media?: string; kind?: string; title?: string },
      ) => {
        const platforms = o.platforms
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => {
            if (!(PLATFORMS as readonly string[]).includes(p))
              throw new Error(`platform must be one of ${PLATFORMS.join(", ")}`);
            return p as Platform;
          });
        const media = await mediaOf(
          { ...(o.media ? { media: o.media } : {}), ...(o.kind ? { kind: o.kind } : {}) },
          settings.mediaBucket,
        );
        const made = await withDb((db) =>
          writeOwn(db, { text, title: o.title ?? null, platforms, by: "cli", media }),
        );
        for (const r of made.results)
          console.log(r.ok ? `${r.platform}: draft ${r.draft.id}` : `${r.platform}: ${r.reason}`);
      },
    );
}
