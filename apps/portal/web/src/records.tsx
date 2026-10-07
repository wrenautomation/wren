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
  type RecordAct,
  RecordForm,
  RecordList,
  RecordOverview,
  RecordPage,
  RecordQueue,
  RecordShop,
  type RecordsApi,
} from "@wren/ui";
import { useEffect } from "react";
import { permissionOf } from "../../src/services.js";
import { call, uploadFile } from "./api.js";
import { type ListPage, type OverviewPage, type PageProps, WREN } from "./module.js";
import { href, navigate } from "./route.js";

type Scope = { app: string; asClient: boolean };
const APIS = new Map<string, RecordsApi>();
/**
 * The record calls for a product and client (none for Wren's own), made once so types are asked
 * once. The app asking (a product's project pages show its own projects) and whether the team
 * sees it as the client does go along.
 */
function apiOf(product: string, client: string | null, scope: Scope): RecordsApi {
  const key = `${product}:${client}:${scope.app}:${scope.asClient}`;
  let api = APIS.get(key);
  if (!api) {
    const ask = <T,>(handler: string, body: Record<string, unknown>) =>
      call<T>(`${product}/${handler}`, client ? { client, ...scope, ...body } : body);
    api = {
      types: () => ask("recordsTypes", {}),
      list: (a) => ask("recordsList", { ...a }),
      get: (a) => ask("recordsGet", { ...a }),
      export: (a) => ask("recordsExport", { ...a }),
      stats: (a) => ask("recordsStats", { ...a }),
      // Edits are Wren's records' for now (`@wren/core/edits`): the console serves them.
      ...(product === "console"
        ? {
            edit: (a) => ask("recordsEdit", { ...a }),
            undo: (a) => ask("recordsUndo", { ...a }),
            ask: (a) => ask("recordsAsk", { ...a }),
          }
        : {}),
    };
    APIS.set(key, api);
  }
  return api;
}

const LOCAL = new Map<string, LocalRecords>();
/** The demo's copy: one per product and client, gone on reload. */
function localOf(product: string, client: string, scope: Scope): LocalRecords {
  const key = `${product}:${client}`;
  const local = LOCAL.get(key) ?? localRecords(apiOf(product, client, scope));
  LOCAL.set(key, local);
  return local;
}

