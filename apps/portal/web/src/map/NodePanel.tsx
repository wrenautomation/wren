/**
 * The Map's details for one node (click), a card over the canvas: its numbers, the people on it
 * newest first with a link to each journey, the crossings in and out over the window, and the way
 * into the app that manages it. Read only; the edit panel (`EditPanel.tsx`) has the fields.
 */
import type { ShapeNode } from "@wren/pipeline/model";
import { Button, ButtonLink, Icon, num } from "@wren/ui";
import { href } from "../route.js";
import { type MapData, numbersSay, type Window, windowSays } from "./model.js";
import { OVER_RIGHT } from "./overlay.js";
import { opensOf, type Place } from "./routes.js";

/** The people listed before "and N more". */
const SHOWN = 12;

const KIND: Record<ShapeNode["kind"], string> = {
  source: "Source",
  step: "Step",
  offer: "Offer",
  plan: "Plan",
};

export function NodePanel({
  data,
  id,
  window,
  place,
  client,
  at,
  onClose,
}: {
  data: MapData;
  id: string;
  window: Window;
  place: Place;
  /** The client's id, or null in Wren's own workspace. */
  client: string | null;
  /** The workspace as a link's params. */
  at: Record<string, string>;
  onClose: () => void;
}) {
  const node = data.body.nodes.find((n) => n.id === id);
  const ghost = data.ghosts.find((g) => g.id === id);
  const name = node?.name ?? ghost?.name ?? id;
  const people = node ? data.people.filter((p) => p.node === id) : (ghost?.people ?? []);
  const nameOf = (n: string) => data.body.nodes.find((x) => x.id === n)?.name ?? n;
  const cross = (dir: "in" | "out") =>
    data.body.edges
      .filter((e) => (dir === "in" ? e.to === id : e.from === id))
      .map((e) => ({
        id: e.id,
        who: nameOf(dir === "in" ? e.from : e.to),
        n: data.edges.get(e.id) ?? 0,
        loop: e.kind === "loop",
      }));
  const crossings = { in: cross("in"), out: cross("out") };
  const opens = node ? opensOf(node, place, client) : [];
  const [main, ...more] = opens;
  return (
    <section
      aria-label={`${name}, details`}
      className={`${OVER_RIGHT} text-[14px] text-(--ui-ink)`}
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px]/6 font-semibold">{name}</h2>
          <p className="text-[13px] text-(--ui-ink-3)">
            {node ? KIND[node.kind] : "Dropped from the newest version"}
          </p>
        </div>
        <Button tone="quiet" size="dense" icon="close" onClick={onClose}>
          Close
        </Button>
      </header>

      <section aria-label="Numbers">
        <ul className="list-none space-y-0.5 text-(--ui-ink-2)">
          {numbersSay(node?.kind ?? "step", data.nodes.get(id)).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="mt-1 text-[12.5px] text-(--ui-ink-3)">Numbers {windowSays(window)}.</p>
      </section>

      {node?.kind === "source" ? null : (
        <section aria-label="People here">
          <h3 className="mb-1.5 text-[13px] font-semibold text-(--ui-ink-2)">People here</h3>
          {people.length ? (
            <ul className="list-none">
              {people.slice(0, SHOWN).map((p) => (
                <li key={p.id}>
                  <a
                    href={href(`/pipelines/journeys/${encodeURIComponent(p.id)}`, at)}
                    className="flex min-h-9 items-center gap-2 text-(--ui-ink) no-underline hover:bg-(--ui-hover)"
                  >
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="text-[12.5px] text-(--ui-ink-3)">
                      {p.daysAtNode < 1 ? "today" : `${num(p.daysAtNode)} d`}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-(--ui-ink-3)">Nobody is here.</p>
          )}
          {people.length > SHOWN ? (
            <p className="mt-1 text-[12.5px] text-(--ui-ink-3)">
              and {num(people.length - SHOWN)} more
            </p>
          ) : null}
        </section>
      )}

      {node ? (
        <section aria-label="Crossings">
          <h3 className="mb-1.5 text-[13px] font-semibold text-(--ui-ink-2)">
            Crossings {windowSays(window)}
          </h3>
          {(["in", "out"] as const).map((dir) =>
            crossings[dir].length ? (
              <ul key={dir} className="mb-2 list-none space-y-0.5 text-(--ui-ink-2)">
                {crossings[dir].map((r) => (
                  <li key={r.id} className="flex gap-2">
                    <Icon name={dir === "in" ? "left" : "right"} size={14} />
                    <span className="min-w-0 flex-1 truncate">
                      {dir === "in" ? "from" : "to"} {r.who}
                      {r.loop ? " (loop)" : ""}
                    </span>
                    <span className="[font-variant-numeric:tabular-nums]">{num(r.n)}</span>
                  </li>
                ))}
              </ul>
            ) : null,
          )}
          {crossings.in.length + crossings.out.length === 0 ? (
            <p className="text-(--ui-ink-3)">No wires.</p>
          ) : null}
        </section>
      ) : null}

      {main ? (
        <footer className="flex flex-wrap items-center gap-2">
          <ButtonLink href={main.href} tone="primary" size="dense">
            Open
          </ButtonLink>
          {more.map((o) => (
            <ButtonLink key={o.href} href={o.href} tone="quiet" size="dense">
              {o.label}
            </ButtonLink>
          ))}
          <span className="text-[12.5px] text-(--ui-ink-3)">in {main.label}</span>
        </footer>
      ) : null}
    </section>
  );
}
