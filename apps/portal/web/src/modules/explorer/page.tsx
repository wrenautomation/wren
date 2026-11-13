/**
 * Explorer: every root as one Finder-style tree, a page per root (designs/2026-11-12-explorer.md
 * D5). Canon, Vireo and the business map read on the server (PathsConsole); Weaver and folders read here, beside
 * `weaver serve` on this Mac. A walk from here into a server root hands its rest over in one call
 * (`across`). The address holds where it stands (`?at=`) and the view (`?view=`). A subject or a
 * run opens whole (`?whole=1`, WA-1373): its own view fills the page, the columns step aside.
 */
import {
  across,
  type Column,
  type Item,
  type LinePage,
  type Page,
  type PathMap,
  type Reads,
  rootOf,
  type Shown,
  segments,
  type Whole,
} from "@wren/core/paths";
import { foldersTree } from "@wren/paths/folders-tree";
import type { VireoSubject } from "@wren/paths/vireo-tree";
import { weaverServe, weaverTree } from "@wren/paths/weaver-tree";
import {
  Button,
  Explorer,
  type ExplorerView,
  FolderMoveMenu,
  Icon,
  type IconName,
  type TagTone,
  useSeen,
} from "@wren/ui";
import { type ReactNode, useEffect } from "react";
import { call } from "../../api.js";
import { useFolders } from "../../folders.js";
import { PORTAL, useCall } from "../../load.js";
import { METRO_MARKS, MetroPreview, metroFills } from "../../map/explorer.js";
import type { PageProps } from "../../module.js";
import { navigate } from "../../route.js";
import { CANON_MARKS, CanonPreview, CanonRoot, canonFills } from "../canon/explorer.js";
import { WEAVER_MARKS, WeaverPreview, weaverFills } from "../research/explorer.js";
import { RunWhole } from "../research/page.js";
import { SERVE } from "../research/serve.js";
import { SubjectWhole, VIREO_MARKS, VireoPreview, vireoFills } from "../variants/explorer.js";
import { explorerHref, viewOf, wholeHref } from "./href.js";

/** The server's roots, one call each. */
const FAR: Reads = {
  columns: (route) => call<Shown>("paths/columns", { route }),
  children: (path, after) => call<Page>("paths/children", { path, ...(after ? { after } : {}) }),
  find: (q, under) => call<{ items: Item[] }>("paths/find", { q, under }).then((r) => r.items),
  map: (root, fold) => call<PathMap>("paths/map", { root, ...fold }),
  line: (from, to, after) =>
    call<LinePage>("paths/line", { from, to, ...(after ? { after } : {}) }),
};

/** The roots read here; fresh per read, so each read loads its own runs and tree. */
function here() {
  const weaver = weaverServe(SERVE);
  return {
    weaver: weaverTree(weaver),
    folders: foldersTree({
      tree: () => call("folders/tree", {}),
      subjects: () => call<VireoSubject[]>("variants/subjects", {}),
      runs: () => weaver.runs(),
    }),
  };
}

const READ: Reads = {
  columns: (route) => across(here(), FAR).columns(route),
  children: (path, after) => across(here(), FAR).children(path, after),
  find: (q, under) => across(here(), FAR).find(q, under),
  map: (root, fold) => across(here(), FAR).map(root, fold),
  line: (from, to, after) => across(here(), FAR).line(from, to, after),
};

/** Every root's marks in one map: a folder's rows come from any root. */
const MARKS: Record<string, { label: string; tone?: TagTone }> = {
  ...CANON_MARKS,
  ...VIREO_MARKS,
  ...WEAVER_MARKS,
  ...METRO_MARKS,
};

const ERRORS = {
  "not-indexed": (
    <>
      Canon reaches this page after the first sync: <code>wren canon sync</code>.
    </>
  ),
  offline: (
    <>
      Weaver reads from this Mac. Start it with <code>weaver serve</code>, then try again.
    </>
  ),
  blind: "This batch is open: mark it in Batches first. Its why and lineage show after.",
};

/** What fills an empty folder, by root; in Folders, the root or a folder of his. */
const FILLS: Record<string, (c: Column) => ReactNode> = {
  canon: (c) => canonFills(c.route),
  vireo: (c) => vireoFills(c.route),
  weaver: (c) => weaverFills(c.route),
  metro: (c) => metroFills(c.route),
  folders: (c) =>
    c.item.kind === "root" || c.item.kind === "folder" ? (
      <>
        File a run or a subject from its ⋯ in <a href={explorerHref("weaver")}>Weaver</a> or{" "}
        <a href={explorerHref("vireo/subjects")}>Vireo</a>.
      </>
    ) : undefined,
};

