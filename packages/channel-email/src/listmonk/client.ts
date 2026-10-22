/**
 * A thin client for Listmonk's REST API (designs/2026-10-21-esign-and-newsletter.md). Listmonk has
 * no maintained TypeScript SDK, so this covers the dozen calls the newsletter uses and no more.
 * Every shape here was probed against Listmonk 6.2.0. The API user's token goes in one header and
 * never in a log line or an error.
 */
import { z } from "zod";
import type { FetchLike } from "../fetch-like.js";

export interface ListmonkConfig {
  /** Base URL, no trailing path: `https://lists.example.test`. */
  url: string;
  user: string;
  token: string;
  fetch?: FetchLike;
}

export class ListmonkError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`listmonk ${status}: ${message}`);
  }
}

const SUB_LIST = z.looseObject({
  id: z.number(),
  subscription_status: z.string(),
  subscription_updated_at: z.string().nullish(),
});
const SUBSCRIBER = z.looseObject({
  id: z.number(),
  email: z.string(),
  name: z.string().nullish(),
  status: z.string(),
  updated_at: z.string().nullish(),
  lists: z.array(SUB_LIST).default([]),
});
const LIST = z.looseObject({
  id: z.number(),
  name: z.string(),
  tags: z.array(z.string()).nullish(),
});
const CAMPAIGN = z.looseObject({
  id: z.number(),
  uuid: z.string(),
  name: z.string(),
  status: z.string(),
  to_send: z.number().nullish(),
  sent: z.number().nullish(),
  tags: z.array(z.string()).nullish(),
});
const TEMPLATE = z.looseObject({ id: z.number(), name: z.string(), type: z.string() });

export type ListmonkSubscriber = z.infer<typeof SUBSCRIBER>;
export type ListmonkList = z.infer<typeof LIST>;
export type ListmonkCampaign = z.infer<typeof CAMPAIGN>;

const rows = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.object({ results: z.array(item) }) });
const one = <T extends z.ZodType>(item: T) => z.object({ data: item });

export type SettingsMap = Record<string, unknown>;

export function listmonk(cfg: ListmonkConfig) {
  const base = cfg.url.replace(/\/+$/, "");
  const doFetch: FetchLike = cfg.fetch ?? ((u, i) => fetch(u, i));

  async function call<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<z.infer<S>> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `token ${cfg.user}:${cfg.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text.slice(0, 200);
      try {
        message = String((JSON.parse(text) as { message?: unknown }).message ?? message);
      } catch {}
      throw new ListmonkError(res.status, message);
    }
    return schema.parse(text ? JSON.parse(text) : {});
  }
  const ok = z.object({ data: z.unknown() });

  return {
    lists: async () => (await call("GET", "/api/lists?per_page=all", rows(LIST))).data.results,

    async createList(o: { name: string; tags: string[] }) {
      return (
        await call(
          "POST",
          "/api/lists",
          one(LIST),
          // Private: no public page offers it. Single opt-in: Wren already confirmed the person.
          { name: o.name, type: "private", optin: "single", tags: o.tags },
        )
      ).data;
    },

    /** Every subscriber, each with its subscription on every list. */
    subscribers: async () =>
      (await call("GET", "/api/subscribers?per_page=all", rows(SUBSCRIBER))).data.results,

    /** A new subscriber, already confirmed on `listId`. A 409 means the address exists: add it instead. */
    async createSubscriber(o: { email: string; name: string; listId: number }) {
      return (
        await call("POST", "/api/subscribers", one(SUBSCRIBER), {
          email: o.email,
          name: o.name,
          status: "enabled",
          lists: [o.listId],
          preconfirm_subscriptions: true,
        })
      ).data;
    },

    /** Put existing subscribers on a list as confirmed, or take them off as unsubscribed (the row stays). */
    async setSubscription(ids: number[], listId: number, action: "add" | "unsubscribe") {
      if (ids.length === 0) return;
      await call("PUT", "/api/subscribers/lists", ok, {
        ids,
        action,
        target_list_ids: [listId],
        ...(action === "add" ? { status: "confirmed" } : {}),
      });
    },

    templates: async () =>
      (await call("GET", "/api/templates", z.object({ data: z.array(TEMPLATE) }))).data,

    async createTemplate(o: { name: string; body: string }) {
      return (
        await call("POST", "/api/templates", one(TEMPLATE), {
          name: o.name,
          type: "campaign",
          subject: "",
          body: o.body,
        })
      ).data;
    },

    settings: async () =>
      (await call("GET", "/api/settings", one(z.record(z.string(), z.unknown())))).data,

    /** Listmonk reloads itself after this: wait for the next call to answer. */
    async putSettings(all: SettingsMap) {
      await call("PUT", "/api/settings", ok, all);
    },

    campaigns: async (query: string) =>
      (
        await call(
          "GET",
          `/api/campaigns?per_page=all&query=${encodeURIComponent(query)}`,
          rows(CAMPAIGN),
        )
      ).data.results,

    campaign: async (id: number) => (await call("GET", `/api/campaigns/${id}`, one(CAMPAIGN))).data,

    async createCampaign(o: {
      name: string;
      subject: string;
      listIds: number[];
      body: string;
      templateId: number;
      messenger: string;
      tags: string[];
    }) {
      return (
        await call("POST", "/api/campaigns", one(CAMPAIGN), {
          name: o.name,
          subject: o.subject,
          lists: o.listIds,
          type: "regular",
          content_type: "plain",
          body: o.body,
          messenger: o.messenger,
          template_id: o.templateId,
          tags: o.tags,
        })
      ).data;
    },

    async setCampaignStatus(id: number, status: "running" | "paused" | "cancelled") {
      await call("PUT", `/api/campaigns/${id}/status`, ok, { status });
    },
  };
}

export type Listmonk = ReturnType<typeof listmonk>;

/** Listmonk renders a campaign body as a Go template: a literal `{{` in a post must not open an action. */
export const escapeTemplate = (text: string) => text.replaceAll("{{", '{{ "{{" }}');
