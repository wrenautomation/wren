/**
 * What a loop reads of a metro campaign (designs/2026-11-02-campaigns.md, phase 3). The shape owns
 * campaigns (`@wren/pipeline`, a higher layer), so the composition root passes the live ones in.
 */

/** A live campaign, inherited fields filled in. The default campaign is never one: it is the rest. */
export interface LoopCampaign {
  /** The group id: stamped on every act it runs. */
  id: string;
  /** A registry offer id. */
  offer?: string;
  /** A segment id (a group's number, as text), or out lines. */
  audience?: { segment?: string; lines?: string[] };
  /** Per channel, the account that acts. */
  accounts: Readonly<Record<string, string>>;
  /** Per `<channel>.<act>`, a day cap. */
  caps: Readonly<Record<string, number>>;
}

/**
 * What a campaign may still spend of an act: the smaller of the global left and its own cap left.
 * No cap: the global left. The global cap is the bot-flag guard; a campaign cap never raises it.
 */
export function capLeft(global: number, cap: number | undefined, used: number): number {
  return Math.max(0, cap === undefined ? global : Math.min(global, cap - used));
}
