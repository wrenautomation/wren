/**
 * The stage-1 port: what the funnel needs to know about an address before anything
 * dials a mail server. The implementation lives in `mailifier` and is handed in at
 * `mailifier.ts`; nothing else in wren names the vendor.
 *
 * Declared here rather than imported so the shape is ours: if the library's own
 * LocalCheck ever drifts from this, the adapter stops compiling, which is exactly
 * when we want to hear about it.
 */

/** Which DNS record supplied deliverability. */
export type MxPath = "mx" | "a" | "aaaa";
/** Advisory, never a failure: the campaign decides what a role account or freemail means. */
export type LocalFlag = "role_account" | "freemail" | "mx_fallback" | "mx_unresolved";

export interface LocalCheck {
  email: string;
  /** null = passed stage 1. Otherwise the reason, and no probe is worth spending. */
  failure: string | null;
  flags: readonly LocalFlag[];
  /** Resolved MX hosts (lowercased, priority-stripped); empty whenever no real MX was found. */
  mxHosts: readonly string[];
  mxPath: MxPath | null;
  passed: boolean;
}

export interface LocalCheckerLike {
  check(email: string): Promise<LocalCheck>;
}
