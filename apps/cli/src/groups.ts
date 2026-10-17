/**
 * `wren groups …` and `wren channels` (designs/2026-10-15-channel-stats.md): People groups as
 * text for agents, and the funnel per channel. A rule is written as `segments-text.ts` reads it:
 *
 *   wren groups count 'all(trait persona is "agency owner", step saw on reddit in 30d)'
 *   wren groups save "Warm owners" --rule 'all(...)'
 *   wren channels --days 30 --by source --channel email
 *
 * `--client <id>` works in that client's workspace.
 */
import { readFileSync } from "node:fs";
import {
  ATTRIBUTIONS,
  type Attribution,
  channelPeople,
  channelStats,
  type StatsQuery,
} from "@wren/core/channel-stats";
import { FUNNEL_STEPS, type FunnelStep } from "@wren/core/channel-stats-schema";
import { profileOf } from "@wren/core/profiles";
import {
  inSegment,
  listSegments,
  previewRule,
  type Rule,
  ruleWords,
  type Segment,
  saveSegment,
  segmentMembers,
  segmentNames,
  segmentVersions,
} from "@wren/core/segments";
import type { SegmentKind } from "@wren/core/segments-schema";
import { parseRule, ruleText } from "@wren/core/segments-text";
import type { Db } from "@wren/db";
import { type Command, InvalidArgumentError } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const whole = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError("a whole number, 1 or more");
  return n;
};

/** A rule's text: inline, or `@file` read from disk, or `-` from stdin. */
function textOf(v: string): string {
  if (v === "-") return readFileSync(0, "utf8");
  if (v.startsWith("@")) return readFileSync(v.slice(1), "utf8");
  return v;
}

/** Text read into a rule against this workspace's group names; exits 1 with why when it won't. */
async function ruleOf(db: Db, text: string): Promise<Rule> {
  const names = await segmentNames(db);
  const got = parseRule(textOf(text), new Map([...names].map(([id, n]) => [n, id])));
  if ("problems" in got) {
    for (const p of got.problems) console.error(p);
    process.exit(1);
  }
  return got.rule;
}

/** A group by id or name (any case). */
async function segmentOf(db: Db, ref: string): Promise<Segment> {
  const all = await listSegments(db);
  const s = /^\d+$/.test(ref)
    ? all.find((x) => x.id === Number(ref))
    : all.find((x) => x.name.toLowerCase() === ref.toLowerCase());
  if (!s) throw new InvalidArgumentError(`no group ${ref}`);
  return s;
}

const pct = (v: number | null) => (v === null ? "" : `${Math.round(v * 100)}%`);

