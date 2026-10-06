/**
 * How likely an answer engine is to lift a passage whole: a 0-100 heuristic over five parts
 * (answer quality 30, self-containment 25, structure 20, figures 15, first-hand signals 10).
 * Passages are the site's `/llms.txt` split at headings, so an FAQ answer scores on its own.
 * A guide for the weekly search pass, not a gate: it points at weak passages; a person or the
 * `/search-week` agent decides what to change.
 *
 * Ported from geo-seo-claude's citability_scorer.py (MIT, Copyright (c) zubair-trabzada); the
 * weights and patterns are theirs, the passage split is ours.
 */

export interface PassageScore {
  heading: string;
  words: number;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  parts: {
    answer: number;
    selfContained: number;
    structure: number;
    figures: number;
    firstHand: number;
  };
  preview: string;
}

const has = (re: RegExp, s: string) => re.test(s);
const count = (re: RegExp, s: string) => s.match(re)?.length ?? 0;

export function scorePassage(text: string, heading = ""): PassageScore {
  const words = text.split(/\s+/).filter(Boolean);
  const n = words.length;
  const sentences = text.split(/[.!?]+/);

  // 1. answer quality (30)
  let answer = 0;
  if (
    [
      /\b\w+\s+is\s+(?:a|an|the)\s/i,
      /\b\w+\s+refers?\s+to\s/i,
      /\b\w+\s+means?\s/i,
      /\b\w+\s+(?:can be |are )?defined\s+as\s/i,
      /\bin\s+(?:simple|other)\s+(?:terms|words)\s*,/i,
    ].some((p) => has(p, text))
  )
    answer += 15;
  const first60 = words.slice(0, 60).join(" ");
  if (
    [
      /\b(?:is|are|was|were|means?|refers?)\b/i,
      /\d+%/,
      /\$[\d,]+/,
      /\d+\s+(?:million|billion|thousand)/i,
    ].some((p) => has(p, first60))
  )
    answer += 15;
  if (heading.trim().endsWith("?")) answer += 10;
  const clear = sentences.filter((s) => {
    const w = s.split(/\s+/).filter(Boolean).length;
    return w >= 5 && w <= 25;
  }).length;
  answer += Math.floor((clear / sentences.length) * 10);
  if (
    has(
      /(?:according to|research shows|studies? (?:show|indicate|suggest|found)|data (?:shows|indicates|suggests))/i,
      text,
    )
  )
    answer += 10;

  // 2. self-containment (25)
  let selfContained =
    n >= 134 && n <= 167
      ? 10
      : n >= 100 && n <= 200
        ? 7
        : n >= 80 && n <= 250
          ? 4
          : n < 30 || n > 400
            ? 0
            : 2;
  const pronouns = count(/\b(?:it|they|them|their|this|that|these|those|he|she|his|her)\b/gi, text);
  const ratio = n > 0 ? pronouns / n : 1;
  selfContained += ratio < 0.02 ? 8 : ratio < 0.04 ? 5 : ratio < 0.06 ? 3 : 0;
  const proper = count(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g, text);
  selfContained += proper >= 3 ? 7 : proper >= 1 ? 4 : 0;

  // 3. structure (20)
  const avg = n / sentences.length;
  let structure = avg >= 10 && avg <= 20 ? 8 : avg >= 8 && avg <= 25 ? 5 : 2;
  if (has(/(?:first|second|third|finally|additionally|moreover|furthermore)/i, text))
    structure += 4;
  if (has(/(?:\d+[.)]\s|\b(?:step|tip|point)\s+\d+)/i, text)) structure += 4;
  if (text.includes("\n")) structure += 4;

  // 4. figures (15)
  let figures = Math.min(count(/\d+(?:\.\d+)?%/g, text) * 3, 6);
  figures += Math.min(count(/\$[\d,]+(?:\.\d+)?(?:\s*(?:million|billion|M|B|K))?/g, text) * 3, 5);
  figures += Math.min(
    count(
      /\b\d+(?:,\d{3})*(?:\.\d+)?\s+(?:users|customers|pages|sites|companies|businesses|people|percent|times|x\b)/gi,
      text,
    ) * 2,
    4,
  );
  if (has(/\b20(?:2\d|1\d)\b/, text)) figures += 2;
  for (const p of [
    /(?:according to|per|from|by)\s+[A-Z]/,
    /(?:Gartner|Forrester|McKinsey|Harvard|Stanford|MIT|Google|Microsoft|OpenAI|Anthropic)/,
    /\([A-Z][a-z]+(?:\s+\d{4})?\)/,
  ])
    if (has(p, text)) figures += 2;

  // 5. first-hand signals (10)
  let firstHand = 0;
  if (
    has(
      /(?:our (?:research|study|data|analysis|survey|findings)|we (?:found|discovered|analyzed|surveyed|measured))/i,
      text,
    )
  )
    firstHand += 5;
  if (has(/(?:case study|for example|for instance|in practice|real-world|hands-on)/i, text))
    firstHand += 3;
  if (has(/(?:using|with|via|through)\s+[A-Z][a-z]+/, text)) firstHand += 2;

  const parts = {
    answer: Math.min(answer, 30),
    selfContained: Math.min(selfContained, 25),
    structure: Math.min(structure, 20),
    figures: Math.min(figures, 15),
    firstHand: Math.min(firstHand, 10),
  };
  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  return {
    heading,
    words: n,
    score,
    grade: score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "F",
    parts,
    preview: words.slice(0, 30).join(" ") + (n > 30 ? "…" : ""),
  };
}

/** Markdown split at `#`-headings; list-only and short blocks (under 20 words) are not passages. */
export function passagesOf(markdown: string): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  let heading = "Introduction";
  let body: string[] = [];
  const flush = () => {
    const prose = body.filter((l) => l.trim() && !/^\s*-\s+\[/.test(l));
    const text = prose.join("\n").replace(/^>\s*/gm, "").trim();
    if (text.split(/\s+/).filter(Boolean).length >= 20) out.push({ heading, text });
  };
  for (const line of markdown.split("\n")) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      flush();
      heading = h[1] ?? "";
      body = [];
    } else body.push(line);
  }
  flush();
  return out;
}

export interface Citability {
  passages: PassageScore[];
  average: number;
  /** Passages in the 134-167 word band answer engines lift most. */
  inBand: number;
}

export function citability(markdown: string): Citability {
  const passages = passagesOf(markdown).map((p) => scorePassage(p.text, p.heading));
  return {
    passages,
    average: passages.length
      ? Math.round((10 * passages.reduce((a, p) => a + p.score, 0)) / passages.length) / 10
      : 0,
    inBand: passages.filter((p) => p.words >= 134 && p.words <= 167).length,
  };
}
