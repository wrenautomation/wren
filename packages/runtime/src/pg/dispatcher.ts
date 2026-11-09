/**
 * One loop: claim due invocations and hand each turn to `run` (in process here; Lambda in phase 3).
 * Woken by NOTIFY rt_wake, else sleeps until the next run_at or lease end, at most `pollMs`.
 */
import type postgres from "postgres";
import { deferred } from "./promise.js";
import { type Claim, claim, type Lane, nextDue } from "./store.js";

export interface DispatcherOptions {
  sql: postgres.Sql;
  run: (c: Claim) => Promise<unknown>;
  /** Which rows this loop takes; default all. */
  lane?: Lane;
  concurrency?: number;
  /**
   * Set: rows a caller waits on are claimed first, and the rest take at most this many of
   * `concurrency` (design doc "Group 4"). Unset: one claim, by run_at.
   */
  background?: number;
  leaseMs?: number;
  pollMs?: number;
  log?: (msg: string, err?: unknown) => void;
  /** Time of each claim that took rows, for the worker's timing log. */
  time?: (phase: "claim", ms: number) => void;
}

export class Dispatcher {
  private active = 0;
  private activeBackground = 0;
  private kicked = false;
  private stopped = false;
  private wakeUp: (() => void) | undefined;
  private listener: { unlisten(): Promise<void> } | undefined;
  private looping: Promise<void> | undefined;
  private idle = deferred<void>();

  constructor(private o: DispatcherOptions) {}

  /** Change which rows this loop takes (a superseded box slot stops taking new ones). */
  setLane(lane: Lane) {
    this.o = { ...this.o, lane };
    this.kick();
  }

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
      const bg = this.o.background;
      let got = 0;
      if (free > 0) {
        try {
          const t0 = performance.now();
          const lane = this.o.lane ?? {};
          const claims =
            bg === undefined
              ? await claim(this.o.sql, free, leaseMs, Date.now(), lane)
              : await claim(this.o.sql, free, leaseMs, Date.now(), { ...lane, callerWaits: true });
          const waited = claims.length;
          const room = bg === undefined ? 0 : Math.min(free - waited, bg - this.activeBackground);
          if (room > 0)
            claims.push(
              ...(await claim(this.o.sql, room, leaseMs, Date.now(), {
                ...lane,
                callerWaits: false,
              })),
            );
          got = claims.length;
          if (got) this.o.time?.("claim", performance.now() - t0);
          for (const [i, c] of claims.entries()) {
            const isBackground = bg !== undefined && i >= waited;
            this.active++;
            if (isBackground) this.activeBackground++;
            this.o
              .run(c)
              .catch((e: unknown) => log(`turn ${c.id} threw`, e))
              .finally(() => {
                this.active--;
                if (isBackground) this.activeBackground--;
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
        // background full: only waited rows can start, so only they set the wake time
        const full = bg !== undefined && this.activeBackground >= bg;
        const due = await nextDue(
          this.o.sql,
          full ? { ...this.o.lane, callerWaits: true } : this.o.lane,
        );
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
