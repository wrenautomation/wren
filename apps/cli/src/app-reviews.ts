/**
 * `wren app-reviews`: the platform reviews Wren's social apps wait on (designs/2026-10-09-app-reviews.md).
 * A packet per review (fields, permission text, screencast, open items) with live checks of the
 * pages, callbacks, keys and icon it points at. Filing stays a person's act on the platform.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSsmEnv } from "@wren/config/ssm";
import {
  type Check,
  type CheckDeps,
  checkReview,
  ICON,
  packetOf,
  REVIEWS,
  reviewOf,
} from "@wren/content/connect/app-reviews";
import type { Command } from "commander";

const PROD_PARAMS = "/wren/prod/env,/wren/prod/env-2";

export function registerAppReviews(program: Command, rootDir: string): void {
  let names: Promise<Set<string> | null> | null = null;
  // Prod's key names from SSM; the values stay in this object and are never printed. Null when
  // AWS isn't reachable from here.
  const prodNames = () => {
    names ??= (async () => {
      const held: NodeJS.ProcessEnv = {};
      try {
        await loadSsmEnv(PROD_PARAMS, { env: held, log: () => {} });
        return new Set(Object.keys(held));
      } catch {
        return null;
      }
    })();
    return names;
  };
  const deps = async (): Promise<CheckDeps> => {
    const prod = await prodNames();
    return {
      fetch: (url) => fetch(url, { headers: { "user-agent": "wren-reviews/1" } }),
      hasKey: (name) => (prod ? prod.has(name) : null),
      icon: () => readFile(join(rootDir, ICON)).catch(() => null),
    };
  };
  const mark = (checks: readonly Check[]) => {
    const todo = checks.filter((c) => !c.ok).length;
    return todo ? `${todo} ${todo === 1 ? "check" : "checks"} to do` : "checks pass";
  };

  const reviews = program
    .command("app-reviews")
    .description("Platform reviews for Wren's social apps: state, packets, live checks");
  reviews
    .command("list", { isDefault: true })
    .description("Each review: filed or not, what it waits on, its checks")
    .action(async () => {
      const d = await deps();
      const wide = Math.max(...REVIEWS.map((r) => r.name.length));
      for (const r of REVIEWS) {
        const checks = await checkReview(r, d);
        const open = r.open.length ? `, ${r.open.length} open` : "";
        const state = r.filed
          ? `filed ${r.filed}`
          : `${checks.length ? mark(checks) : "no checks"}${open}`;
        const after = r.after.length ? `  after ${r.after.join(", ")}` : "";
        console.log(`${r.id.padEnd(20)} ${r.name.padEnd(wide)} ${state}${after}`);
      }
    });
  reviews
    .command("packet <id>")
    .description("A review's packet as Markdown, with its checks run now")
    .option("--out <file>", "write it here instead of printing it")
    .option("--no-check", "skip the live checks")
    .action(async (id: string, o: { out?: string; check: boolean }) => {
      const r = reviewOf(id);
      if (!r) throw new Error(`no review ${id}: ${REVIEWS.map((x) => x.id).join(", ")}`);
      const text = packetOf(r, o.check ? await checkReview(r, await deps()) : null);
      if (!o.out) {
        process.stdout.write(text);
        return;
      }
      await writeFile(o.out, text);
      console.log(`wrote ${o.out}`);
    });
  reviews
    .command("check [id]")
    .description("Only the checks: pages, callbacks, prod keys, icon; exits 1 while any is to do")
    .action(async (id: string | undefined) => {
      const one = id ? reviewOf(id) : null;
      if (id && !one) throw new Error(`no review ${id}: ${REVIEWS.map((x) => x.id).join(", ")}`);
      const d = await deps();
      let todo = 0;
      for (const r of one ? [one] : REVIEWS) {
        const checks = await checkReview(r, d);
        if (!checks.length) continue;
        console.log(`${r.id}: ${mark(checks)}`);
        for (const c of checks) {
          if (!c.ok) todo++;
          console.log(`  ${c.ok ? "ok  " : "TODO"} ${c.need}: ${c.detail}`);
        }
      }
      if (todo) process.exitCode = 1;
    });
}
