/**
 * A detail window's layout (WA-1315): Split puts the source left, its findings right and the
 * title card under both, each edge draggable (react-resizable-panels; sizes kept per viewer);
 * Stack is the old column. Narrow windows always stack.
 */
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

export type Lay = "split" | "stack";
const KEY = "weaver-panel-lay";
/** under this width a left/right split reads worse than a column */
const SPLIT_MIN_PX = 560;

// one choice for every window; storage can be missing (private window, preview)
const subs = new Set<() => void>();
let mem: Lay | null = null;
function readLay(): Lay {
  if (mem) return mem;
  try {
    mem = localStorage.getItem(KEY) === "stack" ? "stack" : "split";
  } catch {
    mem = "split";
  }
  return mem;
}
function writeLay(l: Lay) {
  mem = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {}
  for (const f of subs) f();
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** The chosen layout, whether this window is wide enough to split, and a ref for its box. */
export function useLay() {
  const lay = useSyncExternalStore(subscribe, readLay, () => "split" as Lay);
  const box = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const el = box.current?.closest(".rg-panel") ?? box.current;
    if (el) setWide(el.getBoundingClientRect().width >= SPLIT_MIN_PX);
  }, []);
  useEffect(() => {
    const el = box.current?.closest(".rg-panel") ?? box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setWide(e.contentRect.width >= SPLIT_MIN_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { lay, wide, split: wide && lay === "split", set: writeLay, box };
}

/** Split: the side and the main column, the title card under both. */
export function SplitBody({
  side,
  main,
  head,
}: {
  side: ReactNode;
  main: ReactNode;
  head: ReactNode;
}) {
  return (
    <PanelGroup direction="vertical" autoSaveId="weaver-split-v" className="sp">
      <Panel minSize={30} defaultSize={74}>
        <PanelGroup direction="horizontal" autoSaveId="weaver-split-h">
          <Panel minSize={18} defaultSize={40} className="sp-side">
            {side}
          </Panel>
          <PanelResizeHandle className="sp-h" aria-label="Resize the columns" />
          <Panel minSize={30} defaultSize={60} className="sp-main">
            {main}
          </Panel>
        </PanelGroup>
      </Panel>
      <PanelResizeHandle className="sp-v" aria-label="Resize the title card" />
      <Panel minSize={10} defaultSize={26} className="sp-head">
        {head}
      </Panel>
    </PanelGroup>
  );
}
