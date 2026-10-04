/**
 * A page declared as data (`template: "list"` or `"queue"`), drawn by @wren/ui's templates.
 * The record type's product serves it at /api/<product>/records*; the address is the state.
 * On the demo, actions run on a copy in the browser; a reload resets it.
 */
import type { Row } from "@wren/core/records/serve";
import {
  type LocalRecords,
  localRecords,
  type Place,
  RecordList,
  RecordPage,
  RecordQueue,
  type RecordsApi,
} from "@wren/ui";
import { useEffect } from "react";
import { call } from "./api.js";
import type { ListPage, PageProps } from "./module.js";
import { href, navigate } from "./route.js";

const APIS = new Map<string, RecordsApi>();
/** The four record calls for a product and client, made once so their types are asked once. */
function apiOf(product: string, client: string): RecordsApi {
  const key = `${product}:${client}`;
  let api = APIS.get(key);
  if (!api) {
    const ask = <T,>(handler: string, body: object) =>
      call<T>(`${product}/${handler}`, { client, ...body });
    api = {
      types: () => ask("recordsTypes", {}),
      list: (a) => ask("recordsList", a),
      get: (a) => ask("recordsGet", a),
      export: (a) => ask("recordsExport", a),
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

export function TemplatePage({
  page,
  path,
  id,
  ...props
}: PageProps & { page: ListPage; path: string; id: string | undefined }) {
  const { params } = props;
  const old = page.legacy?.(params) ?? null;
  useEffect(() => {
    if (old) navigate(href(path, old, params), true);
  });
  if (old) return null;

  const here = id ? `${path}/${encodeURIComponent(id)}` : path;
  const place: Place = {
    params,
    link: (change) => href(here, change, params),
    page: (rid) => `${path}/${encodeURIComponent(String(rid))}`,
    list: path,
    go: navigate,
  };
  const { extras, actions = [] } = page;
  const product = page.record.split(".")[0] ?? "";
  const local = props.demo ? localOf(product, props.client) : null;
  const shared = {
    record: page.record,
    api: local?.api ?? apiOf(product, props.client),
    place,
    acts: {
      actions,
      viewer: { team: props.team, demo: props.demo },
      call:
        local?.callFor(page.record, actions) ??
        ((handler: string, input: Record<string, unknown>) =>
          call(handler, { client: props.client, ...input })),
    },
    empty: page.empty,
    columns: page.columns,
    extras: extras && ((detail: unknown, row: Row) => extras(detail, { ...props, row })),
  };
  if (id) return <RecordPage {...shared} id={id} />;
  return page.template === "queue" ? <RecordQueue {...shared} /> : <RecordList {...shared} />;
}