type Input = Record<string, unknown>;
/** "12.setup" -> the project and the step (or result) key in it. */
const partsOf = (id: string) => {
  const at = id.indexOf(".");
  return { engagementId: Number(id.slice(0, at)), key: id.slice(at + 1) };
};
const step = (id: string) => {
  const { engagementId, key } = partsOf(id);
  return { engagementId, step: key };
};
const access =
  (status: string) =>
  (id: string, { note }: Input) =>
    ["delivery/access", { accessId: Number(id.slice(1)), status, ...(note ? { note } : {}) }] as [
      string,
      Input,
    ];
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
  "console/retryEvent": (id) => ["console/retryEvent", { id }],
  "console/releaseHold": (id) => ["console/releaseHold", { id }],
  "email/approve": (id, { body }) => ["email/approve", { id: num(id), ...(body ? { body } : {}) }],
  "email/drop": (id) => ["email/drop", { id: num(id) }],
  "sms/reply": (id, { body }) => ["sms/reply", { id: Number(id), body }],
  "email/pause": (id, { reason }) => ["email/pause", { target: id, reason }],
  "email/resume": (id) => ["email/resume", { target: id }],
  "delivery/done": (id) => ["delivery/done", step(id)],
  "delivery/undone": (id) => ["delivery/done", { ...step(id), on: null }],
  "delivery/slip": (id, { to, reason }) => ["delivery/slip", { ...step(id), to, reason }],
  "delivery/answer": (id, { answer, fileKey }) => [
    "delivery/answer",
    { askId: Number(id), answer, fileKey },
  ],
  "delivery/approve": (id) => [
    "delivery/decide",
    { deliverableId: Number(id), decision: "approved" },
  ],
  "delivery/changes": (id, { note }) => [
    "delivery/decide",
    { deliverableId: Number(id), decision: "changes", note },
  ],
  "delivery/version": (id, { title, url, fileKey }) => [
    "delivery/deliver",
    { replaces: Number(id), title, url, fileKey },
  ],
  "delivery/hide": (id) => ["delivery/hide", { updateId: Number(id) }],
  "delivery/invite": (id, { email }) => ["delivery/invite", { client: id, email, role: "owner" }],
  "console/teamRole": (id, { role }) => ["console/teamSet", { email: id, role }],
  "console/teamClients": (id, { clients }) => [
    "console/teamSet",
    { email: id, clients: clients ?? "" },
  ],
  "console/teamRemove": (id) => ["console/teamRemove", { email: id }],
  "delivery/grant": access("granted"),
  "delivery/revoke": access("revoked"),
  "delivery/decline": access("declined"),
  "delivery/result": (id, { value, note }) => {
    const { engagementId, key } = partsOf(id);
    return ["delivery/result", { engagementId, key, value: Number(value), note }];
  },
  "marketing/draftAgain": (id) => {
    const [ideaId, platform] = head(id, 2);
    return handlerCall(
      "ContentDesk",
      "draft",
      { ideaId, platforms: [platform], again: true },
      { key: "default" },
    );
  },
  "marketing/pause": (id, { reason }) =>
    handlerCall("Ads", "stop", { campaignId: head(id, 1)[0], ...(reason ? { reason } : {}) }),
  // It spends: the console asks for the handler's name, the action's confirm is the human's.
  "marketing/resume": (id) =>
    handlerCall("Ads", "resume", { campaignId: head(id, 1)[0] }, { confirm: "resume" }),
  "marketing/markRead": (id) => handlerCall("SmsDesk", "markRead", { contactId: num(id) }),
  // A draft's review: ContentDesk's one key, as the CLI's verdicts are one table.
  "marketing/approveDraft": (id) => desk("approve", { ids: [bare(id)] }),
  "marketing/rejectDraft": (id) => desk("reject", { ids: [bare(id)] }),
  "marketing/redraft": (id, { note }) => desk("redraft", { draftId: bare(id), note }),
  // A video's yes, from its page or the Inbox (`video:3`).
  "marketing/videoApprove": (id) => desk("approveVideo", { id: num(id) }),
  "marketing/videoApproveShort": (id, { short }) =>
    desk("approveVideo", { id: num(id), short: Number(short) }),
  "marketing/videoThumbnail": (id, { n }) => desk("pickThumbnail", { id: num(id), n: Number(n) }),
  "marketing/videoSet": (id, { patch }) => handlerCall("VideoDesk", "set", { id: num(id), patch }),
  "marketing/videoCut": (id, { from, to, state }) =>
    handlerCall("VideoDesk", "cut", { id: num(id), from, to, state }),
  "marketing/videoAsk": (id, { message }) =>
    handlerCall("VideoDesk", "ask", { id: num(id), message }),
  "marketing/videoUndo": (id) => handlerCall("VideoDesk", "undo", { id: num(id) }),
  "marketing/videoRender": (id) => handlerCall("VideoDesk", "render", { id: num(id) }),
  // A reply sends: the console asks for the handler's name. An untouched draft is the desk's.
  "marketing/dmReply": (id, { body }) =>
    handlerCall("ReachDesk", "reply", { contactId: num(id), ...words(body) }, { confirm: "reply" }),
  "marketing/dmRead": (id) => handlerCall("ReachDesk", "markRead", { contactId: num(id) }),
  // An untouched draft isn't sent: the desk answers with the draft it holds.
  "marketing/commentAnswer": (id, { body }) =>
    handlerCall(
      "ReachDesk",
      "answerComment",
      { id: num(id), ...(typeof body === "string" ? { body } : {}) },
      { confirm: "answerComment" },
    ),
  "marketing/commentDm": (id, { body }) =>
    handlerCall("ReachDesk", "dmComment", { id: num(id), body }, { confirm: "dmComment" }),
  "marketing/commentDrop": (id) => handlerCall("ReachDesk", "dropComment", { id: num(id) }),
  "marketing/activitySeen": (id) => handlerCall("SocialDesk", "markSeen", { ids: [num(id)] }),
  // Withdrawing can't be undone: the console asks first.
  "marketing/inviteWithdraw": (id) =>
    handlerCall(
      "ReachDesk",
      "withdrawInvite",
      { contactId: Number(id) },
      { confirm: "withdrawInvite" },
    ),
  "marketing/placeWatch": (id) => handlerCall("ReachDesk", "watchPlace", { subreddit: id }),
  "marketing/placeSkip": (id) => handlerCall("ReachDesk", "skipPlace", { subreddit: id }),
  "marketing/placeMove": (id, { account }) =>
    handlerCall("ReachDesk", "movePlace", { subreddit: id, account }),
  // Like an answer: an untouched draft isn't sent, the desk comments with the draft it holds.
  "marketing/threadComment": (id, { body }) =>
    handlerCall(
      "ReachDesk",
      "commentThread",
      { id: bare(id), ...words(body) },
      { confirm: "commentThread" },
    ),
  "marketing/threadSkip": (id) => handlerCall("ReachDesk", "skipThread", { id: bare(id) }),
  // A person from People: `li:<id>` or `reddit:<handle>`, read by the desk.
  "marketing/personDraft": (id) => handlerCall("ReachDesk", "draftPerson", { id }),
  "marketing/personMessage": (id, { body }) =>
    handlerCall("ReachDesk", "messagePerson", { id, ...words(body) }, { confirm: "messagePerson" }),
  "marketing/personInvite": (id) =>
    handlerCall("ReachDesk", "invitePerson", { id }, { confirm: "invitePerson" }),
  ...drafting("inbox", null),
  ...drafting("post", "draft"),
  ...drafting("comment", "comment"),
  ...drafting("thread", "thread"),
  ...drafting("dm", "dm"),
  ...drafting("invite", "invite"),
  "marketing/dmCopy": (id, input) =>
    handlerCall("ReachDesk", "setTemplate", { key: id, body: changed(input) }),
  "marketing/textCopy": (id, input) =>
    handlerCall("SmsDesk", "setTemplate", { key: id, body: changed(input) }),
};
/**
 * A draft's box (`DraftAsk`): save his words, Ask Claude, Undo. `record` is the draft's kind. An
 * Inbox id carries it ("comment:12"); a page's own id doesn't, so the page says it. A save writes
 * only over the text the box started from (`expect`), so Claude's change meanwhile isn't lost.
 */
