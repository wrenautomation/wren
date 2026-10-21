/**
 * Admin → Systems: every app this viewer may open, in two groups. "On your shape" holds the apps a
 * live Map node opens, each naming those nodes. "Not on the shape" holds the rest: handlers, loops,
 * review and the like. A parked app shows in neither (`systemsOf`, map/routes.ts).
 */
import { Empty, Icon, LoadFailed, Loading, PageHeader, Section } from "@wren/ui";
import { useApps } from "../../apps-context.js";
import { mapNodeHref, systemsOf } from "../../map/routes.js";
import { useShapeNodes } from "../../map/stations.js";
import { type Module, type PageProps, WREN } from "../../module.js";
import { LINK } from "./Guide.js";

const firstOf = (m: Module) => {
  const p = m.pages.find((x) => !x.hidden) ?? m.pages[0];
  return p ? `/${m.id}/${p.id}` : "/";
};

function Row({
  app,
  client,
  nodes = [],
}: {
  app: Module;
  client: string | null;
  nodes?: { id: string; name: string }[];
}) {
  return (
    <li className="grid grid-cols-[30px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-(--ui-hair) py-3.5 last:border-b-0">
      <span
        className="row-span-2 grid size-[30px] place-items-center bg-(--ui-fill) text-(--ui-ink)"
        aria-hidden="true"
      >
        <Icon name={app.icon} />
      </span>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
        <a className={`${LINK} text-[15px] font-semibold`} href={firstOf(app)}>
          {app.name}
        </a>
        <span className="text-[13.5px] text-(--ui-ink-2)">{app.blurb}</span>
      </div>
      {nodes.length ? (
        <ul className="flex list-none flex-wrap gap-x-3 gap-y-1 text-[13px]">
          {nodes.map((n) => (
            <li key={n.id}>
              <a className={`${LINK} text-(--ui-ink-2)`} href={mapNodeHref(n.id, client)}>
                {n.name}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function Systems({ client }: PageProps) {
  const apps = useApps();
  const shape = useShapeNodes(client);
  const at = client === WREN.id ? null : client;
  const header = <PageHeader title="Systems" lede="Every app, and where it sits on your shape." />;
  if (shape.error && !shape.data)
    return (
      <>
        {header}
        <LoadFailed error={shape.error} onRetry={shape.retry} what="shape" />
      </>
    );
  // The header shows at once; the groups wait for the shape, as rows in the shape of the list.
  if (!shape.data)
    return (
      <>
        {header}
        <Loading shape="rows" lines={6} />
      </>
    );
  const { onShape, rest } = systemsOf(
    apps,
    shape.data.nodes,
    client === WREN.id ? "wren" : "client",
  );
  return (
    <>
      {header}
      <Section title="On your shape" count={onShape.length}>
        {onShape.length ? (
          <ul className="max-w-[68ch] list-none">
            {onShape.map(({ app, nodes }) => (
              <Row key={app.id} app={app} client={at} nodes={nodes} />
            ))}
          </ul>
        ) : (
          <Empty>No app is on the shape yet. A station opens an app once the shape has one.</Empty>
        )}
      </Section>
      <Section title="Not on the shape" count={rest.length}>
        <ul className="max-w-[68ch] list-none">
          {rest.map((app) => (
            <Row key={app.id} app={app} client={at} />
          ))}
        </ul>
      </Section>
    </>
  );
}
