/**
 * The axe color-contrast scan: every portal page, in every look, all text at 4.5:1 with no
 * large-text exception (designs/2026-10-14-customerio-audit.md, B3 item 10). CI runs it on the
 * preview; the token test (packages/ui/src/contrast.test.ts) checks the colors themselves.
 *
 *   tsx scripts/contrast.ts                         # the preview on :8788, every look
 *   tsx scripts/contrast.ts --url https://app.example.com --state signed-in.json
 *   tsx scripts/contrast.ts --looks wren,night --only /inbox --out report.json
 *
 * A preset or showcase look goes in by `?theme=`, as a person tries one. A client's look (a
 * brand) goes on the page root as the portal puts it. `--inject` puts every look in that way,
 * to try this checkout's tokens on a live portal. `--report` exits 0 with failures.
 */
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { BASE, PRESETS, readTheme, SHOWCASE, type Theme, themeVars } from "@wren/ui/theme";
import { type BrowserContext, chromium, type Page } from "playwright-core";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const url = (arg("url") ?? `http://localhost:${process.env.PORT ?? 8788}`).replace(/\/$/, "");
const only = arg("only");
const inject = process.argv.includes("--inject");
const workers = Number(arg("workers") ?? 4);

/** Two client looks: a brand on light and one on dark. */
const BRANDS: Record<string, Theme> = {
  "client-light": readTheme({ brand: { color: "#1d5a45" } }),
  "client-dark": readTheme({ brand: { color: "#d4af37", scheme: "dark" } }),
};
const LOOKS: Record<string, Theme> = { ...PRESETS, ...SHOWCASE, ...BRANDS };
const looks = (arg("looks")?.split(",") ?? Object.keys(LOOKS)).filter((l) => l in LOOKS);

const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

interface Miss {
  look: string;
  page: string;
  target: string;
  text: string;
  fg: string;
  bg: string;
  ratio: number;
}

/** Every page the nav reaches: each app, then each page its own links reach. */
async function pagesOf(p: Page): Promise<string[]> {
  await settle(p, `${url}/`);
  const hrefs = (sel: string) =>
    p.$$eval(sel, (as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
  const local = (h: string) => h.startsWith("/") && !h.startsWith("//") && !h.includes("?");
  const apps = [...new Set((await hrefs("nav a[href], aside a[href]")).filter(local))];
  const all = new Set(["/", ...apps]);
  for (const app of apps) {
    const top = app.split("/")[1];
    await settle(p, url + app);
    const more = (await hrefs("a[href]")).filter((h) => local(h) && h.split("/")[1] === top);
    for (const h of more.slice(0, 20)) all.add(h);
  }
  return [...all].filter((h) => !only || h.startsWith(only)).sort();
}

async function settle(p: Page, to: string) {
  await p.goto(to, { waitUntil: "domcontentloaded" });
  await p.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await p.waitForTimeout(300);
}

async function scan(p: Page, look: string, page: string): Promise<Miss[]> {
  const viaUrl = !inject && !(look in BRANDS);
  const u = new URL(url + page);
  u.searchParams.set("theme", viaUrl ? look : "wren");
  await settle(p, u.toString());
  if (!viaUrl)
    // Whole (BASE under the look), and !important: the page's own look lands late on slow pages.
    await p.addStyleTag({
      content: `:root { ${Object.entries(themeVars({ ...BASE, ...LOOKS[look] }))
        .map(([k, v]) => `${k}: ${v} !important;`)
        .join(" ")} }`,
    });
  if (!(await p.evaluate(() => "axe" in window))) await p.addScriptTag({ path: AXE });
  const found = await p.evaluate(async () => {
    const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
    // No large-text exception: 4.5:1 at every size.
    axe.configure({
      checks: [
        {
          id: "color-contrast",
          options: { contrastRatio: { normal: { expected: 4.5 }, large: { expected: 4.5 } } },
        },
      ],
    });
    const r = await axe.run(document, {
      runOnly: { type: "rule", values: ["color-contrast"] },
      resultTypes: ["violations"],
    });
    return r.violations.flatMap((v) =>
      v.nodes.map((n) => {
        const d = (n.any[0]?.data ?? {}) as Record<string, unknown>;
        let el: Element | null = null;
        try {
          el = document.querySelector(String(n.target[0]));
        } catch {
          // A target inside a shadow root: no text to show.
        }
        return {
          target: n.target.join(" "),
          text: (el?.textContent ?? "").trim().slice(0, 60),
          fg: String(d.fgColor ?? ""),
          bg: String(d.bgColor ?? ""),
          ratio: Number(d.contrastRatio ?? 0),
        };
      }),
    );
  });
  return found.map((f) => ({ look, page, ...f }));
}

const browser = await chromium.launch();
const state = arg("state");
const context = (): Promise<BrowserContext> =>
  browser.newContext({
    viewport: { width: 1440, height: 900 },
    // The portal's CSP refuses inline scripts, and axe goes in as one.
    bypassCSP: true,
    ...(state ? { storageState: state } : {}),
  });

const first = await (await context()).newPage();
const pages = await pagesOf(first);
const jobs = looks.flatMap((look) => pages.map((page) => [look, page] as const));
console.log(`${pages.length} pages × ${looks.length} looks`);

const misses: Miss[] = [];
const broken: string[] = [];
await Promise.all(
  Array.from({ length: workers }, async () => {
    const p = await (await context()).newPage();
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const [look, page] = job;
      try {
        misses.push(...(await scan(p, look, page)));
      } catch (err) {
        broken.push(`${look} ${page}: ${(err as Error).message.split("\n")[0]}`);
      }
    }
  }),
);
await browser.close();

// One line per look, then each distinct pair with where it shows first.
const pairs = new Map<string, Miss & { n: number }>();
for (const m of misses) {
  const k = `${m.look} ${m.fg} on ${m.bg}`;
  const hit = pairs.get(k);
  if (hit) hit.n++;
  else pairs.set(k, { ...m, n: 1 });
}
for (const look of looks) {
  const mine = [...pairs.values()].filter((p) => p.look === look);
  console.log(
    `${look}: ${misses.filter((m) => m.look === look).length} failing (${mine.length} pairs)`,
  );
  for (const p of mine.sort((a, b) => b.n - a.n))
    console.log(`  ${p.fg} on ${p.bg} ${p.ratio}:1 ×${p.n}  ${p.page} "${p.text}"`);
}
for (const b of broken) console.log(`not scanned: ${b}`);
const out = arg("out");
if (out) writeFileSync(out, JSON.stringify({ pages, looks, misses, broken }, null, 2));
if ((misses.length || broken.length) && !process.argv.includes("--report")) process.exit(1);
