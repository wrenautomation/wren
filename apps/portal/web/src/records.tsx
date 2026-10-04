/**
 * A page declared as data (`template: "list"`), drawn by @wren/ui's List and Record templates.
 * The record type's product serves it at /api/<product>/records*; the address is the state.
 */
import type { Row } from "@wren/core/records/serve";
import { type Place, RecordList, RecordPage, type RecordsApi } from "@wren/ui";
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
  const { extras } = page;
  const shared = {
    record: page.record,
    api: apiOf(page.record.split(".")[0] ?? "", props.client),
    place,
    empty: page.empty,
    columns: page.columns,
    extras: extras && ((detail: unknown, row: Row) => extras(detail, { ...props, row })),
  };
  return id ? <RecordPage {...shared} id={id} /> : <RecordList {...shared} />;
}
