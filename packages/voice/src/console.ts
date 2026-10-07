/**
 * VoiceConsole: the Voice app's writes. A test call runs in the browser on fakes ($0, nothing
 * dialed, nothing booked); when it ends, `saveTest` keeps its transcript and timed turns, so the
 * Calls and Latency pages read tests and real calls the same way.
 */
import type * as restate from "@restatedev/restate-sdk";
import { answer, type PortalRequest, portalService, type SignedViewer } from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { atomic, type Db, setAuditActor } from "@wren/db";
import { z } from "zod";
import { STAGES } from "./call.js";
import { VOICE_CONSOLE_ROUTES } from "./console-routes.js";
import { saveCall } from "./store.js";
import { OUTCOMES } from "./types.js";

const ms = z.number().min(0).max(600_000).nullable();
const short = (n: number) => z.string().max(n);

/** A finished test call, as the portal's session hands it back. */
export const testCallSchema = z.object({
  pipeline: short(200).min(1),
  outcome: z.enum(OUTCOMES),
  transcript: z
    .array(
      z.object({
        who: z.enum(["caller", "agent", "tool"]),
        text: short(4000),
        tool: short(40).optional(),
      }),
    )
    .max(400),
  turns: z
    .array(
      z.object({
        n: z.number().int().min(0).max(1000),
        caller: short(4000),
        agent: short(4000),
        tools: z.array(short(40)).max(20),
        speculative: z.boolean(),
        barged: z.boolean(),
        ms: z.object(
          Object.fromEntries(Object.keys(STAGES).map((k) => [k, ms])) as Record<
            keyof typeof STAGES,
            typeof ms
          >,
        ),
      }),
    )
    .max(400),
  message: short(4000).nullable(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
});
export type TestCall = z.infer<typeof testCallSchema>;

export interface SaveTestRequest extends PortalRequest {
  call: TestCall;
}

export function makeVoiceConsole(deps: { db: Db }) {
  const { db } = deps;
  return portalService({
    name: "VoiceConsole",
    main: db,
    routes: VOICE_CONSOLE_ROUTES,
    unnamed: "wren",
    handlers: {
      saveTest: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, call: testCallSchema }) },
        (ctx: restate.Context, req: SaveTestRequest) =>
          answer(async () => {
            const by = (req.viewer as SignedViewer).email;
            const call = testCallSchema.parse(req.call);
            const ref = `test-${ctx.rand.uuidv4()}`;
            const id = await ctx.run("save", () =>
              atomic(db, async (tx) => {
                await setAuditActor(tx, by);
                return saveCall(
                  tx,
                  {
                    call: { id: ref, from: "", to: "", direction: "test" },
                    pipeline: call.pipeline,
                    outcome: call.outcome,
                    lead: null,
                    transcript: call.transcript.map((l) =>
                      l.tool === undefined ? { who: l.who, text: l.text } : { ...l, tool: l.tool },
                    ),
                    turns: call.turns,
                    booking: null,
                    message: call.message,
                    startedAt: new Date(call.startedAt),
                    endedAt: new Date(call.endedAt),
                  },
                  { whose: "wren", by },
                );
              }),
            );
            return { id };
          }),
      ),
    },
  });
}
