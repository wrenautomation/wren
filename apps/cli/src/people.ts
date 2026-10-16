/**
 * `wren people …` (designs/2026-10-14-customerio-audit.md, B1): one profile per person.
 * `backfill` runs every address source's existing rows through `resolveProfile`; twice changes
 * nothing. `--client <id>` for a client's own database, and its rows kept on Wren's main one (its
 * form entries, sent and paid pay links) as timeline lines there (B7).
 *
 * The people map (designs/2026-10-15-people-map.md): `show`, `list` and `warm` read who someone
 * is and whether they're warm; `refresh` runs one pass; `personas` asks a model for unknown roles.
 */

import {
  fillPersonas,
  findProfile,
  listPeople,
  type PeopleFilter,
  type PersonaModel,
  peopleCounts,
  REASON_WORDS,
  type Rollup,
  STAGE_WORDS,
  warmthOf,
} from "@wren/core/people-map";
import { peopleMapPass } from "@wren/core/people-map-pass";
import { STAGES, WARM_REASONS } from "@wren/core/people-map-schema";
import {
  type BackfillCount,
  backfillClientRows,
  backfillProfiles,
  PROFILE_SOURCES,
} from "@wren/core/profiles-backfill";
import { mergeProfiles } from "@wren/core/profiles";
import { bulkBackfillProfiles } from "@wren/core/profiles-bulk";
import { linkBookers } from "@wren/core/profiles-link";
import type { Db } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { type Command, InvalidArgumentError } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const sourcesOf = (v: string): string[] => {
  const got = v.split(",").map((s) => s.trim());
  const bad = got.filter((s) => !(PROFILE_SOURCES as readonly string[]).includes(s));
  if (bad.length)
    throw new InvalidArgumentError(
      `not a source: ${bad.join(", ")} (${PROFILE_SOURCES.join(", ")})`,
    );
  return got;
};

const rowsOf = (v: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1)
    throw new InvalidArgumentError("rows: a whole number, 1 or more");
  return n;
};

type Args = { dryRun?: boolean; only?: string[]; batch: number; bulk?: boolean | number };

const oneOf =
  <T extends string>(what: string, list: readonly T[]) =>
  (v: string): T => {
    if (!(list as readonly string[]).includes(v))
      throw new InvalidArgumentError(`${what}: one of ${list.join(", ")}`);
    return v as T;
  };

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "-");

/** A rollup as lines a person reads. */
function showRollup(r: Rollup): string[] {
  const out = [
    `profile #${r.profileId}: ${STAGE_WORDS[r.stage]}, ${r.warmth}`,
    `  warmth: ${r.warmthLine ?? "none"}`,
  ];
  for (const k of WARM_REASONS) {
    const c = r.counts[k];
    if (c.n)
      out.push(
        `  ${REASON_WORDS[k].padEnd(22)} ${String(c.n).padStart(4)}  ${day(c.first)} to ${day(c.last)}`,
      );
  }
  const sent = r.counts.contacted;
  if (sent.n)
    out.push(
      `  ${"we reached out".padEnd(22)} ${String(sent.n).padStart(4)}  ${day(sent.first)} to ${day(sent.last)}`,
    );
  out.push(`  subscriptions: ${r.subscriptions ?? "none"}`);
  if (r.repliedChannels)
    out.push(`  replied on: ${r.repliedChannels} (last ${r.repliedLastChannel})`);
  if (r.firstTouch)
    out.push(`  first: ${day(r.firstTouch.at)} ${r.firstTouch.channel} ${r.firstTouch.what ?? ""}`);
  if (r.lastTouch)
    out.push(`  last: ${day(r.lastTouch.at)} ${r.lastTouch.channel} ${r.lastTouch.what ?? ""}`);
  out.push(`  came from: ${r.cameFrom ?? "-"}`);
  out.push(`  persona: ${r.persona} (${r.personaRole}, ${r.personaNiche}, ${r.personaSize})`);
  return out;
}

