/**
 * Browser mods: autobrowse mods on npm (keyword `autobrowse-mod`), each with what it may touch.
 * Read only: a mod goes on from the desk (`autobrowse mods add`), never from here. The same
 * search as autobrowse's `searchMods`, from the browser.
 */
import { Empty, LoadFailed, Loading, PageHeader, Tag } from "@wren/ui";
import { useCall } from "../../load.js";
import { BLOCK, LIST, QUIET } from "../work/bits.js";

const REGISTRY = "https://registry.npmjs.org";

interface Mod {
  name: string;
  version: string;
  description: string;
  sites: string[];
  domains: string[];
  gates: string[];
  code: boolean;
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`npm answered ${res.status}`);
  return (await res.json()) as T;
}

/** Each hit's permissions come from its latest manifest's `autobrowseMod`. */
async function search(): Promise<Mod[]> {
  const { objects } = await json<{ objects: { package: { name: string; version: string } }[] }>(
    `${REGISTRY}/-/v1/search?text=keywords:autobrowse-mod&size=50`,
  );
  return Promise.all(
    objects.map(async ({ package: p }) => {
      const m = await json<{ description?: string; autobrowseMod?: Partial<Mod> }>(
        `${REGISTRY}/${p.name.replace("/", "%2f")}/${p.version}`,
      );
      return {
        name: p.name,
        version: p.version,
        description: m.description ?? "",
        sites: m.autobrowseMod?.sites ?? [],
        domains: m.autobrowseMod?.domains ?? [],
        gates: m.autobrowseMod?.gates ?? [],
        code: m.autobrowseMod?.code !== false,
      };
    }),
  );
}

/** A mod made for a laptop's own test pages, which no client's browser can reach. */
const LOCAL = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/;
const local = (m: Mod) => m.domains.length > 0 && m.domains.every((d) => LOCAL.test(d));

/** "@wren/autobrowse-mod-lead-notes" reads "Lead notes". */
const nameOf = (pkg: string) => {
  const s = pkg
    .replace(/^@[^/]+\//, "")
    .replace(/^autobrowse-mod-/, "")
    .replaceAll("-", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const line = (label: string, items: string[]) =>
  items.length ? (
    <span className={`${QUIET} ${BLOCK}`}>
      {label}: {items.join(", ")}
    </span>
  ) : null;

export function Mods() {
  const mods = useCall("mods", async () => (await search()).filter((m) => !local(m)));
  return (
    <>
      <PageHeader title="Browser mods" lede="What each mod can touch. Wren turns one on for you." />
      {mods.error && !mods.data ? (
        <LoadFailed error={mods.error} onRetry={mods.retry} />
      ) : !mods.data ? (
        <Loading lines={4} />
      ) : !mods.data.length ? (
        <Empty>Mods published to npm show here.</Empty>
      ) : (
        <ul className={LIST}>
          {mods.data.map((m) => (
            <li key={m.name}>
              <span className="flex flex-wrap items-center gap-2">
                <b className="[overflow-wrap:anywhere]" title={m.name}>
                  {nameOf(m.name)}
                </b>
                <span className={QUIET}>v{m.version}</span>
                {m.code ? <Tag tone="accent">Runs code</Tag> : <Tag>Data only</Tag>}
              </span>
              {m.description ? <span className={BLOCK}>{m.description}</span> : null}
              {line("Sites", m.sites)}
              {line("Domains", m.domains)}
              {line("Asks you before", m.gates)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
