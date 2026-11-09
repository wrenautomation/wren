/**
 * One loop: claim due invocations and hand each turn to `run` (in process here; Lambda in phase 3).
 * Woken by NOTIFY rt_wake, else sleeps until the next run_at or lease end, at most `pollMs`.
 */
import type postgres from "postgres";
import { deferred } from "./promise.js";
import { type Claim, claim, nextDue } from "./store.js";

export interface DispatcherOptions {
  sql: postgres.Sql;
  run: (c: Claim) => Promise<unknown>;
  concurrency?: number;
  leaseMs?: number;
  pollMs?: number;
  log?: (msg: string, err?: unknown) => void;
}

export class Dispatcher {
  private active = 0;
  private kicked = false;
  private stopped = false;
  private wakeUp: (() => void) | undefined;
  private listener: { unlisten(): Promise<void> } | undefined;
  private looping: Promise<void> | undefined;
  private idle = deferred<void>();

  constructor(private o: DispatcherOptions) {}

  async start() {
    this.listener = await this.o.sql.listen("rt_wake", () => this.kick());
    this.looping = this.loop();
  }

  kick() {
    this.kicked = true;
    this.wakeUp?.();
  }

  async stop() {
    this.stopped = true;
    this.kick();
    await this.listener?.unlisten();
    await this.looping;
    if (this.active > 0) await this.idle.promise;
  }

  private async loop() {
    const conc = this.o.concurrency ?? 8;
    const leaseMs = this.o.leaseMs ?? 60_000;
    const pollMs = this.o.pollMs ?? 1000;
    const log = this.o.log ?? ((m, e) => console.error(`rt dispatcher: ${m}`, e ?? ""));
    while (!this.stopped) {
      this.kicked = false;
      const free = conc - this.active;
      let got = 0;
      if (free > 0) {
        try {
          const claims = await claim(this.o.sql, free, leaseMs, Date.now());
          got = claims.length;
          for (const c of claims) {
            this.active++;
            this.o
              .run(c)
              .catch((e: unknown) => log(`turn ${c.id} threw`, e))
              .finally(() => {
                this.active--;
                if (this.active === 0 && this.stopped) this.idle.resolve();
                this.kick();
              });
          }
        } catch (e) {
          log("claim failed", e);
        }
      }
      if (this.stopped) break;
      if (got > 0 && got === free) continue;
      if (this.kicked) continue;
      let wait = pollMs;
      try {
        const due = await nextDue(this.o.sql);
        if (due) wait = Math.max(0, Math.min(pollMs, due.getTime() - Date.now()));
      } catch {}
      if (this.kicked || this.stopped) continue;
      await new Promise<void>((r) => {
        const t = setTimeout(r, wait);
        this.wakeUp = () => {
          clearTimeout(t);
          r();
        };
      });
      this.wakeUp = undefined;
    }
  }
}
