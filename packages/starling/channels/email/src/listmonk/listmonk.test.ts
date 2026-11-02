/**
 * The Listmonk client against a fake `fetch`, and the sync planner. Every payload is synthetic;
 * the shapes were probed against Listmonk 6.2.0.
 */
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../fetch-like.js";
import { escapeTemplate, ListmonkError, type ListmonkSubscriber, listmonk } from "./client.js";
import { applySetup, settingsFor } from "./setup.js";
import { planTopic, syncTopic, topicTag, type WrenConsent } from "./sync.js";

type Call = { method: string; path: string; body: unknown; auth: string | null };

/** A fake Listmonk: answers by "METHOD path" with a status and a JSON body. */
function fake(routes: Record<string, [number, unknown] | ((body: unknown) => [number, unknown])>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const key = `${init?.method ?? "GET"} ${u.pathname}${u.search}`;
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method: init?.method ?? "GET",
      path: `${u.pathname}${u.search}`,
      body,
      auth: headers.get("authorization"),
    });
    const route = routes[key];
    if (!route)
      return new Response(JSON.stringify({ message: `no route ${key}` }), { status: 404 });
    const [status, out] = typeof route === "function" ? route(body) : route;
    return new Response(JSON.stringify(out), { status });
  };
  return { fetch, calls };
}

const cfg = (f: FetchLike) => ({
  url: "https://lists.example.test/",
  user: "wren",
  token: "tok",
  fetch: f,
});

const sub = (
  id: number,
  email: string,
  o: { status?: string; at?: string; lists?: [number, string, string][] } = {},
): ListmonkSubscriber => ({
  id,
  email,
  name: email,
  status: o.status ?? "enabled",
  updated_at: o.at ?? "2026-10-01T00:00:00Z",
  lists: (o.lists ?? []).map(([lid, st, at]) => ({
    id: lid,
    subscription_status: st,
    subscription_updated_at: at,
  })),
});

const consent = (consentId: number, address: string, state: string, at: string): WrenConsent => ({
  consentId,
  address,
  state,
  changedAt: new Date(at),
});

