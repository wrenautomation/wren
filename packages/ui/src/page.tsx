/**
 * Composite pages. A page is a tree of nodes, each a widget or a group of nodes, and one
 * renderer walks it: a client's layout, the demo's and the console's are different trees over
 * the same widgets. A widget never fetches. Its `source` names an allowlisted view or a portal
 * handler, and the page's `load` reads it, so a card, a CSV export and an agent read one answer.
 */
import { cn } from "cn";
import { type ReactNode, Suspense, use, useState } from "react";
import { type Access, can, type Viewer } from "./access.js";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "./components/ui/card.js";
import { Skeleton } from "./components/ui/skeleton.js";
import { Button } from "./controls.js";

export type Size = "s" | "m" | "l" | "full";
export type Source =
  | { view: string; params?: Record<string, unknown> }
  | { handler: string; input?: Record<string, unknown> };

/** What a widget's View gets. Typing its props with this lets any `Widget<T>` sit in a `Node`. */
export interface WidgetProps<T> {
  data: T;
  size: Size;
}

export interface Widget<T = unknown> {
  kind: "widget";
  /** Unique on its page: "pipeline.funnel". */
  id: string;
  title: string;
  source: Source;
  /** Draws what `source` answered. A method, so a widget of any data fits a `Node`. */
  View(props: WidgetProps<T>): ReactNode;
  size?: Size;
  requires?: Access;
}

export interface Group {
  kind: "group";
  title?: string;
  layout: "row" | "grid" | "stack";
  children: Node[];
  requires?: Access;
}

export type Node = Widget | Group;

/** Something to do. A button, the ⌘K palette and a form all read this one definition. */
export interface Action {
  id: string;
  label: string;
  /** The portal handler it calls: "delivery/approve". */
  handler: string;
  /** The handler's zod schema, for a generated form. */
  input?: unknown;
  requires?: Access;
  /** Asked before it runs. */
  confirm?: string;
}

type Answer = { data: unknown } | { error: string };

interface TreeProps {
  viewer: Viewer;
  read: (source: Source) => Promise<Answer>;
  /** Downloads a view-backed widget's rows as CSV; its button shows only when given. */
  csv?: ((view: string, name: string) => void) | undefined;
}

const LAYOUT = {
  row: "grid gap-4 md:auto-cols-fr md:grid-flow-col",
  grid: "grid gap-4 md:grid-cols-2",
  stack: "flex flex-col gap-4",
};
const SPAN: Record<Size, string> = { s: "", m: "", l: "md:col-span-2", full: "col-span-full" };

/** Draws `node` for `viewer`: what they can't see is left out, each source is read once. */
export function PageTree({
  node,
  viewer,
  load,
  csv,
}: {
  node: Node;
  viewer: Viewer;
  load: (source: Source) => Promise<unknown>;
  csv?: TreeProps["csv"];
}) {
  const [answers] = useState(() => new Map<string, Promise<Answer>>());
  const read = (source: Source) => {
    const key = JSON.stringify(source);
    let answer = answers.get(key);
    if (!answer) {
      answer = load(source).then(
        (data) => ({ data }),
        (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }),
      );
      answers.set(key, answer);
    }
    return answer;
  };
  return <Tree node={node} viewer={viewer} read={read} csv={csv} />;
}

function Tree({ node, ...tree }: TreeProps & { node: Node }) {
  if (!can(tree.viewer, node.requires)) return null;
  if (node.kind === "widget") return <WidgetCard widget={node} {...tree} />;
  return (
    <section className="flex flex-col gap-3">
      {node.title ? (
        <h2 className="text-[11.5px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]">
          {node.title}
        </h2>
      ) : null}
      <div className={LAYOUT[node.layout]}>
        {node.children.map((child, i) => (
          <Tree
            key={child.kind === "widget" ? child.id : `${child.title ?? "group"}-${i}`}
            node={child}
            {...tree}
          />
        ))}
      </div>
    </section>
  );
}

function WidgetCard({ widget, read, csv }: TreeProps & { widget: Widget }) {
  const size = widget.size ?? "m";
  const source = widget.source;
  return (
    <Card className={cn("min-w-0", SPAN[size])} data-widget={widget.id}>
      <CardHeader>
        <CardTitle>{widget.title}</CardTitle>
        {csv && "view" in source ? (
          <CardAction>
            <Button
              tone="quiet"
              size="sm"
              icon="download"
              onClick={() => csv(source.view, widget.id)}
            >
              CSV
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        <Suspense fallback={<Skeleton className="h-24 w-full" />}>
          <Body answer={read(source)} widget={widget} size={size} />
        </Suspense>
      </CardContent>
    </Card>
  );
}

function Body({ answer, widget, size }: { answer: Promise<Answer>; widget: Widget; size: Size }) {
  const a = use(answer);
  if ("error" in a) return <p className="text-sm text-(--ui-bad)">{a.error}</p>;
  return <widget.View data={a.data} size={size} />;
}
