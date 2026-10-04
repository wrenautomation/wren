/**
 * Composite pages. A page is a tree of nodes, each a widget or a group of nodes, and one
 * renderer walks it: a client's layout, the demo's and the console's are different trees over
 * the same widgets. A widget never fetches. Its `source` names an allowlisted view or a portal
 * handler, and the page's `load` reads it, so a card, a CSV export and an agent read one answer.
 * A View offers buttons through `act`; the page's `call` runs them and the widget reads again.
 */
import { cn } from "cn";
import { type ReactNode, Suspense, startTransition, use, useState } from "react";
import { type Access, can, type Viewer } from "./access.js";
import { ActionButton, type Call } from "./action.js";
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
  /**
   * A button for `action` on `input` (a row's id): it runs, then this widget reads again.
   * Nothing when the page has no `call` or the viewer may not.
   */
  act: (action: Action, input?: Record<string, unknown>) => ReactNode;
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
  /**
   * A text asked before it runs, into `field` of the input: "why" for a pause, the draft for an
   * approve. It starts from the input's own `field` and goes only when changed, so an untouched
   * draft isn't sent as an edit.
   */
  ask?: { field: string; label: string };
  /** The toast after it worked, from the handler's answer. */
  done?: (answer: unknown) => string;
  /**
   * The rest is for a record's action, called as `{ids}`; an answer's `done` ids are the ones
   * it changed. Its shortcut in a list or a queue: "a".
   */
  key?: string;
  /** Offered on a selection. */
  bulk?: true;
  /**
   * The handler that reverses it, on the same ids. Given, the action runs at once with 10 seconds
   * to undo it; without one, it asks first (`confirm`, or its label).
   */
  undo?: string;
  /** The states a record must be in for it to apply: `{ status: ["awaiting"] }`. */
  when?: Readonly<Record<string, readonly string[]>>;
  /** What it sets on a record, so the demo can do it in the browser: `{ status: "approved" }`. */
  sets?: Readonly<Record<string, string>>;
}

type Answer = { data: unknown } | { error: string };

interface TreeProps {
  viewer: Viewer;
  read: (source: Source) => Promise<Answer>;
  /** Forgets a source's answer and draws again, keeping the old answer up until the new one is in. */
  reread: (source: Source) => void;
  /** Downloads a view-backed widget's rows as CSV; its button shows only when given. */
  csv?: ((view: string, name: string) => void) | undefined;
  /** Runs a widget's actions; absent, `act` offers none. */
  call?: Call | undefined;
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
  call,
}: {
  node: Node;
  viewer: Viewer;
  load: (source: Source) => Promise<unknown>;
  csv?: TreeProps["csv"];
  call?: Call;
}) {
  const [answers] = useState(() => new Map<string, Promise<Answer>>());
  const [, redraw] = useState(0);
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
  const reread = (source: Source) =>
    startTransition(() => {
      answers.delete(JSON.stringify(source));
      redraw((n) => n + 1);
    });
  return <Tree node={node} viewer={viewer} read={read} reread={reread} csv={csv} call={call} />;
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

function WidgetCard({ widget, viewer, read, reread, csv, call }: TreeProps & { widget: Widget }) {
  const size = widget.size ?? "m";
  const source = widget.source;
  const act: WidgetProps<unknown>["act"] = (action, input) =>
    call ? (
      <ActionButton
        action={action}
        input={input}
        viewer={viewer}
        call={call}
        after={() => reread(source)}
      />
    ) : null;
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
          <Body answer={read(source)} widget={widget} size={size} act={act} />
        </Suspense>
      </CardContent>
    </Card>
  );
}

function Body({
  answer,
  widget,
  ...props
}: Omit<WidgetProps<unknown>, "data"> & { answer: Promise<Answer>; widget: Widget }) {
  const a = use(answer);
  if ("error" in a) return <p className="text-sm text-(--ui-bad)">{a.error}</p>;
  return <widget.View data={a.data} {...props} />;
}