function drafting(page: string, record: string | null) {
  const item = (id: string) =>
    record
      ? { record, id }
      : { record: id.slice(0, id.indexOf(":")), id: id.slice(id.indexOf(":") + 1) };
  return {
    [`marketing/${page}Set`]: (id: string, { text, expect }: Input) =>
      handlerCall("DraftAsk", "set", { ...item(id), text, expect }),
    [`marketing/${page}Ask`]: (id: string, { message }: Input) =>
      handlerCall("DraftAsk", "ask", { ...item(id), message }),
    [`marketing/${page}Undo`]: (id: string) => handlerCall("DraftAsk", "undo", item(id)),
  };
}
/** A template's new words. The box leaves out unchanged text, and an empty body clears it. */
const changed = ({ body }: Input) => {
  if (typeof body !== "string") throw new Error("Nothing changed.");
  return body;
};
/** A Marketing record's action: a console call to the handler behind it (`console/call`). */
const handlerCall = (
  service: string,
  handler: string,
  input: Input,
  more: Input = {},
): [string, Input] => ["console/call", { service, handler, input, ...more }];
const desk = (handler: string, input: Input) =>
  handlerCall("ContentDesk", handler, input, { key: "default" });
/** An Inbox id carries its type ("comment:12", "draft:3"); after the colon is the row's own id. */
const bare = (id: string) => id.slice(id.indexOf(":") + 1);
const num = (id: string) => Number(bare(id));
/** The words when typed; an untouched draft is left out and the desk sends the one it holds. */
const words = (body: unknown) => (typeof body === "string" ? { body } : {});
/** "idea/platform/draft": a post's idea and platform. "campaign/adset/day": an ad day's campaign. */
const head = (id: string, n: number) => id.split("/").slice(0, n);
/** Head actions that are another handler with something added. */
const AS: Record<string, [string, Input]> = {
  "delivery/note": ["delivery/post", { internal: true }],
  "marketing/activityAllSeen": handlerCall("SocialDesk", "markAllSeen", {}),
  "marketing/audienceRead": handlerCall("SocialDesk", "readAudience", { platform: "linkedin" }),
  // One RedditReads pass; the loop is never started from here.
  // A pass takes minutes: started, not awaited.
  "marketing/discoveryRead": handlerCall("RedditReads", "sync", {}, { key: "wren", send: true }),
};

