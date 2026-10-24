/**
 * A focus page (designs/2026-10-23-focus-view.md, F1 and F2; artifact section 13, `.app.focus`):
 * one part of the Map at `/map/<kind>/<id>`, a set at `/map/parts/<parts>`, a saved view at
 * `/map/view/<id>`. The crumbs lead back up and Esc goes up one. The map draws the
 * part only, with stubs to where people come from and go to; a stub or a station focuses that part.
 * Beside it, the Attached panel: the part's own attachments, its stations', and the apps it opens.
 * Under it, the people on the part now and its numbers. Attach and remove save a shape version.
 */
import {
  ATTACH_KINDS,
  ATTACH_LABEL_MAX,
  ATTACH_REF_MAX,
  type Attach,
  type MetroBody,
} from "@wren/pipeline/metro";
import { MAP_VIEW_RECORD, partsParam, readPart } from "@wren/pipeline/metro-parts";
import {
  Alert,
  Button,
  CHIP,
  CHIP_ON,
  FormKept,
  Icon,
  LoadFailed,
  SaveViewPop,
  SELECT_CLASS,
  SelectField,
  TextField,
  useEditForm,
  usePref,
} from "@wren/ui";
import { MetroMap, type MetroPart, type MetroPick, MetroSkeleton } from "@wren/ui/metro";
import { Fragment, useEffect, useMemo, useState } from "react";
import { call } from "../api.js";
import { type PageProps, WREN } from "../module.js";
import { atOf } from "../modules/deals/board.js";
import { go, navigate } from "../route.js";
import {
  attachHref,
  type Crumb,
  type Focus,
  type FocusAt,
  focusHref,
  focusNumbers,
  focusOf,
  focusPeople,
} from "./focus.js";
import { type MapData, mayEditShape, windowOf } from "./model.js";
import { Numbers, PeopleHere } from "./NodePanel.js";
import { messageOf, Refused } from "./Refused.js";
import { useMap } from "./read.js";
import { opensOf, panelParams } from "./routes.js";
import { viewOf } from "./view.js";
import { MAP_HOME, mapKeepOf, useMapViews, viewParamsOf, viewPartsOf } from "./views.js";

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
  part,
  at,
  client,
  onSaved,
  onCancel,
}: {
  focus: Focus;
  part: MetroPart;
  at: Record<string, string>;
  client: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
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
  const { part } = focus;
  const remove = async (ref: string) => {
    if (!part) return;
    setRefused(null);
    try {
      await call("pipeline/shapeAttach", {
        ...at,
        on: part.kind,
        id: part.id,
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
      ) : count ? null : (
        <p className="text-[13px] text-(--ui-ink-3)">Nothing attached here.</p>
      )}
      {focus.inside.map((s) => (
        <Fragment key={`${s.part.kind}:${s.part.id}`}>
          <h3 className="mt-1 text-[12.5px] font-semibold text-(--ui-ink-2)">
            <a href={focusHref(s.part, props.params)} className="text-inherit">
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
      {mayEdit && own && part ? (
        adding ? (
          <AttachForm
            focus={focus}
            part={part}
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

/** The parts row of a set: a chip per part, × to drop it, and Add part (a line or a group). */
function PartsBar({
  metro,
  focus,
  params,
  onParts,
}: {
  metro: MetroBody;
  focus: Focus;
  params: URLSearchParams;
  onParts: (next: MetroPart[]) => void;
}) {
  const has = (p: MetroPart) => focus.parts.some((x) => x.kind === p.kind && x.id === p.id);
  const lines = metro.lines.filter((l) => !has({ kind: "line", id: l.id }));
  const groups = metro.groups.filter((g) => !has({ kind: "group", id: g.id }));
  const set = focus.parts.length > 1 || focus.word === "View";
  return (
    <ul aria-label="Parts" className="flex list-none flex-wrap items-center gap-1.5">
      {set
        ? focus.parts.map((p) => {
            const name = readPart(metro, p)?.label ?? p.id;
            return (
              <li
                key={`${p.kind}:${p.id}`}
                className="inline-flex items-center gap-1 rounded-(--ui-leaf-chip) bg-(--ui-wash) py-0.5 pr-0.5 pl-2 text-[12.5px] font-semibold"
              >
                <a href={focusHref(p, params)} className="text-(--ui-ink) no-underline">
                  {name}
                </a>
                {focus.parts.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Drop ${name}`}
                    onClick={() => onParts(focus.parts.filter((x) => x !== p))}
                    className="inline-flex size-6 cursor-pointer items-center justify-center rounded-(--ui-leaf-chip) border-0 bg-transparent text-(--ui-ink-3) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
                  >
                    <Icon name="close" size={13} />
                  </button>
                ) : null}
              </li>
            );
          })
        : null}
      {lines.length || groups.length ? (
        <li>
          <select
            aria-label="Add part"
            className={`${SELECT_CLASS} h-8 w-auto`}
            value=""
            onChange={(e) => {
              const [kind, id] = e.target.value.split("\u0000");
              if ((kind === "line" || kind === "group") && id)
                onParts([...focus.parts, { kind, id }]);
            }}
          >
            <option value="">+ Add part</option>
            {lines.length ? (
              <optgroup label="Lines">
                {lines.map((l) => (
                  <option key={l.id} value={`line\u0000${l.id}`}>
                    {l.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {groups.length ? (
              <optgroup label="Groups">
                {groups.map((g) => (
                  <option key={g.id} value={`group\u0000${g.id}`}>
                    {g.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * A focus: one part, a set of parts, or a saved view. On "/" (`home`) it is his home view: the Map
 * crumb and Whole map lead to the whole Map, and Esc stays.
 */
export function FocusPage({
  props,
  at: given,
  home = false,
}: {
  props: PageProps;
  at: FocusAt;
  home?: boolean;
}) {
  // The address is read once: a new one mounts a new page (App keys it).
  const [at] = useState(given);
  const window = windowOf(props.params.get("window"));
  const read = useMap(props.client, window);
  const data: MapData | null = read.data?.map ?? null;
  const metro = data?.metro ?? null;
  const keep = mapKeepOf(props);
  const views = useMapViews(keep);
  const homePref = usePref<number>(keep, MAP_HOME);
  const atView = "view" in at;
  // The saved view on screen, or the one these parts came from (`sv`).
  const svId = atView ? at.view : Number(props.params.get("sv")) || null;
  const saved = svId === null ? null : (views.lines.find((v) => v.id === svId) ?? null);
  const asked = useMemo(
    () => (atView ? (saved ? viewPartsOf(saved) : null) : at.parts),
    [at, atView, saved],
  );
  const focus = useMemo(
    () => (metro && asked ? focusOf(metro, asked, atView ? saved?.name : undefined) : null),
    [metro, asked, atView, saved],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `data` is the read this moment belongs to
  const now = useMemo(() => new Date(), [data]);
  const view = useMemo(
    () => (data && metro ? viewOf(metro, data, data.people, now) : null),
    [data, metro, now],
  );
  const mayEdit = mayEditShape(props);
  const mapAt = focusHref(null, props.params, home ? { whole: "1" } : {});
  const crumbAt = (c: Crumb) => (c.part ? focusHref(c.part, props.params) : mapAt);
  const to = (p: MetroPart | null) => navigate(focusHref(p, props.params));
  const toParts = (next: MetroPart[]) =>
    navigate(focusHref(next, props.params, { sv: svId === null ? null : String(svId) }));
  const up = focus ? crumbAt(focus.up) : mapAt;

  // Esc goes up one crumb, unless a field or a dialog has it. Home stays home.
  useEffect(() => {
    if (home) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || typing(e)) return;
      navigate(up);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [up, home]);

  const onPick = (p: MetroPick) => {
    if (p.kind === "station") to({ kind: "station", id: p.id });
    // A track's panel lives on the whole Map.
    else if (p.kind === "track") go("/", panelParams({ kind: "track", id: p.id }), props.params);
  };

  const label = focus ? `${focus.word} · ${focus.name}` : "Focus";
  useEffect(() => {
    if (!home) document.title = `${label} · Wren Client Portal`;
  }, [label, home]);

  if (read.error && !read.data)
    return (
      <div className="p-5">
        <LoadFailed error={read.error} onRetry={read.retry} what="map" />
      </div>
    );
  if (!read.data || (atView && !views.ready)) return <MetroSkeleton />;
  if (!data || !metro || !focus || !view || !asked) {
    const [one] = "parts" in at ? at.parts : [];
    return (
      <div className={`${PAD} grid gap-2 py-6 text-[14.5px] text-(--ui-ink-2)`}>
        <p>
          {atView && !saved
            ? `There is no saved view ${at.view} here.`
            : atView || !one || ("parts" in at && at.parts.length > 1)
              ? "The newest version of the shape holds none of these parts."
              : `The newest version of the shape has no ${one.kind} called "${one.id}".`}
        </p>
        <p>
          <a href={mapAt}>Back to the Map</a>
        </p>
      </div>
    );
  }

  const numbers = focusNumbers(data, focus);
  const people = focusPeople(data, focus);
  const gone = asked.length - focus.parts.length;
  // Save view once the parts differ from the open view; Home once they are the open view.
  const same = !!saved && partsParam(viewPartsOf(saved)) === partsParam(asked);
  const isHome = !!saved && homePref.value === saved.id;
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
                    // biome-ignore lint/suspicious/noArrayIndexKey: crumbs keep their order; a set's has no part
                    <li key={i} className="flex gap-1">
                      {i ? <span aria-hidden="true">›</span> : null}
                      {last ? (
                        <b aria-current="page" className="text-(--ui-ink)">
                          {c.label}
                        </b>
                      ) : (
                        <a href={crumbAt(c)} className="text-inherit">
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
            {gone ? (
              <p className="text-[13px] text-(--ui-ink-3)">
                {gone === 1 ? "One part" : `${gone} parts`} of this view left the shape.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {home ? (
              <a href={mapAt} className={CHIP}>
                Whole map
              </a>
            ) : null}
            {keep && saved && same ? (
              <button
                type="button"
                aria-pressed={isHome}
                onClick={() => homePref.set(isHome ? null : saved.id)}
                className={`${CHIP} ${isHome ? CHIP_ON : ""}`}
              >
                <Icon name="home" size={15} /> Home view
              </button>
            ) : null}
            {keep && views.ready && !same ? (
              <SaveViewPop
                record={MAP_VIEW_RECORD}
                params={viewParamsOf(asked)}
                keep={keep}
                open={saved ?? undefined}
                onSaved={(v) => {
                  views.reload();
                  navigate(focusHref({ view: v.id }, props.params));
                }}
              />
            ) : null}
          </div>
        </header>
        <PartsBar metro={metro} focus={focus} params={props.params} onParts={toParts} />
        <MetroMap
          view={view}
          focus={focus.parts}
          onStub={to}
          onPick={onPick}
          controls={false}
          intro={false}
          bare
          className="metro-fit"
        />
        <div className="grid gap-4 text-[14px] sm:grid-cols-2">
          {focus.part?.kind === "flow" ? null : (
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