/** A model as `fillPersonas` asks it: one JSON object back. */
function personaModel(llm: LlmClient): PersonaModel {
  return async (facts) => {
    const r = await llm.complete(
      `Title: ${facts.title ?? "-"}\nCompany: ${facts.company ?? "-"}\nHeadline: ${facts.headline ?? "-"}`,
      {
        system:
          'Who is this person at work? Answer one JSON object: {"role": "owner"|"executive"|"manager"|"staff"|null, "niche": a one-word industry in lower case or null, "size": "solo"|"small"|"mid"|"large"|null}. null when unsure.',
        maxTokens: 80,
      },
    );
    try {
      const j = JSON.parse(/\{[\s\S]*\}/.exec(r.text)?.[0] ?? "{}") as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" && v ? v : null);
      return {
        role: str(j.role) as never,
        niche: str(j.niche)?.toLowerCase() ?? null,
        size: str(j.size) as never,
      };
    } catch {
      return { role: null, niche: null, size: null };
    }
  };
}

export function registerPeople(
  program: Command,
  o: {
    withDb: WithDb;
    withMainDb: WithDb;
    client: () => string | undefined;
    /** A model by name, its keys loaded; for `personas` only. */
    llm?: (name: string) => LlmClient;
  },
): void {
  const people = program
    .command("people")
    .description("profiles: one per person, by every address they use");
  people
    .command("backfill")
    .description("make or join a profile for every existing address row")
    .option("--dry-run", "count rows only")
    .option("--only <sources>", "comma list of sources", sourcesOf)
    .option("--batch <n>", "rows per read", (v) => Number(v), 500)
    .option("--bulk [rows]", "set-based, same result, far faster (rows per read, 5000)", rowsOf)
    .action(async (a: Args) => {
      await o.withDb(async (db) => {
        const opts = {
          ...(a.dryRun ? { dryRun: true } : {}),
          ...(a.only ? { only: a.only } : {}),
          progress: (c: { source: string; rows: number }) =>
            process.stderr.write(`\r${`${c.source} ${c.rows} rows`.padEnd(40)}`),
        };
        const counts: (BackfillCount & { chunks?: number; perRow?: number })[] = a.bulk
          ? await bulkBackfillProfiles(db, {
              ...opts,
              ...(a.bulk === true ? {} : { batch: a.bulk }),
            })
          : await backfillProfiles(db, { ...opts, batch: a.batch });
        process.stderr.write("\n");
        for (const c of counts)
          console.log(
            `${c.source.padEnd(14)} ${String(c.rows).padStart(7)} rows  ${c.created} made  ${c.merged} merged  ${c.skipped} skipped${c.chunks === undefined ? "" : `  (${c.chunks} chunks, ${c.perRow} one by one)`}`,
          );
        // Bookers we reached under another address join that profile (by name and domain).
        if (!a.dryRun && (!a.only || a.only.some((x) => x.includes("booking")))) {
          const linked = await linkBookers(db);
          const merged = linked.reduce((n, l) => n + l.merged.length, 0);
          const maybe = linked.reduce((n, l) => n + l.maybe.length, 0);
          console.log(`bookers linked  ${merged} merged  ${maybe} left to judge`);
        }
        const client = o.client();
        if (!client || a.only) return;
        const kept = await o.withMainDb((main) =>
          backfillClientRows(main, client, db, {
            ...(a.dryRun ? { dryRun: true } : {}),
            batch: a.batch,
          }),
        );
        for (const c of kept)
          console.log(
            `${`${c.source} (main)`.padEnd(14)} ${String(c.rows).padStart(7)} rows  ${c.noted} lines`,
          );
      });
    });

  people
    .command("show <who>")
    .description("one person: stage, warmth and why, subscriptions, touches, persona (read live)")
    .option("--json", "as JSON")
    .action(async (who: string, a: { json?: boolean }) => {
      await o.withDb(async (db) => {
        const id = await findProfile(db, who);
        if (!id) throw new Error(`no profile for ${who}`);
        const [r] = await warmthOf(db, [id]);
        if (!r) throw new Error(`profile #${id} is merged or gone`);
        console.log(a.json ? JSON.stringify(r, null, 2) : showRollup(r).join("\n"));
      });
    });
  people
    .command("warm <who>")
    .description("the warm gate: why a cold opener would be refused, or cold")
    .action(async (who: string) => {
      await o.withDb(async (db) => {
        const id = await findProfile(db, who);
        if (!id) return console.log("cold (no profile)");
        const [r] = await warmthOf(db, [id]);
        console.log(r?.warmth === "warm" ? `warm: ${r.warmthLine}` : "cold");
      });
    });
  // The answer to a "may be the same person" line on a timeline: a person judged, so the two join.
  people
    .command("merge <from> <into>")
    .description(
      "one person under two profiles: from joins into (keys, lines and traits move; nothing is deleted)",
    )
    .action(async (fromWho: string, intoWho: string) => {
      await o.withDb(async (db) => {
        const from = await findProfile(db, fromWho);
        const into = await findProfile(db, intoWho);
        if (!from || !into) throw new Error(`no profile for ${from ? intoWho : fromWho}`);
        if (from === into) throw new Error(`#${from} is already one profile`);
        const got = await mergeProfiles(db, into, from, "a person: wren people merge", "person");
        console.log(`#${from} joined #${into}: ${got.keys} keys, ${got.traits} traits`);
      });
    });
  people
    .command("list")
    .description("people from the map, latest touch first; with no filter, counts by stage")
    .option("--stage <stage>", STAGES.join(", "), oneOf("stage", STAGES))
    .option("--warmth <w>", "warm or cold", oneOf("warmth", ["warm", "cold"] as const))
    .option("--persona <p>", "a role, size, niche, or whole persona")
    .option("--reason <r>", WARM_REASONS.join(", "), oneOf("reason", WARM_REASONS))
    .option("--subscribed [topic]", "any consent, or one naming this topic")
    .option("--replied", "replied at least once")
    .option("--source <s>", "came from (lead_import, site_form, ...) or first channel")
    .option(
      "--sort <s>",
      "last, warm, replied, id",
      oneOf("sort", ["last", "warm", "replied", "id"] as const),
      "last",
    )
    .option("--limit <n>", "rows", (v) => Number(v), 50)
    .option("--json", "as JSON")
    .action(async (a: PeopleFilter & { json?: boolean }) => {
      await o.withDb(async (db) => {
        const { json, ...f } = a;
        const filtered = Object.keys(f).some((k) => !["sort", "limit"].includes(k));
        if (!filtered && !json) {
          for (const c of await peopleCounts(db))
            console.log(
              `${STAGE_WORDS[c.stage].padEnd(12)} ${c.warmth.padEnd(5)} ${String(c.n).padStart(8)}`,
            );
          return;
        }
        const rows = await listPeople(db, f);
        if (json) return console.log(JSON.stringify(rows, null, 2));
        for (const r of rows)
          console.log(
            `#${String(r.profileId).padEnd(7)} ${r.name.slice(0, 28).padEnd(28)} ${r.stage.padEnd(11)} ${r.warmth.padEnd(5)} ${r.persona.padEnd(22)} ${day(r.lastTouchAt)}  ${r.warmthLine ?? ""}`,
          );
      });
    });
  people
    .command("refresh")
    .description("one people map pass now: loose handles keyed, every row rebuilt")
    .action(async () => {
      await o.withDb(async (db) => {
        const s = await peopleMapPass(db);
        console.log(
          `handles ${s.handles.keyed} keyed of ${s.handles.seen}; ${s.written} rows written, ${s.dropped} dropped, ${s.traits} traits; ${s.ms} ms`,
        );
      });
    });
  people
    .command("personas")
    .description("ask a model for unknown roles from titles and headlines; writes persona_* traits")
    .requiredOption("--model <name>", "the model (as WREN_LLM names one)")
    .option("--limit <n>", "profiles asked", (v) => Number(v), 50)
    .option("--dry-run", "ask, but write nothing")
    .action(async (a: { model: string; limit: number; dryRun?: boolean }) => {
      if (!o.llm) throw new Error("no model plumbing in this build");
      const model = personaModel(o.llm(a.model));
      await o.withDb(async (db) => {
        const r = await fillPersonas(db, model, {
          limit: a.limit,
          ...(a.dryRun ? { dryRun: true } : {}),
        });
        console.log(`${r.asked} asked, ${r.set} ${a.dryRun ? "would be set" : "set"}`);
      });
    });
}
