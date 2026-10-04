/**
 * A page declared as data (`template: "list"`, `"queue"` or `"overview"`), drawn by @wren/ui's
 * templates. The record type's product serves it at /api/<product>/records*; in Wren's own
 * workspace the console serves every record. The address is the state. On the demo, actions run
 * on a copy in the browser; a reload resets it.
 */
import type { Row } from "@wren/core/records/serve";
import {
  type LocalRecords,
  localRecords,
  type Place,
  RecordList,
  RecordOverview,
  RecordPage,
  RecordQueue,
  type RecordsApi,
} from "@wren/ui";
import { useEffect } from "react";
import { call } from "./api.js";
import { type ListPage, type OverviewPage, type PageProps, WREN } from "./module.js";
import { href, navigate } from "./route.js";

const APIS = new Map<string, RecordsApi>();
/** The record calls for a product and client (none for Wren's own), made once so types are asked once. */
function apiOf(product: string, client: string | null): RecordsApi {
  const key = `${product}:${client}`;
  let api = APIS.get(key);
  if (!api) {
    const ask = <T,>(handler: string, body: Record<string, unknown>) =>
      call<T>(`${product}/${handler}`, client ? { client, ...body } : body);
    api = {
      types: () => ask("recordsTypes", {}),
      list: (a) => ask("recordsList", { ...a }),
      get: (a) => ask("recordsGet", { ...a }),
      export: (a) => ask("recordsExport", { ...a }),
      stats: (a) => ask("recordsStats", { ...a }),
    };
    APIS.set(key, api);
  }
  return api;
}

const LOCAL = new Map<string, LocalRecords>();
/** The demo's copy: one per product and client, gone on reload. */
function localOf(product: string, client: string): LocalRecords {
  const key = `${product}:${client}`;
  const local = LOCAL.get(key) ?? localRecords(apiOf(product, client));
  LOCAL.set(key, local);
  return local;
}

type Input = Record<string, unknown>;
const loop = (id: string, run: boolean): [string, Input] => {
  const at = id.indexOf("/");
  return ["console/setLoop", { service: id.slice(0, at), key: id.slice(at + 1), run }];
};
/**
 * Actions whose handler takes one record, not `{ ids }`: the handler it calls for each id, and
 * with what. A loop's id is "<service>/<key>"; an inbox's, its address.
 */
const ONE: Record<string, (id: string, input: Input) => [string, Input]> = {
  "console/startLoop": (id) => loop(id, true),
  "console/stopLoop": (id) => loop(id, false),
  "email/approve": (id, { body }) => [
    "email/approve",
    { id: Number(id), ...(body ? { body } : {}) },
  ],
  "email/drop": (id) => ["email/drop", { id: Number(id) }],
  "email/pause": (id, { reason }) => ["email/pause", { target: id, reason }],
  "email/resume": (id) => ["email/resume", { target: id }],
};

/** Each id in turn; one alone says why it failed, several say which were skipped. */
async function eachOf(one: (id: string, input: Input) => [string, Input], input: Input) {
  const ids = (input.ids ?? []) as (string | number)[];
  const done: (string | number)[] = [];
  const skipped: (string | number)[] = [];
  for (const id of ids) {
    const [handler, body] = one(String(id), input);
    try {
      await call(handler, body);
      done.push(id);
    } catch (err) {
      if (ids.length === 1) throw err;
      skipped.push(id);
    }
  }
  return { done, skipped };
}

export function TemplatePage({
  page,
  path,
  id,
  app,
  ...props
}: PageProps & {
  page: ListPage | OverviewPage;
  path: string;
  id: string | undefined;
  app: string;
}) {
  const { params } = props;
  const old = ("legacy" in page && page.legacy?.(params)) || null;
  useEffect(() => {
    if (old) navigate(href(path, old, params), true);
  });
  if (old) return null;

  const wren = props.client === WREN.id;
  const client = wren ? null : props.client;
  const record = page.template === "overview" ? (page.tiles[0]?.record ?? "") : page.record;
  const product = wren ? "console" : (record.split(".")[0] ?? "");
  if (page.template === "overview")
    return (
      <RecordOverview title={app} api={apiOf(product, client)} tiles={page.tiles} top={page.top} />
    );

  const here = id ? `${path}/${encodeURIComponent(id)}` : path;
  const place: Place = {
    params,
    link: (change) => href(here, change, params),
    page: (rid) => `${path}/${encodeURIComponent(String(rid))}`,
    list: path,
    go: navigate,
  };
  const { extras, actions = [] } = page;
  const local = props.demo && client ? localOf(product, client) : null;
  const shared = {
    record: page.record,
    api: local?.api ?? apiOf(product, client),
    place,
    acts: {
      actions,
      viewer: { team: props.team, demo: props.demo },
      call:
        local?.callFor(page.record, actions) ??
        ((handler: string, input: Input) => {
          const one = ONE[handler];
          if (one) return eachOf(one, input);
          return call(handler, client ? { client, ...input } : input);
        }),
    },
    empty: page.empty,
    columns: page.columns,
    extras: extras && ((detail: unknown, row: Row) => extras(detail, { ...props, row })),
    head: page.head,
  };
  if (id) return <RecordPage {...shared} id={id} />;
  return page.template === "queue" ? <RecordQueue {...shared} /> : <RecordList {...shared} />;
}
