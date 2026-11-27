/**
 * `wren jobs …`: list, pause and resume every job from one place (designs/2026-11-27-central-queue.md).
 * Each kind of job is paused at its own layer:
 * - a loop (`ReachInboxRead/daily`, or `ReachInboxRead` = every key): a `job_pauses` row its pass
 *   reads first; the chain lives, resume wakes it
 * - part of a loop (`--unit "replies acct"`, `--unit "replies *"`): a person's `unit_holds` row
 * - a launchd job on this Mac (`launchd:<label>`): `launchctl disable` (internships: `toggle.sh`)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ingressOf, type Settings } from "@wren/config";
import { personHold, releaseSubjects } from "@wren/core/checks";
import { runtimeAdmin } from "@wren/core/console";
import {
  durationMs,
  type JobPauseRow,
  openPauses,
  pauseJob,
  resumeJob,
} from "@wren/core/job-pauses";
import { type LoopHealth, loopHealth } from "@wren/core/loop-watch";
import { limitStage } from "@wren/core/restate";
import type { Db } from "@wren/db";
import * as clients from "@wren/runtime/clients";
import type { Command } from "commander";
import { sql } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const BY = "cli";
const AGENTS = join(homedir(), "Library/LaunchAgents");
/** Our launchd jobs; long-lived servers stay out (design: Non-goals). */
const LAUNCHD_PREFIXES = ["dev.williamjin.", "com.wrenautomation."];
const INTERNSHIPS = "dev.williamjin.internships-";
const TOGGLE = join(homedir(), "Documents/personal_portfolio/scripts/internships/toggle.sh");
/** internships labels → their `toggle.sh` group (it pauses the whole group). */
const internshipsGroup = (label: string) => {
  const rest = label.slice(INTERNSHIPS.length);
  if (rest.startsWith("apply")) return "apply";
  if (rest === "mail") return "mail";
  return "poll"; // poll, prepare, draft
};

const when = (at: string | null) => (at ? at.slice(0, 16).replace("T", " ") : "-");
const untilText = (u: string) => (u === "infinity" ? "until resumed" : `until ${when(u)}`);

/** A loop's units are `<kind> <subject>`; `<kind> *` covers every subject. */
const UNIT = /^[a-z][a-z-]* \S.*$/;

function launchdLabels(): string[] {
  if (process.platform !== "darwin" || !existsSync(AGENTS)) return [];
  return readdirSync(AGENTS)
    .filter((f) => f.endsWith(".plist") && LAUNCHD_PREFIXES.some((p) => f.startsWith(p)))
    .map((f) => f.slice(0, -".plist".length))
    .sort();
}

function launchctl(...args: string[]): string {
  try {
    return execFileSync("launchctl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    return String((err as { stdout?: string }).stdout ?? "");
  }
}

function launchdState(): Map<string, "loaded" | "disabled" | "off"> {
  const uid = String(process.getuid?.() ?? 501);
  const disabled = new Set(
    [...launchctl("print-disabled", `gui/${uid}`).matchAll(/"([^"]+)" => (?:disabled|true)/g)].map(
      (m) => m[1] as string,
    ),
  );
  const loaded = new Set(
    launchctl("list")
      .split("\n")
      .map((l) => l.split("\t")[2])
      .filter(Boolean),
  );
  return new Map(
    launchdLabels().map((l) => [
      l,
      disabled.has(l) ? "disabled" : loaded.has(l) ? "loaded" : "off",
    ]),
  );
}

/** Pause or resume one launchd job on this Mac. */
function launchdSet(label: string, on: boolean): string {
  if (process.platform !== "darwin") throw new Error("launchd jobs pause only on the Mac");
  if (!existsSync(join(AGENTS, `${label}.plist`))) throw new Error(`no launchd job ${label}`);
  if (label.startsWith(INTERNSHIPS) && existsSync(TOGGLE)) {
    const group = internshipsGroup(label);
    execFileSync(TOGGLE, [group, on ? "on" : "off"], { stdio: "inherit" });
    return `internships group "${group}" ${on ? "on" : "off"} (toggle.sh pauses the whole group)`;
  }
  const uid = String(process.getuid?.() ?? 501);
  const target = `gui/${uid}/${label}`;
  if (on) {
    execFileSync("launchctl", ["enable", target]);
    launchctl("bootstrap", `gui/${uid}`, join(AGENTS, `${label}.plist`));
  } else {
    execFileSync("launchctl", ["disable", target]);
    launchctl("bootout", target);
  }
  return `${label} ${on ? "enabled" : "disabled"}`;
}

