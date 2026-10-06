/**
 * Browser mods: autobrowse mods on npm (keyword `autobrowse-mod`), each with what it may touch.
 * Read only: a mod goes on from the desk (`autobrowse mods add`), never from here. The same
 * search as autobrowse's `searchMods`, from the browser.
 */
import { Alert, Empty, Loading, PageHeader, Tag } from "@wren/ui";
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

const line = (label: string, items: string[]) =>
  items.length ? (
    <span className={`${QUIET} ${BLOCK}`}>
      {label}: {items.join(", ")}
    </span>
  ) : null;

export function Mods() {
  const mods = useCall("mods", search);
  return (
    <>
      <PageHeader
        title="Browser mods"
        lede="Autobrowse mods on npm, with what each may touch. A mod goes on from the desk."
      />
      {mods.error && !mods.data ? (
        <Alert onRetry={mods.retry}>{mods.error.message}</Alert>
      ) : !mods.data ? (
        <Loading lines={4} />
      ) : !mods.data.length ? (
        <Empty>No mod is on npm yet.</Empty>
      ) : (
        <ul className={LIST}>
          {mods.data.map((m) => (
            <li key={m.name}>
              <span className="flex flex-wrap items-center gap-2">
                <b className="[overflow-wrap:anywhere]">{m.name}</b>
                <span className={QUIET}>{m.version}</span>
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
