/**
 * Explorer: every root as one Finder-style tree, a page per root (designs/2026-11-12-explorer.md
 * D5). Canon and Vireo read on the server (PathsConsole); Weaver and folders read here, beside
 * `weaver serve` on this Mac. A walk from here into a server root hands its rest over in one call
 * (`across`). The address holds where it stands (`?at=`) and the view (`?view=`).
 */
import {
  across,
  type Column,
  type Item,
  type Page,
  type Reads,
  rootOf,
  type Shown,
  type Whole,
} from "@wren/core/paths";
import { foldersTree } from "@wren/paths/folders-tree";
import type { VireoSubject } from "@wren/paths/vireo-tree";
import { weaverServe, weaverTree } from "@wren/paths/weaver-tree";
import { Explorer, type ExplorerView, type IconName, type TagTone, useSeen } from "@wren/ui";
import type { ReactNode } from "react";
import { call } from "../../api.js";
import { PORTAL } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { CANON_MARKS, CanonPreview, CanonRoot, canonFills } from "../canon/explorer.js";
import { WEAVER_MARKS, WeaverPreview, weaverFills } from "../research/explorer.js";
import { SERVE } from "../research/serve.js";
import { VIREO_MARKS, VireoPreview, vireoFills } from "../variants/explorer.js";
import { explorerHref, viewOf } from "./href.js";

/** The server's roots, one call each. */
const FAR: Reads = {
  columns: (route) => call<Shown>("paths/columns", { route }),
  children: (path, after) => call<Page>("paths/children", { path, ...(after ? { after } : {}) }),
  find: (q, under) => call<{ items: Item[] }>("paths/find", { q, under }).then((r) => r.items),
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
};

/** Every root's marks in one map: a folder's rows come from any root. */
const MARKS: Record<string, { label: string; tone?: TagTone }> = {
  ...CANON_MARKS,
  ...VIREO_MARKS,
  ...WEAVER_MARKS,
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
  folders: (c) =>
    c.item.kind === "root" || c.item.kind === "folder" ? (
      <>
        File runs from <a href={href("/research/runs", { view: "history" })}>Research</a> and
        subjects from <a href="/variants/subjects">Subjects</a>.
      </>
    ) : undefined,
};

const PREVIEW: Record<string, (w: Whole, view: ExplorerView) => ReactNode> = {
  canon: (w, view) => <CanonPreview w={w} view={view} />,
  vireo: (w) => <VireoPreview w={w} />,
  weaver: (w) => <WeaverPreview w={w} />,
};

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
  return function RootPage({ params }: PageProps) {
    const route = params.get("at") || root.id;
    const view = viewOf(params.get("view"));
    useSeen("list", { label: root.label, icon: root.icon, text: `${root.label}, at ${route}` });
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
        preview={(w) => PREVIEW[rootOf(w.path)]?.(w, view) ?? <Body text={w.body} />}
        folderPage={(c: Column) => (c.route === "canon" ? <CanonRoot view={view} /> : undefined)}
      />
    );
  };
}
