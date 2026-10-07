/**
 * A page declared as data (`template: "list"`, `"queue"`, `"overview"` or `"day"`), drawn by
 * @wren/ui's templates. The record type's product serves it at /api/<product>/records*; in
 * Wren's own workspace the console serves every record. The address is the state. On the demo,
 * actions run on a copy in the browser; a reload resets it.
 */
import { WREN as CORE_WREN } from "@wren/core/access";
import type { Row } from "@wren/core/records/serve";
import {
  type AccessApi,
  type KeepApi,
  type LocalRecords,
  localRecords,
  type Place,
  type RecordAct,
  RecordDay,
  RecordForm,
  RecordList,
  RecordOverview,
  RecordPage,
  RecordQueue,
  RecordShop,
  RecordSwitch,
  type RecordsApi,
} from "@wren/ui";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { permissionOf } from "../../src/services.js";
import { call, uploadFile, viewingAs } from "./api.js";
import { type DayPage, type ListPage, type OverviewPage, type PageProps, WREN } from "./module.js";
import { notesSection } from "./modules/notes/backlinks.js";
import { href, navigate } from "./route.js";

type HeadMeta = Parameters<NonNullable<ListPage["head"]>>[0];

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
      keep: keepOf(client, scope),
      // Edits are Wren's records' for now (`@wren/core/edits`): the console serves them.
      // View as reads only: no edits.
      ...(product === "console" && !viewingAs
        ? {
            edit: (a) => ask("recordsEdit", { ...a }),
            undo: (a) => ask("recordsUndo", { ...a }),
            ask: (a) => ask("recordsAsk", { ...a }),
          }
        : {}),
      access: accessOf(client, scope),
    };
    APIS.set(key, api);
  }
  return api;
}

const ACCESS = new Map<string, AccessApi>();
/** Issues and asks on a record: the console keeps them for Wren and for every client. */
function accessOf(client: string | null, scope: Scope): AccessApi {
  const key = `${client}:${scope.asClient}`;
  let access = ACCESS.get(key);
  if (!access) {
    const ask = <T,>(handler: string, body: Record<string, unknown>) =>
      call<T>(`console/${handler}`, client ? { client, asClient: scope.asClient, ...body } : body);
    access = {
      client: client ?? CORE_WREN,
      issues: (a) => ask("issues", { ...a }),
      raise: (a) => ask("issueRaise", { ...a }),
      resolve: (id) => ask("issueResolve", { id }),
      ask: (a) => ask("accessAsk", { ...a }),
      ...(viewingAs ? { readOnly: true } : {}),
    };
    ACCESS.set(key, access);
  }
  return access;
}

const KEEPS = new Map<string, KeepApi>();
/**
 * What the viewer keeps in this workspace (saved views, prefs), served by the console for any
 * product: Wren's own apps with no client, else that client.
 */
