/** The size the cut pass writes a track at. Pure: the page's preview reads it too. */

export const portrait = (s: { width: number; height: number }) => s.height > s.width;

/** 1080 on the short side (ffmpeg's -2: the nearest even number). */
export function cutSize(s: { width: number; height: number }): [number, number] {
  const even = (n: number) => Math.round(n / 2) * 2;
  return portrait(s)
    ? [1080, even((s.height * 1080) / s.width)]
    : [even((s.width * 1080) / s.height), 1080];
}
