/**
 * A video's length from its MP4 or QuickTime boxes, read by byte range so the file never sits in
 * memory: walk the top-level boxes to `moov`, then its `mvhd` duration over its timescale. Null
 * when the file isn't one or the box isn't found; the caller then skips the check.
 */

/** Bytes `start` to `end` inclusive. */
export type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

/** A `moov` past this is not read: a short-form video's is far smaller. */
const MOOV_MAX = 32 * 1024 * 1024;
const BOXES_MAX = 64;

const u32 = (b: Uint8Array, at: number) =>
  ((b[at] ?? 0) * 2 ** 24 +
    ((b[at + 1] ?? 0) << 16) +
    ((b[at + 2] ?? 0) << 8) +
    (b[at + 3] ?? 0)) >>>
  0;
const u64 = (b: Uint8Array, at: number) => u32(b, at) * 2 ** 32 + u32(b, at + 4);
const type = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));

/** The box at `at` in `b`: its type, where its body starts and its end, or null past the end. */
function boxAt(b: Uint8Array, at: number, end: number) {
  if (at + 8 > end) return null;
  const small = u32(b, at);
  const large = small === 1;
  const size = large ? u64(b, at + 8) : small === 0 ? end - at : small;
  const head = large ? 16 : 8;
  if (size < head) return null;
  return { type: type(b, at + 4), body: at + head, end: at + size };
}

/** `mvhd`'s duration in seconds, from a `moov` box's body. */
function mvhdSeconds(moov: Uint8Array): number | null {
  for (let at = 0, n = 0; n < BOXES_MAX; n++) {
    const box = boxAt(moov, at, moov.length);
    if (!box) return null;
    if (box.type === "mvhd") {
      const v = moov[box.body];
      const scaleAt = box.body + (v === 1 ? 20 : 12);
      const scale = u32(moov, scaleAt);
      const duration = v === 1 ? u64(moov, scaleAt + 4) : u32(moov, scaleAt + 4);
      return scale > 0 ? duration / scale : null;
    }
    at = box.end;
  }
  return null;
}

export async function videoSeconds(read: ReadRange, size: number): Promise<number | null> {
  for (let at = 0, n = 0; at + 8 <= size && n < BOXES_MAX; n++) {
    const head = await read(at, Math.min(at + 15, size - 1));
    const box = boxAt(head, 0, size - at);
    if (!box) return null;
    if (n === 0 && box.type !== "ftyp" && box.type !== "wide" && box.type !== "moov") return null;
    const end = at + box.end;
    if (box.type === "moov") {
      const bodyLen = end - (at + box.body);
      if (bodyLen <= 0 || bodyLen > MOOV_MAX) return null;
      return mvhdSeconds(await read(at + box.body, end - 1));
    }
    at = end;
  }
  return null;
}
