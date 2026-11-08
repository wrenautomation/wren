#!/usr/bin/env node
// Layers behaviour checks (designs/2026-11-07-layers-spec.md): hover, shut, lift, overlap.
// GPU Chrome with no window: new headless (channel chromium) runs on the GPU; the old headless shell draws 3D text jagged.
// Usage (from apps/portal): node scripts/layers-check.mjs [--sb http://localhost:52772] [--w 1280,390] [story ids...]
import { createRequire } from "node:module";

const require = createRequire(`${process.cwd()}/`);
const { chromium } = require("playwright");

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i < 0 ? d : argv.splice(i, 2)[1];
};
const SB = opt("--sb", "http://localhost:52772");
const WIDTHS = opt("--w", "1280,390").split(",").map(Number);
const SHAPES = ["funnels", "attraction", "upsells", "downsells", "continuity", "whole-model"];
const ids = argv.length
  ? argv
  : [...SHAPES.map((s) => `wren-map-offer-shapes--${s}`), "wren-map-layers--default"];

const fails = [];
const fail = (where, id, detail) => {
  fails.push({ where, id, ...detail });
  console.log("FAIL", where, id, JSON.stringify(detail)); // live, survives a crash
};
const pause = (p, ms) => p.waitForTimeout(ms);

/** Projected quads (corner markers put in each box) of faces and tags; stop-name centres. */
const scan = (p) =>
  p.evaluate(() => {
    const quad = (el) => {
      const ms = ["0 0", "100% 0", "100% 100%", "0 100%"].map((at) => {
        const m = document.createElement("i");
        const [x, y] = at.split(" ");
        m.style.cssText = `position:absolute;left:${x};top:${y};width:0;height:0`;
        el.appendChild(m);
        return m;
      });
      const q = ms.map((m) => {
        const b = m.getBoundingClientRect();
        return [b.left, b.top];
      });
      for (const m of ms) m.remove();
      return q;
    };
    return [...document.querySelectorAll(".mlay-slot:not(.shut)")].map((s) => ({
      key: s.dataset.part,
      face: quad(s.querySelector(".mlay-face")),
      tag: quad(s.querySelector(".mlay-tag")),
      names: [...s.querySelectorAll(".mlay-open svg text")]
        .filter((t) => t.textContent.trim() && t.getBoundingClientRect().width > 0)
        .map((t) => {
          const b = t.getBoundingClientRect();
          return {
            t: t.textContent.trim().slice(0, 30),
            c: [(b.left + b.right) / 2, (b.top + b.bottom) / 2],
          };
        }),
    }));
  });
/** Convex polygons overlap by more than `pad` px (separating axis). */
function clash(a, b, pad = 2) {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const n = [(y1 - y2) / len, (x2 - x1) / len];
      const pr = (q) => q.map(([x, y]) => x * n[0] + y * n[1]);
      const [pa, pb] = [pr(a), pr(b)];
      if (Math.min(...pa) > Math.max(...pb) - pad || Math.min(...pb) > Math.max(...pa) - pad)
        return false;
    }
  return true;
}
const inside = ([x, y], q) => {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const [ax, ay] = q[i];
    const [bx, by] = q[(i + 1) % q.length];
    const s = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
    if (s && sign && s !== sign) return false;
    sign ||= s;
  }
  return true;
};
const qArea = (q) =>
  Math.abs(
    q.reduce((s, [x, y], i) => {
      const [u, v] = q[(i + 1) % q.length];
      return s + x * v - u * y;
    }, 0),
  ) / 2;
const bbox = (q) => ({
  x0: Math.min(...q.map((p) => p[0])),
  y0: Math.min(...q.map((p) => p[1])),
  x1: Math.max(...q.map((p) => p[0])),
  y1: Math.max(...q.map((p) => p[1])),
});

function overlaps(id, plates) {
  for (const a of plates) {
    if (clash(a.tag, a.face)) fail("O2 tag on own face", id, { a: a.key });
    for (const n of a.names)
      if (!inside(n.c, a.face)) fail("O3 name outside plate", id, { a: a.key, name: n.t });
    for (const b of plates) {
      if (a === b) continue;
      if (clash(a.tag, b.face)) fail("O1 tag on face", id, { a: a.key, b: b.key });
      if (a.key < b.key && clash(a.tag, b.tag)) fail("O1 tag on tag", id, { a: a.key, b: b.key });
      if (a.key < b.key && clash(a.face, b.face)) {
        // share of the smaller face under the other: sampled
        const [s, l] = qArea(a.face) < qArea(b.face) ? [a.face, b.face] : [b.face, a.face];
        const bb = bbox(s);
        let tot = 0;
        let hit = 0;
        for (let i = 0; i <= 20; i++)
          for (let j = 0; j <= 20; j++) {
            const pt = [bb.x0 + ((bb.x1 - bb.x0) * i) / 20, bb.y0 + ((bb.y1 - bb.y0) * j) / 20];
            if (!inside(pt, s)) continue;
            tot++;
            if (inside(pt, l)) hit++;
          }
        if (tot && hit / tot > 0.25)
          fail("O5 plates overlap", id, { a: a.key, b: b.key, share: (hit / tot).toFixed(2) });
      }
    }
  }
}

