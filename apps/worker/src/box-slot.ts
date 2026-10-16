/**
 * The box worker's two slots. Each deploy starts the new build beside the old one, on the other
 * port (`deploy/scripts/box-worker.sh`), so the new build is a new Restate deployment and takes
 * every new call. A call already pinned to the old deployment finishes on the code it began on.
 *
 * One URL for every build made each deploy a change in place: a call that was suspended across
 * the deploy replayed on the new code. On 2026-10-16 `SocialWatch/wren/loop` began on one build,
 * waited 30 min on a `Content/comments` read, and resumed on the next. The new build waits on
 * `SocialPushed/take` with a timer, which the journal did not have: journal mismatch (570) on
 * every retry, then a pause, holding the key's lock.
 *
 * The old build serves its pinned calls until the deploy after next replaces it. It stops its
 * wakes once it is not the current deployment, so a row wakes its loop once.
 */

/** The two loopback ports a box build listens on; a deploy takes the one the live build does not. */
export const BOX_PORTS = [9080, 9081] as const;

/** This build's port, from `WREN_BOX_PORT` (the first slot when unset, as before slots). */
export function boxPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.WREN_BOX_PORT;
  if (raw === undefined || raw === "") return BOX_PORTS[0];
  const port = Number(raw);
  if (!(BOX_PORTS as readonly number[]).includes(port))
    throw new Error(`WREN_BOX_PORT must be one of ${BOX_PORTS.join(", ")}, not ${raw}`);
  return port;
}

/** The deployment URL Restate calls this build at. */
export const boxUrl = (port: number) => `http://127.0.0.1:${port}/`;

/** One admin SQL query (`POST /query`): its rows. */
export type AdminQuery = (sql: string) => Promise<Record<string, unknown>[]>;

const ID = /^[\w-]+$/;

function sqlId(v: string): string {
  if (!ID.test(v)) throw new Error(`not an id: ${v}`);
  return `'${v}'`;
}

/** Still the deployment that serves `service`: no later build registered it. */
export async function isCurrent(
  query: AdminQuery,
  deployment: string,
  service: string,
): Promise<boolean> {
  const rows = await query(`SELECT deployment_id FROM sys_service WHERE name = ${sqlId(service)}`);
  return rows[0]?.deployment_id === deployment;
}

/** Calls not yet completed that are pinned to `deployment`: they finish on its code. */
export async function pinnedTo(query: AdminQuery, deployment: string): Promise<number> {
  const rows = await query(
    `SELECT count(*) AS n FROM sys_invocation WHERE pinned_deployment_id = ${sqlId(deployment)} AND status <> 'completed'`,
  );
  return Number(rows[0]?.n ?? 0);
}

export interface SupersededOptions {
  query: AdminQuery;
  /** This build's deployment id. */
  deployment: string;
  /** A service this build serves: whoever serves it is the current build. */
  service: string;
  everyMs: number;
  /** Once, when a later build took over: the calls still pinned here. */
  onSuperseded(pinned: number): void | Promise<void>;
  /** A check that failed: the build stays current until a check says otherwise. */
  onError?(err: unknown): void;
}

/** Look every `everyMs` whether a later build took over; call `onSuperseded` once, then stop. */
export function watchSuperseded(o: SupersededOptions): { check(): Promise<boolean>; stop(): void } {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = async (): Promise<boolean> => {
    if (done) return true;
    try {
      if (await isCurrent(o.query, o.deployment, o.service)) return false;
      done = true;
      await o.onSuperseded(await pinnedTo(o.query, o.deployment).catch(() => -1));
      return true;
    } catch (err) {
      o.onError?.(err);
      return false;
    }
  };
  const tick = () => {
    timer = setTimeout(async () => {
      if (!(await check())) tick();
    }, o.everyMs);
    timer.unref?.();
  };
  tick();
  return {
    check,
    stop() {
      done = true;
      if (timer) clearTimeout(timer);
    },
  };
}
