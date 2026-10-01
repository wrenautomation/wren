/**
 * The reactivation demo, recorded for one firm: the demo portal with the
 * firm's name where the sample's is, walked the way a buyer would look at it.
 * Home, the run replay, one person's brief zoomed on why to call now, the
 * emails waiting for an OK, and why a line was written. The demo notice stays
 * on screen: the list is a real agency's public one, not the lead's.
 *
 * The name swap happens in the browser (the portal's API answers are
 * rewritten on the way in), so the demo database is never touched.
 */
import { type Offer, offerFor } from "@wren/offers";
import { type Encoded, encode, openRecorder, type Recorder } from "@wren/video";
import { DEMO_NAME } from "../portal/service.js";
import type { VideoBrief } from "./brief.js";

/** Stored on the enrichment as model and prompt version: a new version re-renders. */
export const WALK = { name: "reactivation-demo", version: "1" } as const;

export const DEMO_ORIGIN = "https://demo.wrenautomation.com";

/** The lines at the bottom of the video, in walk order. Taken from the portal's own copy. */
export interface WalkCopy {
  home: string;
  run: string;
  brief: string;
  emails: string;
  why: string;
}

export const WALK_COPY: WalkCopy = {
  home: "Every past client on your list, looked up for a reason to call now.",
  run: "Who was checked, what was found, and where it came from.",
  brief: "Each one gets a brief with its sources.",
  emails: "And an email that waits for your OK.",
  why: "Every line comes from the brief, and the brief from a source.",
};

export interface WalkOptions {
  /** Work directory; frames are deleted after the encode, the mp4 and poster stay. */
  dir: string;
  origin?: string;
  copy?: Partial<WalkCopy>;
  /** The offer on the cards; the reactivation offer by default. */
  offer?: Offer;
  ffmpeg?: string;
}

/** Record the walk for this firm and encode it. */
export async function renderWalk(brief: VideoBrief, o: WalkOptions): Promise<Encoded> {
  const copy = { ...WALK_COPY, ...o.copy };
  const offer = o.offer ?? offerFor("reactivation");
  const origin = o.origin ?? DEMO_ORIGIN;
  const rec = await openRecorder({ dir: o.dir });
  try {
    await swapName(rec, brief.firm);
    await rec.goto(`${origin}/reactivation/overview`);
    await walk(rec, brief, copy, offer);
    const recording = await rec.stop();
    await rec.close();
    return await encode(recording, `${o.dir}/video`, {
      ...(o.ffmpeg && { ffmpeg: o.ffmpeg }),
      // The portal home with their name in it, not the title card the watch page already says.
      posterAt: 5,
    });
  } finally {
    await rec.close().catch(() => {});
  }
}

/** The portal's API answers with the firm's name in place of the sample's. */
async function swapName(rec: Recorder, firm: string): Promise<void> {
  const inJson = JSON.stringify(firm).slice(1, -1);
  await rec.page.route("**/api/**", async (route) => {
    const res = await route.fetch();
    if (!res.headers()["content-type"]?.includes("json")) return route.fulfill({ response: res });
    const body = (await res.text()).replaceAll(DEMO_NAME, inJson);
    await route.fulfill({ response: res, body });
  });
}

async function walk(rec: Recorder, brief: VideoBrief, copy: WalkCopy, offer: Offer): Promise<void> {
  const p = rec.page;
  const nav = (name: string) => p.getByRole("link", { name, exact: true });

  await rec.card({ eyebrow: `Made for ${brief.firm}`, title: offer.name }, true);
  await rec.start();
  await rec.pause(2200);
  await rec.uncard();
  rec.caption(copy.home);
  await rec.pause(2600);

  await rec.click(p.getByRole("link", { name: "Watch it run" }));
  rec.caption(copy.run);
  await rec.pause(6000);

  await rec.click(nav("People"));
  rec.caption(null);
  await rec.pause(1400);
  await rec.click(p.locator('main a[href*="person="]').first());
  await rec.pause(1000);
  rec.caption(copy.brief);
  const why = p.getByRole("heading", { name: "Why call now" });
  await rec.zoom([why, why.locator("xpath=following-sibling::*[1]")], { hold: 2.8 });
  await p.keyboard.press("Escape");
  await rec.pause(500);

  await rec.click(nav("Emails"));
  rec.caption(copy.emails);
  await rec.pause(2600);
  await rec.click(p.getByRole("button", { name: /Why this line/ }).first());
  await rec.pause(900);
  rec.caption(copy.why);
  const trail = p.locator("[role=dialog] .ui-trail");
  await rec.zoom(
    [trail.locator(".ui-trail-step").first(), trail.locator(".ui-source-head").first()],
    { hold: 3 },
  );
  rec.caption(null);

  await rec.card({ eyebrow: "wrenautomation.com", title: offer.name, sub: offer.promise });
  await rec.pause(3500);
}