export function registerGroups(program: Command, o: { withDb: WithDb }): void {
  const seg = program
    .command("groups")
    .description("People groups: rules as text, counts, members, versions");

  seg
    .command("list")
    .description("every group: id, kind, size, version, name")
    .option("--archived", "the archived ones")
    .action((a: { archived?: boolean }) =>
      o.withDb(async (db) => {
        for (const s of await listSegments(db, a.archived ? "archived" : "active"))
          console.log(
            `${String(s.id).padStart(4)}  ${s.kind.padEnd(8)} ${String(s.size).padStart(7)}  v${s.version}  ${s.name}`,
          );
      }),
    );

  seg
    .command("show <group>")
    .description("one group, by id or name: its rule as text and in words")
    .action((ref: string) =>
      o.withDb(async (db) => {
        const s = await segmentOf(db, ref);
        const names = await segmentNames(db);
        console.log(`${s.name} (#${s.id}, ${s.kind}, v${s.version}, ${s.size} in, ${s.state})`);
        if (s.rule) {
          console.log(ruleText(s.rule, names));
          console.log(`\n${ruleWords(s.rule, names)}`);
        }
        if (s.words) console.log(`\nAsked as: ${s.words}`);
      }),
    );

  seg
    .command("check <rule>")
    .description("read a rule (text, @file or -): print it back, as JSON and in words")
    .action((text: string) =>
      o.withDb(async (db) => {
        const rule = await ruleOf(db, text);
        const names = await segmentNames(db);
        console.log(ruleText(rule, names));
        console.log(JSON.stringify(rule));
        console.log(ruleWords(rule, names));
      }),
    );

  seg
    .command("count <rule>")
    .description("how many a rule matches now, and a few of them")
    .action((text: string) =>
      o.withDb(async (db) => {
        const p = await previewRule(db, await ruleOf(db, text), new Date());
        console.log(`${p.size} people: ${p.words}`);
        for (const s of p.sample) console.log(`  #${s.id} ${s.name}`);
      }),
    );

  seg
    .command("save <name>")
    .description("make or change a group by name; each save is a new version")
    .option("--rule <rule>", "its rule (text, @file or -); a manual one has none")
    .option("--kind <kind>", "live, manual or snapshot (a new one only)", "live")
    .option("--words <words>", "what it was asked as, in plain words")
    .action((name: string, a: { rule?: string; kind: string; words?: string }) =>
      o.withDb(async (db) => {
        const was = (await listSegments(db)).find(
          (s) => s.name.toLowerCase() === name.trim().toLowerCase(),
        );
        const rule = a.rule ? await ruleOf(db, a.rule) : undefined;
        const got = await saveSegment(
          db,
          {
            id: was?.id ?? null,
            name,
            kind: (was?.kind ?? a.kind) as SegmentKind,
            rule: rule ?? was?.rule ?? undefined,
            words: a.words ?? was?.words ?? null,
            expect: was?.updatedAt ?? null,
          },
          "cli",
          new Date(),
        );
        const s = got.segment;
        console.log(
          `${was ? "changed" : "made"} #${s.id} ${s.name}: v${s.version}, ${s.size} in` +
            (got.change ? ` (+${got.change.entered.length} -${got.change.left.length})` : ""),
        );
      }),
    );

  seg
    .command("members <group>")
    .description("who is in it now")
    .option("--limit <n>", "at most", whole, 100)
    .action((ref: string, a: { limit: number }) =>
      o.withDb(async (db) => {
        const s = await segmentOf(db, ref);
        for (const m of await segmentMembers(db, s.id, { limit: a.limit }))
          console.log(`#${m.profileId}  ${m.name ?? ""}  ${[...m.emails, ...m.phones].join(", ")}`);
      }),
    );

  seg
    .command("history <group>")
    .description("every save: version, when, by whom, the rule then")
    .action((ref: string) =>
      o.withDb(async (db) => {
        const s = await segmentOf(db, ref);
        const names = await segmentNames(db);
        for (const v of await segmentVersions(db, s.id))
          console.log(
            `v${v.version}  ${v.at.slice(0, 16)}  ${v.by}  ${v.name}\n  ${v.rule ? ruleText(v.rule, names).replace(/\n/g, "\n  ") : "(no rule)"}`,
          );
      }),
    );

  seg
    .command("in <group> <person>")
    .description("is this person (a profile id or an email) in it now? exits 1 when not")
    .action((ref: string, who: string) =>
      o.withDb(async (db) => {
        const s = await segmentOf(db, ref);
        const id = /^\d+$/.test(who)
          ? Number(who)
          : await profileOf(db, { kind: "email", value: who });
        if (!id) throw new InvalidArgumentError(`no profile ${who}`);
        const yes = await inSegment(db, id, s, new Date());
        console.log(yes ? "yes" : "no");
        if (!yes) process.exitCode = 1;
      }),
    );

  program
    .command("channels")
    .description("the funnel per channel: reached, saw, engaged, replied, booked, paid")
    .option("--by <by>", "channel, source or trait:<key>", "channel")
    .option("--channel <channel>", "only this channel")
    .option("--days <n>", "first reached in the last n days", whole)
    .option("--group <group>", "only people in this group (id or name)")
    .option("--rule <rule>", "only people this rule matches (text, @file or -)")
    .option("--attribution <a>", "who gets a booking: any, first or last", "any")
    .option("--people <key:step>", "list the people behind one number, like sms:replied")
    .option("--json", "print JSON")
    .action(
      (a: {
        by: string;
        channel?: string;
        days?: number;
        group?: string;
        rule?: string;
        attribution: string;
        people?: string;
        json?: boolean;
      }) =>
        o.withDb(async (db) => {
          if (!(ATTRIBUTIONS as readonly string[]).includes(a.attribution))
            throw new InvalidArgumentError("attribution: any, first or last");
          const q: StatsQuery = {
            by: a.by as NonNullable<StatsQuery["by"]>,
            channel: a.channel ?? null,
            days: a.days ?? null,
            segment: a.group ? (await segmentOf(db, a.group)).id : null,
            rule: a.rule ? await ruleOf(db, a.rule) : null,
            attribution: a.attribution as Attribution,
          };
          const now = new Date();
          if (a.people) {
            const cut = a.people.lastIndexOf(":");
            const step = a.people.slice(cut + 1) as FunnelStep;
            if (cut < 1 || !FUNNEL_STEPS.includes(step))
              throw new InvalidArgumentError(`--people <key>:<${FUNNEL_STEPS.join("|")}>`);
            const people = await channelPeople(
              db,
              { ...q, key: a.people.slice(0, cut), step },
              now,
            );
            if (a.json) return console.log(JSON.stringify(people, null, 2));
            for (const p of people)
              console.log(`${p.at.slice(0, 10)}  #${p.id}  ${p.name}  ${p.email ?? ""}`);
            return;
          }
          const got = await channelStats(db, q, now);
          if (a.json) return console.log(JSON.stringify(got, null, 2));
          const cell = (n: number | null) => (n === null ? "-" : String(n)).padStart(8);
          console.log(
            `${"".padEnd(28)}${FUNNEL_STEPS.map((s) => s.padStart(8)).join("")}${"sends".padStart(8)}${"cost".padStart(9)}  rates`,
          );
          for (const r of got.rows)
            console.log(
              `${r.label.slice(0, 27).padEnd(28)}${FUNNEL_STEPS.map((s) => cell(r.people[s])).join("")}${String(r.sends).padStart(8)}${(r.costUsd === null ? "" : `$${r.costUsd.toFixed(2)}`).padStart(9)}  ${FUNNEL_STEPS.slice(
                1,
              )
                .map((s) => pct(r.rates[s]))
                .filter(Boolean)
                .join(
                  " ",
                )}${r.views ? `  views ${r.views}` : ""}${r.visits ? `  visits ${r.visits}` : ""}`,
            );
          console.log(
            `\nFirst reached ${got.from ? `since ${got.from.slice(0, 10)}` : "ever"}; bookings: ${got.attribution}. A dash: the channel can't show it.`,
          );
        }),
    );
}
