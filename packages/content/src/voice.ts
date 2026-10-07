/**
 * How the posts sound. The default is William's own writing rule; a voice
 * file (WREN_CONTENT_VOICE) replaces it with his words when he has more to say.
 */
export const DEFAULT_VOICE = `Extremely concise. Short plain sentences a person would say out loud.
Fewer words, more signal. No filler, no hedging, no hype, no jargon, no buzzwords.
Lead with the point. Concrete over abstract: the real numbers and events you are given, never made-up ones.
First person, one person talking, never "we" for a team that does not exist.
No emoji. No exclamation marks. No calls to follow or like.`;

export interface Brand {
  /** Who is talking. */
  readonly name: string;
  /** One line on what the business does, for context only; never pasted into a post. */
  readonly about: string;
}

export const DEFAULT_BRAND: Brand = {
  name: "Wren Automation",
  about:
    "a one-person automation agency: builds unattended outreach, content and browser automation for small businesses, and posts about building it",
};