/** The slot in hand now: `.hot` key, or "-". */
const handNow = (p) =>
  p.evaluate(() => document.querySelector(".mlay-slot.hot")?.dataset.part ?? "-");

async function hover(p, id, plates) {
  for (const pl of plates) {
    const f = bbox(pl.face);
    const w = f.x1 - f.x0;
    const h = f.y1 - f.y0;
    if (w < 20 || h < 20) continue;
    // H1: parked pointer, no flips. Spots off a turned plate stay "-" and pass.
    const spots = [];
    for (let i = 0; i < 7; i++)
      for (let j = 0; j < 7; j++)
        spots.push([f.x0 + w * (0.02 + (0.96 * i) / 6), f.y0 + h * (0.02 + (0.96 * j) / 6)]);
    for (const [x, y] of spots) {
      await p.mouse.move(x, y);
      await pause(p, 200);
      const seq = [];
      for (let k = 0; k < 8; k++) {
        seq.push(await handNow(p));
        await pause(p, 50);
      }
      if (new Set(seq).size > 1)
        fail("H1 flips", id, { a: pl.key, x: Math.round(x), y: Math.round(y), seq: seq.join(",") });
    }
    // H2: out through the bottom edge and back, 2 px steps: at most one change each way
    const cx = (f.x0 + f.x1) / 2;
    const path = [];
    for (let y = f.y1 - 30; y <= f.y1 + 30; y += 2) path.push(y);
    const states = [];
    for (const y of [...path, ...path.reverse()]) {
      await p.mouse.move(cx, y);
      await pause(p, 30);
      states.push((await handNow(p)) === pl.key ? 1 : 0);
    }
    await pause(p, 150);
    const changes = states.slice(1).filter((s, i) => s !== states[i]).length;
    if (changes > 2) fail("H2 edge flicker", id, { a: pl.key, changes, seq: states.join("") });
    // H3: centre to each act: in hand all the way
    await p.mouse.move(cx, (f.y0 + f.y1) / 2);
    await pause(p, 350);
    const acts = await p.evaluate(
      (key) =>
        [...document.querySelectorAll(`.mlay-slot[data-part="${CSS.escape(key)}"] .mlay-act`)].map(
          (a) => {
            const b = a.getBoundingClientRect();
            return [b.left + b.width / 2, b.top + b.height / 2, a.getAttribute("aria-label")];
          },
        ),
      pl.key,
    );
    for (const [ax, ay, label] of acts) {
      await p.mouse.move(cx, (f.y0 + f.y1) / 2);
      await pause(p, 300);
      const n = 20;
      const from = [cx, (f.y0 + f.y1) / 2];
      let lost = 0;
      for (let k = 1; k <= n; k++) {
        await p.mouse.move(from[0] + ((ax - from[0]) * k) / n, from[1] + ((ay - from[1]) * k) / n);
        await pause(p, 25);
        if ((await handNow(p)) !== pl.key) lost++;
      }
      const top = await p.evaluate(
        ([x, y]) =>
          document.elementFromPoint(x, y)?.closest(".mlay-act")?.getAttribute("aria-label") ?? null,
        [ax, ay],
      );
      if (lost) fail("H3 lost hand on the way to an act", id, { a: pl.key, act: label, lost });
      if (top !== label) fail("H3 act not on top", id, { a: pl.key, act: label, got: top });
    }
  }
  await p.mouse.move(2, 2);
  await pause(p, 300);
}

