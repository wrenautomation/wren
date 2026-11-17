/**
 * Add creator finds (WA-1416 D7), one per sheet state. A made-up person: the repo is public.
 * `canon/creatorFindShow` answers by id; `canon/creatorFind` opens find 3 (found).
 */
import type { FindShown, FindShownCandidate } from "@wren/research/creator-find";

const AT = new Date("2026-11-16T20:00:00Z");
const base = {
  input: "Dana Reyes",
  inputKey: "dana reyes",
  name: "Dana Reyes" as string | null,
  niche: "business",
  personId: null as number | null,
  step: null as string | null,
  candidates: [] as FindShownCandidate[],
  runId: "01MOCKRUN",
  usd: 0.006,
  error: null as string | null,
  requestedBy: "william@example.com",
  createdAt: AT,
  updatedAt: AT,
};
const read = (o: Partial<NonNullable<FindShownCandidate["read"]>> = {}) => ({
  readAt: "2026-11-16T20:02:00Z",
  readFails: 0,
  readError: null,
  active: true,
  ...o,
});
const cand = (o: Partial<FindShownCandidate> & Pick<FindShownCandidate, "platform" | "handle">) =>
  ({
    url: `https://example.com/${o.platform}/${o.handle}`,
    name: "Dana Reyes",
    followers: null,
    label: "main",
    why: "Main account: the bio names her company.",
    sources: ["searxng"],
    creatorId: null,
    tracked: null,
    readError: null,
    read: null,
    ...o,
  }) as FindShownCandidate;

const CANDS: FindShownCandidate[] = [
  cand({
    platform: "youtube",
    handle: "@danareyes",
    followers: 1_240_000,
    creatorId: 11,
    tracked: "auto",
    read: read(),
  }),
  cand({
    platform: "youtube",
    handle: "@danareyesclips",
    name: "Dana Reyes Clips",
    followers: 88_000,
    label: "alternate",
    why: "Second channel with the same bio, run by her team.",
    sources: ["youtube-api"],
  }),
  cand({
    platform: "x",
    handle: "danareyes",
    creatorId: 12,
    tracked: "auto",
    read: read({ readAt: null }),
  }),
  cand({
    platform: "instagram",
    handle: "dana.reyes",
    creatorId: 13,
    tracked: "auto",
    read: read({ readAt: null, readFails: 1, readError: "This user's account is private" }),
  }),
  cand({
    platform: "instagram",
    handle: "danareyes_daily",
    name: "Daily Dana Reyes",
    label: "fan",
    why: "A stranger's clips account that tells followers to follow @dana.reyes.",
  }),
  cand({ platform: "tiktok", handle: "danareyes", creatorId: 14, tracked: "before", read: read() }),
  cand({
    platform: "linkedin",
    handle: "dana-reyes-4b21a7",
    label: "main",
    why: "LinkedIn profile listing her company; LinkedIn reads are unproven, so it waits for a tick.",
    sources: ["perplexity"],
  }),
  cand({
    platform: "linkedin",
    handle: "dana-reyes-sales-0091",
    name: "Dana Reyes",
    label: "other person",
    why: "A sales rep in another city with the same name.",
    sources: ["perplexity"],
  }),
  cand({
    platform: "threads",
    handle: "forbes",
    name: "Forbes",
    label: "not a profile",
    why: "A brand account.",
  }),
];

export const FINDS: Record<number, FindShown> = {
  1: { ...base, id: 1, name: null, state: "waiting" },
  2: { ...base, id: 2, state: "finding", step: "picking" },
  3: { ...base, id: 3, state: "found", personId: 7, candidates: CANDS },
  4: {
    ...base,
    id: 4,
    input: "Zyx Qor",
    name: "Zyx Qor",
    state: "found",
    candidates: [CANDS[8] as FindShownCandidate],
  },
  5: { ...base, id: 5, state: "failed", error: "The Mac stopped answering after 10 minutes" },
  6: {
    ...base,
    id: 6,
    input:
      "Maximiliana Wolfeschlegelsteinhausenbergerdorff-Okonkwo-Vandersteen Productions International",
    name: "Maximiliana Wolfeschlegelsteinhausenbergerdorff-Okonkwo-Vandersteen",
    state: "found",
    personId: 8,
    candidates: CANDS.map((c) => ({
      ...c,
      name: "Maximiliana Wolfeschlegelsteinhausenbergerdorff-Okonkwo-Vandersteen",
      handle: `${c.handle}_maximilianawolfeschlegelsteinhausenberger`,
      why: `${c.why} The display name, the bio and the linked site all match the person searched for, word for word.`,
    })),
  },
};

export const CREATOR_FIND_ANSWERS = {
  "canon/creatorFindShow": (b: Record<string, unknown>) => FINDS[Number(b.id)] ?? FINDS[3],
  "canon/creatorFind": () => FINDS[3],
  "canon/creatorTrack": () => FINDS[3],
  "canon/creatorRemove": () => ({ removed: true }),
};
