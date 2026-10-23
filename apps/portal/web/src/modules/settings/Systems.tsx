/**
 * Admin → Systems: every app this viewer may open, in two groups. "On your shape" holds the apps a
 * live Map node opens, each naming those nodes. "Not on the shape" holds the rest: handlers, loops,
 * review and the like. A parked app shows in neither (`systemsOf`, map/routes.ts).
 */
import { Empty, LoadFailed, Loading, PageHeader, Section } from "@wren/ui";
import { useApps } from "../../apps-context.js";
import { mapNodeHref, systemsOf } from "../../map/routes.js";
import { useShapeNodes } from "../../map/stations.js";
import { type Module, type PageProps, WREN } from "../../module.js";
import { type AppLine, AppRows } from "./app-rows.js";

const firstOf = (m: Module) => {
  const p = m.pages.find((x) => !x.hidden) ?? m.pages[0];
  return p ? `/${m.id}/${p.id}` : "/";
};

const lineOf = (
  app: Module,
  client: string | null,
  nodes: { id: string; name: string }[] = [],
): AppLine => ({
  id: app.id,
  name: app.name,
  icon: app.icon,
  blurb: app.blurb,
  href: firstOf(app),
  links: nodes.map((n) => ({ id: n.id, label: n.name, href: mapNodeHref(n.id, client) })),
});

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
          <AppRows
            apps={onShape.map(({ app, nodes }) => lineOf(app, at, nodes))}
            label="Apps on your shape"
            linksHead="Map nodes"
          />
        ) : (
          <Empty>No app is on the shape yet. A station opens an app once the shape has one.</Empty>
        )}
      </Section>
      <Section title="Not on the shape" count={rest.length}>
        <AppRows
          apps={rest.map((app) => lineOf(app, at))}
          label="Apps not on your shape"
          linksHead="Map nodes"
        />
      </Section>
    </>
  );
}
