/**
 * A QR code for a tracked link, made here: no service, no package. Byte mode, error correction
 * level M (about 15% of the code can be lost), versions 1 to 10 (up to 213 bytes, plenty for a
 * `/go/` link). Follows ISO/IEC 18004 the way Project Nayuki's reference encoder lays it out.
 *
 * Pure, so the portal draws it in the browser and the tests read it in Node.
 */

/** Codewords of error correction per block, and blocks, at level M, by version (index 0 unused). */
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Level M's two format bits. */
const LEVEL_M = 0;
export const QR_MAX_VERSION = 10;

/** Modules that carry data and error correction, past the fixed patterns. */
function rawModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

const dataCodewords = (ver: number) =>
  Math.floor(rawModules(ver) / 8) - (ECC_PER_BLOCK[ver] ?? 0) * (BLOCKS[ver] ?? 0);

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(out[j] as number, root);
      if (j + 1 < degree) out[j] = (out[j] as number) ^ (out[j + 1] as number);
    }
    root = gfMul(root, 0x02);
  }
  return out;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const out = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (out.shift() as number);
    out.push(0);
    divisor.forEach((d, i) => {
      out[i] = (out[i] as number) ^ gfMul(d, factor);
    });
  }
  return out;
}

/** The codewords in the order they're placed: blocks interleaved, error correction after. */
function codewords(bytes: readonly number[], ver: number): number[] {
  const bits: number[] = [];
  const put = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(ver) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    data.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
  for (let pad = 0xec; data.length < cap / 8; pad ^= 0xec ^ 0x11) data.push(pad);

  const blocks = BLOCKS[ver] as number;
  const ecc = ECC_PER_BLOCK[ver] as number;
  const raw = Math.floor(rawModules(ver) / 8);
  const short = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(ecc);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - ecc + (i < short ? 0 : 1));
    k += dat.length;
    const rem = rsRemainder(dat, divisor);
    if (i < short) dat.push(0);
    all.push([...dat, ...rem]);
  }
  const out: number[] = [];
  for (let i = 0; i < (all[0]?.length ?? 0); i++)
    for (let j = 0; j < all.length; j++)
      if (i !== shortLen - ecc || j >= short) out.push(all[j]?.[i] as number);
  return out;
}

function alignAt(ver: number, size: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** A code's penalty (lower reads better): runs, blocks, finder look-alikes and balance. */
function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let y = 0; y < size; y++) lines.push(m[y] as boolean[]);
  for (let x = 0; x < size; x++) lines.push(m.map((row) => row[x] as boolean));
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    const s = `0000${line.map((b) => (b ? "1" : "0")).join("")}0000`;
    for (const finder of ["10111010000", "00001011101"])
      for (let at = s.indexOf(finder); at >= 0; at = s.indexOf(finder, at + 1)) score += 40;
  }
  let dark = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = m[y]?.[x];
      if (c) dark++;
      if (
        x < size - 1 &&
        y < size - 1 &&
        c === m[y]?.[x + 1] &&
        c === m[y + 1]?.[x] &&
        c === m[y + 1]?.[x + 1]
      )
        score += 3;
    }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/**
 * The code for `text` as rows of modules, true is dark, with no quiet zone (draw four modules of
 * light around it). Null when it's too long for version 10.
 */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  const fits = (v: number) => 4 + (v <= 9 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v) * 8;
  while (ver <= QR_MAX_VERSION && !fits(ver)) ver++;
  if (ver > QR_MAX_VERSION) return null;
  const size = ver * 4 + 17;
  const m: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );
  const set = (x: number, y: number, dark: boolean) => {
    (m[y] as boolean[])[x] = dark;
    (fixed[y] as boolean[])[x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const)
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
  const align = alignAt(ver, size);
  const last = align.length - 1;
  for (const [i, ax] of align.entries())
    for (const [j, ay] of align.entries()) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  const format = (mask: number) => {
    const data = (LEVEL_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  const words = codewords(bytes, ver);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fixed[y]?.[x] && i < words.length * 8) {
          (m[y] as boolean[])[x] = (((words[i >>> 3] as number) >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }

  const masked = (mask: number) => {
    const out = m.map((row) => [...row]);
    const at = MASKS[mask] as (x: number, y: number) => boolean;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (!fixed[y]?.[x] && at(x, y)) (out[y] as boolean[])[x] = !out[y]?.[x];
    return out;
  };
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    format(mask);
    const score = penalty(masked(mask));
    if (score < bestScore) {
      best = mask;
      bestScore = score;
    }
  }
  format(best);
  return masked(best);
}

/** The code as one SVG path in module units (`viewBox="0 0 <size+8> <size+8>"`), quiet zone in. */
export function qrPath(m: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  m.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let w = 1;
      while (row[x + w]) w++;
      parts.push(`M${x + 4} ${y + 4}h${w}v1h-${w}z`);
      x += w - 1;
    }
  });
  return parts.join("");
}
