/**
 * The wide graph as a dock (research-web.md, 11-09 "panes"; dockview 8.6.2): Lists | Web | detail
 * windows (wins.ts). The layout persists across runs; a window of another run drops on load.
 */
import "dockview-react/dist/styles/dockview.css";
import {
  type DockviewApi,
  DockviewDefaultTab,
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import { Icon } from "../../icons.js";
import type { Win } from "./wins.js";

const LAY = "weaver-dock";

/** What the panes draw; Graph owns the state, the panes only place it. */
export interface DockParts {
  lists: ReactNode;
  web: ReactNode;
  detail: (win: string) => ReactNode;
  title: (win: string) => string;
}
const Parts = createContext<DockParts | null>(null);
const useParts = () => {
  const c = useContext(Parts);
  if (!c) throw new Error("a dock pane outside RunDock");
  return c;
};
const ListsPane = () => <>{useParts().lists}</>;
const WebPane = () => <>{useParts().web}</>;
function DetailPane({ params, api }: IDockviewPanelProps<{ win: string }>) {
  const c = useParts();
  const t = c.title(params.win);
  useEffect(() => {
    if (api.title !== t) api.setTitle(t);
  }, [api, t]);
  return <>{c.detail(params.win)}</>;
}
const PANES = { lists: ListsPane, web: WebPane, detail: DetailPane };
/** Lists and Web hide, never close */
const Fixed = (p: IDockviewPanelHeaderProps) => <DockviewDefaultTab {...p} hideClose />;
const TABS = { fixed: Fixed };
const THEME: DockviewTheme = { name: "wren", className: "dockview-theme-wren" };

/** A group's float and fill buttons. */
function Acts({ group, containerApi }: IDockviewHeaderActionsProps) {
  const [, re] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const a = containerApi.onDidMaximizedGroupChange(() => re());
    const b = group.api.onDidLocationChange(() => re());
    return () => {
      a.dispose();
      b.dispose();
    };
  }, [group, containerApi]);
  const floating = group.api.location.type === "floating";
  const max = group.api.isMaximized();
  const web = group.panels.some((p) => p.id === "web");
  return (
    <div className="dk-acts">
      {web ? null : floating ? (
        <button
          type="button"
          aria-label="Dock the window"
          title="Dock the window"
          onClick={() => group.api.moveTo({ position: "right" })}
        >
          <Icon name="panelRight" size={14} />
        </button>
      ) : (
        <button
          type="button"
          aria-label="Float the window"
          title="Float the window"
          onClick={() =>
            containerApi.addFloatingGroup(group, {
              width: 460,
              height: Math.max(320, Math.min(600, containerApi.height - 48)),
              x: Math.max(16, containerApi.width - 484),
              y: 24,
            })
          }
        >
          <Icon name="pip" size={14} />
        </button>
      )}
      {floating ? null : (
        <button
          type="button"
          aria-label={max ? "Restore the layout" : "Fill the dock"}
          title={max ? "Restore the layout (Esc)" : "Fill the dock (double-click a tab)"}
          aria-pressed={max}
          onClick={() => (max ? group.api.exitMaximized() : group.api.maximize())}
        >
          <Icon name={max ? "shrink" : "expand"} size={14} />
        </button>
      )}
    </div>
  );
}

export function addLists(api: DockviewApi) {
  const web = api.getPanel("web");
  api.addPanel({
    id: "lists",
    component: "lists",
    tabComponent: "fixed",
    title: "Lists",
    initialWidth: 290,
    ...(web ? { position: { referencePanel: web, direction: "left" } } : {}),
  });
}
/** A new detail window: beside `near`'s, or any detail window's, or right of the web. */
export function addDetail(api: DockviewApi, id: string, title: string, near?: string | null) {
  const ref =
    (near ? api.getPanel(near) : undefined) ?? api.panels.find((p) => p.api.component === "detail");
  return api.addPanel({
    id,
    component: "detail",
    title,
    params: { win: id },
    ...(ref
      ? { position: { referenceGroup: ref.group } }
      : { position: { referencePanel: "web", direction: "right" }, initialWidth: 440 }),
  });
}
export function defaultLayout(api: DockviewApi) {
  api.clear();
  api.addPanel({ id: "web", component: "web", tabComponent: "fixed", title: "Web" });
  addLists(api);
}
/** the groups that hold a kind of pane; a hidden one stays in the layout */
export const groupsOf = (api: DockviewApi, kind: "lists" | "detail") => [
  ...new Set(api.panels.filter((p) => p.api.component === kind).map((p) => p.group)),
];

function restore(api: DockviewApi, keep: ReadonlySet<string>) {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LAY);
    if (raw) api.fromJSON(JSON.parse(raw));
  } catch {
    raw = null;
  }
  if (!raw || !api.getPanel("web")) return defaultLayout(api);
  for (const p of [...api.panels])
    if (p.api.component === "detail" && !keep.has(p.id)) api.removePanel(p);
}

export interface RunDockProps {
  parts: DockParts;
  /** this run's windows at mount: their panels come back */
  wins: readonly Win[];
  onReady: (api: DockviewApi) => void;
  /** a window's tab closed */
  onGone: (win: string) => void;
  /** a window's tab came to the front */
  onFocus: (win: string) => void;
  /** sizes, visibility, a fill or a float changed */
  onLayout: () => void;
}

export function RunDock({ parts, wins, onReady, onGone, onFocus, onLayout }: RunDockProps) {
  const cb = useRef({ onGone, onFocus, onLayout });
  cb.current = { onGone, onFocus, onLayout };
  // dockview disposes in a passive effect: this runs first, so its unmount closes no window
  const dead = useRef(false);
  useLayoutEffect(
    () => () => {
      dead.current = true;
    },
    [],
  );
  const apiRef = useRef<DockviewApi | null>(null);
  const ready = ({ api }: DockviewReadyEvent) => {
    apiRef.current = api;
    restore(api, new Set(wins.map((w) => w.id)));
    let t: ReturnType<typeof setTimeout> | undefined;
    api.onDidLayoutChange(() => {
      if (dead.current) return;
      cb.current.onLayout();
      clearTimeout(t);
      t = setTimeout(() => {
        if (dead.current) return;
        try {
          localStorage.setItem(LAY, JSON.stringify(api.toJSON()));
        } catch {
          /* private mode */
        }
      }, 300);
    });
    // a move between groups removes then adds: gone only if it is gone after
    api.onDidRemovePanel((p) => {
      if (dead.current || p.api.component !== "detail") return;
      queueMicrotask(() => {
        if (!dead.current && !api.getPanel(p.id)) cb.current.onGone(p.id);
      });
    });
    api.onDidActivePanelChange(() => {
      const p = api.activePanel;
      if (!dead.current && p?.api.component === "detail") cb.current.onFocus(p.id);
    });
    onReady(api);
  };
  return (
    <Parts.Provider value={parts}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click a tab fills the dock, as an IDE does; the fill button does it by key */}
      <div
        className="rg-dock"
        onDoubleClick={(e) => {
          if (!(e.target as Element).closest(".dv-tab")) return;
          const g = (e.target as Element).closest(".dv-groupview");
          const grp = apiRef.current?.groups.find((x) => x.element === g || x.element.contains(g));
          if (!grp || grp.api.location.type === "floating") return;
          grp.api.isMaximized() ? grp.api.exitMaximized() : grp.api.maximize();
        }}
      >
        <DockviewReact
          theme={THEME}
          components={PANES}
          tabComponents={TABS}
          rightHeaderActionsComponent={Acts}
          onReady={ready}
        />
      </div>
    </Parts.Provider>
  );
}
