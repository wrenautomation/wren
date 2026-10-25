/**
 * A chapter of a video that is up on YouTube, as a post of its own: the chapter's title and what
 * he said in it (the words the cut keeps, between its start and the next chapter's), with the
 * video's link. One idea per chapter (ref `chapter:<edit>:<n>`), the video with the fewest
 * chapters used goes first, so every video keeps feeding the queue. A chapter under
 * `MIN_WORDS` says too little to stand alone and is passed over.
 */
import type { Queryable } from "@wren/db";
import { keepSegments, toCutTime } from "@wren/studio/cuts";
import type { Chapter, Cut, Word } from "@wren/studio/schema";
import { sql } from "drizzle-orm";
import { addIdeaOnce } from "../ideas.js";
import type { ContentIdea } from "../schema.js";

const MIN_WORDS = 40;
const MAX_SAID = 4000;
const FPS = 30;

export interface ChapterVideo {
  edit: number;
  title: string;
  url: string;
  durationS: number;
  chapters: Chapter[];
  words: Word[];
  cuts: Cut[];
  /** Chapter numbers already made into ideas. */
  used: number[];
}

const chapterRef = (edit: number, n: number) => `chapter:${edit}:${n}`;

/** What he said in chapter `n`: the kept words from its start to the next chapter's. */
export function chapterWords(v: ChapterVideo, n: number): string {
  const ch = v.chapters[n];
  if (!ch) return "";
  const end = v.chapters[n + 1]?.at ?? Number.POSITIVE_INFINITY;
  const keep = keepSegments(v.cuts, v.durationS, FPS);
  return v.words
    .filter((w) => w.s >= ch.at && w.s < end && toCutTime(w.s, keep) !== null)
    .map((w) => w.w)
    .join(" ");
}

export function chapterText(v: ChapterVideo, n: number, said: string): string {
  const title = v.chapters[n]?.title ?? "";
  return `From my video "${v.title}" (${v.url}), the part "${title}". What I said there:
"${said.slice(0, MAX_SAID)}"
Write one post on this point alone, from what I said. Link the video only where the platform allows links.`;
}

/** The next unused chapter worth a post: the least-used video first, then its earliest chapter. */
export function nextChapter(
  videos: readonly ChapterVideo[],
): { v: ChapterVideo; n: number; said: string } | null {
  const order = [...videos].sort((a, b) => a.used.length - b.used.length || b.edit - a.edit);
  for (const v of order)
    for (let n = 0; n < v.chapters.length; n++) {
      if (v.used.includes(n)) continue;
      const said = chapterWords(v, n);
      if (said.split(" ").length >= MIN_WORDS) return { v, n, said };
    }
  return null;
}

export async function chapterIdea(db: Queryable): Promise<ContentIdea | null> {
  const rows = (await db.execute(sql`
    select e.id edit, coalesce(nullif(e.title, ''), d.title, '') title, d.url,
      (e.tracks->'main'->>'durationS')::float "durationS", e.chapters, e.words, e.cuts,
      coalesce((select array_agg(split_part(c.ref, ':', 3)::int) from content_ideas c
        where c.ref like 'chapter:' || e.id || ':%'), '{}') used
    from content_drafts d
    join content_ideas i on i.id = d.idea_id
    join video_edits e on i.ref = 'video:' || e.id
    where d.platform = 'youtube' and d.status = 'published' and d.url is not null
      and coalesce(d.extra->>'kind', '') <> 'short' and jsonb_array_length(e.chapters) > 0`)) as unknown as ChapterVideo[];
  for (let tries = 0; tries < 3; tries++) {
    const next = nextChapter(rows);
    if (!next) return null;
    const idea = await addIdeaOnce(
      db,
      chapterText(next.v, next.n, next.said),
      "promo",
      chapterRef(next.v.edit, next.n),
    );
    if (idea) return idea;
    next.v.used.push(next.n); // made by a pass racing this one
  }
  return null;
}