describe("the client", () => {
  it("sends the token in one header and trims the base URL", async () => {
    const { fetch, calls } = fake({
      "GET /api/lists?per_page=all": [
        200,
        { data: { results: [{ id: 3, name: "News", tags: ["a"] }] } },
      ],
    });
    const lists = await listmonk(cfg(fetch)).lists();
    expect(lists).toEqual([{ id: 3, name: "News", tags: ["a"] }]);
    expect(calls[0]?.auth).toBe("token wren:tok");
  });

  it("raises the server's message with its status, and never the token", async () => {
    const { fetch } = fake({
      "POST /api/subscribers": [409, { message: "E-mail already exists." }],
    });
    const err = await listmonk(cfg(fetch))
      .createSubscriber({ email: "a@example.test", name: "a", listId: 1 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ListmonkError);
    expect((err as ListmonkError).status).toBe(409);
    expect((err as Error).message).toContain("E-mail already exists.");
    expect((err as Error).message).not.toContain("tok");
  });

  it("makes a private single opt-in list with the topic tag", async () => {
    const { fetch, calls } = fake({
      "POST /api/lists": [200, { data: { id: 7, name: "Posts", tags: ["wren-topic:blog"] } }],
    });
    await listmonk(cfg(fetch)).createList({ name: "Posts", tags: [topicTag("blog")] });
    expect(calls[0]?.body).toEqual({
      name: "Posts",
      type: "private",
      optin: "single",
      tags: ["wren-topic:blog"],
    });
  });

  it("adds as confirmed, unsubscribes without a status, and skips an empty set", async () => {
    const { fetch, calls } = fake({ "PUT /api/subscribers/lists": [200, { data: true }] });
    const lm = listmonk(cfg(fetch));
    await lm.setSubscription([], 1, "add");
    await lm.setSubscription([4, 5], 1, "add");
    await lm.setSubscription([6], 1, "unsubscribe");
    expect(calls.map((c) => c.body)).toEqual([
      { ids: [4, 5], action: "add", target_list_ids: [1], status: "confirmed" },
      { ids: [6], action: "unsubscribe", target_list_ids: [1] },
    ]);
  });

  it("makes a plain campaign on the postback messenger with its template", async () => {
    const { fetch, calls } = fake({
      "POST /api/campaigns": [
        200,
        { data: { id: 9, uuid: "u-9", name: "issue", status: "draft", tags: ["issue:blog:x"] } },
      ],
    });
    const c = await listmonk(cfg(fetch)).createCampaign({
      name: "issue:blog:x",
      subject: "S",
      listIds: [7],
      body: "text",
      templateId: 2,
      messenger: "wren",
      tags: ["issue:blog:x"],
    });
    expect(c.uuid).toBe("u-9");
    expect(calls[0]?.body).toMatchObject({
      type: "regular",
      content_type: "plain",
      messenger: "wren",
      template_id: 2,
      lists: [7],
    });
  });

  it("escapes a literal {{ so Listmonk's template engine leaves post text alone", () => {
    expect(escapeTemplate("use {{x}} here")).toBe('use {{ "{{" }}x}} here');
    expect(escapeTemplate("plain")).toBe("plain");
  });
});

describe("the sync plan", () => {
  const L = 7;
  const on = (at = "2026-10-01T00:00:00Z"): [number, string, string] => [L, "confirmed", at];

  it("creates a confirmed consent Listmonk does not know", () => {
    const plan = planTopic({
      consents: [consent(1, "A@Example.test", "confirmed", "2026-10-02T00:00:00Z")],
      subscribers: [],
      listId: L,
    });
    expect(plan.create).toEqual(["A@Example.test"]);
  });

  it("matches addresses without regard to case", () => {
    const plan = planTopic({
      consents: [consent(1, "a@example.test", "confirmed", "2026-10-02T00:00:00Z")],
      subscribers: [sub(10, "A@EXAMPLE.test", { lists: [on()] })],
      listId: L,
    });
    expect(plan).toEqual({ create: [], add: [], remove: [], withdraw: [] });
  });

  it("puts a known subscriber who is not on the list onto it", () => {
    const plan = planTopic({
      consents: [consent(1, "a@example.test", "confirmed", "2026-10-02T00:00:00Z")],
      subscribers: [sub(10, "a@example.test", { lists: [] })],
      listId: L,
    });
    expect(plan.add).toEqual([10]);
  });

  it("takes a withdrawn consent off the list", () => {
    const plan = planTopic({
      consents: [consent(1, "a@example.test", "withdrawn", "2026-10-02T00:00:00Z")],
      subscribers: [sub(10, "a@example.test", { lists: [on()] })],
      listId: L,
    });
    expect(plan.remove).toEqual([10]);
  });

  it("leaves a withdrawn consent alone when Listmonk already has it off", () => {
    const plan = planTopic({
      consents: [consent(1, "a@example.test", "withdrawn", "2026-10-02T00:00:00Z")],
      subscribers: [
        sub(10, "a@example.test", { lists: [[L, "unsubscribed", "2026-10-03T00:00:00Z"]] }),
      ],
      listId: L,
    });
    expect(plan).toEqual({ create: [], add: [], remove: [], withdraw: [] });
  });

  it("withdraws in Wren when Listmonk took the person off after Wren's last word", () => {
    const plan = planTopic({
      consents: [consent(1, "a@example.test", "confirmed", "2026-10-02T00:00:00Z")],
      subscribers: [
        sub(10, "a@example.test", { lists: [[L, "unsubscribed", "2026-10-05T00:00:00Z"]] }),
      ],
      listId: L,
    });
    expect(plan.withdraw).toEqual([{ consentId: 1, address: "a@example.test" }]);
    expect(plan.add).toEqual([]);
  });

  it("lets a later re-confirm in Wren win over an older unsubscribe in Listmonk", () => {
    const plan = planTopic({
      consents: [consent(1, "a@example.test", "confirmed", "2026-10-09T00:00:00Z")],
      subscribers: [
        sub(10, "a@example.test", { lists: [[L, "unsubscribed", "2026-10-05T00:00:00Z"]] }),
      ],
      listId: L,
    });
    expect(plan.withdraw).toEqual([]);
    expect(plan.add).toEqual([10]);
  });

  it("treats a blocklisted subscriber as off every list, at the subscriber's update time", () => {
    const plan = planTopic({
      consents: [consent(1, "a@example.test", "confirmed", "2026-10-02T00:00:00Z")],
      subscribers: [
        sub(10, "a@example.test", {
          status: "blocklisted",
          at: "2026-10-06T00:00:00Z",
          lists: [on()],
        }),
      ],
      listId: L,
    });
    expect(plan.withdraw).toHaveLength(1);
  });

  it("does not ping-pong: after the sync, a second plan is empty", () => {
    // Wren confirmed; Listmonk had it unsubscribed earlier. Wren adds it back. Next read: on, newer.
    const plan = planTopic({
      consents: [consent(1, "a@example.test", "confirmed", "2026-10-09T00:00:00Z")],
      subscribers: [
        sub(10, "a@example.test", { lists: [[L, "confirmed", "2026-10-10T00:00:00Z"]] }),
      ],
      listId: L,
    });
    expect(plan).toEqual({ create: [], add: [], remove: [], withdraw: [] });
  });
});

describe("syncTopic", () => {
  it("makes the list when none carries the topic tag, then creates and adds", async () => {
    const created: unknown[] = [];
    const { fetch, calls } = fake({
      "GET /api/lists?per_page=all": [
        200,
        { data: { results: [{ id: 1, name: "Other", tags: ["x"] }] } },
      ],
      "POST /api/lists": [200, { data: { id: 8, name: "Posts", tags: ["wren-topic:blog"] } }],
      "GET /api/subscribers?per_page=all": [200, { data: { results: [] } }],
      "POST /api/subscribers": (b) => {
        created.push(b);
        return [
          200,
          {
            data: sub(31, "new@example.test", {
              lists: [[8, "confirmed", "2026-10-10T00:00:00Z"]],
            }),
          },
        ];
      },
      "PUT /api/subscribers/lists": [200, { data: true }],
    });
    const out = await syncTopic({
      lm: listmonk(cfg(fetch)),
      topic: "blog",
      publicName: "Posts",
      consents: [consent(1, "new@example.test", "confirmed", "2026-10-02T00:00:00Z")],
      withdraw: async () => {},
    });
    expect(out).toMatchObject({
      topic: "blog",
      listId: 8,
      create: 1,
      add: 0,
      remove: 0,
      withdraw: 0,
    });
    expect(created).toEqual([
      expect.objectContaining({
        email: "new@example.test",
        name: "new",
        lists: [8],
        preconfirm_subscriptions: true,
      }),
    ]);
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/lists")).toBe(true);
  });

  it("falls back to an add by id when the address already exists (409)", async () => {
    const { fetch, calls } = fake({
      "GET /api/lists?per_page=all": [
        200,
        { data: { results: [{ id: 8, name: "Posts", tags: ["wren-topic:blog"] }] } },
      ],
      "GET /api/subscribers?per_page=all": (() => {
        let n = 0;
        return () =>
          (n++ === 0
            ? [200, { data: { results: [] } }]
            : [200, { data: { results: [sub(40, "Dup@Example.test")] } }]) as [number, unknown];
      })(),
      "POST /api/subscribers": [409, { message: "exists" }],
      "PUT /api/subscribers/lists": [200, { data: true }],
    });
    const out = await syncTopic({
      lm: listmonk(cfg(fetch)),
      topic: "blog",
      consents: [consent(1, "dup@example.test", "confirmed", "2026-10-02T00:00:00Z")],
      withdraw: async () => {},
    });
    expect(out.create).toBe(1);
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body).toMatchObject({ ids: [40], action: "add", target_list_ids: [8] });
  });

  it("hands a Listmonk-side unsubscribe to Wren", async () => {
    const withdrawn: unknown[] = [];
    const { fetch } = fake({
      "GET /api/lists?per_page=all": [
        200,
        { data: { results: [{ id: 8, name: "Posts", tags: ["wren-topic:blog"] }] } },
      ],
      "GET /api/subscribers?per_page=all": [
        200,
        {
          data: {
            results: [
              sub(10, "a@example.test", { lists: [[8, "unsubscribed", "2026-10-05T00:00:00Z"]] }),
            ],
          },
        },
      ],
    });
    const out = await syncTopic({
      lm: listmonk(cfg(fetch)),
      topic: "blog",
      consents: [consent(1, "a@example.test", "confirmed", "2026-10-02T00:00:00Z")],
      withdraw: async (c) => void withdrawn.push(c),
    });
    expect(out.withdraw).toBe(1);
    expect(withdrawn).toEqual([{ consentId: 1, address: "a@example.test" }]);
  });
});

