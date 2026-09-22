/** Serve the prober on PROBE_PORT (2525). Env: PROBE_TOKEN (required), PROBE_HELO (required). */
import { SmtpVerifier } from "@wren/channel-email";
import { makeProber } from "./server.js";

const port = Number(process.env.PROBE_PORT ?? 2525);
const token = process.env.PROBE_TOKEN ?? "";
const helo = process.env.PROBE_HELO ?? "";
if (!token || !helo) {
  console.error("PROBE_TOKEN and PROBE_HELO are required");
  process.exit(2);
}

const verifier = new SmtpVerifier({
  helo,
  perHostGapMs: Number(process.env.PROBE_HOST_GAP_MS ?? 1500),
});
const server = makeProber({
  verifier,
  token,
  log: (line) => console.log(new Date().toISOString(), line),
});
server.listen(port, () => console.log(`prober listening on :${port} as ${helo}`));
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.once(sig, () => server.close(() => process.exit(0)));
