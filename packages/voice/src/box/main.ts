/**
 * The voice box service's entry (deploy/voice/wren-voice.service). Not installed or started
 * anywhere: setup does that, with the vendors' keys, once William says yes.
 *
 * Env, from SSM like the box worker (WREN_SSM_ENV_PARAM, then WREN_SSM_VOICE_PARAM):
 * WREN_DATABASE_URL, WREN_VOICE_PORT (8790), WREN_VOICE_TOKEN (the stream URL's token),
 * TELNYX_API_KEY. With no token or no vendors it serves /health as not ready and refuses calls.
 */
import { CALENDAR } from "@wren/calendar";
import { loadSsmEnv } from "@wren/config/ssm";
import { settingsFor } from "@wren/core/clients";
import { createDb } from "@wren/db";
import { agentOf, VOICE_AGENT } from "../agent.js";
import { calendarIn, leadsIn, messagesOnCall } from "../ports.js";
import { saveCall } from "../store.js";
import { TelnyxHttp } from "../transports/telnyx.js";
import { startVoiceServer } from "./server.js";

await loadSsmEnv(process.env.WREN_SSM_ENV_PARAM);
await loadSsmEnv(process.env.WREN_SSM_VOICE_PARAM);
const env = (name: string) => process.env[name]?.trim() || null;
const raw = env("WREN_DATABASE_URL");
if (!raw) throw new Error("WREN_DATABASE_URL is required");
// Same database, this machine's door, as the box worker does.
const url = new URL(raw);
url.hostname = "127.0.0.1";
const { db } = createDb(url.toString(), { max: 4, app: "wren-voice", actor: "voice" });
const block = async (id: string) => (await settingsFor(db, null))[id] ?? {};

const server = await startVoiceServer({
  port: Number(env("WREN_VOICE_PORT") ?? 8790),
  token: env("WREN_VOICE_TOKEN"),
  control: new TelnyxHttp(env("TELNYX_API_KEY") ?? ""),
  // Setup: the ears and mouth picked by measured latency, and the brain on @wren/llm.
  pipeline: () => null,
  agent: async () => agentOf(await block(VOICE_AGENT)),
  ports: {
    leads: leadsIn(db),
    calendar: calendarIn(db, {
      calendar: "wren",
      settings: () => block(CALENDAR),
      // Fails closed until setup wires Google's free/busy: no slot offered blind.
      busy: async () => {
        throw new Error("busy times aren't wired on the voice box yet");
      },
    }),
    messages: messagesOnCall,
  },
  save: async (r) => {
    await saveCall(db, r, { whose: "wren", by: null });
  },
  log: (line) => console.log(line),
});
console.log(`voice: listening on ${JSON.stringify(server.address())}`);
