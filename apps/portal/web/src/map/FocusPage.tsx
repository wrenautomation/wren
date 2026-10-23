/**
 * A focus page (designs/2026-10-23-focus-view.md, F1; artifact section 13, `.app.focus`): one part
 * of the Map at `/map/<kind>/<id>`. The crumbs lead back up and Esc goes up one. The map draws the
 * part only, with stubs to where people come from and go to; a stub or a station focuses that part.
 * Beside it, the Attached panel: the part's own attachments, its stations', and the apps it opens.
 * Under it, the people on the part now and its numbers. Attach and remove save a shape version.
 */
import { ATTACH_KINDS, ATTACH_LABEL_MAX, ATTACH_REF_MAX, type Attach } from "@wren/pipeline/metro";
import { Alert, Button, FormKept, LoadFailed, SelectField, TextField, useEditForm } from "@wren/ui";
import { MetroMap, type MetroPart, type MetroPick, MetroSkeleton } from "@wren/ui/metro";
import { Fragment, useEffect, useMemo, useState } from "react";
import { call } from "../api.js";
import { type PageProps, WREN } from "../module.js";
import { atOf } from "../modules/deals/board.js";
import { go, navigate } from "../route.js";
import { attachHref, type Focus, focusHref, focusNumbers, focusOf, focusPeople } from "./focus.js";
import { type MapData, mayEditShape, windowOf } from "./model.js";
import { Numbers, PeopleHere } from "./NodePanel.js";
import { messageOf, Refused } from "./Refused.js";
import { useMap } from "./read.js";
import { opensOf, panelParams } from "./routes.js";
import { viewOf } from "./view.js";

const PAD = "px-[clamp(12px,2.5vw,24px)]";
const KIND_WORD: Record<Attach["kind"], string> = {
  sop: "SOP",
  link: "Link",
  page: "Page",
  funnel: "Funnel",
  doc: "Doc",
  template: "Tmpl",
  note: "Note",
};

/** True when a key press belongs to a field or an open dialog, not to the page. */
const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return (
    !!t?.closest("input, textarea, select, [contenteditable=true]") ||
    !!document.querySelector("[role=dialog], [role=alertdialog]")
  );
};

/** One attachment row (artifact `.ai`): the kind chip, the label, the ref. */
function AttachRow({ a, onRemove }: { a: Attach; onRemove?: (() => void) | undefined }) {
  const to = attachHref(a);
  const name = a.label ?? a.ref;
  return (
    <li className="flex items-center gap-2.5 text-[13px]">
      <span className="min-w-[34px] rounded-(--ui-leaf-chip) bg-(--ui-wash) px-1.5 py-1 text-center text-[10px] font-bold tracking-[.04em] text-(--ui-link) uppercase">
        {KIND_WORD[a.kind]}
      </span>
      <span className="min-w-0 flex-1">
        {to ? (
          <a
            href={to}
            {...(to.startsWith("https://") ? { target: "_blank", rel: "noreferrer" } : {})}
            className="block font-semibold wrap-anywhere text-(--ui-ink) no-underline hover:underline"
          >
            {name}
          </a>
        ) : (
          <b className="block font-semibold wrap-anywhere">{name}</b>
        )}
        {a.label ? (
          <span className="block text-[12px] wrap-anywhere text-(--ui-ink-3)">{a.ref}</span>
        ) : null}
      </span>
      {onRemove ? (
        <Button tone="quiet" size="dense" aria-label={`Remove ${name}`} onClick={onRemove}>
          Remove
        </Button>
      ) : null}
    </li>
  );
}

