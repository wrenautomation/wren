/**
 * What a step needs from whoever runs it: journaled side effects and a
 * durable clock. The Domain object gives a Restate-backed one; tests a
 * plain one. Steps never see a Restate context.
 *
 * Gates are answers, not parked invocations: a step whose gate has no
 * answer throws `GateOpen`, the driver records the open gate and returns,
 * and the person's answer arrives as a new invocation that resumes.
 */
export interface Host {
  /** Run once and journal the result; a replay returns the journaled value. */
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** Durable pause. */
  sleep(ms: number): Promise<void>;
  now(): Promise<Date>;
}

export type Gate = "purchase" | "password" | "human";

export interface GateAnswer {
  approved: boolean;
  note: string | null;
  at: string;
}

export class GateOpen extends Error {
  constructor(
    readonly gate: Gate,
    readonly prompt: string,
  ) {
    super(`gate ${gate} is open`);
    this.name = "GateOpen";
  }
}

/** A browser leg (or an API check after one) that a person has to finish. Retrying will not help. */
export class NeedsHuman extends Error {
  constructor(
    message: string,
    readonly artifacts: Record<string, string> = {},
  ) {
    super(message);
    this.name = "NeedsHuman";
  }
}

/** A plain host: effects run once, sleeps are skipped or shortened. For tests and dry runs. */
export function directHost(opts: { sleepScale?: number; now?: () => Date } = {}): Host {
  const scale = opts.sleepScale ?? 0;
  return {
    run: (_name, fn) => fn(),
    sleep: (ms) => (scale > 0 ? new Promise((r) => setTimeout(r, ms * scale)) : Promise.resolve()),
    now: async () => (opts.now ?? (() => new Date()))(),
  };
}
