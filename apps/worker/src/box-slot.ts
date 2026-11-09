/**
 * The box worker's two slots. Each deploy starts the new build beside the old one, on the other
 * port (`deploy/scripts/box-worker.sh`). The build that started last takes every new row
 * (`rt.box_builds`); a row already pinned to the old build finishes on the code it began on.
 *
 * One build for every row made each deploy a change in place: a call suspended across the deploy
 * replayed on new code. On 2026-10-16 `SocialActivityRead/wren/loop` began on one build, waited
 * 30 min on a read, and resumed on the next, whose journal did not match: a pause on every retry.
 *
 * The old build serves its pinned rows until the deploy after next replaces it. It stops its wakes
 * once a newer build started, so a row wakes its loop once (`rt.ts`, `standDown`).
 */

/** The two loopback ports a box build listens on; a deploy takes the one the live build does not. */
const BOX_PORTS = [9080, 9081] as const;

/** This build's port, from `WREN_BOX_PORT` (the first slot when unset). Its door is port + 10. */
export function boxPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.WREN_BOX_PORT;
  if (raw === undefined || raw === "") return BOX_PORTS[0];
  const port = Number(raw);
  if (!(BOX_PORTS as readonly number[]).includes(port))
    throw new Error(`WREN_BOX_PORT must be one of ${BOX_PORTS.join(", ")}, not ${raw}`);
  return port;
}