describe("setup", () => {
  const opts = {
    rootUrl: "https://lists.example.test",
    intakeUrl: "http://127.0.0.1:8080/ListmonkIntake/post",
  };

  it("sets the rate, turns tracking and public pages off, and adds the messenger", () => {
    const { settings, unknown } = settingsFor(
      {
        "app.root_url": "http://localhost:9000",
        "app.check_updates": true,
        "app.concurrency": 10,
        "app.message_rate": 10,
        "app.message_sliding_window": false,
        "app.message_sliding_window_duration": "1h",
        "app.message_sliding_window_rate": 10000,
        "app.enable_public_subscription_page": true,
        "app.enable_public_archive": true,
        "privacy.individual_tracking": true,
        "privacy.disable_tracking": false,
        messengers: [],
      },
      opts,
    );
    expect(unknown).toEqual([]);
    expect(settings).toMatchObject({
      "app.root_url": "https://lists.example.test",
      "app.concurrency": 1,
      "app.message_rate": 1,
      "app.message_sliding_window": true,
      "app.message_sliding_window_duration": "24h",
      "app.message_sliding_window_rate": 1500,
      "app.enable_public_subscription_page": false,
      "privacy.disable_tracking": true,
    });
    expect(settings.messengers).toEqual([
      expect.objectContaining({
        name: "wren",
        enabled: true,
        root_url: opts.intakeUrl,
        retries: 0,
      }),
    ]);
  });

  it("replaces its own messenger, keeps the others, and reports a key this Listmonk lacks", () => {
    const { settings, unknown } = settingsFor(
      { "app.root_url": "x", messengers: [{ name: "wren", root_url: "old" }, { name: "other" }] },
      opts,
    );
    expect(
      (settings.messengers as { name: string; root_url: string }[]).map((m) => m.name),
    ).toEqual(["other", "wren"]);
    expect(unknown).toContain("app.message_rate");
    expect(settings).not.toHaveProperty("app.message_rate");
  });

  it("applies once and waits for the restart", async () => {
    let gets = 0;
    const { fetch, calls } = fake({
      "GET /api/settings": () => {
        gets++;
        // The second read, right after the PUT, finds Listmonk still restarting.
        return gets === 2
          ? [502, { message: "bad gateway" }]
          : [200, { data: { "app.root_url": "x", messengers: [] } }];
      },
      "PUT /api/settings": [200, { data: true }],
      "GET /api/templates": [200, { data: [{ id: 4, name: "wren plain", type: "campaign" }] }],
    });
    const out = await applySetup(listmonk(cfg(fetch)), opts, { tries: 3, gapMs: 1 });
    expect(out.templateId).toBe(4);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });
});