/** A subject's or a run's ⋯: move it to a folder (designs/2026-11-08-folders.md). */
function FileIn({
  kind,
  itemKey,
  title,
  team,
}: {
  kind: "subject" | "run";
  itemKey: string;
  title: string;
  team: boolean;
}) {
  const filed = useFolders(kind, team);
  if (!filed.folders) return null;
  return (
    <FolderMoveMenu
      title={title}
      folders={filed.folders}
      current={filed.folderOf(itemKey)}
      acts={filed.acts}
      itemKey={itemKey}
    />
  );
}

/** The ⋯ for an item a folder can hold: a subject (by id) or a run. */
function fileOf(w: Whole, team: boolean): ReactNode {
  const [root, a, b, c] = segments(w.path);
  if (root === "vireo" && a === "subjects" && b && !c) {
    const id = (w.data as { subject?: { id: number } } | undefined)?.subject?.id;
    return id == null ? null : (
      <FileIn kind="subject" itemKey={String(id)} title={w.name} team={team} />
    );
  }
  if (root === "weaver" && a && !b)
    return <FileIn kind="run" itemKey={a} title={w.name} team={team} />;
  return null;
}

const PREVIEW: Record<string, (w: Whole, view: ExplorerView, team: boolean) => ReactNode> = {
  canon: (w, view) => <CanonPreview w={w} view={view} />,
  vireo: (w, _view, team) => <VireoPreview w={w} file={fileOf(w, team)} />,
  weaver: (w, _view, team) => <WeaverPreview w={w} file={fileOf(w, team)} />,
  metro: (w) => <MetroPreview w={w} />,
};

/** Weaver's root page: every run, or the ones picked, on one graph. */
const WeaverRoot = () => (
  <a href={wholeHref("weaver")} className="inline-flex items-center gap-1.5 self-start">
    <Icon name="workflow" size={14} />
    All runs on one graph
  </a>
);

/** An item opened whole, by its route; null: it has no whole view, the columns show it. */
function wholeOf(route: string, params: URLSearchParams, back: () => void): ReactNode {
  const [root, a, b, c] = segments(route);
  // as a subject's own back button
  const backLink = (
    <Button size="dense" tone="quiet" icon="left" onClick={back}>
      Explorer
    </Button>
  );
  if (root === "vireo" && a === "subjects" && b && !c)
    return <SubjectWhole slug={b} params={params} onBack={back} />;
  if (root === "weaver" && !b)
    return <RunWhole open={a ?? (params.get("run") || "all")} params={params} back={backLink} />;
  return null;
}

/** An old Subjects link (`?subject=<id>`): on to that subject whole. */
function SubjectMoved({ id }: { id: string }) {
  const got = useCall("variants-subjects", () =>
    call<{ id: number; slug: string }[]>("variants/subjects", {}),
  );
  const slug = got.data?.find((s) => String(s.id) === id)?.slug;
  const done = !!got.data || !!got.error;
  useEffect(() => {
    if (!done) return;
    navigate(slug ? wholeHref(`vireo/subjects/${slug}`) : explorerHref("vireo/subjects"), true);
  }, [done, slug]);
  return null;
}

/** A root with no preview of its own: the item's text. */
const Body = ({ text }: { text: string | undefined }) =>
  text ? (
    <div className="max-w-[72ch] text-[14px]/[1.6] whitespace-pre-wrap text-(--ui-ink-2) wrap-anywhere">
      {text}
    </div>
  ) : null;

export interface ExplorerRoot {
  id: string;
  label: string;
  icon: IconName;
  about: string;
}

/** One root's page: Explorer standing in that root. */
export function rootPage(root: ExplorerRoot) {
  return function RootPage({ params, team }: PageProps) {
    const route = params.get("at") || root.id;
    const view = viewOf(params.get("view"));
    useSeen("list", { label: root.label, icon: root.icon, text: `${root.label}, at ${route}` });
    const moved = root.id === "vireo" ? params.get("subject") : null;
    if (moved) return <SubjectMoved id={moved} />;
    const whole = params.get("whole")
      ? wholeOf(route, params, () => navigate(explorerHref(route, view)))
      : null;
    if (whole) return whole;
    return (
      <Explorer
        route={route}
        view={view}
        name={root.label}
        hrefFor={(r, v) => explorerHref(r, v ?? view)}
        onRoute={(r, v) => navigate(explorerHref(r, v ?? view))}
        read={READ}
        scope={PORTAL}
        marks={MARKS}
        errorText={ERRORS}
        emptyText={(c) => FILLS[rootOf(c.route)]?.(c)}
        preview={(w) => PREVIEW[rootOf(w.path)]?.(w, view, team) ?? <Body text={w.body} />}
        folderPage={(c: Column) =>
          c.route === "canon" ? (
            <CanonRoot view={view} />
          ) : c.route === "weaver" ? (
            <WeaverRoot />
          ) : undefined
        }
      />
    );
  };
}