/** The `+ Attach` form: kind, ref, label. Saved as one shape version. */
function AttachForm({
  focus,
  at,
  client,
  onSaved,
  onCancel,
}: {
  focus: Focus;
  at: Record<string, string>;
  client: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { part } = focus;
  const form = useEditForm({
    key: `map:attach:${client}:${part.kind}:${part.id}`,
    defaults: { kind: "link", ref: "", label: "" },
  });
  const send = form.onSend(
    async (v) => {
      const label = v.label.trim();
      await call("pipeline/shapeAttach", {
        ...at,
        on: part.kind,
        id: part.id,
        add: { kind: v.kind, ref: v.ref.trim(), ...(label ? { label } : {}) },
      });
      onSaved();
    },
    { clear: true },
  );
  return (
    <form
      aria-label={`Attach to ${focus.name}`}
      className="grid gap-2 rounded-(--ui-radius) bg-(--ui-wash) p-3"
      onSubmit={(e) => void send(e)}
    >
      <SelectField
        form={form}
        name="kind"
        aria-label="Kind"
        options={ATTACH_KINDS.map((k) => [k, KIND_WORD[k] === "Tmpl" ? "Template" : KIND_WORD[k]])}
      />
      <TextField
        form={form}
        name="ref"
        autoFocus
        maxLength={ATTACH_REF_MAX}
        aria-label="Ref"
        placeholder="An https:// link or an id"
      />
      <TextField
        form={form}
        name="label"
        maxLength={ATTACH_LABEL_MAX}
        aria-label="Label"
        placeholder="Label (optional)"
      />
      <FormKept form={form} />
      {form.error ? <Alert className="mb-0">{form.error}</Alert> : null}
      <div className="flex gap-2">
        <Button
          tone="primary"
          size="dense"
          type="submit"
          busy={form.formState.isSubmitting}
          disabled={!form.watch("ref").trim()}
        >
          Attach
        </Button>
        <Button tone="quiet" size="dense" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The Attached panel (artifact `.att`). */
function Attached({
  focus,
  data,
  props,
  mayEdit,
  onSaved,
}: {
  focus: Focus;
  data: MapData;
  props: PageProps;
  mayEdit: boolean;
  onSaved: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const at = atOf(props.client);
  const wren = props.client === WREN.id;
  const own = focus.own;
  const count = (own?.length ?? 0) + focus.inside.reduce((n, s) => n + s.attach.length, 0);
  // The apps the part's stations open, one row each, in station order.
  const apps = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of focus.stations) {
      const node = data.body.nodes.find((n) => n.id === s.id);
      if (!node) continue;
      for (const o of opensOf(node, wren ? "wren" : "client", wren ? null : props.client))
        if (!seen.has(o.label)) seen.set(o.label, o.href);
    }
    return [...seen];
  }, [focus, data, wren, props.client]);
  const remove = async (ref: string) => {
    setRefused(null);
    try {
      await call("pipeline/shapeAttach", {
        ...at,
        on: focus.part.kind,
        id: focus.part.id,
        remove: ref,
      });
      onSaved();
    } catch (err) {
      setRefused(messageOf(err));
    }
  };
  return (
    <section
      aria-label="Attached"
      className="grid content-start gap-2 border-l border-(--ui-hair) bg-[color-mix(in_srgb,var(--ui-canvas)_40%,var(--ui-paper))] px-3.5 py-4 max-[760px]:border-t max-[760px]:border-l-0"
    >
      <h2 className="mt-1 mb-0.5 text-[13.5px] font-[650]">
        Attached <span className="ml-1.5 font-semibold text-(--ui-ink-3)">{count}</span>
      </h2>
      {own?.length ? (
        <ul className="grid list-none gap-2">
          {own.map((a) => (
            <AttachRow
              key={`${a.kind}:${a.ref}`}
              a={a}
              onRemove={mayEdit ? () => void remove(a.ref) : undefined}
            />
          ))}
        </ul>
      ) : own ? (
        <p className="text-[13px] text-(--ui-ink-3)">Nothing on {focus.name} itself.</p>
      ) : null}
      {focus.inside.map((s) => (
        <Fragment key={s.id}>
          <h3 className="mt-1 text-[12.5px] font-semibold text-(--ui-ink-2)">
            <a
              href={focusHref({ kind: "station", id: s.id }, props.params)}
              className="text-inherit"
            >
              {s.label}
            </a>
          </h3>
          <ul className="grid list-none gap-2">
            {s.attach.map((a) => (
              <AttachRow key={`${a.kind}:${a.ref}`} a={a} />
            ))}
          </ul>
        </Fragment>
      ))}
      {apps.length ? (
        <>
          <h2 className="mt-1 mb-0.5 text-[13.5px] font-[650]">Apps</h2>
          <ul className="grid list-none gap-2">
            {apps.map(([label, to]) => (
              <li key={label} className="flex items-center gap-2.5 text-[13px]">
                <span className="min-w-[34px] rounded-(--ui-leaf-chip) bg-(--ui-wash) px-1.5 py-1 text-center text-[10px] font-bold tracking-[.04em] text-(--ui-ink-2) uppercase">
                  App
                </span>
                <a href={to} className="font-semibold text-(--ui-ink) no-underline hover:underline">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {refused ? <Refused text={refused} /> : null}
      {mayEdit && own ? (
        adding ? (
          <AttachForm
            focus={focus}
            at={at}
            client={props.client}
            onSaved={() => {
              setAdding(false);
              onSaved();
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-1.5 cursor-pointer rounded-(--ui-leaf-button) border border-dashed border-(--ui-ink-3) bg-transparent px-2.5 py-[7px] text-left text-[13px] font-[650] text-(--ui-link)"
          >
            + Attach
          </button>
        )
      ) : null}
    </section>
  );
}

export function FocusPage({ props, part }: { props: PageProps; part: MetroPart }) {
  const window = windowOf(props.params.get("window"));
  const read = useMap(props.client, window);
  const data: MapData | null = read.data?.map ?? null;
  const metro = data?.metro ?? null;
  const focus = useMemo(() => (metro ? focusOf(metro, part) : null), [metro, part]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `data` is the read this moment belongs to
  const now = useMemo(() => new Date(), [data]);
  const view = useMemo(
    () => (data && metro ? viewOf(metro, data, data.people, now) : null),
    [data, metro, now],
  );
  const mayEdit = mayEditShape(props);
  const to = (p: MetroPart | null) => navigate(focusHref(p, props.params));
  const upPart = focus?.up.part ?? null;

  // Esc goes up one crumb, unless a field or a dialog has it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || typing(e)) return;
      navigate(focusHref(upPart, props.params));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [upPart, props.params]);

  const onPick = (p: MetroPick) => {
    if (p.kind === "station") to({ kind: "station", id: p.id });
    // A track's panel lives on the whole Map.
    else if (p.kind === "track") go("/", panelParams({ kind: "track", id: p.id }), props.params);
  };

  const label = focus ? `${focus.word} · ${focus.name}` : "Focus";
  useEffect(() => {
    document.title = `${label} · Wren Client Portal`;
  }, [label]);

  if (read.error && !read.data)
    return (
      <div className="p-5">
        <LoadFailed error={read.error} onRetry={read.retry} what="map" />
      </div>
    );
  if (!read.data) return <MetroSkeleton />;
  if (!data || !metro || !focus || !view)
    return (
      <div className={`${PAD} grid gap-2 py-6 text-[14.5px] text-(--ui-ink-2)`}>
        <p>
          The newest version of the shape has no {part.kind} called "{part.id}".
        </p>
        <p>
          <a href={focusHref(null, props.params)}>Back to the Map</a>
        </p>
      </div>
    );

  const numbers = focusNumbers(data, focus);
  const people = focusPeople(data, focus);
  return (
    <section
      aria-label={`${focus.word} ${focus.name}`}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)_250px] max-[760px]:grid-cols-[minmax(0,1fr)]"
    >
      <div className={`${PAD} grid min-w-0 content-start gap-3.5 py-[18px]`}>
        <header className="flex flex-wrap items-end justify-between gap-2.5">
          <div className="grid gap-1">
            <nav aria-label="Breadcrumb">
              <ol className="flex list-none flex-wrap gap-1 text-[13px] text-(--ui-ink-3)">
                {focus.crumbs.map((c, i) => {
                  const last = i === focus.crumbs.length - 1;
                  return (
                    <li key={c.part ? `${c.part.kind}:${c.part.id}` : "map"} className="flex gap-1">
                      {i ? <span aria-hidden="true">›</span> : null}
                      {last ? (
                        <b aria-current="page" className="text-(--ui-ink)">
                          {c.label}
                        </b>
                      ) : (
                        <a href={focusHref(c.part, props.params)} className="text-inherit">
                          {c.label}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
            <h1 className="text-[22px] tracking-[-.02em]">{focus.name}</h1>
            <p className="text-[13.5px] text-(--ui-ink-2)">
              {focus.word} · {numbers.join(" · ")}
            </p>
          </div>
        </header>
        <MetroMap
          view={view}
          focus={part}
          onStub={to}
          onPick={onPick}
          controls={false}
          intro={false}
          className="metro-fit"
        />
        <div className="grid gap-4 text-[14px] sm:grid-cols-2">
          {part.kind === "flow" ? null : (
            <PeopleHere people={people} at={atOf(props.client)} level={2} />
          )}
          <Numbers lines={numbers} window={window} />
        </div>
      </div>
      <Attached
        focus={focus}
        data={data}
        props={props}
        mayEdit={mayEdit && !!focus.own}
        onSaved={read.retry}
      />
    </section>
  );
}