/** A form's files go up first; the handler gets each one's key. */
async function uploaded(client: string | null, input: Input): Promise<Input> {
  const out = { ...input };
  for (const [k, v] of Object.entries(input))
    if (v instanceof File) out[k] = await uploadFile(client ?? undefined, v);
  return out;
}

/** Each id in turn; one alone says why it failed, several say which were skipped. */
async function eachOf(
  one: (id: string, input: Input) => [string, Input],
  input: Input,
  client: string | null,
) {
  const ids = (input.ids ?? []) as (string | number)[];
  const done: (string | number)[] = [];
  const skipped: (string | number)[] = [];
  for (const id of ids) {
    const [handler, body] = one(String(id), input);
    try {
      await call(handler, client ? { client, ...body } : body);
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
  const scope = { app: path.split("/")[1] ?? "", asClient: !props.team };
  if (page.template === "overview") {
    const Below = page.below;
    return (
      <>
        <RecordOverview
          title={page.id === "overview" ? app : page.label}
          api={apiOf(product, client, scope)}
          tiles={page.tiles}
          top={page.top}
        />
        {Below ? <Below {...props} /> : null}
      </>
    );
  }

  const here = id ? `${path}/${encodeURIComponent(id)}` : path;
  const place: Place = {
    params,
    link: (change) => href(here, change, params),
    page: (rid) => `${path}/${encodeURIComponent(String(rid))}`,
    list: path,
    go: navigate,
  };
  const { extras } = page;
  // Each action needs what its route needs, unless it says otherwise: a button the login can't
  // press is hidden.
  const actions = (page.actions ?? []).map((a) => {
    const needs = a.requires?.needs ?? permissionOf(AS[a.handler]?.[0] ?? a.handler);
    return needs ? { ...a, requires: { ...a.requires, needs } } : a;
  });
  const local = props.demo && client ? localOf(product, client, scope) : null;
  const shared = {
    record: page.record,
    title: page.label,
    api: local?.api ?? apiOf(product, client, scope),
    place,
    acts: {
      actions,
      viewer: { team: props.team, demo: props.demo, ...(props.can ? { can: props.can } : {}) },
      call:
        local?.callFor(page.record, actions) ??
        (async (handler: string, input: Input) => {
          const sent = await uploaded(client, input);
          const one = ONE[handler];
          if (one) return eachOf(one, sent, client);
          const [to, add] = AS[handler] ?? [handler, {}];
          return call(to, client ? { client, ...add, ...sent } : { ...add, ...sent });
        }),
    },
    empty: page.empty,
    example: props.demo ? page.example : undefined,
    columns: page.columns,
    extras:
      extras &&
      ((detail: unknown, row: Row, act: RecordAct) => extras(detail, { ...props, row, act })),
    head: page.head,
  };
  if (id) return <RecordPage {...shared} id={id} />;
  if (page.template === "form") return <RecordForm {...shared} />;
  if (page.template === "shop") return <RecordShop {...shared} />;
  return page.template === "queue" ? <RecordQueue {...shared} /> : <RecordList {...shared} />;
}