async function shutLift(p, id) {
  const key = await p.evaluate(() => document.querySelector(".mlay-slot:not(.shut)")?.dataset.part);
  if (!key) return;
  const sel = `.mlay-slot[data-part="${key}"]`;
  // hover a face point that takes the hand (bbox centre of a tilted quad can miss it)
  const q = (await scan(p)).find((pl) => pl.key === key).face;
  const at = (u, v) =>
    [0, 1].map(
      (i) => (1 - v) * ((1 - u) * q[0][i] + u * q[1][i]) + v * ((1 - u) * q[3][i] + u * q[2][i]),
    );
  let held = false;
  for (const [u, v] of [
    [0.5, 0.5],
    [0.3, 0.3],
    [0.7, 0.3],
    [0.3, 0.7],
    [0.7, 0.7],
    [0.5, 0.15],
    [0.5, 0.85],
  ]) {
    await p.mouse.move(...at(u, v));
    await pause(p, 250);
    if ((await handNow(p)) === key) {
      held = true;
      break;
    }
  }
  if (!held) {
    fail("C0 no face point takes the hand", id, { key });
    return;
  }
  const shutBtn = p.locator(`${sel} .mlay-act[aria-label^="Shut "]`);
  await shutBtn.click();
  await pause(p, 140);
  const mid = await p.evaluate((s) => {
    const pl = document.querySelector(`${s} .mlay-plate`);
    return pl
      ? {
          o: Number(getComputedStyle(pl).opacity),
          closing: pl.parentElement.classList.contains("closing"),
        }
      : null;
  }, sel);
  if (!mid?.closing || mid.o > 0.9 || mid.o < 0.02) fail("C1 no fall animation", id, { key, mid });
  await pause(p, 400);
  const after = await p.evaluate((s) => {
    const el = document.querySelector(s);
    return {
      shut: el.classList.contains("shut"),
      exp: el.querySelector(":scope > .mlay-knob")?.getAttribute("aria-expanded"),
    };
  }, sel);
  if (!after.shut || after.exp !== "false") fail("C1 not shut", id, { key, after });
  // C2: the knob lifts it, rising
  await p.locator(`${sel} > .mlay-knob`).click();
  const rise = [];
  for (let k = 0; k < 6; k++) {
    rise.push(
      await p.evaluate(
        (s) => Number(getComputedStyle(document.querySelector(`${s} .mlay-plate`)).opacity),
        sel,
      ),
    );
    await pause(p, 50);
  }
  await pause(p, 300);
  const up = await p.evaluate((s) => {
    const el = document.querySelector(s);
    return {
      shut: el.classList.contains("shut"),
      exp: el.querySelector(":scope > .mlay-knob")?.getAttribute("aria-expanded"),
      o: Number(getComputedStyle(el.querySelector(".mlay-plate")).opacity),
    };
  }, sel);
  if (up.shut || up.exp !== "true" || up.o < 0.99) fail("C2 not lifted", id, { key, up });
  if (!rise.some((o) => o > 0.02 && o < 0.98))
    fail("C2 no rise animation", id, { key, rise: rise.map((o) => o.toFixed(2)).join(",") });
  // C3: knob of a lifted plate folds it, when the knob shows (a plate over it hides it: S6 rule 6)
  await p.mouse.move(2, 2);
  await pause(p, 200);
  const k = await p.locator(`${sel} > .mlay-knob`).boundingBox();
  const covered = (await scan(p)).some((pl) =>
    inside([k.x + k.width / 2, k.y + k.height / 2], pl.face),
  );
  if (covered) return console.log(id, "C3 skipped: knob under a plate");
  await p.locator(`${sel} > .mlay-knob`).click({ force: true });
  await pause(p, 600);
  const folded = await p.evaluate((s) => document.querySelector(s).classList.contains("shut"), sel);
  if (!folded) fail("C3 knob did not fold", id, { key });
  await p.locator(`${sel} > .mlay-knob`).click({ force: true });
  await pause(p, 600);
}

const b = await chromium.launch({ headless: true, channel: "chromium" });
for (const id of ids)
  for (const W of WIDTHS) {
    const at = `${id}@${W}`;
    const p = await b.newPage({ viewport: { width: W, height: W < 600 ? 844 : 860 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
    p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 160)));
    await p.goto(`${SB}/iframe.html?viewMode=story&id=${id}`, { timeout: 90_000 });
    const shapes = id.startsWith("wren-map-offer-shapes");
    if (shapes) await p.waitForSelector("svg[role=group]", { timeout: 60_000 });
    const plays = shapes
      ? await p
          .locator("select[aria-label=Play] option")
          .count()
          .catch(() => 1)
      : 1;
    for (let i = 0; i < Math.max(plays, 1); i++) {
      const where = plays > 1 ? `${at}#${i}` : at;
      if (shapes) {
        await p.waitForSelector("svg[role=group]", { timeout: 60_000 });
        if (plays > 1) await p.selectOption("select[aria-label=Play]", String(i));
        await p.getByRole("button", { name: "Layers", exact: true }).click();
      }
      try {
        await p.waitForSelector(".mlay-floor", { timeout: 60_000 });
      } catch {
        fail("load", where, { errs });
        continue;
      }
      await pause(p, 2200);
      if ((await p.locator(".mlay-lift").count()) > 0) fail("C4 text pins", where, {});
      const plates = await scan(p);
      if (!plates.length) {
        console.log(where, "no plates");
        if (shapes) await p.getByRole("button", { name: "Flat", exact: true }).click();
        continue;
      }
      overlaps(where, plates);
      if (W >= 600) {
        await hover(p, where, plates);
        await shutLift(p, where);
      }
      console.log(where, `plates ${plates.length}`, `fails so far ${fails.length}`);
      if (shapes) await p.getByRole("button", { name: "Flat", exact: true }).click();
    }
    if (errs.length) fail("E1 errors", at, { errs: errs.slice(0, 3) });
    await p.close();
  }
await b.close();
for (const f of fails) console.log(JSON.stringify(f));
console.log(`${fails.length} fails`);
process.exit(fails.length ? 1 : 0);
