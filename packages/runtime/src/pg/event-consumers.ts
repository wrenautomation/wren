/**
 * Readers of `RT_EVENTS` (relay.ts). A durable consumer acks each event after its handler; an
 * ordered one replays from a time for a live watch. Both see an event at least once: dedupe by `seq`.
 */
import { AckPolicy, DeliverPolicy, jetstream, jetstreamManager } from "@nats-io/jetstream";
import { connect, type NatsConnection, nanos } from "@nats-io/transport-node";
import { EVENTS_STREAM, ensureEventsStream, type RunEvent } from "./relay.js";

export interface DurableOptions {
  natsUrl: string;
  /** the consumer's durable name: its place in the stream outlives restarts */
  name: string;
  /** e.g. `rt.events.*.paused` */
  filter: string;
  handle: (e: RunEvent) => Promise<void>;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

/** Runs until stopped; a failed handler gets the event again in 30 s, five tries in all. */
export function consumeEvents(o: DurableOptions): { stop(): Promise<void> } {
  let stopped = false;
  let nc: NatsConnection | null = null;
  let close: (() => void) | null = null;
  const run = async () => {
    while (!stopped) {
      try {
        nc = await connect({
          servers: o.natsUrl,
          name: `wren-${o.name}`,
          maxReconnectAttempts: -1,
        });
        const jsm = await jetstreamManager(nc);
        await ensureEventsStream(jsm);
        const config = {
          durable_name: o.name,
          filter_subject: o.filter,
          ack_policy: AckPolicy.Explicit,
          ack_wait: nanos(60_000),
          max_deliver: 5,
        };
        try {
          await jsm.consumers.info(EVENTS_STREAM, o.name);
          await jsm.consumers.update(EVENTS_STREAM, o.name, config);
        } catch (e) {
          if (!/consumer not found/i.test(String(e))) throw e;
          // a new consumer starts at now: old events were told by the sweeps before it
          await jsm.consumers.add(EVENTS_STREAM, { ...config, deliver_policy: DeliverPolicy.New });
        }
        const c = await jetstream(nc).consumers.get(EVENTS_STREAM, o.name);
        const msgs = await c.consume();
        close = () => void msgs.stop();
        for await (const m of msgs) {
          try {
            await o.handle(m.json<RunEvent>());
            m.ack();
          } catch (e) {
            o.log(`${o.name}: handler failed`, { error: String(e), seq: m.seq });
            m.nak(30_000);
          }
        }
      } catch (e) {
        if (!stopped) o.log(`${o.name}: consumer failed`, { error: String(e) });
      } finally {
        await nc?.close().catch(() => {});
        nc = null;
      }
      if (!stopped) await new Promise((r) => setTimeout(r, 10_000).unref?.());
    }
  };
  const done = run();
  return {
    async stop() {
      stopped = true;
      close?.();
      await nc?.close().catch(() => {});
      await done;
    },
  };
}

export interface WatchOptions {
  natsUrl: string;
  /** replay from this time; default now */
  since?: Date;
  /** subjects; default every event */
  filter?: string[];
  signal?: AbortSignal;
}

/** Every event from `since` on, then live, until the signal ends it. */
export async function* watchEvents(o: WatchOptions): AsyncGenerator<RunEvent> {
  const nc = await connect({ servers: o.natsUrl, name: "wren-rt-watch" });
  try {
    const c = await jetstream(nc).consumers.get(EVENTS_STREAM, {
      filter_subjects: o.filter?.length ? o.filter : [`rt.events.>`],
      deliver_policy: DeliverPolicy.StartTime,
      opt_start_time: (o.since ?? new Date()).toISOString(),
    });
    const msgs = await c.consume();
    if (o.signal?.aborted) return;
    o.signal?.addEventListener("abort", () => void msgs.stop(), { once: true });
    for await (const m of msgs) yield m.json<RunEvent>();
  } finally {
    await nc.close().catch(() => {});
  }
}
