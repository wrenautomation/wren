/**
 * The crawler's way up the fetch ladder (designs/2026-10-18-fetch-ladder.md). wren's own
 * polite fetch is rung 1 (`plain`). On a block, the URL goes to autobrowse's `web GET /fetch`,
 * which climbs `impersonate`, `render` and `exit` on the Mac. This class decides where to
 * start (the memory) and what to record; autobrowse holds the capability.
 */
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { FetchError, type Fetcher, type FetchResponse, type FetchStep } from "./fetcher.js";
import { looksLikeJsShell, readPage } from "./htmltext.js";
import { domainOf, type LadderTier, type TierMemory } from "./tier-memory.js";

/** `fetch_tier` of a page wren's own plain fetch got. */
export const HTTP_TIER = "httpx";

/** A plain answer with one of these statuses is a block. 404 and the rest are answers. */
const BLOCK_STATUSES: ReadonlySet<number> = new Set([403, 429, 503]);

/** What autobrowse's `web GET /fetch` answers (`Fetched`): the fields this side reads. */
interface Fetched {
  finalUrl: string;
  status: number | null;
  html: string;
  tier: LadderTier;
  /** null: a usable page; else the signal the last rung still hit. */
  block: string | null;
  tries: FetchStep[];
}

/** The plain rung's try: a page, or the error that ended it. */
interface PlainTry {
  resp: FetchResponse | null;
  error: FetchError | null;
  step: FetchStep;
}

const isRobots = (url: string): boolean => {
  try {
    return new URL(url).pathname === "/robots.txt";
  } catch {
    return false;
  }
};

export class LadderFetcher implements Fetcher {
  constructor(
    private readonly inner: Fetcher,
    private readonly sites: SiteClient,
    private readonly memory: TierMemory,
  ) {}

  get userAgent(): string {
    return this.inner.userAgent;
  }

  async get(url: string): Promise<FetchResponse> {
    // robots.txt is read plain: the crawler checks it before it asks for a page, at any rung.
    if (isRobots(url)) return this.inner.get(url);
    const domain = domainOf(url);
    const start = domain ? await this.memory.startFor(domain) : null;
    const steps: FetchStep[] = [];

    let plain: PlainTry | null = null;
    let from: LadderTier;
    if (start) {
      from = start;
    } else {
      plain = await this.tryPlain(url);
      steps.push(plain.step);
      if (!plain.step.block) {
        if (plain.resp && domain) await this.memory.learn(domain, "plain", null);
        return settled(plain, steps);
      }
      from = plain.step.block === "shell" ? "render" : "impersonate";
    }

    const up = await this.climb(url, from);
    let stopped: string;
    if ("block" in up) {
      steps.push({ tier: from, status: null, block: up.block });
      stopped = up.block;
    } else {
      steps.push(...up.fetched.tries.map(({ tier, status, block }) => ({ tier, status, block })));
      if (!up.fetched.block) {
        const { fetched } = up;
        const block = steps.slice(0, -1).findLast((s) => s.block)?.block ?? null;
        if (domain) await this.memory.learn(domain, fetched.tier, block);
        return {
          status: fetched.status ?? 200,
          url: fetched.finalUrl,
          text: fetched.html,
          tier: fetched.tier,
          block,
          steps,
        };
      }
      stopped = up.fetched.block;
    }

    // The ladder gave no page: a remembered start falls back to plain, and a plain answer
    // that was blocked stays the answer, now carrying the block and every step.
    if (!plain) {
      plain = await this.tryPlain(url);
      steps.push(plain.step);
      if (!plain.step.block) return settled(plain, steps);
    }
    return settled(plain, steps, stopped);
  }

  /** `web GET /fetch`. A cap (429) or any other failure is a block, never a throw. */
  private async climb(
    url: string,
    from: LadderTier,
  ): Promise<{ fetched: Fetched } | { block: "cap" | "offline" }> {
    try {
      const fetched = await this.sites.call<Fetched>("web", "GET", "/fetch", { url, from });
      return { fetched };
    } catch (err) {
      return { block: err instanceof SiteCallError && err.status === 429 ? "cap" : "offline" };
    }
  }

  private async tryPlain(url: string): Promise<PlainTry> {
    let resp: FetchResponse;
    try {
      resp = await this.inner.get(url);
    } catch (err) {
      if (!(err instanceof FetchError)) throw err;
      const block =
        err.status !== null && BLOCK_STATUSES.has(err.status) ? `status-${err.status}` : null;
      return { resp: null, error: err, step: { tier: "plain", status: err.status, block } };
    }
    return {
      resp,
      error: null,
      step: { tier: "plain", status: resp.status, block: plainBlock(resp) },
    };
  }
}

/** A block on the plain rung: a refusing status, or a page that is a JS shell. Else null. */
function plainBlock(resp: FetchResponse): string | null {
  if (BLOCK_STATUSES.has(resp.status)) return `status-${resp.status}`;
  if (resp.status < 400 && looksLikeJsShell(resp.text, readPage(resp.text, resp.url).text))
    return "shell";
  return null;
}

/** The plain answer as the fetch's answer: the page or the error, with the trail. `block` set only when blocked. */
function settled(plain: PlainTry, steps: FetchStep[], block?: string): FetchResponse {
  const trail = { tier: HTTP_TIER, steps, ...(block ? { block } : {}) };
  if (plain.resp) return { ...plain.resp, ...trail };
  const err = plain.error as FetchError;
  throw new FetchError(err.message, err.status, trail);
}