export function keepOf(client: string | null, scope: Scope): KeepApi {
  const key = `${client}:${scope.asClient}`;
  let keep = KEEPS.get(key);
  if (!keep) {
    const ask = <T,>(handler: string, body: Record<string, unknown>) =>
      call<T>(`console/${handler}`, client ? { client, asClient: scope.asClient, ...body } : body);
    keep = {
      views: (record) => ask("savedViews", { record }),
      save: (v) => ask("saveView", { ...v }),
      remove: (id) => ask("removeView", { id }),
      move: (record, ids) => ask("moveViews", { record, ids }),
      prefs: (keys) => ask("prefs", keys ? { keys } : {}),
      setPref: (key, value) => ask("setPref", { key, value }),
    };
    KEEPS.set(key, keep);
  }
  return keep;
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
  // Access (`./modules/access`): a role's, a grant's, an issue's or an ask's id.
  "console/roleCopy": (id, { name }) => ["console/roleCopy", { id, ...(name ? { name } : {}) }],
  "console/roleGrant": (id, { verbs, apps, channels }) => [
    "console/roleGrant",
    { id, verbs, apps, channels },
  ],
  "console/roleGive": (id, { email }) => ["console/teamSet", { email, role: id }],
  "delivery/roleGive": (id, { email }) => ["delivery/invite", { email, role: id }],
  "console/roleRemove": (id) => ["console/roleRemove", { id }],
  "console/grantEnd": (id) => ["console/grantEnd", { id: Number(id) }],
  "console/issueResolve": (id) => ["console/issueResolve", { id: Number(id) }],
  "console/askApprove": (id) => ["console/askDecide", { id: Number(id), approve: true }],
  "console/askDecline": (id) => ["console/askDecide", { id: Number(id), approve: false }],
  // A template's ask in To approve (`template:4:3`, version 3); the id names the version seen.
  "templates/approve": (id) => ["templates/approve", { ids: [id] }],
  "templates/decline": (id) => ["templates/decline", { ids: [id] }],
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
  "marketing/rejectDraft": (id, { reason, note }) =>
    desk("reject", { ids: [bare(id)], reason, note }),
  "marketing/redraft": (id, { note }) => desk("redraft", { draftId: bare(id), note }),
  // A post's fields (designs/2026-10-07-post-shapes.md): a change, or a file's bytes on one.
  "marketing/draftFields": (id, { patch }) => desk("fields", { draftId: draftOf(id), patch }),
  "marketing/draftAttach": (id, { field, name, data }) =>
    desk("attach", { draftId: draftOf(id), field, name, data }),
  // Its stage, target, video and link switch (designs/2026-10-07-content-funnel.md).
  "marketing/draftFunnel": (id, { stage, to, video, linked }) =>
    desk("funnel", { draftId: draftOf(id), stage, to, video, linked }),
  // A video's promo: four model calls, so started, not awaited (designs/2026-10-07-content-funnel.md).
  "marketing/videoPromote": (id) =>
    handlerCall("ContentDesk", "promote", { video: num(id) }, { key: "default", send: true }),
  "marketing/postPromote": (id) =>
    handlerCall("ContentDesk", "promote", { draftId: draftOf(id) }, { key: "default", send: true }),
  // A video's yes, from its page or the Inbox (`video:3`).
  "marketing/videoApprove": (id, { privacy }) =>
    desk("approveVideo", { id: num(id), privacy: privacy || null }),
  "marketing/videoApproveShort": (id, { short, privacy }) =>
    desk("approveVideo", { id: num(id), short: Number(short), privacy: privacy || null }),
  "marketing/videoApproveVertical": (id, { privacy }) =>
    desk("approveVideo", { id: num(id), vertical: true, privacy: privacy || null }),
  "marketing/videoWords": (id, { wrong, right, at, text }) =>
    handlerCall("VideoDesk", "words", { id: num(id), wrong, right, at, text }),
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
  // A proposed invite (`connect:7`, or the Invites row's contact id): his yes sends it.
  "marketing/connectApprove": (id) =>
    handlerCall("ReachDesk", "approveInvites", { ids: [num(id)] }, { confirm: "approveInvites" }),
  "marketing/connectSkip": (id) => handlerCall("ReachDesk", "skipInvites", { ids: [num(id)] }),
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
  // A comment on someone else's LinkedIn post: `lipost:<id>`, posted from Wren's account.
  "marketing/lipostComment": (id, { body }) =>
    handlerCall(
      "ReachDesk",
      "commentPost",
      { id: num(id), ...words(body) },
      { confirm: "commentPost" },
    ),
  "marketing/lipostSkip": (id, { reason, note }) =>
    handlerCall("ReachDesk", "skipPost", { ids: [num(id)], reason, note }),
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
/** A post draft's id from any page's: "draft:<id>" (To approve), "idea/platform/<id>" (Posts). */
const draftOf = (id: string) => bare(id.slice(id.lastIndexOf("/") + 1));
/** The words when typed; an untouched draft is left out and the desk sends the one it holds. */
const words = (body: unknown) => (typeof body === "string" ? { body } : {});
/** "idea/platform/draft": a post's idea and platform. "campaign/adset/day": an ad day's campaign. */
const head = (id: string, n: number) => id.split("/").slice(0, n);
/** A client's draft verdicts: its own Marketing service, which checks its approver. */
const CLIENT_ONE: Record<string, (id: string, input: Input) => [string, Input]> = {
  "marketing/approveDraft": (id) => ["marketing/approveDraft", { ids: [bare(id)] }],
  "marketing/rejectDraft": (id, { reason, note }) => [
    "marketing/rejectDraft",
    { ids: [bare(id)], reason, note },
  ],
  "marketing/redraft": (id, { note }) => ["marketing/redraft", { draftId: bare(id), note }],
  "marketing/draftFields": (id, { patch }) => [
    "marketing/draftFields",
    { draftId: draftOf(id), patch },
  ],
  "marketing/draftAttach": (id, { field, name, data }) => [
    "marketing/draftAttach",
    { draftId: draftOf(id), field, name, data },
  ],
  "marketing/draftFunnel": (id, { stage, to, video, linked }) => [
    "marketing/draftFunnel",
    { draftId: draftOf(id), stage, to, video, linked },
  ],
};
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

/** A page's actions as the portal runs them: one record's handler per id, else as named. */
const callOf =
  (client: string | null) =>
  async (handler: string, input: Input): Promise<unknown> => {
    const sent = await uploaded(client, input);
    const one = (client && CLIENT_ONE[handler]) || ONE[handler];
    if (one) return eachOf(one, sent, client);
    const [to, add] = AS[handler] ?? [handler, {}];
    return call(to, client ? { client, ...add, ...sent } : { ...add, ...sent });
  };

export function TemplatePage({
  page,
  path,
  id,
  app,
  ...props
}: PageProps & {
  page: ListPage | OverviewPage | DayPage;
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
  const record =
    page.template === "overview"
      ? (page.tiles[0]?.record ?? "")
      : page.template === "day"
        ? (page.sources[0]?.record ?? "")
        : page.record;
  // The console serves Wren's records, and access's anywhere.
  const product = wren || record.startsWith("access.") ? "console" : (record.split(".")[0] ?? "");
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
          keepAs={props.demo ? undefined : `tiles:${path.split("/").filter(Boolean).join(".")}`}
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
  // Each action needs what its route needs, unless it says otherwise: a button the login can't
  // press is hidden.
  // View as reads only: no actions.
  const actions = (viewingAs ? [] : (page.actions ?? [])).map((a) => {
    const needs = a.requires?.needs ?? permissionOf(AS[a.handler]?.[0] ?? a.handler);
    return needs ? { ...a, requires: { ...a.requires, needs } } : a;
  });
  const viewer = {
    team: props.team,
    demo: props.demo,
    ...(props.can ? { can: props.can } : {}),
    ...(props.who !== undefined ? { who: props.who } : {}),
  };
  const local = props.demo && client ? localOf(product, client, scope) : null;
  const api = local?.api ?? apiOf(product, client, scope);
  // A filter across the top that the page's own list reads: Content's platforms.
  const { across } = page;
  const switched = (body: ReactNode, list?: string) =>
    across ? (
      <RecordSwitch
        api={api}
        place={place}
        field={across.field}
        label={across.label}
        waits={across.waits}
        record={list}
      >
        {body}
      </RecordSwitch>
    ) : (
      body
    );
  if (page.template === "day")
    return switched(
      <RecordDay
        title={page.label}
        api={api}
        place={place}
        sources={page.sources}
        by={page.by}
        acts={{ actions, viewer, call: callOf(client) }}
      />,
    );

  const { extras, head } = page;
  const shared = {
    record: page.record,
    title: page.label,
    api,
    place,
    acts: {
      actions,
      viewer,
      call: local?.callFor(page.record, actions) ?? callOf(client),
    },
    empty: page.empty,
    example: props.demo ? page.example : undefined,
    columns: page.columns,
    sections: page.sections,
    // Every record lists the notes that @ it, after its own sections.
    extras: (detail: unknown, row: Row, act: RecordAct) => {
      const own = extras ? extras(detail, { ...props, row, act }) : {};
      const notes = notesSection(props, page.record, String(row.id));
      return notes ? { ...own, sections: [...(own.sections ?? []), notes] } : own;
    },
    // The page's head sees whose page it is, as its extras do.
    head: head && ((meta: HeadMeta, reload: () => void) => head(meta, reload, props)),
  };
  if (id) return <RecordPage {...shared} id={id} />;
  if (page.template === "form") return <RecordForm {...shared} />;
  if (page.template === "shop") return <RecordShop {...shared} />;
  return switched(
    page.template === "queue" ? <RecordQueue {...shared} /> : <RecordList {...shared} />,
    page.record,
  );
}