/** `launchd:<label>`, or a bare label we have a plist for. */
function launchdOf(job: string): string | null {
  if (job.startsWith("launchd:")) return job.slice("launchd:".length);
  return launchdLabels().includes(job) ? job : null;
}

/** The running loop keys a loop job names (`Service/key` or `Service`). */
function loopKeys(job: string, loops: LoopHealth[]): LoopHealth[] {
  return loops.filter((l) => l.id === job || l.service === job);
}

export function registerJobs(program: Command, withMainDb: WithDb, settings: Settings) {
  const loopsNow = () => withMainDb((db) => loopHealth(runtimeAdmin(db).query, new Date()));
  const wake = (l: LoopHealth) =>
    clients
      .connect(ingressOf(settings))
      .objectClient<{ wake: () => Promise<boolean> }>({ name: l.service }, l.key)
      .wake();

  const cmd = program
    .command("jobs")
    .description("every job in one list: loops, held parts, launchd jobs; pause and resume them")
    .option("--all", "stopped loops too")
    .option("--json", "rows as JSON")
    .action(async (o: { all?: boolean; json?: boolean }) => {
      const [loops, pauses, unitHolds] = await Promise.all([
        loopsNow(),
        withMainDb(openPauses),
        withMainDb((db) =>
          db.execute<{
            id: number;
            stage: string;
            subject: string;
            reason: string;
            held_by: string | null;
          }>(sql`select id, stage, subject, reason, held_by from unit_holds
                 where stage like 'loop.%' and released_at is null order by held_at`),
        ),
      ]);
      const launchd = launchdState();
      const heldOf = (id: string, service: string) =>
        pauses.find((p) => p.job === id || p.job === service);
      const rows = {
        loops: loops
          .filter((l) => o.all || l.health !== "stopped")
          .map((l) => ({ ...l, held: heldOf(l.id, l.service) ?? null })),
        units: unitHolds,
        launchd: [...launchd].map(([label, state]) => ({
          label,
          state,
          held: pauses.find((p) => p.job === `launchd:${label}`) ?? null,
        })),
        pauses,
      };
      if (o.json) return console.log(JSON.stringify(rows, null, 2));
      const heldLine = (p: JobPauseRow) => `held by ${p.held_by} ${untilText(p.until)}: ${p.why}`;
      console.log("Loops");
      for (const l of rows.loops)
        console.log(
          `  ${(l.held ? "held" : l.health).padEnd(7)} ${l.id}  next ${when(l.nextAt)}  ${l.held ? heldLine(l.held) : l.why}`,
        );
      if (rows.units.length) {
        console.log("Held parts of loops");
        for (const u of rows.units)
          console.log(
            `  ${String(u.id).padEnd(5)} ${u.stage}  ${u.subject}  ${u.held_by ? `by ${u.held_by}` : "by timeouts"}: ${u.reason}`,
          );
      }
      if (rows.launchd.length) {
        console.log("launchd (this Mac)");
        for (const j of rows.launchd)
          console.log(
            `  ${(j.held ? "held" : j.state).padEnd(8)} ${j.label}${j.held ? `  ${heldLine(j.held)}` : ""}`,
          );
      }
    });

  cmd
    .command("pause <job>")
    .description(
      "Hold a job: a loop (Service/key or Service), its parts (--unit), or launchd:<label>. Running work finishes",
    )
    .requiredOption("--why <text>", "why, in words")
    .option(
      "--unit <units...>",
      'parts of one loop key: "replies acct-1", or "replies *" for every account',
    )
    .option("--for <time>", "ends on its own: 30m, 2h, 1d")
    .option("--new-kind", "allow a unit kind this loop never reported")
    .action(
      async (job: string, o: { why: string; unit?: string[]; for?: string; newKind?: boolean }) => {
        const forMs = o.for ? durationMs(o.for) : undefined;
        const label = launchdOf(job);
        if (label) {
          if (o.unit) throw new Error("--unit is for loops");
          if (forMs) throw new Error("--for is for loops; resume a launchd job by hand");
          console.log(launchdSet(label, false));
          await withMainDb((db) => pauseJob(db, { job: `launchd:${label}`, why: o.why, by: BY }));
          return;
        }
        const loops = loopKeys(job, await loopsNow());
        if (!loops.length)
          throw new Error(`no loop or launchd job named ${job} (see: wren jobs --all)`);
        if (o.unit) {
          if (forMs)
            throw new Error("--for is not for units yet; resume them with wren jobs resume");
          const [l, ...more] = loops;
          if (!l || more.length || l.id !== job)
            throw new Error("--unit needs one loop key: Service/key");
          const stage = limitStage(l.service, l.key);
          const bad = o.unit.filter((u) => !UNIT.test(u));
          if (bad.length)
            throw new Error(`units are "<kind> <subject>" or "<kind> *": ${bad.join(", ")}`);
          if (!o.newKind) {
            const seen = new Set(
              (
                await withMainDb((db) =>
                  db.execute<{ kind: string }>(
                    sql`select distinct split_part(subject, ' ', 1) kind from unit_holds where stage = ${stage}`,
                  ),
                )
              ).map((r) => r.kind),
            );
            for (const t of l.timeouts) if (t.unit) seen.add(t.unit.split(" ")[0] as string);
            const unknown = o.unit.filter((u) => !seen.has(u.split(" ")[0] as string));
            if (unknown.length)
              throw new Error(
                `${l.id} never reported a unit of kind ${unknown.map((u) => `"${u.split(" ")[0]}"`).join(", ")} (seen: ${[...seen].join(", ") || "none"}). A wrong kind holds nothing; check the loop's code, then add --new-kind`,
              );
          }
          const ids = await withMainDb(async (db) => {
            const out: number[] = [];
            for (const subject of o.unit ?? [])
              out.push((await personHold(db, { stage, subject, why: o.why, by: BY })).id);
            return out;
          });
          console.log(
            `held ${o.unit.join(", ")} on ${l.id} (holds ${ids.join(", ")}); the rest of each pass runs`,
          );
          return;
        }
        const row = await withMainDb((db) => pauseJob(db, { job, why: o.why, by: BY, forMs }));
        console.log(
          `held ${job} ${untilText(row.until)}: ${loops.length} key(s) skip their next pass; a pass in flight finishes`,
        );
      },
    );

  cmd
    .command("resume <job>")
    .description("End a hold: the loop passes now; --unit ends only those parts")
    .option("--unit <units...>", "parts to let go")
    .action(async (job: string, o: { unit?: string[] }) => {
      const label = launchdOf(job);
      if (label) {
        console.log(launchdSet(label, true));
        await withMainDb((db) => resumeJob(db, `launchd:${label}`, BY));
        return;
      }
      const loops = loopKeys(job, await loopsNow());
      if (!loops.length) throw new Error(`no loop or launchd job named ${job}`);
      if (o.unit) {
        const [l, ...more] = loops;
        if (!l || more.length || l.id !== job)
          throw new Error("--unit needs one loop key: Service/key");
        const done = await withMainDb((db) =>
          releaseSubjects(db, limitStage(l.service, l.key), o.unit ?? [], BY),
        );
        console.log(`released ${done.map((r) => r.subject).join(", ") || "nothing (none held)"}`);
        return;
      }
      const done = await withMainDb((db) => resumeJob(db, job, BY));
      if (!done.length) console.log(`${job} had no hold of its own`);
      for (const l of loops.filter((x) => x.health !== "stopped")) await wake(l);
      console.log(`resumed ${job}; ${loops.length} key(s) woken`);
    });
}
